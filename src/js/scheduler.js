// Roster generator and analysis for the hour model (schema 2). Pure functions, no DOM.
//
// Decision: for every person p and day d one duty out of cand[p][d] (all allowed start/end
// combinations on the 30-minute grid) or "off" (choice -1).
// Hard (never broken by the search): "cannot work" hours, day windows, duty lengths,
// appointments are contained in the duty of every participant, the late-evening rule.
// Everything else is a weighted penalty (config.weights): coverage gaps, weekly hours,
// weekend duty, balance of special weekdays (Fridays), balance of shared time, preferences.
// Method: greedy improvement per cell, then simulated annealing. Details: docs/generator.md.

import { daysOfMonth, weekdayOf, dayNumber, shiftMonth, minutesOf, makeRng, fmtMin, formatDay } from './util.js';
import { STEP, CELLS, EMPTY_DAY, dutyKey } from './model.js';

const FULL_BLOCK = 'x'.repeat(CELLS);

export function isAbsent(person, date) {
  return (person.absences || []).some((a) => a.from && date >= a.from && date <= (a.to || a.from));
}

/** Effective wish string of a person for a date: absence > entry for the date > weekly pattern. Chars '.', 'x', '-', '+'. */
export function effectiveDay(state, person, date) {
  if (isAbsent(person, date)) return FULL_BLOCK;
  const base = person.pattern?.[weekdayOf(date)] || EMPTY_DAY;
  const ex = state.availability?.[date.slice(0, 7)]?.[person.id]?.[date];
  let out = '';
  for (let i = 0; i < CELLS; i++) {
    const c = ex ? ex[i] : '.';
    if (c === 'o') out += '.';
    else if (c !== '.') out += c;
    else out += base[i] === 'o' ? '.' : base[i];
  }
  return out;
}

export function appointmentsFor(cfg, person, date) {
  const wd = weekdayOf(date);
  return cfg.appointments
    .filter((a) => (a.repeat === 'weekly' ? Number(a.weekday) === wd : a.date === date))
    .filter((a) => a.participants === 'all' || (Array.isArray(a.participants) && a.participants.includes(person.id)))
    .map((a) => ({ from: minutesOf(a.from), to: minutesOf(a.to), title: a.title }));
}

function blocked(avs, from, to) {
  for (let i = Math.floor(from / STEP); i < Math.ceil(to / STEP); i++) if (avs[i] === 'x') return true;
  return false;
}

function candidatesFor(cfg, person, day, avs, ap) {
  const win = cfg.dayWindows[day.wd];
  if (!win.on && !ap.length) return [];
  let lo = minutesOf(win.from);
  let hi = minutesOf(win.to);
  const aFrom = ap.length ? Math.min(...ap.map((a) => a.from)) : 0;
  const aTo = ap.length ? Math.max(...ap.map((a) => a.to)) : 0;
  if (ap.length) { lo = Math.min(lo, aFrom); hi = Math.max(hi, aTo); }
  const minL = Math.round(person.minLen * 60);
  const maxL = Math.round(person.maxLen * 60);
  const lengths = new Set();
  if (day.weekend && cfg.weekendDuty.perMonth > 0 && !ap.length) lengths.add(Math.round(cfg.weekendDuty.hours * 60));
  else {
    for (let l = minL; l <= maxL; l += STEP) lengths.add(l);
    if (ap.length) {
      lengths.add(aTo - aFrom); // duty only for the appointment
      for (let l = aTo - aFrom; l <= Math.max(maxL, aTo - aFrom); l += STEP) if (l > maxL) lengths.add(l);
    }
  }
  const maxDay = cfg.maxDayHours * 60;
  const out = [];
  for (let start = Math.ceil(lo / STEP) * STEP; start < hi; start += STEP) {
    for (const len of lengths) {
      const end = start + len;
      if (len <= 0 || end > hi || len > maxDay) continue;
      if (ap.length && !(start <= aFrom && end >= aTo)) continue;
      if (blocked(avs, start, end)) continue;
      out.push({ from: start, to: end, len, apptOnly: ap.length > 0 && len < minL });
    }
  }
  return out;
}

const parseDuty = (d) => {
  const from = minutesOf(d.from);
  const to = minutesOf(d.to);
  return { from, to, len: to - from, apptOnly: false, manual: true };
};

/**
 * opts.keep: 'all' = every duty of the stored plan is fixed and other cells stay off (analysis);
 *            'locked' = only duties marked locked stay (generation).
 */
