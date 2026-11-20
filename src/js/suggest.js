// Suggestions for refining a plan by hand: for one person and day, the changes that keep the
// plan valid (no new hard-rule violation), ranked by how they change the weighted cost:
// other times, no duty, hand over to / take over from another person, move to another day of
// the week, trade days with another person, exchange times on the same day.
// Pure functions, no DOM. Used by the duty editor in view-plan.js.

import { buildProblem, makeEval } from './scheduler.js';
import { dutyKey } from './model.js';
import { minutesOf, fmtMin, formatDay } from './util.js';

/** Problem with all candidates (locked duties fixed) and the stored plan as choice matrix. */
export function problemWithPlan(state, key) {
  const P = buildProblem(state, key, { keep: 'locked' });
  const duties = state.plans[key]?.duties || {};
  const choice = P.people.map((person, p) => P.days.map((day, d) => {
    const du = duties[dutyKey(person.id, day.date)];
    if (!du) return -1;
    if (P.fixed[p][d]) return 0;
    const from = minutesOf(du.from);
    const to = minutesOf(du.to);
    let i = P.cand[p][d].findIndex((c) => c.from === from && c.to === to);
    if (i < 0) { P.cand[p][d] = [...P.cand[p][d], { from, to, len: to - from, apptOnly: false, manual: true }]; i = P.cand[p][d].length - 1; }
    return i;
  }));
  return { P, choice };
}

/** Total weighted cost and number of hard violations of a choice matrix. */
export function evaluate(P, choice) {
  const E = makeEval(P, choice);
  let cost = 0;
  let hard = 0;
  const O = new Float64Array(P.pairs.length);
  for (let d = 0; d < P.days.length; d++) { cost += E.dayCost(d); E.overlaps(d).forEach((v, k) => { O[k] += v; }); }
  for (let w = 0; w < P.weekKeys.length; w++) cost += E.weekCost(w);
  for (let p = 0; p < P.people.length; p++) { const r = E.personCost(p); cost += r.cost; hard += r.hard; }
  return { cost: cost + E.globalCost(O), hard };
}

const t = (m) => fmtMin(m).replace(/:00$/, '');
const span = (c) => `${t(c.from)}–${t(c.to)}`;
const dayName = (P, d) => formatDay(P.days[d].date);

/**
 * Ranked options for person `pid` on `date`.
 * Returns { base, times: [...], moves: [...] }; every option is
 * { label, delta, changes: [{ pid, date, from, to } | { pid, date, off: true }] }.
 */
