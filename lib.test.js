import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeDay, rollover, makeToken, checkToken } from './lib.js';

const ex = (o = {}) => ({ id: 'a1', name: 'Supino', sets: 3, reps: '12', rest: '60', ...o });

test('sanitizeDay normaliza descanso e aceita plano válido', () => {
  const d = sanitizeDay({ title: 'T', exercises: [ex()] });
  assert.equal(d.exercises[0].rest, '60s');
});
test('sanitizeDay rejeita ids duplicados, séries absurdas e id malicioso', () => {
  assert.throws(() => sanitizeDay({ exercises: [ex(), ex()] }), /duplicado/);
  assert.throws(() => sanitizeDay({ exercises: [ex({ sets: 99 })] }), /séries/);
  assert.throws(() => sanitizeDay({ exercises: [ex({ id: '"><script>' })] }), /id inválido/);
  assert.throws(() => sanitizeDay({ exercises: [] }), /inválida/);
});
test('rollover arquiva dia anterior e zera', () => {
  const db = { weights: { a1: 20 }, history: [], progress: { date: '2026-10-14', day: 'A', sets: { a1: [1, 2] }, note: '' } };
  assert.equal(rollover(db, '2026-10-15'), true);
  assert.equal(db.history.length, 1);
  assert.deepEqual(db.progress.sets, {});
  assert.equal(rollover(db, '2026-10-15'), false);
});
test('rollover não arquiva dia vazio', () => {
  const db = { weights: {}, history: [], progress: { date: '2026-10-14', day: 'A', sets: {}, note: '' } };
  rollover(db, '2026-10-15');
  assert.equal(db.history.length, 0);
});
test('token expira e rejeita adulteração', () => {
  const t = makeToken('s', 1000, 0);
  assert.equal(checkToken('s', t, 500), true);
  assert.equal(checkToken('s', t, 2000), false);
  assert.equal(checkToken('outro', t, 500), false);
  assert.equal(checkToken('s', 'lixo'), false);
});

import { parseRepRange, suggest, assessSets, equipOf } from './lib.js';

test('parseRepRange', () => {
  assert.deepEqual(parseRepRange('12 a 15 reps'), [12, 15]);
  assert.deepEqual(parseRepRange('12 reps'), [12, 12]);
  assert.deepEqual(parseRepRange('15 reps (Descanso curto)'), [15, 15]);
  assert.equal(parseRepRange('Prancha'), null);
});

const EX = { id: 'a2', name: 'Leg Press 45º', sets: 4, reps: '12 a 15 reps' }; // máquina: salto de 5 kg
const all = [1, 2, 3, 4];
const sess = (repsList, w = 30, done = all) => ({
  sets: { a2: done },
  weights: { a2: w },
  setReps: { a2: Object.fromEntries(repsList.map((r, i) => [i + 1, r])) },
});

test('assessSets: exemplo do usuário (12 previstas, 4 na 3ª série) = pesado demais', () => {
  const ex = { id: 'x', sets: 4, reps: '12 reps' };
  const a = assessSets(ex, { 1: 12, 2: 10, 3: 4, 4: 4 }, all);
  assert.equal(a.level, 'very_heavy');
  assert.match(a.text, /Queda de 8 reps/);
});
test('assessSets: níveis', () => {
  assert.equal(assessSets(EX, { 1: 15, 2: 15, 3: 15, 4: 15 }, all).level, 'top');
  assert.equal(assessSets(EX, { 1: 17, 2: 17, 3: 17, 4: 17 }, all).level, 'easy');
  assert.equal(assessSets(EX, { 1: 14, 2: 13, 3: 12, 4: 12 }, all).level, 'in_range');
  assert.equal(assessSets(EX, { 1: 14, 2: 12, 3: 10, 4: 10 }, all).level, 'heavy');
  assert.equal(assessSets(EX, {}, all), null);
  assert.equal(assessSets({ ...EX, isCardio: true }, { 1: 5 }, [1]), null);
});
test('assessSets: todas no topo mas com série faltando não conta como topo', () => {
  assert.equal(assessSets(EX, { 1: 15, 2: 15 }, [1, 2]).level, 'in_range');
});

