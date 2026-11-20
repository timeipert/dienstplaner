// Tests for the plan evaluation (constraint report, fairness figures, pairs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { newState, getPlan, dutyKey } from '../src/js/model.js';
import { generate, buildProblem, storedChoice } from '../src/js/scheduler.js';
import { buildReport } from '../src/js/report.js';

const KEY = '2026-12';
function planned() {
  const s = newState('team3');
  const r = generate(s, KEY, { budgetMs: 2000 });
  getPlan(s, KEY).duties = r.duties;
  const P = buildProblem(s, KEY, { keep: 'all' });
  return { s, P, rep: buildReport(P, storedChoice(P)) };
}
const find = (rep, id) => rep.constraints.find((c) => c.id === id);

test('report: all hard constraints are met in a generated plan', () => {
  const { rep } = planned();
  for (const id of ['blocked', 'appts', 'window', 'late']) assert.equal(find(rep, id).status, 'ok', id);
});

test('report: coverage and weekly coverage are fully met', () => {
  const { rep } = planned();
  assert.equal(find(rep, 'coverage').status, 'ok');
  assert.ok(rep.constraints.filter((c) => c.id.startsWith('wc-')).every((c) => c.status === 'ok'));
});

test('report: weekend duty, empty weekends and appointment-only duties are ok', () => {
  const { rep } = planned();
  assert.equal(find(rep, 'weekendDuty').status, 'ok');
  assert.equal(find(rep, 'emptyWe').status, 'ok');
  assert.equal(find(rep, 'apptOnly').status, 'ok');
});

test('report: per-person figures add up', () => {
  const { s, rep } = planned();
  const duties = Object.keys(getPlan(s, KEY).duties).length;
  assert.equal(rep.persons.reduce((a, r) => a + r.duties, 0), duties);
  for (const r of rep.persons) assert.equal(r.byWd.reduce((a, b) => a + b, 0), r.duties);
  assert.equal(rep.weekdayTotals.reduce((a, b) => a + b, 0), duties);
});

test('report: pair matrix is symmetric and shared hours are balanced', () => {
  const { rep } = planned();
  const [a, b] = rep.persons;
  assert.deepEqual(rep.pairs[a.idx][b.idx], rep.pairs[b.idx][a.idx]);
  assert.equal(rep.pairList.length, 3);
  const hrs = rep.pairList.map((x) => x.hours);
  assert.ok(Math.max(...hrs) - Math.min(...hrs) <= 5, hrs.join(','));
});

test('report: a violated hard rule is reported as "bad"', () => {
  const { s } = planned();
  const j1 = s.people.find((p) => p.name === 'J1');
  getPlan(s, KEY).duties[dutyKey(j1.id, '2026-12-01')] = { from: '16:00', to: '21:00' }; // misses the Tuesday meeting
  const P = buildProblem(s, KEY, { keep: 'all' });
  const rep = buildReport(P, storedChoice(P));
  assert.equal(find(rep, 'appts').status, 'bad');
  assert.ok(rep.summary.bad >= 1);
});

test('report: an empty plan has no hard violation and uncovered coverage', () => {
  const s = newState('team3');
  const P = buildProblem(s, KEY, { keep: 'all' });
  const rep = buildReport(P, storedChoice(P));
  assert.equal(find(rep, 'coverage').met, 0);
  assert.notEqual(find(rep, 'coverage').status, 'ok');
  assert.equal(find(rep, 'blocked').status, 'na');
});