export function buildProblem(state, key, opts = {}) {
  const keep = opts.keep || 'all';
  const cfg = state.config;
  const plan = state.plans[key] || { duties: {} };
  const closed = new Set(cfg.closedDates.map((c) => c.date));
  const referenced = new Set(Object.keys(plan.duties || {}).map((k) => k.split('|')[0]));
  const people = state.people.filter((p) => p.active || referenced.has(p.id));
  const pIndex = new Map(people.map((p, i) => [p.id, i]));

  const days = daysOfMonth(key).map((date, d) => {
    const wd = weekdayOf(date);
    const dn = dayNumber(date);
    return { d, date, wd, dn, weekKey: dn - ((wd - cfg.weekStart + 7) % 7), closed: closed.has(date), weekend: cfg.weekendDays.includes(wd) };
  });
  const weekKeys = [...new Set(days.map((x) => x.weekKey))];
  days.forEach((x) => { x.w = weekKeys.indexOf(x.weekKey); });
  const weekDays = weekKeys.map((_, w) => days.filter((x) => x.w === w).map((x) => x.d));

  const need = days.map((day) => {
    const a = new Int8Array(CELLS);
    if (day.closed) return a;
    for (const r of cfg.coverage) {
      if (!r.weekdays.includes(day.wd)) continue;
      for (let i = Math.floor(minutesOf(r.from) / STEP); i < Math.ceil(minutesOf(r.to) / STEP); i++) a[i] = Math.max(a[i], Number(r.min) || 0);
    }
    return a;
  });

  const av = [], appts = [], cand = [], forced = [], fixed = [], initial = [];
  const workdays = 7 - cfg.weekendDays.length || 5;
  const target = [];
  const weekWork = [];
  people.forEach((person, p) => {
    av.push([]); appts.push([]); cand.push([]); forced.push([]); fixed.push([]); initial.push([]);
    days.forEach((day) => {
      const avs = effectiveDay(state, person, day.date);
      const ap = day.closed || isAbsent(person, day.date) ? [] : appointmentsFor(cfg, person, day.date);
      let list = person.active && !day.closed ? candidatesFor(cfg, person, day, avs, ap) : [];
      let fix = false;
      let ch = -1;
      const existing = plan.duties?.[dutyKey(person.id, day.date)];
      if (existing && (keep === 'all' || existing.locked)) { list = [parseDuty(existing)]; fix = true; ch = 0; }
      else if (keep === 'all') fix = true;
      else if (ap.length && list.length) ch = 0;
      av[p].push(avs); appts[p].push(ap); cand[p].push(list); fixed[p].push(fix); initial[p].push(ch);
      forced[p].push(ap.length > 0 && list.length > 0);
    });
    const work = weekDays.map((ds) => ds.filter((d) => !days[d].weekend && !days[d].closed && !isAbsent(person, days[d].date)).length);
    weekWork.push(work);
    target.push(work.map((n) => n * person.weeklyHours * 60 / workdays));
  });

  // history: duties on balance weekdays in previous months, and the last duty of the previous month
  const hist = people.map(() => 0);
  for (let m = 1; m <= cfg.balanceHistoryMonths; m++) {
    const prev = state.plans[shiftMonth(key, -m)];
    if (!prev) continue;
    for (const k of Object.keys(prev.duties || {})) {
      const [pid, date] = k.split('|');
      if (pIndex.has(pid) && cfg.balanceWeekdays.includes(weekdayOf(date))) hist[pIndex.get(pid)]++;
    }
  }
  const prevKey = shiftMonth(key, -1);
  const prevLast = daysOfMonth(prevKey).slice(-1)[0];
  const prevEnd = people.map((p) => {
    const du = state.plans[prevKey]?.duties?.[dutyKey(p.id, prevLast)];
    return du ? minutesOf(du.to) : -1;
  });

  // weekends of the month: groups of weekend days in the same week
  const weekends = weekKeys.map((_, w) => weekDays[w].filter((d) => days[d].weekend && !days[d].closed)).filter((g) => g.length);

  const pairs = [];
  people.forEach((a, p) => people.forEach((b, q) => { if (p < q && a.active && b.active) pairs.push([p, q]); }));

  return { key, cfg, W: cfg.weights, people, pIndex, days, weekKeys, weekDays, weekends, weekWork, need, av, appts, cand, forced, fixed, initial, target, hist, prevEnd, pairs };
}

