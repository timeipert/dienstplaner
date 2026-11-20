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
  const finishRun = () => {
    const res = current.result();
    runs++;
    current = null;
    if (!best || res.cost < best.cost - 1e-9) {
      const report = buildReport(P, res.choice);
      best = { ...res, report, open: openConstraints(report) };
    }
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
    result: () => ({ ...best, runs, spent, reason }),
  };
}

/** Synchronous wrapper (tests and the command line). */
export function searchPlan(P, opts = {}) {
  const s = createSearch(P, opts);
  while (!s.step(250)) { /* until met or time limit */ }
  return s.result();
}
