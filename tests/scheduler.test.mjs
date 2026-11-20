// Tests for the hour-model generator. Run with: npm test
// The main scenario mirrors the first real use case (state 2026-11-20): three persons
// (J1, J2 with 15 h/week and 5-hour duties, N with 25 h/week and 5–6-hour duties),
// coverage Mon–Fri 14:00–20:00, once a week until 21:00, team meeting Tuesday 14:00–15:30,
// one 3-hour weekend duty per person and month.
import { testState } from './fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { newState, normalizeState, getPlan, blockString, dutyKey } from '../src/js/model.js';
import { generate, buildProblem, analyze, storedChoice, effectiveDay } from '../src/js/scheduler.js';
import { planToCsv, planToIcs } from '../src/js/exporters.js';
import { minutesOf, weekdayOf } from '../src/js/util.js';

const KEY = '2026-12';

function scenario() {
  const s = testState();
  return s;
}
const duties = (r) => Object.entries(r.duties).map(([k, v]) => ({ pid: k.split('|')[0], date: k.split('|')[1], from: minutesOf(v.from), to: minutesOf(v.to) }));
const pid = (s, name) => s.people.find((p) => p.name === name).id;

let cached = null;
function runScenario() {
  if (!cached) { const s = scenario(); cached = { s, r: generate(s, KEY, { budgetMs: 2500 }) }; }
  return cached;
}

test('scenario: every Tuesday all three persons cover the team meeting 14:00–15:30', () => {
  const { s, r } = runScenario();
  const ds = duties(r);
  for (const date of [...new Set(r.problem.days.filter((d) => d.wd === 2).map((d) => d.date))]) {
    for (const p of s.people) {
      const du = ds.find((x) => x.pid === p.id && x.date === date);
      assert.ok(du && du.from <= 14 * 60 && du.to >= 15 * 60 + 30, `${p.name} ${date}`);
    }
  }
});

test('scenario: no hard rule is broken and weekday coverage 14–20 has no gaps', () => {
  const { r } = runScenario();
  const a = analyze(r.problem, r.choice);
  const bad = a.messages.filter((m) => m.level === 'bad');
  assert.deepEqual(bad.map((m) => m.text), []);
});

test('scenario: J2 never works Wednesday before 16:30 or Friday after 18:00', () => {
  const { s, r } = runScenario();
  for (const du of duties(r).filter((x) => x.pid === pid(s, 'J2'))) {
    const wd = weekdayOf(du.date);
    if (wd === 3) assert.ok(du.from >= 16 * 60 + 30, du.date);
    if (wd === 5) assert.ok(du.to <= 18 * 60, du.date);
  }
});

test('scenario: no Wednesday duty starts before 12:00', () => {
  const { r } = runScenario();
  for (const du of duties(r)) if (weekdayOf(du.date) === 3) assert.ok(du.from >= 12 * 60, du.date);
});

test('scenario: each person has exactly one 3-hour weekend duty', () => {
  const { s, r } = runScenario();
  for (const p of s.people) {
    const we = duties(r).filter((x) => x.pid === p.id && [0, 6].includes(weekdayOf(x.date)));
    assert.equal(we.length, 1, p.name);
    assert.equal(we[0].to - we[0].from, 180);
  }
});

test('scenario: at most one weekend of the month without any duty', () => {
  const { r } = runScenario();
  const a = analyze(r.problem, r.choice);
  assert.equal(a.messages.filter((m) => m.text.includes('Wochenenden ohne Dienst')).length, 0);
});

test('scenario: monthly hours are close to the contract', () => {
  const { r } = runScenario();
  const a = analyze(r.problem, r.choice);
  for (const st of a.stats) assert.ok(Math.abs(st.worked - st.target) <= 6, `${st.person.name}: ${st.worked} vs ${st.target}`);
});

test('scenario: Fridays are spread evenly (difference at most 1)', () => {
  const { s, r } = runScenario();
  const counts = s.people.map((p) => duties(r).filter((x) => x.pid === p.id && weekdayOf(x.date) === 5).length);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, counts.join(','));
});

test('late rule: after a duty ending at 21:00 the next duty starts at 13:00 or later', () => {
  const { r } = runScenario();
  const ds = duties(r);
  for (const du of ds) {
    if (du.to <= minutesOf('20:30')) continue;
    const next = ds.find((x) => x.pid === du.pid && new Date(x.date) - new Date(du.date) === 864e5);
    if (next) assert.ok(next.from >= 13 * 60, `${du.date} -> ${next.date}`);
  }
});

test('"cannot work" entries are hard', () => {
  const s = scenario();
  const j1 = pid(s, 'J1');
  s.availability[KEY] = { [j1]: {} };
  for (let d = 1; d <= 31; d++) {
    const date = `2026-12-${String(d).padStart(2, '0')}`;
    if (weekdayOf(date) === 1) s.availability[KEY][j1][date] = blockString(0, 24 * 60);
  }
  const r = generate(s, KEY, { budgetMs: 800 });
  assert.equal(duties(r).filter((x) => x.pid === j1 && weekdayOf(x.date) === 1).length, 0);
});

test('effective wishes: date entry "o" overrides the weekly pattern', () => {
  const s = scenario();
  const j2 = s.people.find((p) => p.name === 'J2');
  assert.equal(effectiveDay(s, j2, '2026-12-02')[20], 'x'); // Wednesday 10:00 blocked by pattern
  s.availability[KEY] = { [j2.id]: { '2026-12-02': blockString(0, 24 * 60, 'o') } };
  assert.equal(effectiveDay(s, j2, '2026-12-02')[20], '.');
});

