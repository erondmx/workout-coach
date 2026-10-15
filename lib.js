import crypto from 'node:crypto';

const ID_RE = /^[a-z0-9_-]{1,24}$/;
export const DAYS = ['A', 'B', 'C'];
export const EQUIPS = ['machine', 'dumbbell', 'barbell'];

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
    if (EQUIPS.includes(ex.equip)) out.equip = ex.equip;
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
      reps: { ...(p.reps || {}) },
      effort: { ...(p.effort || {}) },
      note: p.note || '',
    });
    db.history = db.history.slice(-60);
  }
  db.progress = { date: today, day: p.day, sets: {}, reps: {}, effort: {}, note: '' };
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

export const EFFORTS = ['easy', 'ok', 'hard'];
const EFFORT_PT = { easy: 'fácil', ok: 'na medida', hard: 'pesado' };

// "12 a 15 reps" -> [12, 15]; "12 reps" -> [12, 12]; sem número -> null.
export function parseRepRange(reps) {
  const s = String(reps || '');
  const range = s.match(/(\d+)\s*(?:a|-|–)\s*(\d+)/i);
  if (range) return [Number(range[1]), Number(range[2])];
  const one = s.match(/^\s*(\d+)\s*(?:reps?)?\b/i);
  return one ? [Number(one[1]), Number(one[1])] : null;
}

// Equipamento do exercício: o campo equip (se o coach definiu) ou um palpite pelo nome.
export function equipOf(ex) {
  if (EQUIPS.includes(ex.equip)) return ex.equip;
  const n = String(ex.name || '').toLowerCase();
  if (/halter|rosca|serrote|martelo|eleva[çc][ãa]o|crucifixo|franc[êe]s/.test(n)) return 'dumbbell';
  if (/barra|smith|agachamento|stiff/.test(n)) return 'barbell';
  return 'machine';
}

// Salto realista de carga: máquinas e barra de 5 em 5 kg; halteres de 1 em 1 (< 10 kg) ou 2 em 2.
export function stepFor(ex, w) {
  if (equipOf(ex) === 'dumbbell') return w < 10 ? 1 : 2;
  return 5;
}

const fmtKg = (n) => `${String(Math.round(n * 10) / 10).replace('.', ',')} kg`;

// Dica de carga para o PRÓXIMO treino de um exercício, a partir das sessões arquivadas.
// Regras (dupla progressão):
//  - completou todas as séries + esforço "fácil" (e reps no topo da faixa, se registradas) -> subir carga
//  - completou + "na medida" + reps no topo em 2 treinos seguidos com a mesma carga -> subir carga
//  - completou mas abaixo do topo da faixa -> manter e buscar o topo
//  - "pesado" ou séries incompletas -> manter; 2 vezes seguidas -> descer um degrau da máquina/halter
export function suggest(ex, history) {
  if (ex.isCardio) return null;
  const range = parseRepRange(ex.reps);
  if (!range) return null;
  const top = range[1];
  const sessions = history
    .filter((h) => (h.sets?.[ex.id] || []).length > 0)
    .slice(-2)
    .map((h) => ({
      done: h.sets[ex.id].length,
      w: Number(h.weights?.[ex.id]) || 0,
      reps: h.reps?.[ex.id] != null ? Number(h.reps[ex.id]) : null,
      effort: h.effort?.[ex.id] || null,
    }));
  const last = sessions.at(-1);
  if (!last || !(last.w > 0)) return null;

  const complete = (s) => s.done >= ex.sets;
  const hitTop = (s) => s.reps != null && s.reps >= top;
  const w = last.w;
  const inc = stepFor(ex, w);
  const recap = `Última vez: ${last.done}/${ex.sets} séries com ${fmtKg(w)}${last.reps != null ? `, ${last.reps} reps` : ''}${last.effort ? `, ${EFFORT_PT[last.effort]}` : ''}`;

  const struggled = (s) => s.effort === 'hard' || !complete(s);
  if (struggled(last)) {
    const prev = sessions.length === 2 ? sessions[0] : null;
    if (prev && struggled(prev) && prev.w >= w) {
      const to = Math.max(inc, w - inc);
      return { type: 'down', to, text: `${recap}. Dificuldade 2 treinos seguidos: desça um degrau para ${fmtKg(to)} e capriche na técnica.` };
    }
    return { type: 'hold', text: `${recap}. Mantenha ${fmtKg(w)} e busque ${ex.sets}×${top} reps.` };
  }

  const effortUnknown = last.effort == null;
  const easyOk = last.effort === 'easy' && (last.reps == null || hitTop(last));
  const prev = sessions.length === 2 ? sessions[0] : null;
  const steady = last.effort === 'ok' && hitTop(last) && prev && complete(prev) && hitTop(prev) && prev.w === w && prev.effort !== 'hard';
  if (easyOk || steady) {
    return { type: 'up', to: w + inc, text: `${recap}. Tudo certo: suba para ${fmtKg(w + inc)}.` };
  }
  if (effortUnknown && !hitTop(last)) return null; // sem dados suficientes
  if (!hitTop(last) && last.reps != null) {
    return { type: 'reps', text: `${recap}. Mantenha ${fmtKg(w)} até chegar a ${top} reps em todas as séries.` };
  }
  return { type: 'hold', text: `${recap}. Repita ${fmtKg(w)}; ao sentir fácil, suba ${fmtKg(inc)}.` };
}

export function computeHints(db) {
  const out = {};
  for (const day of Object.values(db.plan)) {
    for (const ex of day.exercises) {
      const h = suggest(ex, db.history);
      if (h) out[ex.id] = h;
    }
  }
  return out;
}
