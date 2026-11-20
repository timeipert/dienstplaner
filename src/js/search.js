// Repeated search with a time limit: runs the optimizer several times (new random starts and
// restarts from the best plan so far) until every rule of the evaluation is met or the time
// limit is reached. The best plan is the one with the lowest weighted cost (config.weights),
// so the weights decide which rule gives way when not all of them can be met.
// Rules that no plan can meet completely (lower bounds, report.js structuralBounds) do not
// count as violated. Pure functions, no DOM.

import { createOptimizer } from './scheduler.js';
import { buildReport } from './report.js';

/** Constraints of a report that are not met (status warn or bad). */
export function openConstraints(report) {
  return report.constraints.filter((c) => c.status === 'warn' || c.status === 'bad');
}

/**
 * opts.timeoutMs: total time; opts.runMs: time of one optimizer run; opts.seed.
 * opts.untilMet: false = a single run (fast mode).
 * Returns { step(ms) -> done, progress(), state(), stop(), result() }.
 */
export function createSearch(P, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const runMs = Math.min(opts.runMs ?? 3000, timeoutMs);
  const untilMet = opts.untilMet !== false;
  let seed = opts.seed ?? 1;
  let spent = 0;
  let runs = 0;
  let best = null;
  let reason = '';
  let stopped = false;
  let current = null;

  const startRun = () => {
    // every second run continues from the best plan so far at a lower temperature
    const fromBest = best && runs % 2 === 1;
    current = createOptimizer(P, { budgetMs: runMs, seed: seed++, start: fromBest ? best.choice : null, T0: fromBest ? 15 : 60 });
  };
  // pool of distinct good plans (variants): kept when they differ from every better plan in
  // at least MIN_DIFF person-days
  const pool = [];
  const MIN_DIFF = 6;
  const diffCount = (a, b) => {
    let n = 0;
    for (let p = 0; p < a.length; p++) for (let d = 0; d < a[p].length; d++) if (a[p][d] !== b[p][d]) n++;
    return n;
  };
  const addToPool = (res) => {
    if (pool.some((x) => diffCount(x.choice, res.choice) < MIN_DIFF && x.cost <= res.cost)) return;
    for (let i = pool.length - 1; i >= 0; i--) if (diffCount(pool[i].choice, res.choice) < MIN_DIFF) pool.splice(i, 1);
    pool.push(res);
    pool.sort((a, b) => a.cost - b.cost);
    if (pool.length > 4) pool.length = 4;
  };
  const finishRun = () => {
    const res = current.result();
    runs++;
    current = null;
    addToPool(res);
    if (!best || res.cost < best.cost - 1e-9) {
      const report = buildReport(P, res.choice);
      best = { ...res, report, open: openConstraints(report) };
    }
  };

  /** Up to 3 plans besides the best whose cost is at most 10 % higher, with their open rules. */
  const variantsOf = () => {
    if (!best) return [];
    return pool.filter((x) => x.choice !== best.choice && diffCount(x.choice, best.choice) >= MIN_DIFF && x.cost <= best.cost * 1.1 + 5).slice(0, 3).map((x) => {
      const report = buildReport(P, x.choice);
      const open = openConstraints(report);
      return { duties: x.duties, cost: x.cost, diff: diffCount(x.choice, best.choice), open: open.map((c) => c.label.replace(/ \(.*\)$/, '')) };
    });
  };

  return {
    step(ms) {
      if (reason) return true;
      const t0 = Date.now();
      while (Date.now() - t0 < ms && !reason) {
        if (stopped && (best || current)) { reason = 'stopped'; break; }
        if (!current) startRun();
        const slice = Math.max(1, ms - (Date.now() - t0));
        if (current.step(slice)) finishRun();
        const used = spent + (Date.now() - t0);
        if (stopped) reason = 'stopped';
        else if (best && best.open.length === 0) reason = 'met';
        else if (!untilMet && runs >= 1) reason = 'single';
        else if (used >= timeoutMs) reason = 'timeout';
      }
      spent += Date.now() - t0;
      if (reason && current) finishRun();
      return !!reason;
    },
    stop() { stopped = true; },
    progress: () => (reason ? 1 : Math.min(1, untilMet ? spent / timeoutMs : spent / runMs)),
    state: () => ({ runs, spent, reason, open: best ? best.open.length : null, cost: best ? best.cost : null }),
    result: () => ({ ...best, runs, spent, reason, variants: variantsOf() }),
  };
}

/** Synchronous wrapper (tests and the command line). */
export function searchPlan(P, opts = {}) {
  const s = createSearch(P, opts);
  while (!s.step(250)) { /* until met or time limit */ }
  return s.result();
}