test('locked duties survive a new generation', () => {
  const s = scenario();
  const n = pid(s, 'N');
  getPlan(s, KEY).duties[dutyKey(n, '2026-12-03')] = { from: '15:00', to: '21:00', locked: true };
  const r = generate(s, KEY, { budgetMs: 500 });
  assert.deepEqual(r.duties[dutyKey(n, '2026-12-03')], { from: '15:00', to: '21:00' });
});

test('analysis of a stored plan flags a missing team meeting', () => {
  const s = scenario();
  getPlan(s, KEY).duties[dutyKey(pid(s, 'J1'), '2026-12-01')] = { from: '16:00', to: '21:00' };
  const P = buildProblem(s, KEY, { keep: 'all' });
  const a = analyze(P, storedChoice(P));
  assert.ok(a.messages.some((m) => m.text.includes('J1') && m.text.includes('Weekly meeting')));
});

test('exports contain the duties', () => {
  const { s, r } = runScenario();
  getPlan(s, KEY).duties = r.duties;
  const P = buildProblem(s, KEY);
  assert.ok(planToCsv(s, P).includes('J1'));
  assert.ok(planToIcs(s, P, pid(s, 'N')).includes('BEGIN:VEVENT'));
});

test('schema-1 data is replaced instead of crashing', () => {
  const st = normalizeState({ version: 1, config: { demand: [] } });
  assert.equal(st.version, 2);
});

test('"rather not" hours are avoided when there is a choice', () => {
  const s = scenario();
  const j1 = s.people.find((p) => p.name === 'J1'); // preset: Friday 20:00–21:00 rather not
  const r = generate(s, KEY, { budgetMs: 1500 });
  for (const du of duties(r).filter((x) => x.pid === j1.id && weekdayOf(x.date) === 5)) {
    assert.ok(du.to <= 20 * 60, `${du.date} ends ${du.to}`);
  }
});

test('"rather not" is a soft rule: a duty can still be placed there by hand and is flagged', () => {
  const s = scenario();
  const j1 = s.people.find((p) => p.name === 'J1');
  getPlan(s, KEY).duties[dutyKey(j1.id, '2026-12-04')] = { from: '16:00', to: '21:00' };
  const P = buildProblem(s, KEY, { keep: 'all' });
  const a = analyze(P, storedChoice(P));
  assert.ok(a.messages.some((m) => m.level === 'warn' && m.text.includes('eher nicht')));
  assert.ok(!a.messages.some((m) => m.level === 'bad' && m.text.includes('J1') && m.text.includes('4.12.')));
});

test('weekly wish: once a week a duty that starts in the morning', () => {
  const s = scenario();
  const n = s.people.find((p) => p.name === 'N');
  n.weeklyWishes = [{ id: 'w1', label: 'Vormittag', days: 1, from: '10:00', to: '13:00' }];
  const r = generate(s, KEY, { budgetMs: 2500 });
  const P = r.problem;
  const mine = duties(r).filter((x) => x.pid === n.id);
  for (let w = 0; w < P.weekDays.length; w++) {
    if (P.weekWork[P.pIndex.get(n.id)][w] < 3) continue;
    const dates = new Set(P.weekDays[w].map((d) => P.days[d].date));
    const morning = mine.filter((x) => dates.has(x.date) && x.from >= 10 * 60 && x.from < 13 * 60);
    assert.ok(morning.length >= 1, `week ${w}`);
  }
});

test('whole-day block (all x) means no duty that day', () => {
  const s = scenario();
  const n = s.people.find((p) => p.name === 'N');
  s.availability[KEY] = { [n.id]: { '2026-12-10': blockString(0, 24 * 60) } };
  const r = generate(s, KEY, { budgetMs: 600 });
  assert.equal(duties(r).filter((x) => x.pid === n.id && x.date === '2026-12-10').length, 0);
});

test('same-day alignment: "start together" reduces start-time spread among morning/afternoon duties', () => {
  const spread = (mode) => {
    const s = scenario();
    s.config.align.mode = mode;
    const r = generate(s, KEY, { budgetMs: 2500 });
    const ds = duties(r);
    let total = 0;
    for (const date of new Set(ds.map((x) => x.date))) {
      for (const afternoon of [false, true]) {
        const g = ds.filter((x) => x.date === date && (x.from >= 13 * 60) === afternoon);
        if (g.length >= 2) total += (Math.max(...g.map((x) => x.from)) - Math.min(...g.map((x) => x.from))) / 30;
      }
    }
    return total;
  };
  const none = spread('none');
  const start = spread('start');
  assert.ok(start <= none, `start ${start} vs none ${none}`);
  assert.ok(start <= 12, `spread with "start" is ${start}`);
});

test('analysis: an appointment inside a "cannot work" time is flagged as a problem', () => {
  const s = scenario();
  const j1 = s.people.find((p) => p.name === 'J1');
  s.availability[KEY] = { [j1.id]: { '2026-12-01': blockString(14 * 60, 15 * 60) } }; // Tuesday meeting 14:00–15:30
  const P = buildProblem(s, KEY, { keep: 'all' });
  const a = analyze(P, storedChoice(P));
  assert.ok(a.messages.some((m) => m.level === 'bad' && m.text.includes('J1') && m.text.includes('gesperrter Zeit')));
});