export function suggestFor(state, key, pid, date, limit = 6) {
  const { P, choice } = problemWithPlan(state, key);
  const p = P.pIndex.get(pid);
  const d = P.days.findIndex((x) => x.date === date);
  if (p == null || d < 0) return { base: null, times: [], moves: [] };
  const base = evaluate(P, choice);
  const nP = P.people.length;
  const at = (q, e) => (choice[q][e] >= 0 ? P.cand[q][e][choice[q][e]] : null);
  // candidate of q on day e with the same or the closest times to duty du (-1 if q cannot work then)
  const sameIdx = (q, e, du) => {
    if (!du) return -1;
    let best = -1, bestD = Infinity;
    P.cand[q][e].forEach((c, i) => { const dd = Math.abs(c.from - du.from) + Math.abs(c.to - du.to); if (dd < bestD) { bestD = dd; best = i; } });
    return bestD <= 180 ? best : -1;
  };
  const spanOf = (q, e, i) => span(P.cand[q][e][i]);
  const editable = (q, e) => !P.fixed[q][e];

  const tryOpt = (label, list, kind) => {
    const old = list.map(([q, e]) => choice[q][e]);
    list.forEach(([q, e, c]) => { choice[q][e] = c; });
    const r = evaluate(P, choice);
    const changes = list.map(([q, e, c]) => (c < 0 ? { pid: P.people[q].id, date: P.days[e].date, off: true } : { pid: P.people[q].id, date: P.days[e].date, from: fmtMin(P.cand[q][e][c].from), to: fmtMin(P.cand[q][e][c].to) }));
    list.forEach(([q, e], i) => { choice[q][e] = old[i]; });
    if (r.hard > base.hard) return null;
    return { label, kind, delta: r.cost - base.cost, changes };
  };

  const times = [];
  const moves = [];
  const cur = at(p, d);
  if (editable(p, d)) {
    P.cand[p][d].forEach((c, i) => { if (i !== choice[p][d]) times.push(tryOpt(span(c), [[p, d, i]], 'time')); });
    if (cur && !P.forced[p][d]) times.push(tryOpt('Kein Dienst', [[p, d, -1]], 'off'));
  }
  for (let q = 0; q < nP; q++) {
    if (q === p || !P.people[q].active) continue;
    const other = at(q, d);
    const nameQ = P.people[q].name;
    if (cur && !other && editable(p, d) && editable(q, d) && !P.forced[p][d] && P.cand[q][d].length) {
      const i = sameIdx(q, d, cur);
      if (i >= 0) moves.push(tryOpt(`An ${nameQ} abgeben (${nameQ} ${spanOf(q, d, i)})`, [[p, d, -1], [q, d, i]], 'hand'));
    }
    if (!cur && other && editable(p, d) && editable(q, d) && !P.forced[q][d]) {
      const i = sameIdx(p, d, other);
      if (i >= 0) moves.push(tryOpt(`Von ${nameQ} übernehmen (${spanOf(p, d, i)})`, [[q, d, -1], [p, d, i]], 'take'));
    }
    if (cur && other && editable(p, d) && editable(q, d) && (cur.from !== other.from || cur.to !== other.to)) {
      const ip = sameIdx(p, d, other);
      const iq = sameIdx(q, d, cur);
      if (ip >= 0 && iq >= 0) moves.push(tryOpt(`Zeiten mit ${nameQ} tauschen (${nameQ} dann ${spanOf(q, d, iq)}, selbst ${spanOf(p, d, ip)})`, [[p, d, ip], [q, d, iq]], 'swap'));
    }
    // trade days: p gives this day to q and takes one of q's days in the same or next week
    if (cur && !other && editable(p, d) && editable(q, d) && !P.forced[p][d]) {
      const iq = sameIdx(q, d, cur);
      if (iq >= 0) {
        for (let e = 0; e < P.days.length; e++) {
          if (e === d || Math.abs(P.days[e].w - P.days[d].w) > 1) continue;
          const theirs = at(q, e);
          if (!theirs || at(p, e) || !editable(p, e) || !editable(q, e) || P.forced[q][e]) continue;
          const ip = sameIdx(p, e, theirs);
          if (ip >= 0) moves.push(tryOpt(`Mit ${nameQ} tauschen: ${nameQ} übernimmt diesen Tag (${spanOf(q, d, iq)}), dafür ${dayName(P, e)} ${spanOf(p, e, ip)}`, [[p, d, -1], [q, d, iq], [q, e, -1], [p, e, ip]], 'trade'));
        }
      }
    }
  }
  // move to another day of the same week
  if (cur && editable(p, d) && !P.forced[p][d]) {
    for (const e of P.weekDays[P.days[d].w]) {
      if (e === d || at(p, e) || !editable(p, e) || !P.cand[p][e].length) continue;
      const i = sameIdx(p, e, cur);
      let best = i >= 0 ? tryOpt(`Auf ${dayName(P, e)} verschieben (${spanOf(p, e, i)})`, [[p, d, -1], [p, e, i]], 'move') : null;
      if (!best) {
        for (let k = 0; k < P.cand[p][e].length; k++) {
          const o = tryOpt(`Auf ${dayName(P, e)} verschieben (${span(P.cand[p][e][k])})`, [[p, d, -1], [p, e, k]], 'move');
          if (o && (!best || o.delta < best.delta)) best = o;
        }
      }
      if (best) moves.push(best);
    }
  }
  const rank = (a) => a.filter(Boolean).sort((x, y) => x.delta - y.delta).slice(0, limit);
  // moves: the best two of every kind first (so moves are not crowded out by trades), then by effect
  const ok = moves.filter(Boolean).sort((x, y) => x.delta - y.delta);
  const picked = [];
  for (const kind of ['swap', 'hand', 'take', 'move', 'trade']) picked.push(...ok.filter((o) => o.kind === kind).slice(0, 2));
  const mv = [...picked, ...ok.filter((o) => !picked.includes(o))].slice(0, limit + 2).sort((x, y) => x.delta - y.delta);
  // much worse options are noise: keep them only when nothing better exists (at most two)
  const sensible = (list) => { const good = list.filter((o) => o.delta <= 400); return good.length ? good : list.slice(0, 2); };
  return { base, times: sensible(rank(times)), moves: sensible(mv) };
}

/** Words for a cost change: better / as good / worse. */
export function deltaText(delta) {
  if (delta < -1) return { cls: 'better', text: `besser (${Math.round(-delta)} Punkte)` };
  if (delta <= 1) return { cls: 'same', text: 'gleich gut' };
  return { cls: 'worse', text: `schlechter (${Math.round(delta)} Punkte)` };
}

/** Applies suggestion changes to the stored plan (new duties are not locked). */
export function applyChanges(state, key, changes) {
  const duties = state.plans[key].duties;
  for (const c of changes) {
    const k = dutyKey(c.pid, c.date);
    if (c.off) delete duties[k];
    else duties[k] = { from: c.from, to: c.to };
  }
}
