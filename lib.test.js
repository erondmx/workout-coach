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