// ---------------------------------------------------------------------------------------
// Cost functions on a choice matrix

function makeEval(P, choice) {
  const { cfg, W, days, people, cand, need } = P;
  const late = cfg.lateRule;
  const lateEnd = minutesOf(late.endAfter);
  const lateNext = minutesOf(late.nextFrom);
  const avoidAfter = minutesOf(cfg.weekendDuty.avoidAfter);
  const dutyOf = (p, d) => (choice[p][d] < 0 ? null : cand[p][d][choice[p][d]]);

  const coverCount = (d) => {
    const cnt = new Int8Array(CELLS);
    for (let p = 0; p < people.length; p++) {
      const du = dutyOf(p, d);
      if (du) for (let i = du.from / STEP; i < du.to / STEP; i++) cnt[i]++;
    }
    return cnt;
  };
  const alignMode = cfg.align.mode;
  const alignSplit = minutesOf(cfg.align.split);
  /** Spread of start / end times among duties of the same group (morning / afternoon) on one day. */
  const alignCost = (d) => {
    if (alignMode === 'none' || !W.align) return 0;
    const groups = [[], []];
    for (let p = 0; p < people.length; p++) {
      const du = dutyOf(p, d);
      if (du) groups[du.from < alignSplit ? 0 : 1].push(du);
    }
    let cost = 0;
    for (const g of groups) {
      if (g.length < 2) continue;
      const sSpread = (Math.max(...g.map((x) => x.from)) - Math.min(...g.map((x) => x.from))) / STEP;
      const eSpread = (Math.max(...g.map((x) => x.to)) - Math.min(...g.map((x) => x.to))) / STEP;
      const v = alignMode === 'start' ? sSpread : alignMode === 'end' ? eSpread : alignMode === 'both' ? sSpread + eSpread : Math.min(sSpread, eSpread);
      cost += W.align * v;
    }
    return cost;
  };
  const dayCost = (d) => {
    const n = need[d];
    const cnt = coverCount(d);
    let short = 0;
    for (let i = 0; i < CELLS; i++) if (n[i] > cnt[i]) short += n[i] - cnt[i];
    return short * W.coverage + alignCost(d);
  };
  const weekMisses = (w) => {
    const out = [];
    for (const r of cfg.weeklyCoverage) {
      const ds = P.weekDays[w].filter((d) => r.weekdays.includes(days[d].wd) && !days[d].closed);
      if (!ds.length) continue;
      const required = Math.min(Number(r.days) || 1, ds.length);
      const a = Math.floor(minutesOf(r.from) / STEP);
      const b = Math.ceil(minutesOf(r.to) / STEP);
      let ok = 0;
      for (const d of ds) {
        const cnt = coverCount(d);
        let all = true;
        for (let i = a; i < b; i++) if (cnt[i] < r.min) { all = false; break; }
        if (all) ok++;
      }
      if (ok < required) out.push({ rule: r, missing: required - ok });
    }
    return out;
  };
  const weekCost = (w) => weekMisses(w).reduce((s, m) => s + m.missing * W.weeklyCoverage, 0);

  const personCost = (p, detail = false) => {
    const person = people[p];
    let hard = 0;
    let cost = 0;
    const info = detail ? { rather: [], wishMiss: [], late: [], weeks: [], weekend: 0, apptOnly: 0, consecutive: 0, wantMissed: 0, balance: 0, worked: 0, prefMiss: 0 } : null;
    let prev = P.prevEnd[p] >= 0 ? { to: P.prevEnd[p] } : null;
    const worked = new Float64Array(P.weekKeys.length);
    const starts = P.weekKeys.map(() => []);
    let weekend = 0;
    let apptOnly = 0;
    for (let d = 0; d < days.length; d++) {
      const day = days[d];
      const du = dutyOf(p, d);
      if (du) {
        if (late.on && prev && prev.to > lateEnd && du.from < lateNext) { hard++; if (detail) info.late.push(d); }
        worked[day.w] += du.len;
        starts[day.w].push(du.from);
        if (W.rather) {
          const avs = P.av[p][d];
          let rr = 0;
          for (let i = du.from / STEP; i < du.to / STEP; i++) if (avs[i] === '-') rr++;
          cost += W.rather * rr;
          if (detail && rr) info.rather.push(d);
        }
        if (day.weekend) {
          weekend++;
          if (du.to > avoidAfter) cost += W.weekendLate * (du.to - avoidAfter) / STEP;
        } else {
          if (!du.apptOnly) cost += W.length * Math.abs(du.len - person.prefLen * 60) / STEP;
          if (W.outside) {
            const n = P.need[d];
            let idle = 0;
            for (let i = du.from / STEP; i < du.to / STEP; i++) if (!n[i]) idle++;
            cost += W.outside * idle;
          }
        }
        if (du.apptOnly) apptOnly++;
        if (!day.weekend && person.preferredWeekdays.length && !person.preferredWeekdays.includes(day.wd) && !P.appts[p][d].length) {
          cost += W.prefDay;
          if (detail) info.prefMiss++;
        }
        if (person.avoidConsecutive && d > 0 && dutyOf(p, d - 1)) { cost += W.consecutive; if (detail) info.consecutive++; }
      } else if (person.active && P.cand[p][d].length && P.av[p][d].includes('+')) {
        cost += W.want;
        if (detail) info.wantMissed++;
      }
      prev = du;
    }
    for (const wish of person.weeklyWishes || []) {
      const a = minutesOf(wish.from);
      const b = minutesOf(wish.to);
      for (let w = 0; w < worked.length; w++) {
        const need = Math.min(Number(wish.days) || 1, P.weekWork[p][w]);
        if (P.weekWork[p][w] < 3 || need <= 0) continue;
        const have = starts[w].filter((m) => m >= a && m < b).length;
        if (have < need) {
          cost += W.weeklyWish * (need - have);
          if (detail) info.wishMiss.push({ w, wish, missing: need - have });
        }
      }
    }
    for (let w = 0; w < worked.length; w++) {
      cost += W.hours * Math.abs(worked[w] - P.target[p][w]) / 60;
      if (detail) info.weeks.push({ worked: worked[w] / 60, target: P.target[p][w] / 60 });
    }
    if (person.active) cost += W.weekend * Math.abs(weekend - cfg.weekendDuty.perMonth);
    if (apptOnly > cfg.appointmentOnlyMax) cost += W.apptOnly * (apptOnly - cfg.appointmentOnlyMax);
    if (detail) { info.weekend = weekend; info.apptOnly = apptOnly; info.worked = worked.reduce((a, b) => a + b, 0) / 60; }
    return { hard, cost, info };
  };

  const overlaps = (d) => {
    const out = new Float64Array(P.pairs.length);
    P.pairs.forEach(([p, q], k) => {
      const a = dutyOf(p, d);
      const b = dutyOf(q, d);
      if (a && b) out[k] = Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from));
    });
    return out;
  };
  const balanceCounts = () => people.map((person, p) => {
    let n = P.hist[p];
    for (let d = 0; d < days.length; d++) if (cfg.balanceWeekdays.includes(days[d].wd) && choice[p][d] >= 0) n++;
    return n;
  });
  const emptyWeekends = () => P.weekends.filter((g) => !g.some((d) => people.some((_, p) => choice[p][d] >= 0)));
  const globalCost = (O) => {
    let cost = 0;
    const empty = emptyWeekends().length;
    if (empty > cfg.maxEmptyWeekends) cost += W.emptyWeekend * (empty - cfg.maxEmptyWeekends);
    if (cfg.balanceWeekdays.length) {
      const f = balanceCounts().filter((_, p) => people[p].active);
      if (f.length) { const mean = f.reduce((a, b) => a + b, 0) / f.length; cost += W.balanceDay * f.reduce((a, x) => a + (x - mean) ** 2, 0); }
    }
    if (O.length > 1) {
      const mean = O.reduce((a, b) => a + b, 0) / O.length;
      cost += W.pairs * O.reduce((a, x) => a + ((x - mean) / 60) ** 2, 0);
    }
    return cost;
  };
  return { dutyOf, coverCount, dayCost, weekCost, weekMisses, personCost, overlaps, globalCost, balanceCounts, emptyWeekends };
}

