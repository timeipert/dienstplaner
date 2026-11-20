// Exports the month problem of the app as JSON for an exact solver (CP-SAT), plus the best plans
// of the app's own search at several time limits. Per-candidate costs are computed here with the
// same formulas as personCost() in scheduler.js, so the exact model and the app share one source.
// Usage: node tools/exact/export.mjs <backup.json> <YYYY-MM> <out.json>
//   LIMITS=3000,20000,60000 (default) sets the time limits of the app's search used as baselines.
// The output contains names and wishes of the backup: keep it out of the repository
// (tools/exact/*.json is ignored).
import fs from 'node:fs';
const root = new URL('../../src/js/', import.meta.url).href;
const { normalizeState } = await import(root + 'model.js');
const { buildProblem } = await import(root + 'scheduler.js');
const { searchPlan } = await import(root + 'search.js');
const { evaluate } = await import(root + 'suggest.js');
const { minutesOf } = await import(root + 'util.js');

const [file, key, out] = process.argv.slice(2);
const state = normalizeState(JSON.parse(fs.readFileSync(file, 'utf8')));
const P = buildProblem(state, key, { keep: 'locked' });
const { cfg, W, days, people } = P;
const STEP = 30;
const lateEnd = minutesOf(cfg.lateRule.endAfter);
const lateNext = minutesOf(cfg.lateRule.nextFrom);
const avoidAfter = minutesOf(cfg.weekendDuty.avoidAfter);
if (cfg.align.mode !== 'none' && W.align) throw new Error('align cost is not modelled');

const cells = people.map((person, p) => days.map((day, d) => {
  const cands = P.cand[p][d].map((du) => {
    let lin = 0;
    const avs = P.av[p][d];
    if (W.rather) for (let i = du.from / STEP; i < du.to / STEP; i++) if (avs[i] === '-') lin += W.rather;
    if (day.weekend) { if (du.to > avoidAfter) lin += W.weekendLate * (du.to - avoidAfter) / STEP; }
    else {
      if (!du.apptOnly) lin += W.length * Math.abs(du.len - person.prefLen * 60) / STEP;
      if (W.outside) for (let i = du.from / STEP; i < du.to / STEP; i++) if (!P.need[d][i]) lin += W.outside;
    }
    if (P.edge[p][d] && W.vacation) lin += W.vacation;
    if (!day.weekend && person.preferredWeekdays.length && !person.preferredWeekdays.includes(day.wd) && !P.appts[p][d].length) lin += W.prefDay;
    return { from: du.from, to: du.to, len: du.len, apptOnly: du.apptOnly, lin };
  });
  const offCost = person.active && P.cand[p][d].length && P.av[p][d].includes('+') ? W.want : 0;
  return { cands, forced: P.forced[p][d], fixed: P.fixed[p][d], offCost };
}));

const wishes = people.map((person, p) => (person.weeklyWishes || []).map((wish) => ({
  a: minutesOf(wish.from), b: minutesOf(wish.to),
  need: P.weekKeys.map((_, w) => (P.weekWork[p][w] < 3 ? 0 : Math.max(0, Math.min(Number(wish.days) || 1, P.weekWork[p][w])))),
})));

const weekly = [];
for (const r of cfg.weeklyCoverage) P.weekKeys.forEach((_, w) => {
  const ds = P.weekDays[w].filter((d) => r.weekdays.includes(days[d].wd) && !days[d].closed);
  if (!ds.length) return;
  weekly.push({ days: ds, a: Math.floor(minutesOf(r.from) / STEP), b: Math.ceil(minutesOf(r.to) / STEP), min: r.min, required: Math.min(Number(r.days) || 1, ds.length) });
});

// baselines: the app's search with several time limits
const toList = (choice) => choice.map((row) => row.slice());
const baselines = [];
for (const ms of (process.env.LIMITS || '3000,20000,60000').split(',').map(Number)) {
  const t0 = Date.now();
  const r = searchPlan(P, { timeoutMs: ms, untilMet: true, seed: 1 });
  const ev = evaluate(P, r.choice);
  baselines.push({ ms, cost: ev.cost, hard: ev.hard, searchCost: r.cost, runs: r.runs, wall: Date.now() - t0, choice: toList(r.choice) });
  console.log(`search ${ms} ms: cost ${ev.cost.toFixed(1)} hard ${ev.hard} runs ${r.runs}`);
}

fs.writeFileSync(out, JSON.stringify({
  key, W, nP: people.length, nD: days.length, STEP,
  people: people.map((p) => ({ name: p.name, active: p.active, avoidConsecutive: !!p.avoidConsecutive })),
  days: days.map((x) => ({ date: x.date, wd: x.wd, w: x.w, weekend: x.weekend, closed: x.closed })),
  nW: P.weekKeys.length, need: P.need.map((a) => Array.from(a)), target: P.target, weekly, wishes,
  weekends: P.weekends, maxEmptyWeekends: cfg.maxEmptyWeekends, perMonth: cfg.weekendDuty.perMonth,
  apptOnlyMax: cfg.appointmentOnlyMax, lateOn: cfg.lateRule.on, lateEnd, lateNext, prevEnd: P.prevEnd,
  balanceDays: days.map((x) => cfg.balanceWeekdays.includes(x.wd)), hist: P.hist, pairs: P.pairs,
  cells, baselines,
}));
console.log('written', out);