test('suggest: todas as séries no topo -> sobe um degrau da máquina (5 kg)', () => {
  const r = suggest(EX, [sess([15, 15, 15, 15])]);
  assert.equal(r.type, 'up');
  assert.equal(r.to, 35);
});
test('suggest: muito pesado -> desce um degrau já no primeiro treino', () => {
  const r = suggest(EX, [sess([12, 8, 4, 4])]);
  assert.equal(r.type, 'down');
  assert.equal(r.to, 25);
});
test('suggest: abaixo da faixa -> mantém; 2 seguidas -> desce', () => {
  const heavy = sess([13, 11, 10, 10]);
  assert.equal(suggest(EX, [heavy]).type, 'hold');
  assert.equal(suggest(EX, [heavy, heavy]).type, 'down');
});
test('suggest: dentro da faixa -> foco em reps; sem reps/carga/cardio -> null', () => {
  assert.equal(suggest(EX, [sess([14, 13, 12, 12])]).type, 'reps');
  assert.equal(suggest(EX, [{ sets: { a2: all }, weights: { a2: 30 } }]), null);
  assert.equal(suggest(EX, [sess([15, 15, 15, 15], 0)]), null);
  assert.equal(suggest({ ...EX, isCardio: true }, [sess([15, 15, 15, 15])]), null);
});
test('suggest: halteres sobem de 2 em 2 (1 em 1 abaixo de 10 kg)', () => {
  const db = { id: 'a3', name: 'Supino Inclinado com Halteres', sets: 3, reps: '12 reps' };
  const s = (w) => ({ sets: { a3: [1, 2, 3] }, weights: { a3: w }, setReps: { a3: { 1: 12, 2: 12, 3: 12 } } });
  assert.equal(suggest(db, [s(14)]).to, 16);
  assert.equal(suggest(db, [s(8)]).to, 9);
});
test('equipOf: infere pelo nome e respeita equip explícito', () => {
  assert.equal(equipOf({ name: 'Leg Press 45º' }), 'machine');
  assert.equal(equipOf({ name: 'Rosca Martelo' }), 'dumbbell');
  assert.equal(equipOf({ name: 'Agachamento Livre ou no Smith' }), 'barbell');
  assert.equal(equipOf({ name: 'Leg Press', equip: 'barbell' }), 'barbell');
});
test('rollover arquiva reps por série', () => {
  const db = { weights: {}, history: [], progress: { date: '2026-10-14', day: 'A', sets: { a2: [1] }, setReps: { a2: { 1: 12 } }, note: '' } };
  rollover(db, '2026-10-15');
  assert.deepEqual(db.history[0].setReps, { a2: { 1: 12 } });
  assert.deepEqual(db.progress.setReps, {});
});

import { applySwaps, sanitizeImages, sanitizeSwap, computeAssess } from './lib.js';

const PLAN = { A: { title: 'A', desc: '', exercises: [{ id: 'a2', name: 'Leg Press 45º', sets: 4, reps: '12 reps', equip: 'machine' }, { id: 'a1', name: 'Esteira', sets: 1, reps: '5 min', isCardio: true }] } };

test('applySwaps cria exercício temporário com id próprio e guarda o original', () => {
  const out = applySwaps(PLAN, { a2: { name: 'Hack Squat', equip: 'machine' } });
  const ex = out.A.exercises[0];
  assert.equal(ex.id, 'a2s');
  assert.equal(ex.name, 'Hack Squat');
  assert.equal(ex.swappedFrom, 'Leg Press 45º');
  assert.equal(PLAN.A.exercises[0].id, 'a2'); // plano original intacto
  assert.equal(applySwaps(PLAN, {}), PLAN);
});
test('sanitizeSwap valida id existente e não permite cardio', () => {
  assert.equal(sanitizeSwap(PLAN, { exercise_id: 'a2', name: 'Hack', equip: 'machine' }).swap.name, 'Hack');
  assert.throws(() => sanitizeSwap(PLAN, { exercise_id: 'zz', name: 'x' }), /não encontrado/);
  assert.throws(() => sanitizeSwap(PLAN, { exercise_id: 'a1', name: 'x' }), /não encontrado/);
  assert.throws(() => sanitizeSwap(PLAN, { exercise_id: 'a2', name: ' ' }), /vazio/);
});
test('sanitizeImages aceita data URL de imagem e rejeita o resto', () => {
  const ok = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  assert.deepEqual(sanitizeImages([ok]), [ok]);
  assert.deepEqual(sanitizeImages(undefined), []);
  assert.throws(() => sanitizeImages(['http://evil.example/x.jpg']), /inválida/);
  assert.throws(() => sanitizeImages(['data:text/html;base64,PHNjcmlwdD4=']), /inválida/);
  assert.throws(() => sanitizeImages([ok, ok, ok, ok, ok]), /no máximo/);
});
test('computeAssess avalia o exercício trocado de hoje pelo id temporário', () => {
  const db = { plan: PLAN, progress: { swaps: { a2: { name: 'Hack' } }, sets: { a2s: [1, 2, 3, 4] }, setReps: { a2s: { 1: 12, 2: 12, 3: 12, 4: 12 } } } };
  assert.equal(computeAssess(db).a2s.level, 'top');
  assert.equal(computeAssess(db).a2, undefined);
});
