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
      setReps: structuredClone(p.setReps || {}),
      note: p.note || '',
    });
    db.history = db.history.slice(-60);
  }
  db.progress = { date: today, day: p.day, sets: {}, setReps: {}, swaps: {}, note: '' };
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


const NOTCH = 1; // um degrau de carga por vez

// Avalia as reps feitas HOJE (ou numa sessão) contra a faixa prescrita.
// repsMap: { "1": 12, "2": 11, ... } (reps por série); done: séries marcadas.
// Níveis: very_heavy | heavy | in_range | top | easy | null (sem dados)
export function assessSets(ex, repsMap, done) {
  const range = parseRepRange(ex.reps);
  if (!range || ex.isCardio) return null;
  const [lo, hi] = range;
  const logged = (done || [])
    .map((s) => ({ s, r: repsMap?.[s] }))
    .filter((x) => x.r != null && Number.isFinite(Number(x.r)))
    .sort((a, b) => a.s - b.s)
    .map((x) => Number(x.r));
  if (!logged.length) return null;
  const worst = Math.min(...logged);
  const first = logged[0];
  const last = logged.at(-1);
  const drop = first - last;
  const dropNote = drop >= 4 ? ` Queda de ${drop} reps entre a 1ª e a última série: carga pesada ou descanso curto.` : '';
  const complete = (done || []).length >= ex.sets && logged.length >= ex.sets;
  const base = { worst, lo, hi };
  if (worst < lo * 0.7) {
    return { ...base, level: 'very_heavy', text: `Pior série: ${worst} reps (previsto ${lo}–${hi}). Carga pesada demais.${dropNote}` };
  }
  if (worst < lo) {
    return { ...base, level: 'heavy', text: `Pior série: ${worst} reps, abaixo da faixa (${lo}–${hi}). Carga no limite.${dropNote}` };
  }
  if (worst < hi || !complete) {
    return { ...base, level: 'in_range', text: `Pior série: ${worst} reps, dentro da faixa. Busque ${hi} em todas as séries.${dropNote}` };
  }
  if (worst >= hi + 2) {
    return { ...base, level: 'easy', text: `Pior série: ${worst} reps, ${worst - hi} acima do topo. Carga leve.${dropNote}` };
  }
  return { ...base, level: 'top', text: `Todas as séries no topo da faixa (${hi}+). Pronto para mais carga.${dropNote}` };
}

// Dica de carga para o PRÓXIMO treino, a partir das sessões arquivadas (dupla progressão):
//  - todas as séries no topo da faixa (ou acima) -> subir um degrau
//  - pior série bem abaixo da faixa (< 70% do mínimo) -> descer um degrau já
//  - pior série abaixo da faixa -> manter; 2 treinos seguidos assim -> descer um degrau
//  - dentro da faixa -> manter e buscar o topo
export function suggest(ex, history) {
  if (ex.isCardio) return null;
  const range = parseRepRange(ex.reps);
  if (!range) return null;
  const sessions = history
    .filter((h) => (h.sets?.[ex.id] || []).length > 0)
    .slice(-2)
    .map((h) => ({
      w: Number(h.weights?.[ex.id]) || 0,
      done: h.sets[ex.id].length,
      a: assessSets(ex, h.setReps?.[ex.id], h.sets[ex.id]),
    }));
  const last = sessions.at(-1);
  if (!last || !(last.w > 0) || !last.a) return null;

  const w = last.w;
  const step = stepFor(ex, w) * NOTCH;
  const a = last.a;
  const recap = `Última vez: ${last.done}/${ex.sets} séries com ${fmtKg(w)}. ${a.text}`;

  if (a.level === 'very_heavy') {
    const to = Math.max(step, w - step);
    return { type: 'down', to, text: `${recap} Desça para ${fmtKg(to)}.` };
  }
  if (a.level === 'heavy') {
    const prev = sessions.length === 2 ? sessions[0] : null;
    if (prev?.a && ['heavy', 'very_heavy'].includes(prev.a.level) && prev.w >= w) {
      const to = Math.max(step, w - step);
      return { type: 'down', to, text: `${recap} Segundo treino seguido abaixo da faixa: desça para ${fmtKg(to)}.` };
    }
    return { type: 'hold', text: `${recap} Mantenha ${fmtKg(w)} e recupere as reps.` };
  }
  if (a.level === 'in_range') {
    return { type: 'reps', text: `${recap} Mantenha ${fmtKg(w)}.` };
  }
  return { type: 'up', to: w + step, text: `${recap} Suba para ${fmtKg(w + step)}.` };
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

// Avaliação do treino de hoje, por exercício, para mostrar na tela.
export function computeAssess(db) {
  const out = {};
  for (const day of Object.values(applySwaps(db.plan, db.progress.swaps))) {
    for (const ex of day.exercises) {
      const a = assessSets(ex, db.progress.setReps?.[ex.id], db.progress.sets?.[ex.id]);
      if (a) out[ex.id] = a;
    }
  }
  return out;
}

// ---------- fotos e substituições do dia ----------
const IMG_RE = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export const MAX_IMAGES = 4;
export const MAX_IMAGE_CHARS = 2_500_000; // ~1,8 MB por foto (o cliente já reduz para ~1024 px)

// Valida as fotos enviadas ao coach. Retorna a lista limpa ou lança Error.
export function sanitizeImages(images) {
  if (images == null) return [];
  if (!Array.isArray(images) || images.length > MAX_IMAGES) throw new Error(`envie no máximo ${MAX_IMAGES} fotos`);
  return images.map((u) => {
    if (typeof u !== 'string' || u.length > MAX_IMAGE_CHARS || !IMG_RE.test(u)) throw new Error('foto inválida ou grande demais');
    return u;
  });
}

// Troca só por hoje: o exercício vira um "temporário" com id próprio (sufixo "s"),
// para carga e reps do outro aparelho não se misturarem ao histórico do original.
export const swapId = (id) => `${id}s`;

export function applySwaps(plan, swaps) {
  if (!swaps || !Object.keys(swaps).length) return plan;
  const out = {};
  for (const [d, day] of Object.entries(plan)) {
    out[d] = {
      ...day,
      exercises: day.exercises.map((ex) => {
        const s = swaps[ex.id];
        if (!s) return ex;
        const { equip: _e, ...rest } = ex;
        return { ...rest, id: swapId(ex.id), name: s.name, ...(s.equip ? { equip: s.equip } : {}), swappedFrom: ex.name };
      }),
    };
  }
  return out;
}

export function sanitizeSwap(plan, input) {
  const id = String(input?.exercise_id || '').toLowerCase();
  const exists = Object.values(plan).some((d) => d.exercises.some((e) => e.id === id && !e.isCardio));
  if (!exists) throw new Error(`exercício não encontrado: ${input?.exercise_id}`);
  const name = String(input?.name || '').trim().slice(0, 120);
  if (!name) throw new Error('nome vazio');
  return { id, swap: { name, equip: EQUIPS.includes(input?.equip) ? input.equip : undefined, reason: String(input?.reason || '').slice(0, 200) } };
}
