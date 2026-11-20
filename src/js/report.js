// Evaluation of a plan: how well every rule is met, how fair the load is, who works with whom.
// Pure functions, no DOM. Input: problem (buildProblem(..., {keep:'all'})) and choice matrix.

import { analyze, makeEval } from './scheduler.js';
import { STEP } from './model.js';
import { minutesOf, fmtHours } from './util.js';

/** Status for a "met of total" constraint. Hard constraints: every miss is a violation. */
function ratioStatus(met, total, hard) {
  if (total === 0) return 'na';
  if (met === total) return 'ok';
  if (hard) return 'bad';
  return met / total >= 0.9 ? 'warn' : 'bad';
}

const pct = (met, total) => (total ? Math.round((met / total) * 100) : 100);

export function buildReport(P, choice) {
  const A = analyze(P, choice);
  const E = makeEval(P, choice);
  const cfg = P.cfg;
  const nD = P.days.length;
  const duty = (p, d) => (choice[p][d] < 0 ? null : P.cand[p][d][choice[p][d]]);
  const avoidAfter = minutesOf(cfg.weekendDuty.avoidAfter);
  const lateEnd = minutesOf(cfg.lateRule.endAfter);
  const lateNext = minutesOf(cfg.lateRule.nextFrom);
  const split = minutesOf(cfg.align.split);

  // ---- per person figures
  const all = P.people.map((person, p) => {
    const r = { person, idx: p, duties: 0, hours: 0, byWd: Array(7).fill(0), weekend: 0, weekendLate: 0, late: 0, morning: 0, apptOnly: 0, consec: 0, balanceMonth: 0 };
    for (let d = 0; d < nD; d++) {
      const du = duty(p, d);
      if (!du) continue;
      const day = P.days[d];
      r.duties++;
      r.hours += du.len / 60;
      r.byWd[day.wd]++;
      if (day.weekend) { r.weekend++; if (du.to > avoidAfter) r.weekendLate++; }
      if (du.to > lateEnd) r.late++;
      if (du.from < split) r.morning++;
      if (du.apptOnly) r.apptOnly++;
      if (d > 0 && duty(p, d - 1)) r.consec++;
      if (cfg.balanceWeekdays.includes(day.wd)) r.balanceMonth++;
    }
    r.avgLen = r.duties ? r.hours / r.duties : 0;
    r.target = A.stats[p].target;
    r.ratio = r.target ? r.hours / r.target : 0;
    r.balanceTotal = r.balanceMonth + P.hist[p];
    return r;
  });
  const persons = all.filter((r) => r.person.active || r.duties);
  const active = persons.filter((r) => r.person.active);

  // ---- pairs: hours and days on which two persons are at work at the same time
  const pairs = {};
  persons.forEach((a) => { pairs[a.idx] = {}; });
  for (const a of persons) {
    for (const b of persons) {
      if (a.idx >= b.idx) continue;
      let min = 0;
      let days = 0;
      for (let d = 0; d < nD; d++) {
        const x = duty(a.idx, d);
        const y = duty(b.idx, d);
        if (!x || !y) continue;
        const o = Math.min(x.to, y.to) - Math.max(x.from, y.from);
        if (o > 0) { min += o; days++; }
      }
      pairs[a.idx][b.idx] = pairs[b.idx][a.idx] = { hours: min / 60, days };
    }
  }
  const pairList = [];
  for (const a of persons) for (const b of persons) if (a.idx < b.idx) pairList.push({ a: a.person.name, b: b.person.name, ...pairs[a.idx][b.idx] });

  // ---- constraints
  const cs = [];
  const add = (c) => cs.push({ unit: '', detail: '', met: null, total: null, ...c });
  const ratio = (id, group, label, met, total, detail, hard = false, unit = '') => add({ id, group, label, met, total, unit, detail, status: ratioStatus(met, total, hard) });

  // hard
  let nDuties = 0, blockedN = 0, nNoAppt = 0, outside = 0;
  for (let p = 0; p < P.people.length; p++) {
    for (let d = 0; d < nD; d++) {
      const du = duty(p, d);
      if (!du) continue;
      nDuties++;
      for (let i = du.from / STEP; i < du.to / STEP; i++) if (P.av[p][d][i] === 'x') { blockedN++; break; }
      if (!P.appts[p][d].length) {
        nNoAppt++;
        const win = cfg.dayWindows[P.days[d].wd];
        if (!win.on || du.from < minutesOf(win.from) || du.to > minutesOf(win.to)) outside++;
      }
    }
  }
  ratio('blocked', 'hart', '„Kann nicht“-Zeiten und Abwesenheiten eingehalten', nDuties - blockedN, nDuties, blockedN ? `${blockedN} Dienst(e) liegen in gesperrter Zeit` : 'kein Dienst in gesperrter Zeit', true, 'Dienste');

  let apptTotal = 0, apptMet = 0;
  for (let p = 0; p < P.people.length; p++) {
    for (let d = 0; d < nD; d++) {
      const du = duty(p, d);
      for (const a of P.appts[p][d]) { apptTotal++; if (du && du.from <= a.from && du.to >= a.to) apptMet++; }
    }
  }
  ratio('appts', 'hart', 'Termine liegen im Dienst der Teilnehmenden', apptMet, apptTotal, apptTotal ? '' : 'keine Termine in diesem Monat', true, 'Teilnahmen');
  ratio('window', 'hart', 'Dienste liegen in den Dienstzeiten des Wochentags', nNoAppt - outside, nNoAppt, outside ? `${outside} Dienst(e) außerhalb (von Hand eingetragen?)` : '', true, 'Dienste');

  let lateTotal = 0, lateViol = 0;
  if (cfg.lateRule.on) {
    for (let p = 0; p < P.people.length; p++) {
      for (let d = 0; d < nD; d++) {
        const du = duty(p, d);
        const prevEnd = d === 0 ? P.prevEnd[p] : duty(p, d - 1)?.to ?? -1;
        if (du && prevEnd > lateEnd) { lateTotal++; if (du.from < lateNext) lateViol++; }
      }
    }
    ratio('late', 'hart', `Nach Dienst über ${cfg.lateRule.endAfter} hinaus Folgetag frühestens ${cfg.lateRule.nextFrom}`, lateTotal - lateViol, lateTotal, lateTotal ? '' : 'kein Fall in diesem Monat', true, 'Folgetage');
  }

  // coverage
  let needTotal = 0, needMet = 0;
  for (let d = 0; d < nD; d++) {
    const n = P.need[d];
    const cnt = E.coverCount(d);
    for (let i = 0; i < n.length; i++) if (n[i]) { needTotal += n[i]; needMet += Math.min(n[i], cnt[i]); }
  }
  const gaps = A.dayInfo.reduce((a, x) => a + x.gaps.length, 0);
  add({ id: 'coverage', group: 'weich', label: 'Benötigte Besetzung abgedeckt', met: needMet / 2, total: needTotal / 2, unit: 'Personenstunden', detail: gaps ? `${gaps} Lücke(n)` : 'keine Lücke', status: ratioStatus(needMet, needTotal, true) });

  cfg.weeklyCoverage.forEach((rule) => {
    let weeks = 0, miss = 0;
    P.weekKeys.forEach((_, w) => {
      const ds = P.weekDays[w].filter((d) => rule.weekdays.includes(P.days[d].wd) && !P.days[d].closed);
      if (!ds.length) return;
      weeks++;
      if (E.weekMisses(w).some((m) => m.rule === rule)) miss++;
    });
    ratio(`wc-${rule.id}`, 'weich', `${rule.from}–${rule.to} an ${rule.days} Tag(en) pro Woche besetzt`, weeks - miss, weeks, '', false, 'Wochen');
  });

  // weekly hours
  let wkTotal = 0, wkMet = 0, worst = null;
  for (const r of active) {
    A.stats[r.idx].weeks.forEach((wk, w) => {
      if (wk.target <= 0) return;
      wkTotal++;
      const diff = Math.abs(wk.worked - wk.target);
      if (diff <= 1) wkMet++;
      if (!worst || diff > worst.diff) worst = { diff, name: r.person.name, w };
    });
  }
  ratio('weekHours', 'weich', 'Wochenstunden erreicht (Abweichung höchstens 1 Std.)', wkMet, wkTotal, worst && worst.diff > 1 ? `größte Abweichung ${fmtHours(worst.diff)} Std. (${worst.name})` : '', false, 'Personenwochen');

  // weekend
  const off = active.filter((r) => r.weekend !== cfg.weekendDuty.perMonth);
  ratio('weekendDuty', 'weich', `Jede Person genau ${cfg.weekendDuty.perMonth} Wochenenddienst(e)`, active.length - off.length, active.length, off.map((r) => `${r.person.name}: ${r.weekend}`).join(', '), false, 'Personen');
  const weTotal = persons.reduce((a, r) => a + r.weekend, 0);
  const weLate = persons.reduce((a, r) => a + r.weekendLate, 0);
  ratio('weekendEnd', 'weich', `Wochenenddienste enden bis ${cfg.weekendDuty.avoidAfter}`, weTotal - weLate, weTotal, '', false, 'Dienste');
  const emptyWe = E.emptyWeekends().length;
  add({ id: 'emptyWe', group: 'weich', label: `Höchstens ${cfg.maxEmptyWeekends} Wochenende(n) ohne Dienst`, met: P.weekends.length - emptyWe, total: P.weekends.length, unit: 'Wochenenden',
    detail: emptyWe ? `${emptyWe} Wochenende(n) ohne Dienst` : '', status: P.weekends.length === 0 ? 'na' : emptyWe <= cfg.maxEmptyWeekends ? 'ok' : 'bad' });

  const apO = active.filter((r) => r.apptOnly > cfg.appointmentOnlyMax);
  ratio('apptOnly', 'weich', `Dienste nur für einen Termin: höchstens ${cfg.appointmentOnlyMax} je Person`, active.length - apO.length, active.length, apO.map((r) => `${r.person.name}: ${r.apptOnly}`).join(', '), false, 'Personen');

  const avoidC = persons.filter((r) => r.person.avoidConsecutive);
  const cDuties = avoidC.reduce((a, r) => a + r.duties, 0);
  const cConsec = avoidC.reduce((a, r) => a + r.consec, 0);
  ratio('consec', 'weich', 'Keine Dienste an Folgetagen (wo gewünscht)', cDuties - cConsec, cDuties, cConsec ? avoidC.filter((r) => r.consec).map((r) => `${r.person.name}: ${r.consec}`).join(', ') : '', false, 'Dienste');

  let pfTotal = 0, pfMet = 0;
  for (const r of persons) {
    if (!r.person.preferredWeekdays.length) continue;
    for (let d = 0; d < nD; d++) {
      const du = duty(r.idx, d);
      if (!du || P.days[d].weekend || P.appts[r.idx][d].length) continue;
      pfTotal++;
      if (r.person.preferredWeekdays.includes(P.days[d].wd)) pfMet++;
    }
  }
  ratio('prefDays', 'weich', 'Dienste an bevorzugten Wochentagen', pfMet, pfTotal, '', false, 'Dienste');

  let ratherBad = 0;
  for (let p = 0; p < P.people.length; p++) {
    for (let d = 0; d < nD; d++) {
      const du = duty(p, d);
      if (!du) continue;
      for (let i = du.from / STEP; i < du.to / STEP; i++) if (P.av[p][d][i] === '-') { ratherBad++; break; }
    }
  }
  ratio('rather', 'weich', 'Keine Dienste in „eher nicht“-Zeiten', nDuties - ratherBad, nDuties, ratherBad ? `${ratherBad} Dienst(e) berühren eine „eher nicht“-Zeit` : '', false, 'Dienste');

  let wwTotal = 0, wwMet = 0;
  for (const r of persons) {
    for (const wish of r.person.weeklyWishes || []) {
      const a = minutesOf(wish.from), b = minutesOf(wish.to);
      P.weekKeys.forEach((_, w) => {
        const need = Math.min(Number(wish.days) || 1, P.weekWork[r.idx][w]);
        if (P.weekWork[r.idx][w] < 3 || need <= 0) return;
        wwTotal++;
        const have = P.weekDays[w].filter((d) => { const du = duty(r.idx, d); return du && du.from >= a && du.from < b; }).length;
        if (have >= need) wwMet++;
      });
    }
  }
  ratio('weeklyWish', 'weich', 'Wöchentliche Wünsche (z. B. einmal vormittags)', wwMet, wwTotal, wwTotal ? '' : 'keine eingetragen', false, 'Personenwochen');

  let wantTotal = 0, wantMet = 0;
  for (const r of active) {
    for (let d = 0; d < nD; d++) {
      if (!P.cand[r.idx][d].length || !P.av[r.idx][d].includes('+')) continue;
      wantTotal++;
      if (duty(r.idx, d)) wantMet++;
    }
  }
  ratio('want', 'weich', '„Möchte arbeiten“ berücksichtigt', wantMet, wantTotal, wantTotal ? '' : 'keine eingetragen', false, 'Tage');

  if (cfg.align.mode !== 'none') {
    let gTotal = 0, gMet = 0;
    for (let d = 0; d < nD; d++) {
      const groups = [[], []];
      for (let p = 0; p < P.people.length; p++) { const du = duty(p, d); if (du) groups[du.from < split ? 0 : 1].push(du); }
      for (const g of groups) {
        if (g.length < 2) continue;
        gTotal++;
        const s0 = new Set(g.map((x) => x.from)).size === 1;
        const e0 = new Set(g.map((x) => x.to)).size === 1;
        const ok = cfg.align.mode === 'start' ? s0 : cfg.align.mode === 'end' ? e0 : cfg.align.mode === 'both' ? s0 && e0 : s0 || e0;
        if (ok) gMet++;
      }
    }
    ratio('align', 'weich', 'Gleichzeitiger Beginn/Ende bei mehreren Diensten am Tag', gMet, gTotal, '', false, 'Tage');
  }

  let lenTotal = 0, lenMet = 0;
  for (const r of persons) {
    for (let d = 0; d < nD; d++) {
      const du = duty(r.idx, d);
      if (!du || P.days[d].weekend || du.apptOnly) continue;
      lenTotal++;
      if (Math.abs(du.len - r.person.prefLen * 60) < 1) lenMet++;
    }
  }
  ratio('length', 'weich', 'Dienste in Wunschlänge', lenMet, lenTotal, '', false, 'Dienste');

  // balance
  const spreadStatus = (vals, okMax, warnMax) => { const sp = Math.max(...vals) - Math.min(...vals); return sp <= okMax ? 'ok' : sp <= warnMax ? 'warn' : 'bad'; };
  if (active.length > 1) {
    const ratios = active.map((r) => r.ratio);
    add({ id: 'bal-ratio', group: 'ausgleich', label: 'Erfüllung der Vertragsstunden gleichmäßig', status: spreadStatus(ratios, 0.08, 0.2),
      detail: active.map((r) => `${r.person.name} ${Math.round(r.ratio * 100)} %`).join(' · ') });
    if (cfg.balanceWeekdays.length) {
      const f = active.map((r) => r.balanceTotal);
      add({ id: 'bal-day', group: 'ausgleich', label: 'Ausgleichstage (z. B. Freitage) gleich verteilt, mit Vormonaten', status: spreadStatus(f, 1, 2),
        detail: active.map((r) => `${r.person.name} ${r.balanceMonth}${P.hist[r.idx] ? ` (gesamt ${r.balanceTotal})` : ''}`).join(' · ') });
    }
    add({ id: 'bal-we', group: 'ausgleich', label: 'Wochenenddienste gleich verteilt', status: spreadStatus(active.map((r) => r.weekend), 0, 1), detail: active.map((r) => `${r.person.name} ${r.weekend}`).join(' · ') });
    add({ id: 'bal-late', group: 'ausgleich', label: `Späte Dienste (Ende nach ${cfg.lateRule.endAfter}) gleich verteilt`, status: spreadStatus(active.map((r) => r.late), 1, 3), detail: active.map((r) => `${r.person.name} ${r.late}`).join(' · ') });
    if (pairList.length) {
      const hrs = pairList.map((x) => x.hours);
      const mean = hrs.reduce((a, b) => a + b, 0) / hrs.length;
      const sp = Math.max(...hrs) - Math.min(...hrs);
      add({ id: 'bal-pair', group: 'ausgleich', label: 'Gemeinsame Arbeitszeit der Personen gleichmäßig', status: sp <= Math.max(2, mean * 0.1) ? 'ok' : sp <= Math.max(5, mean * 0.25) ? 'warn' : 'bad',
        detail: pairList.map((x) => `${x.a} + ${x.b} ${fmtHours(x.hours)} Std.`).join(' · ') });
    }
  }

  const rated = cs.filter((c) => c.status === 'ok' || c.status === 'warn' || c.status === 'bad');
  const summary = { ok: rated.filter((c) => c.status === 'ok').length, warn: rated.filter((c) => c.status === 'warn').length, bad: rated.filter((c) => c.status === 'bad').length, total: rated.length };
  const weekdayTotals = Array(7).fill(0);
  persons.forEach((r) => r.byWd.forEach((n, i) => { weekdayTotals[i] += n; }));
  return { constraints: cs.map((c) => ({ ...c, percent: c.total != null ? pct(c.met, c.total) : null })), persons, pairs, pairList, weekdayTotals, summary };
}
