import crypto from 'node:crypto';

const ID_RE = /^[a-z0-9_-]{1,24}$/;
export const DAYS = ['A', 'B', 'C'];

// Valida e normaliza um dia de treino vindo do LLM. Lança Error com mensagem clara.
export function sanitizeDay(day) {
  if (!day || typeof day !== 'object') throw new Error('dia inválido');
  const exercises = day.exercises;
  if (!Array.isArray(exercises) || exercises.length < 1 || exercises.length > 20) {
    throw new Error('lista de exercícios inválida (1 a 20)');
  }
  const seen = new Set();
  const clean = exercises.map((ex) => {
    if (!ex || typeof ex !== 'object') throw new Error('exercício inválido');
    const id = String(ex.id || '').toLowerCase();
    if (!ID_RE.test(id)) throw new Error(`id inválido: ${ex.id}`);
    if (seen.has(id)) throw new Error(`id duplicado: ${id}`);
    seen.add(id);
    const sets = Number(ex.sets);
    if (!Number.isInteger(sets) || sets < 1 || sets > 10) throw new Error(`séries inválidas em ${id}`);
    const name = String(ex.name || '').trim().slice(0, 120);
    const reps = String(ex.reps || '').trim().slice(0, 120);
    if (!name || !reps) throw new Error(`nome/reps vazios em ${id}`);
    const out = { id, name, sets, reps };
    if (ex.isCardio) out.isCardio = true;
    if (ex.rest != null && ex.rest !== '') {
      const secs = parseInt(String(ex.rest), 10);
      if (!Number.isFinite(secs) || secs < 10 || secs > 600) throw new Error(`descanso inválido em ${id}`);
      out.rest = `${secs}s`;
    }
    return out;
  });
  return {
    title: String(day.title || '').trim().slice(0, 140) || 'Treino',
    desc: String(day.desc || '').trim().slice(0, 300),
    exercises: clean,
  };
}

// Data local (YYYY-MM-DD) no fuso informado.
export function todayStr(tz = 'America/Sao_Paulo', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
}

// Se o dia mudou, arquiva o progresso do dia anterior (se houve séries) e zera.
export function rollover(db, today) {
  const p = db.progress;
  if (p.date === today) return false;
  const hasSets = Object.values(p.sets).some((a) => a.length > 0);
  if (hasSets) {
    db.history.push({
      date: p.date,
      day: p.day,
      sets: p.sets,
      weights: { ...db.weights },
      note: p.note || '',
    });
    db.history = db.history.slice(-60);
  }
  db.progress = { date: today, day: p.day, sets: {}, note: '' };
  return true;
}

// Sessão: cookie assinado com HMAC e validade.
export function makeToken(secret, ttlMs = 1000 * 60 * 60 * 24 * 90, now = Date.now()) {
  const exp = String(now + ttlMs);
  const sig = crypto.createHmac('sha256', secret).update(exp).digest('hex');
  return `${exp}.${sig}`;
}

export function checkToken(secret, token, now = Date.now()) {
  if (typeof token !== 'string') return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < now) return false;
  const good = crypto.createHmac('sha256', secret).update(exp).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(good);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
