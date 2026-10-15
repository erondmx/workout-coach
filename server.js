import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultPlan } from './defaultPlan.js';
import { askCoach } from './coach.js';
import { DAYS, checkToken, computeAssess, computeHints, makeToken, rollover, safeEqual, todayStr } from './lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const TZ = process.env.TZ_APP || 'America/Sao_Paulo';
const APP_PASSWORD = process.env.APP_PASSWORD;

if (!APP_PASSWORD || APP_PASSWORD.length < 8) {
  console.error('Defina APP_PASSWORD (mín. 8 caracteres) no ambiente.');
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(DATA_DIR, 'secret.txt');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}
const SECRET = loadSecret();

// ---------- armazenamento (JSON com escrita atômica) ----------
const DB_FILE = path.join(DATA_DIR, 'db.json');

function freshDb() {
  return {
    plan: structuredClone(defaultPlan),
    planHistory: [],
    weights: {},
    progress: { date: todayStr(TZ), day: 'A', sets: {}, setReps: {}, note: '' },
    history: [],
    chat: [],
  };
}

let db;
try {
  db = { ...freshDb(), ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) };
} catch {
  db = freshDb();
}

function save() {
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}

// ---------- app ----------
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  });
  next();
});

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const fails = new Map(); // ip -> { n, until }
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const f = fails.get(ip);
  if (f && f.n >= 5 && f.until > Date.now()) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
  }
  const ok = safeEqual(req.body?.password ?? '', APP_PASSWORD);
  if (!ok) {
    const n = (f && f.until > Date.now() ? f.n : 0) + 1;
    fails.set(ip, { n, until: Date.now() + 15 * 60 * 1000 });
    return res.status(401).json({ error: 'Senha incorreta' });
  }
  fails.delete(ip);
  const flags = ['HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${90 * 24 * 3600}`];
  if (req.secure) flags.push('Secure');
  res.set('Set-Cookie', `sid=${encodeURIComponent(makeToken(SECRET))}; ${flags.join('; ')}`);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.set('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

function auth(req, res, next) {
  if (checkToken(SECRET, cookies(req).sid)) return next();
  res.status(401).json({ error: 'Não autenticado' });
}

function view() {
  if (rollover(db, todayStr(TZ))) save();
  db.progress.setReps ??= {};
  return {
    plan: db.plan,
    weights: db.weights,
    progress: db.progress,
    hints: computeHints(db),
    assess: computeAssess(db),
    chat: db.chat.slice(-40),
    canUndo: db.planHistory.length > 0,
    coachEnabled: Boolean(process.env.OPENROUTER_API_KEY),
  };
}

const ID_RE = /^[a-z0-9_-]{1,24}$/;

app.get('/api/state', auth, (req, res) => res.json(view()));

app.put('/api/state', auth, (req, res) => {
  view(); // garante rollover antes de gravar
  const { sets, weights, setReps, day } = req.body || {};
  if (sets && typeof sets === 'object') {
    const clean = {};
    for (const [id, arr] of Object.entries(sets)) {
      if (ID_RE.test(id) && Array.isArray(arr)) {
        clean[id] = arr.filter((n) => Number.isInteger(n) && n >= 1 && n <= 10);
      }
    }
    db.progress.sets = clean;
  }
  // weights, reps e effort chegam completos do cliente: substituem o que havia.
  if (weights && typeof weights === 'object') {
    const clean = {};
    for (const [id, w] of Object.entries(weights)) {
      const n = Number(w);
      if (ID_RE.test(id) && w !== '' && w != null && Number.isFinite(n) && n >= 0 && n <= 1000) clean[id] = n;
    }
    db.weights = clean;
  }
  if (setReps && typeof setReps === 'object') {
    const clean = {};
    for (const [id, bySet] of Object.entries(setReps)) {
      if (!ID_RE.test(id) || !bySet || typeof bySet !== 'object') continue;
      for (const [k, r] of Object.entries(bySet)) {
        const set = Number(k);
        const n = Number(r);
        if (Number.isInteger(set) && set >= 1 && set <= 10 && r !== '' && r != null && Number.isInteger(n) && n >= 0 && n <= 200) {
          (clean[id] ||= {})[set] = n;
        }
      }
    }
    db.progress.setReps = clean;
  }
  if (DAYS.includes(day)) db.progress.day = day;
  save();
  res.json({ ok: true, assess: computeAssess(db) });
});

app.post('/api/reset-day', auth, (req, res) => {
  view();
  db.progress.sets = {};
  db.progress.setReps = {};
  save();
  res.json(view());
});

let coachBusy = false;
app.post('/api/coach', auth, async (req, res) => {
  const text = String(req.body?.message ?? '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'Mensagem vazia' });
  if (coachBusy) return res.status(429).json({ error: 'O coach ainda está respondendo.' });
  coachBusy = true;
  try {
    view();
    const { reply, changes } = await askCoach(db, text);
    if (changes.length) {
      db.planHistory.push({ at: new Date().toISOString(), plan: structuredClone(db.plan) });
      db.planHistory = db.planHistory.slice(-10);
      for (const c of changes) {
        db.plan[c.day] = c.plan;
        // remove progresso de séries de exercícios que não existem mais
        const ids = new Set(Object.values(db.plan).flatMap((d) => d.exercises.map((e) => e.id)));
        for (const bag of [db.progress.sets, db.progress.setReps]) {
          for (const id of Object.keys(bag)) if (!ids.has(id)) delete bag[id];
        }
      }
    }
    db.chat.push({ role: 'user', text });
    db.chat.push({ role: 'assistant', text: reply, changed: changes.map((c) => c.day) });
    db.chat = db.chat.slice(-60);
    save();
    res.json({ reply, changed: changes.map((c) => c.day), state: view() });
  } catch (err) {
    console.error('coach error:', err.message);
    const status = err.status === 503 ? 503 : 502;
    res.status(status).json({ error: status === 503 ? err.message : 'Falha ao falar com o coach. Tente de novo.' });
  } finally {
    coachBusy = false;
  }
});

app.post('/api/plan/undo', auth, (req, res) => {
  const prev = db.planHistory.pop();
  if (!prev) return res.status(400).json({ error: 'Nada para desfazer' });
  db.plan = prev.plan;
  save();
  res.json(view());
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));

app.listen(PORT, () => console.log(`Workout Coach em http://0.0.0.0:${PORT}`));
