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

import { parseRepRange, suggest } from './lib.js';

test('parseRepRange', () => {
  assert.deepEqual(parseRepRange('12 a 15 reps'), [12, 15]);
  assert.deepEqual(parseRepRange('12 reps'), [12, 12]);
  assert.deepEqual(parseRepRange('15 reps (Descanso curto)'), [15, 15]);
  assert.equal(parseRepRange('Prancha'), null);
});

const EX = { id: 'a2', sets: 4, reps: '12 a 15 reps' };
const sess = (o = {}) => ({ sets: { a2: [1, 2, 3, 4] }, weights: { a2: 30 }, reps: { a2: 15 }, effort: { a2: 'easy' }, ...o });

test('suggest: fácil + completo + topo -> sobe carga', () => {
  const r = suggest(EX, [sess()]);
  assert.equal(r.type, 'up');
  assert.equal(r.to, 35); // máquina: salto de 5 kg
});
test('suggest: pesado -> mantém; 2x seguidas -> desce um degrau', () => {
  const hard = sess({ effort: { a2: 'hard' } });
  assert.equal(suggest(EX, [hard]).type, 'hold');
  const r = suggest(EX, [hard, hard]);
  assert.equal(r.type, 'down');
  assert.equal(r.to, 25); // um degrau abaixo
});
test('suggest: séries incompletas -> mantém', () => {
  assert.equal(suggest(EX, [sess({ sets: { a2: [1, 2] } })]).type, 'hold');
});
test('suggest: na medida no topo só sobe após 2 treinos iguais', () => {
  const ok = sess({ effort: { a2: 'ok' } });
  assert.notEqual(suggest(EX, [ok]).type, 'up');
  assert.equal(suggest(EX, [ok, ok]).type, 'up');
});
test('suggest: abaixo do topo -> foco em reps; sem carga/cardio -> null', () => {
  assert.equal(suggest(EX, [sess({ reps: { a2: 12 }, effort: { a2: 'ok' } })]).type, 'reps');
  assert.equal(suggest(EX, [sess({ weights: {} })]), null);
  assert.equal(suggest({ ...EX, isCardio: true }, [sess()]), null);
});

test('suggest: halteres sobem de 2 em 2 (1 em 1 abaixo de 10 kg)', () => {
  const db = { id: 'a3', name: 'Supino Inclinado com Halteres', sets: 3, reps: '12 reps' };
  const s = (w) => ({ sets: { a3: [1, 2, 3] }, weights: { a3: w }, reps: { a3: 12 }, effort: { a3: 'easy' } });
  assert.equal(suggest(db, [s(14)]).to, 16);
  assert.equal(suggest(db, [s(8)]).to, 9);
});
test('equipOf: infere pelo nome e respeita equip explícito', async () => {
  const { equipOf } = await import('./lib.js');
  assert.equal(equipOf({ name: 'Leg Press 45º' }), 'machine');
  assert.equal(equipOf({ name: 'Rosca Martelo' }), 'dumbbell');
  assert.equal(equipOf({ name: 'Agachamento Livre ou no Smith' }), 'barbell');
  assert.equal(equipOf({ name: 'Leg Press', equip: 'barbell' }), 'barbell');
});
