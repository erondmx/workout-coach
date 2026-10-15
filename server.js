import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultPlan } from './defaultPlan.js';
import { askCoach } from './coach.js';
import { DAY_LETTERS, applySwaps, assertUniqueIds, lastSessions, checkToken, computeAssess, computeHints, makeToken, rollover, safeEqual, sanitizeImages, swapId, todayStr } from './lib.js';

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
    progress: { date: todayStr(TZ), day: 'A', sets: {}, setReps: {}, setWeights: {}, swaps: {}, note: '' },
    history: [],
    chat: [],
    notes: {},
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
const jsonSmall = express.json({ limit: '100kb' });
app.use((req, res, next) => (req.path === '/api/coach' ? next() : jsonSmall(req, res, next)));
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
  db.progress.setWeights ??= {};
  db.progress.swaps ??= {};
  if (!db.plan[db.progress.day]) db.progress.day = Object.keys(db.plan)[0];
  return {
    plan: applySwaps(db.plan, db.progress.swaps),
    weights: db.weights,
    progress: db.progress,
    hints: computeHints(db),
    notes: db.notes,
    last: lastSessions(db),
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
  const { sets, weights, setReps, setWeights, day } = req.body || {};
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
  if (setWeights && typeof setWeights === 'object') {
    const clean = {};
    for (const [id, bySet] of Object.entries(setWeights)) {
      if (!ID_RE.test(id) || !bySet || typeof bySet !== 'object') continue;
      for (const [k, w] of Object.entries(bySet)) {
        const set = Number(k);
        const n = Number(w);
        if (Number.isInteger(set) && set >= 1 && set <= 10 && w !== '' && w != null && Number.isFinite(n) && n > 0 && n <= 1000) {
          (clean[id] ||= {})[set] = n;
        }
      }
    }
    db.progress.setWeights = clean;
  }
  if (DAY_LETTERS.includes(day) && db.plan[day]) db.progress.day = day;
  save();
  res.json({ ok: true, assess: computeAssess(db) });
});

// Anotação persistente por exercício (vale para todos os treinos seguintes). Texto vazio apaga.
app.put('/api/notes', auth, (req, res) => {
  const id = String(req.body?.id ?? '');
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'exercício inválido' });
  const text = String(req.body?.text ?? '').slice(0, 1000);
  db.notes ??= {};
  if (text.trim()) db.notes[id] = text;
  else delete db.notes[id];
  save();
  res.json({ ok: true });
});

app.post('/api/reset-day', auth, (req, res) => {
  view();
  db.progress.sets = {};
  db.progress.setReps = {};
  db.progress.setWeights = {};
  db.progress.swaps = {};
  save();
  res.json(view());
});

let coachBusy = false;
app.post('/api/coach', auth, express.json({ limit: '12mb' }), async (req, res) => {
  let images;
  try {
    images = sanitizeImages(req.body?.images);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const text = String(req.body?.message ?? '').trim().slice(0, 2000) || (images.length ? 'Veja as fotos.' : '');
  if (!text) return res.status(400).json({ error: 'Mensagem vazia' });
  if (coachBusy) return res.status(429).json({ error: 'O coach ainda está respondendo.' });
  coachBusy = true;
  try {
    view();
    const { reply: coachReply, changes, swaps, replace } = await askCoach(db, text, images);
    let reply = coachReply;
    let planChanged = [];
    if (replace || changes.length) {
      const next = replace ? structuredClone(replace.plan) : structuredClone(db.plan);
      if (!replace) for (const c of changes) next[c.day] = c.plan;
      try {
        assertUniqueIds(next); // ids únicos no plano todo: cargas e histórico são guardados por id
        db.planHistory.push({ at: new Date().toISOString(), plan: structuredClone(db.plan) });
        db.planHistory = db.planHistory.slice(-10);
        db.plan = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
        planChanged = replace ? Object.keys(db.plan) : changes.map((c) => c.day);
        // o histórico (db.history) e as cargas (db.weights) NÃO são tocados: continuam valendo por id de exercício
        if (!db.plan[db.progress.day]) db.progress.day = Object.keys(db.plan)[0];
        const ids = new Set(Object.values(db.plan).flatMap((d) => d.exercises.map((e) => e.id)));
        for (const id of Object.keys(db.progress.swaps)) {
          if (ids.has(id)) ids.add(swapId(id));
          else delete db.progress.swaps[id];
        }
        // só o progresso de HOJE de exercícios que deixaram de existir é descartado
        for (const bag of [db.progress.sets, db.progress.setReps, db.progress.setWeights]) {
          for (const id of Object.keys(bag)) if (!ids.has(id)) delete bag[id];
        }
      } catch (err) {
        reply += `\n\n(Não apliquei a mudança de plano: ${err.message}.)`;
      }
    }
    for (const s of swaps) if (Object.values(db.plan).some((d) => d.exercises.some((e) => e.id === s.id))) db.progress.swaps[s.id] = s.swap;
    db.chat.push({ role: 'user', text, photos: images.length });
    db.chat.push({ role: 'assistant', text: reply, changed: planChanged, swapped: swaps.map((x) => x.swap.name) });
    db.chat = db.chat.slice(-60);
    save();
    res.json({ reply, changed: planChanged, swapped: swaps.length, state: view() });
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
