// Tests for month settings, the vacation-edge rule, lower bounds and the time-limited search.
// Scenario: tests/fixture.mjs (three persons), month 2026-12.
import { testState } from './fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { newState, editMonthSettings } from '../src/js/model.js';
import { generate, buildProblem } from '../src/js/scheduler.js';
import { buildReport, structuralBounds, weightFor } from '../src/js/report.js';
import { searchPlan } from '../src/js/search.js';
import { minutesOf } from '../src/js/util.js';

const KEY = '2026-12';
const pid = (s, name) => s.people.find((p) => p.name === name).id;
const list = (r) => Object.entries(r.duties).map(([k, v]) => ({ pid: k.split('|')[0], date: k.split('|')[1], from: minutesOf(v.from), to: minutesOf(v.to) }));

test('month setting "no morning duties for all": no duty starts before 12:00 except for appointments', () => {
  const s = testState();
  s.config.appointments.push({ id: 'hpg', title: 'Case conference', repeat: 'once', date: '2026-12-09', from: '10:00', to: '11:30', participants: [pid(s, 'N')] });
  editMonthSettings(s, KEY).noMorning = true;
  const r = generate(s, KEY, { budgetMs: 1500, seed: 3 });
  const early = list(r).filter((d) => d.from < 12 * 60);
  assert.ok(early.every((d) => d.date === '2026-12-09' && d.pid === pid(s, 'N')), JSON.stringify(early));
  assert.ok(list(r).some((d) => d.date === '2026-12-09' && d.pid === pid(s, 'N') && d.from <= 600), 'appointment still inside the duty');
  // another month is not affected
  const P = buildProblem(s, '2027-01', { keep: 'locked' });
  assert.ok(P.people.every((p) => p.minStart === -1));
});

test('month setting per person: other weekly hours and paused weekly wishes', () => {
  const s = testState();
  const n = s.people.find((p) => p.name === 'N');
  n.weeklyWishes = [{ id: 'w', label: 'Vormittag', days: 1, from: '10:00', to: '11:00' }];
  editMonthSettings(s, KEY).people[n.id] = { noMorning: true, noWishes: true, hours: 20 };
  const P = buildProblem(s, KEY, { keep: 'locked' });
  const pn = P.people.find((p) => p.id === n.id);
  assert.equal(pn.weeklyHours, 20);
  assert.equal(pn.weeklyWishes.length, 0);
  assert.equal(n.weeklyHours, 25, 'stored person unchanged');
  assert.equal(n.weeklyWishes.length, 1, 'stored person unchanged');
});

test('vacation edge: no duty on the day before and after an absence when avoidable', () => {
  const s = testState();
  const j1 = s.people.find((p) => p.name === 'J1');
  j1.absences = [{ from: '2026-12-14', to: '2026-12-18' }]; // Mon–Fri; Sunday 13 and Saturday 19 are the edges
  const r = generate(s, KEY, { budgetMs: 2000, seed: 5 });
  const edges = list(r).filter((d) => d.pid === j1.id && (d.date === '2026-12-13' || d.date === '2026-12-19'));
  assert.equal(edges.length, 0, JSON.stringify(edges));
  const rep = buildReport(r.problem, r.choice);
  assert.equal(rep.constraints.find((c) => c.id === 'vacation').status, 'ok');
});

test('lower bounds: 25 h with 5–6-hour duties cannot avoid duties on consecutive days', () => {
  const s = testState();
  const P = buildProblem(s, KEY, { keep: 'locked' });
  const b = structuralBounds(P);
  const n = P.people.findIndex((p) => p.name === 'N');
  assert.ok(b[n].consec >= 2 * 3, `N: ${b[n].consec}`); // at least 2 per full week
  const r = generate(s, KEY, { budgetMs: 1500, seed: 1 });
  const rep = buildReport(r.problem, r.choice);
  assert.ok(rep.hints.some((t) => t.startsWith('N: mindestens')));
});

test('search: stops early when every rule is met, otherwise at the time limit, and keeps the best plan', () => {
  const s = newState('blank');
  s.people = [];
  Object.assign(s.config, { coverage: [], weeklyCoverage: [], maxEmptyWeekends: 99 });
  const one = searchPlan(buildProblem(s, KEY, { keep: 'locked' }), { timeoutMs: 3000, runMs: 200 });
  assert.equal(one.reason, 'met');
  const t = testState();
  const res = searchPlan(buildProblem(t, KEY, { keep: 'locked' }), { timeoutMs: 2500, runMs: 800, seed: 2 });
  assert.ok(['met', 'timeout'].includes(res.reason));
  assert.ok(res.runs >= 1 && res.duties && Number.isFinite(res.cost));
  assert.equal(res.open.length, res.report.constraints.filter((c) => c.status === 'warn' || c.status === 'bad').length);
});

test('every soft rule of the report has a weight', () => {
  const s = testState();
  const r = generate(s, KEY, { budgetMs: 800, seed: 1 });
  const rep = buildReport(r.problem, r.choice);
  for (const c of rep.constraints.filter((x) => x.group !== 'hart')) assert.ok(weightFor(c.id), c.id);
  assert.ok(Object.keys(s.config.weights).includes('vacation'));
});