// ---------------------------------------------------------------------------------------
// Optimizer

export function createOptimizer(P, opts = {}) {
  const rng = makeRng(opts.seed ?? 20261120);
  const budgetMs = opts.budgetMs ?? 3000;
  const nP = P.people.length;
  const nD = P.days.length;
  const choice = P.initial.map((row) => row.slice());
  const E = makeEval(P, choice);

  const dc = new Float64Array(nD);
  const wc = new Float64Array(P.weekKeys.length);
  const pc = new Float64Array(nP);
  const ph = new Int32Array(nP);
  const dayOv = [];
  const O = new Float64Array(P.pairs.length);
  for (let d = 0; d < nD; d++) { dc[d] = E.dayCost(d); dayOv.push(E.overlaps(d)); dayOv[d].forEach((v, k) => { O[k] += v; }); }
  for (let w = 0; w < wc.length; w++) wc[w] = E.weekCost(w);
  for (let p = 0; p < nP; p++) { const r = E.personCost(p); pc[p] = r.cost; ph[p] = r.hard; }
  let gc = E.globalCost(O);
  let total = dc.reduce((a, b) => a + b, 0) + wc.reduce((a, b) => a + b, 0) + pc.reduce((a, b) => a + b, 0) + gc;

  const cells = [];
  for (let p = 0; p < nP; p++) for (let d = 0; d < nD; d++) if (!P.fixed[p][d] && P.cand[p][d].length) cells.push([p, d]);
  const cellsOf = P.people.map((_, p) => cells.filter((c) => c[0] === p).map((c) => c[1]));

  /** Applies changes [[p, d, choice]...]; returns { ok, delta, accept(), revert() }. */
  const tryChange = (changes) => {
    const old = changes.map(([p, d]) => choice[p][d]);
    const Ds = new Set(); const Ws = new Set(); const Ps = new Set();
    for (const [p, d] of changes) { Ds.add(d); Ws.add(P.days[d].w); Ps.add(p); }
    let before = gc;
    for (const d of Ds) before += dc[d];
    for (const w of Ws) before += wc[w];
    for (const p of Ps) before += pc[p];
    changes.forEach(([p, d, c]) => { choice[p][d] = c; });
    const savedOv = [];
    for (const d of Ds) {
      const nv = E.overlaps(d);
      savedOv.push([d, dayOv[d]]);
      nv.forEach((v, k) => { O[k] += v - dayOv[d][k]; });
      dayOv[d] = nv;
    }
    const revert = () => {
      changes.forEach(([p, d], i) => { choice[p][d] = old[i]; });
      for (const [d, ov] of savedOv) { ov.forEach((v, k) => { O[k] += v - dayOv[d][k]; }); dayOv[d] = ov; }
    };
    let ok = true;
    const np = [];
    for (const p of Ps) { const r = E.personCost(p); if (r.hard > ph[p]) { ok = false; break; } np.push([p, r]); }
    if (!ok) return { ok, delta: Infinity, revert, accept: () => {} };
    const nd = [...Ds].map((d) => [d, E.dayCost(d)]);
    const nw = [...Ws].map((w) => [w, E.weekCost(w)]);
    const ng = E.globalCost(O);
    let after = ng;
    for (const [, v] of nd) after += v;
    for (const [, v] of nw) after += v;
    for (const [, r] of np) after += r.cost;
    const delta = after - before;
    return {
      ok, delta, revert,
      accept: () => {
        for (const [d, v] of nd) dc[d] = v;
        for (const [w, v] of nw) wc[w] = v;
        for (const [p, r] of np) { pc[p] = r.cost; ph[p] = r.hard; }
        gc = ng;
        total += delta;
      },
    };
  };

  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pick = (a) => a[Math.floor(rng() * a.length)];

  // greedy improvement: each cell takes its best option, three passes
  for (let pass = 0; pass < 3; pass++) {
    for (const [p, d] of shuffle(cells.slice())) {
      const opts2 = P.cand[p][d].map((_, i) => i);
      if (!P.forced[p][d]) opts2.push(-1);
      let best = null;
      for (const c of opts2) {
        if (c === choice[p][d]) continue;
        const t = tryChange([[p, d, c]]);
        if (t.ok && t.delta < -1e-9 && (!best || t.delta < best.delta)) best = { c, delta: t.delta };
        t.revert();
      }
      if (best) { const t = tryChange([[p, d, best.c]]); t.accept(); }
    }
  }
  let best = choice.map((r) => r.slice());
  let bestTotal = total;

  const randomOption = (p, d) => {
    if (!P.forced[p][d] && choice[p][d] >= 0 && rng() < 0.3) return -1;
    const list = P.cand[p][d];
    const cur = choice[p][d] >= 0 ? list[choice[p][d]] : null;
    if (cur && rng() < 0.5) {
      const near = [];
      list.forEach((c, i) => { if (i !== choice[p][d] && Math.abs(c.from - cur.from) <= 60 && Math.abs(c.to - cur.to) <= 60) near.push(i); });
      if (near.length) return pick(near);
    }
    return Math.floor(rng() * list.length);
  };

  const iterate = (T) => {
    if (!cells.length) return;
    const r = rng();
    let changes;
    if (r < 0.55) {
      const [p, d] = pick(cells);
      const c = randomOption(p, d);
      if (c === choice[p][d]) return;
      changes = [[p, d, c]];
    } else if (r < 0.85) {
      // move a duty of one person to another day of the same week
      const p = Math.floor(rng() * nP);
      const mine = cellsOf[p].filter((d) => choice[p][d] >= 0 && !P.forced[p][d]);
      if (!mine.length) return;
      const d1 = pick(mine);
      const free = cellsOf[p].filter((d) => choice[p][d] < 0 && P.days[d].w === P.days[d1].w);
      if (!free.length) return;
      const d2 = pick(free);
      changes = [[p, d1, -1], [p, d2, Math.floor(rng() * P.cand[p][d2].length)]];
    } else {
      // hand a day over to another person
      const p = Math.floor(rng() * nP);
      const q = Math.floor(rng() * nP);
      if (p === q) return;
      const ds = cellsOf[p].filter((d) => choice[p][d] >= 0 && !P.forced[p][d] && choice[q][d] < 0 && !P.fixed[q][d] && P.cand[q][d].length);
      if (!ds.length) return;
      const d = pick(ds);
      changes = [[p, d, -1], [q, d, Math.floor(rng() * P.cand[q][d].length)]];
    }
    const t = tryChange(changes);
    if (t.ok && (t.delta <= 0 || rng() < Math.exp(-t.delta / T))) {
      t.accept();
      if (total < bestTotal - 1e-9) { bestTotal = total; best = choice.map((row) => row.slice()); }
    } else t.revert();
  };

  let spent = 0;
  let done = cells.length === 0;
  return {
    step(ms) {
      if (done) return true;
      const t0 = Date.now();
      while (Date.now() - t0 < ms && spent + (Date.now() - t0) < budgetMs) {
        const frac = Math.min(1, (spent + (Date.now() - t0)) / budgetMs);
        const T = 60 * Math.pow(0.5 / 60, frac);
        for (let k = 0; k < 100; k++) iterate(T);
      }
      spent += Date.now() - t0;
      if (spent >= budgetMs) done = true;
      return done;
    },
    progress: () => (done ? 1 : Math.min(1, spent / budgetMs)),
    result() {
      const duties = {};
      P.people.forEach((person, p) => P.days.forEach((day, d) => {
        const c = best[p][d];
        if (c >= 0) { const du = P.cand[p][d][c]; duties[dutyKey(person.id, day.date)] = { from: fmtMin(du.from), to: fmtMin(du.to) }; }
      }));
      return { duties, choice: best, cost: bestTotal };
    },
  };
}

