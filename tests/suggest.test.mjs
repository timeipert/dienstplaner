// Tests for refining by hand (suggestions) and for plan variants from the search.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newState, getPlan, dutyKey } from '../src/js/model.js';
import { generate, buildProblem } from '../src/js/scheduler.js';
import { suggestFor, applyChanges, problemWithPlan, evaluate } from '../src/js/suggest.js';
import { searchPlan } from '../src/js/search.js';

const KEY = '2026-12';
function planned() {
  const s = newState('team3');
  getPlan(s, KEY).duties = generate(s, KEY, { budgetMs: 800, seed: 4 }).duties;
  return s;
}

test('suggestions: ranked, valid, and applying one changes the plan by exactly its delta', () => {
  const s = planned();
  const j1 = s.people.find((p) => p.name === 'J1').id;
  const date = Object.keys(getPlan(s, KEY).duties).filter((k) => k.startsWith(j1)).map((k) => k.split('|')[1]).find((d) => new Date(d).getDay() !== 2);
  const res = suggestFor(s, KEY, j1, date);
  const all = [...res.times, ...res.moves];
  assert.ok(res.times.length > 0 && res.moves.length > 0);
  for (let i = 1; i < res.times.length; i++) assert.ok(res.times[i - 1].delta <= res.times[i].delta);
  assert.ok(res.moves.every((o) => ['swap', 'hand', 'take', 'move', 'trade'].includes(o.kind)));
  const o = all[0];
  const before = evaluate(...Object.values(problemWithPlan(s, KEY))).cost;
  applyChanges(s, KEY, o.changes);
  const after = problemWithPlan(s, KEY);
  const r = evaluate(after.P, after.choice);
  assert.ok(Math.abs(r.cost - before - o.delta) < 1e-6, `${r.cost - before} vs ${o.delta}`);
  assert.equal(r.hard, 0);
});

test('suggestions never move a duty that contains an appointment', () => {
  const s = planned();
  const n = s.people.find((p) => p.name === 'N').id;
  const res = suggestFor(s, KEY, n, '2026-12-01'); // Tuesday, team meeting
  assert.ok(!res.times.some((o) => o.kind === 'off'));
  assert.ok(!res.moves.some((o) => o.kind === 'move' || o.kind === 'hand'));
  assert.ok(!getPlan(s, KEY).duties[dutyKey(n, '2026-12-01')] || res.times.every((o) => o.changes.every((c) => !c.off)));
});

test('search returns variants that differ from the best plan and are of similar quality', () => {
  const s = newState('team3');
  const r = searchPlan(buildProblem(s, KEY, { keep: 'locked' }), { timeoutMs: 4000, runMs: 700, seed: 9 });
  if (r.reason === 'met') return; // nothing to compare when the first plan already meets every rule
  for (const v of r.variants) {
    assert.ok(v.diff >= 6);
    assert.ok(v.cost <= r.cost * 1.1 + 5);
    assert.ok(Object.keys(v.duties).length > 0);
  }
});