/** Synchronous wrapper (tests). */
export function generate(state, key, opts = {}) {
  const P = buildProblem(state, key, { keep: opts.keep || 'locked' });
  const opt = createOptimizer(P, opts);
  while (!opt.step(250)) { /* run until the budget is used */ }
  return { problem: P, ...opt.result() };
}

/** Choice matrix of the stored plan (for analyze after buildProblem(..., {keep:'all'})). */
export function storedChoice(P) {
  return P.initial.map((row) => row.slice());
}

// ---------------------------------------------------------------------------------------
// Analysis for display

function runs(flags) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= flags.length; i++) {
    if (i < flags.length && flags[i]) { if (start < 0) start = i; } else if (start >= 0) { out.push([start * STEP, i * STEP]); start = -1; }
  }
  return out;
}

export function analyze(P, choice) {
  const E = makeEval(P, choice);
  const { days, people, cfg } = P;
  const messages = [];
  const dayInfo = days.map((day, d) => {
    const cnt = E.coverCount(d);
    const gaps = runs(Array.from(P.need[d], (n, i) => n > cnt[i]));
    for (const [a, b] of gaps) messages.push({ level: 'bad', d, text: `${formatDay(day.date)}: ${fmtMin(a)}–${fmtMin(b)} nicht besetzt` });
    return { gaps, cnt };
  });
  P.weekKeys.forEach((_, w) => {
    for (const m of E.weekMisses(w)) {
      const first = days[P.weekDays[w][0]].date;
      messages.push({ level: 'warn', text: `Woche ab ${formatDay(first)}: ${m.rule.from}–${m.rule.to} an ${m.missing} Tag(en) zu wenig besetzt` });
    }
  });

  const empty = E.emptyWeekends();
  if (empty.length > cfg.maxEmptyWeekends) {
    messages.push({ level: 'warn', text: `${empty.length} Wochenenden ohne Dienst (erlaubt ${cfg.maxEmptyWeekends}): ${empty.map((g) => formatDay(days[g[0]].date)).join(', ')}` });
  }
  const dutyIssues = people.map(() => days.map(() => []));
  const balance = E.balanceCounts();
  const stats = people.map((person, p) => {
    const r = E.personCost(p, true);
    for (const d of r.info.late) {
      dutyIssues[p][d].push({ level: 'bad', text: `Nach spätem Dienst am Vortag erst ab ${cfg.lateRule.nextFrom}` });
      messages.push({ level: 'bad', d, text: `${person.name}, ${formatDay(days[d].date)}: Beginn zu früh nach spätem Dienst am Vortag` });
    }
    days.forEach((day, d) => {
      const du = E.dutyOf(p, d);
      const ap = P.appts[p][d];
      if (du) {
        if (blocked(P.av[p][d], du.from, du.to)) {
          dutyIssues[p][d].push({ level: 'bad', text: 'Liegt in einer Zeit, in der die Person nicht kann' });
          messages.push({ level: 'bad', d, text: `${person.name}, ${formatDay(day.date)}: Dienst in gesperrter Zeit („kann nicht“)` });
        }
        const win = cfg.dayWindows[day.wd];
        if (!ap.length && (!win.on || du.from < minutesOf(win.from) || du.to > minutesOf(win.to))) {
          dutyIssues[p][d].push({ level: 'warn', text: `Außerhalb der Dienstzeiten des Tages (${win.on ? win.from + '–' + win.to : 'kein Diensttag'})` });
        }
        if (!person.active) dutyIssues[p][d].push({ level: 'warn', text: 'Person ist archiviert' });
      }
      for (const a of ap) {
        if (!du || du.from > a.from || du.to < a.to) {
          dutyIssues[p][d].push({ level: 'bad', text: `Termin „${a.title}“ ${fmtMin(a.from)}–${fmtMin(a.to)} nicht im Dienst` });
          messages.push({ level: 'bad', d, text: `${person.name}, ${formatDay(day.date)}: Termin „${a.title}“ nicht im Dienst enthalten` });
        }
      }
    });
    for (const d of r.info.rather) {
      dutyIssues[p][d].push({ level: 'warn', text: 'Liegt (teilweise) in einer „eher nicht“-Zeit' });
      messages.push({ level: 'warn', d, text: `${person.name}, ${formatDay(days[d].date)}: Dienst in „eher nicht“-Zeit` });
    }
    for (const m of r.info.wishMiss) {
      messages.push({ level: 'warn', text: `${person.name}: Woche ab ${formatDay(days[P.weekDays[m.w][0]].date)}: Wunsch „${m.wish.label || 'wöchentlich'}“ (${m.wish.from}–${m.wish.to}) nicht erfüllt` });
    }
    if (person.active && r.info.weekend !== cfg.weekendDuty.perMonth) {
      messages.push({ level: 'warn', text: `${person.name}: ${r.info.weekend} statt ${cfg.weekendDuty.perMonth} Wochenenddienst(e)` });
    }
    if (r.info.apptOnly > cfg.appointmentOnlyMax) {
      messages.push({ level: 'warn', text: `${person.name}: ${r.info.apptOnly} Dienste nur für einen Termin (erlaubt ${cfg.appointmentOnlyMax})` });
    }
    const targetSum = P.target[p].reduce((a, b) => a + b, 0) / 60;
    return { person, ...r.info, target: targetSum, balance: balance[p], hist: P.hist[p] };
  });

  const O = new Float64Array(P.pairs.length);
  days.forEach((_, d) => E.overlaps(d).forEach((v, k) => { O[k] += v; }));
  const pairStats = P.pairs.map(([p, q], k) => ({ a: people[p].name, b: people[q].name, hours: O[k] / 60 }));
  const order = { bad: 0, warn: 1 };
  messages.sort((a, b) => order[a.level] - order[b.level] || (a.d ?? 99) - (b.d ?? 99));
  return { dayInfo, dutyIssues, stats, pairStats, messages };
}
