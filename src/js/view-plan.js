// Plan view: one timeline per day (one lane per person), duty editor, generation,
// hours per week, balance figures, warnings, print and export.
import { h, openModal, toast, downloadFile, monthNav, confirmModal } from './ui-core.js';
import { store, save } from './store.js';
import { getPlan, dutyKey, STATUS, STEP, visibleRange, WEIGHT_DEFS, monthSettingsOf, personMonthOf, editMonthSettings } from './model.js';
import { buildProblem, analyze, storedChoice } from './scheduler.js';
import { buildReport, weightFor } from './report.js';
import { createSearch, openConstraints } from './search.js';
import { planToCsv, planToIcs } from './exporters.js';
import { formatMonth, formatDay, shiftMonth, minutesOf, fmtMin, fmtHours, WEEKDAYS_SHORT, MONTHS } from './util.js';

const undoStack = []; // { key, json }
// time: 0 = one run of about 3 s; otherwise the search repeats until all rules are met or the limit (ms) is reached
const genOptions = { keepAll: false, time: 20000 };
let lastRun = null; // { key, runs, spent, reason, open } of the last generation in this browser tab
const TIME_OPTIONS = [[0, 'schnell (ein Durchlauf)'], [20000, 'bis alle Regeln erfüllt, höchstens 20 s'], [60000, 'bis alle Regeln erfüllt, höchstens 1 min'], [180000, 'bis alle Regeln erfüllt, höchstens 3 min']];

function pushUndo(key) {
  undoStack.push({ key, json: JSON.stringify(store.state.plans[key]?.duties || {}) });
  if (undoStack.length > 40) undoStack.shift();
}

export function renderPlanView() {
  const s = store.state;
  const key = s.ui.month;
  const cfg = s.config;
  const plan = getPlan(s, key);
  const P = buildProblem(s, key, { keep: 'all' });
  const A = analyze(P, storedChoice(P));
  const intervals = Object.values(plan.duties).map((du) => [minutesOf(du.from), minutesOf(du.to)]);
  P.appts.forEach((row) => row.forEach((list) => list.forEach((a) => intervals.push([a.from, a.to]))));
  const [v0, v1] = visibleRange(cfg, intervals);
  const pct = (m) => `${((Math.min(Math.max(m, v0), v1) - v0) / (v1 - v0)) * 100}%`;
  const width = (a, b) => `${((Math.min(b, v1) - Math.max(a, v0)) / (v1 - v0)) * 100}%`;
  const hours = [];
  for (let m = Math.ceil(v0 / 60) * 60; m <= v1; m += 60) hours.push(m);
  const closed = new Map(cfg.closedDates.map((c) => [c.date, c.note]));
  const people = P.people;
  const [y, mo] = key.split('-').map(Number);
  const deadline = `${cfg.deadlineDay}.${mo === 1 ? 12 : mo - 1}.${mo === 1 ? y - 1 : y}`;

  const scale = h('div', { class: 'tl-scale' }, hours.map((m) => h('span', { style: `left:${pct(m)}` }, String(m / 60))));

  const dayRow = (day, d) => {
    const cls = `tl-day ${day.weekend ? 'we' : ''} ${day.wd === cfg.weekStart ? 'wk' : ''}`;
    if (day.closed) {
      return h('div', { class: cls }, h('div', { class: 'tl-date' }, formatDay(day.date)), h('div', { class: 'tl-closed' }, `geschlossen${closed.get(day.date) ? ' – ' + closed.get(day.date) : ''}`), h('div', { class: 'tl-text' }));
    }
    const need = P.need[d];
    const needRuns = [];
    let st = -1;
    for (let i = 0; i <= need.length; i++) {
      if (i < need.length && need[i] > 0) { if (st < 0) st = i; } else if (st >= 0) { needRuns.push([st * STEP, i * STEP]); st = -1; }
    }
    const lanes = people.filter((p, i) => p.active || plan.duties[dutyKey(p.id, day.date)]).map((person) => {
      const p = P.pIndex.get(person.id);
      const du = plan.duties[dutyKey(person.id, day.date)];
      const issues = A.dutyIssues[p][d];
      const worst = issues.some((x) => x.level === 'bad') ? 'bad' : issues.length ? 'warn' : '';
      const avs = P.av[p][d];
      const runsOf = (ch) => {
        const out = [];
        let b = -1;
        for (let i = 0; i <= avs.length; i++) {
          const on = i < avs.length && avs[i] === ch;
          if (on) { if (b < 0) b = i; } else if (b >= 0) { out.push([b * STEP, i * STEP]); b = -1; }
        }
        return out;
      };
      const blocks = runsOf('x');
      const rathers = runsOf('-');
      return h('div', { class: 'lane', title: `${person.name}: klicken zum Bearbeiten`, onClick: () => openEditor(P, A, person, day, d) },
        blocks.filter(([a, c]) => c > v0 && a < v1).map(([a, c]) => h('i', { class: 'blocked', style: `left:${pct(a)};width:${width(a, c)}` })),
        rathers.filter(([a, c]) => c > v0 && a < v1).map(([a, c]) => h('i', { class: 'rather', style: `left:${pct(a)};width:${width(a, c)}` })),
        P.appts[p][d].map((a) => h('i', { class: 'appt', style: `left:${pct(a.from)};width:${width(a.from, a.to)}`, title: a.title })),
        du ? h('span', { class: `bar ${worst} ${du.locked ? 'locked' : ''}`, style: `left:${pct(minutesOf(du.from))};width:${width(minutesOf(du.from), minutesOf(du.to))}`, title: [`${person.name} ${du.from}–${du.to}`, ...issues.map((x) => x.text)].join('\n') },
          `${person.name} ${du.from}–${du.to}`) : (worst ? h('span', { class: `miss ${worst}`, title: issues.map((x) => x.text).join('\n') }, `${person.name}: !`) : h('span', { class: 'who' }, person.name)));
    });
    const gaps = A.dayInfo[d].gaps;
    return h('div', { class: cls },
      h('div', { class: 'tl-date' }, formatDay(day.date)),
      h('div', { class: 'tl-body' },
        h('div', { class: 'need' },
          needRuns.map(([a, c]) => h('i', { class: 'req', style: `left:${pct(a)};width:${width(a, c)}` })),
          gaps.map(([a, c]) => h('i', { class: 'gap', style: `left:${pct(a)};width:${width(a, c)}`, title: `${fmtMin(a)}–${fmtMin(c)} nicht besetzt` }))),
        lanes),
      h('div', { class: 'tl-text' }, gaps.length ? h('span', { class: 'gaptext' }, gaps.map(([a, c]) => `${fmtMin(a)}–${fmtMin(c)} offen`).join(', ')) : ''));
  };

  return h('section', { class: 'view' },
    h('div', { class: 'toolbar' },
      h('div', { class: 'row' },
        monthNav(formatMonth(key), () => changeMonth(-1), () => changeMonth(1)),
        h('div', { class: 'brushes noprint', role: 'radiogroup', 'aria-label': 'Ansicht' }, [['timeline', 'Zeitleiste'], ['calendar', 'Kalender']].map(([v, l]) => h('button', {
          class: `btn ${(s.ui.planView || 'timeline') === v ? 'on' : ''}`, role: 'radio', 'aria-checked': String((s.ui.planView || 'timeline') === v),
          onClick: () => { s.ui.planView = v; save(); store.render(); },
        }, l)))),
      h('div', { class: 'row' },
        h('button', { class: 'btn solid', onClick: () => runGeneration() }, 'Plan erstellen'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: genOptions.keepAll, onChange: (e) => { genOptions.keepAll = e.target.checked; } }), 'Bestehende Dienste behalten'),
        h('select', { 'aria-label': 'Rechenzeit', onChange: (e) => { genOptions.time = Number(e.target.value); } },
          TIME_OPTIONS.map(([v, l]) => h('option', { value: v, selected: v === genOptions.time }, l))),
        h('button', { class: 'btn', onClick: () => undo(key), disabled: !undoStack.some((u) => u.key === key) }, 'Rückgängig'),
        h('button', { class: 'btn', onClick: () => clearPlan(key) }, 'Leeren'),
        h('button', { class: 'btn', onClick: () => window.print() }, 'Drucken'),
        h('button', { class: 'btn', onClick: () => downloadFile(`dienstplan-${key}.csv`, planToCsv(s, P), 'text/csv') }, 'CSV'))),
    h('div', { class: 'summary' },
      h('label', { class: 'status' }, 'Status ', h('select', { onChange: (e) => { plan.status = e.target.value; save(); } }, Object.entries(STATUS).map(([v, l]) => h('option', { value: v, selected: plan.status === v }, l)))),
      h('span', { class: 'sep' }, `Abgabe bis ${deadline}`),
      h('span', { class: `sep ${A.messages.some((m) => m.level === 'bad') ? 'badtext' : ''}` }, A.messages.filter((m) => m.level === 'bad').length ? `${A.messages.filter((m) => m.level === 'bad').length} Probleme` : 'keine Regelverstöße'),
      people.some((p) => p.active) ? null : h('span', { class: 'sep' }, 'Noch keine Personen angelegt.')),
    renderMonthSettings(s, key),
    renderRuleCheck(s, P, key),
    h('p', { class: 'print-title' }, `${cfg.title} – ${formatMonth(key)}${plan.status !== 'final' ? ' (Entwurf)' : ''}`),
    s.ui.planView === 'calendar' ? renderCalendar(P, A, plan) : [
      h('div', { class: 'legend noprint' },
        h('span', {}, h('i', { class: 'lg-bar' }), 'Dienst'),
        h('span', {}, h('i', { class: 'lg-req' }), 'benötigte Besetzung'),
        h('span', {}, h('i', { class: 'lg-gap' }), 'Lücke'),
        h('span', {}, h('i', { class: 'lg-appt' }), 'Termin'),
        h('span', {}, h('i', { class: 'lg-blocked' }), 'kann nicht'),
        h('span', {}, h('i', { class: 'lg-rather' }), 'eher nicht')),
      h('div', { class: 'timeline', style: `--hours:${(v1 - v0) / 60}` },
        h('div', { class: 'tl-day head' }, h('div', { class: 'tl-date' }), h('div', { class: 'tl-body' }, scale), h('div', { class: 'tl-text' })),
        P.days.map(dayRow))],
    renderStats(s, P, A, key),
    renderMessages(A));
}

/** ISO calendar week number of a date string. */
function weekNumber(date) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}

/** "14:00" -> "14", "15:30" -> "15:30" */
const shortTime = (t) => (t.endsWith(':00') ? String(Number(t.slice(0, 2))) : t.replace(/^0/, ''));

/** Month calendar: weeks as row groups, Mon–Sun as columns, one row per person with duty times. */
function renderCalendar(P, A, plan) {
  const cfg = P.cfg;
  const order = [0, 1, 2, 3, 4, 5, 6].map((i) => (cfg.weekStart + i) % 7);
  const byDn = new Map(P.days.map((d) => [d.dn, d]));
  const people = P.people.filter((person) => person.active || Object.keys(plan.duties).some((k) => k.startsWith(person.id + '|')));
  const rows = [];
  P.weekKeys.forEach((wk, w) => {
    if (w > 0) rows.push(h('tr', { class: 'cal-gap' }, h('td', { colspan: 9 })));
    rows.push(h('tr', { class: `cal-date ${w === 0 ? 'first' : ''}` }, h('th', { class: 'weeklabel' }, `KW ${weekNumber(P.days[P.weekDays[w][0]].date)}`), order.map((_, i) => {
      const day = byDn.get(wk + i);
      if (!day) return h('td', { class: 'out' });
      const gaps = A.dayInfo[day.d].gaps;
      const dayNo = Number(day.date.slice(8));
      return h('td', { class: `dayhead ${day.weekend ? 'we' : ''} ${day.closed ? 'closedday' : ''}` },
        h('span', { class: 'dnum' }, String(dayNo)),
        h('span', { class: 'dwd' }, WEEKDAYS_SHORT[day.wd]),
        dayNo === 1 ? h('span', { class: 'dmonth' }, MONTHS[Number(day.date.slice(5, 7)) - 1]) : null,
        day.closed ? h('small', { class: 'dclosed' }, ' geschlossen') : null,
        gaps.length ? h('div', { class: 'gaptext' }, gaps.map(([a, b]) => `${shortTime(fmtMin(a))}–${shortTime(fmtMin(b))} offen`).join(', ')) : null);
    }), h('td', { class: 'wsum head' }, w === 0 ? 'Std. Woche' : '')));
    people.forEach((person) => {
      const p = P.pIndex.get(person.id);
      const wkStat = A.stats[p].weeks[w];
      rows.push(h('tr', { class: 'cal-person' }, h('th', {}, person.name), order.map((_, i) => {
        const day = byDn.get(wk + i);
        if (!day) return h('td', { class: 'out' });
        if (day.closed) return h('td', { class: 'out' });
        const du = plan.duties[dutyKey(person.id, day.date)];
        const issues = A.dutyIssues[p][day.d];
        const worst = issues.some((x) => x.level === 'bad') ? 'bad' : issues.length ? 'warn' : '';
        const ap = P.appts[p][day.d];
        return h('td', {
          class: `cell ${day.weekend ? 'we' : ''} ${worst} ${du ? 'has' : ''} ${du?.locked ? 'locked' : ''}`,
          title: [du ? `${person.name} ${du.from}–${du.to}` : `${person.name}: kein Dienst`, ...ap.map((a) => `Termin: ${a.title} ${fmtMin(a.from)}–${fmtMin(a.to)}`), ...issues.map((x) => x.text)].join('\n'),
          onClick: () => openEditor(P, A, person, day, day.d),
        }, du ? `${shortTime(du.from)}–${shortTime(du.to)}` : (worst ? '!' : ''), ap.length ? h('sup', {}, ap.map((a) => (a.title || 'T')[0]).join('')) : null);
      }), h('td', { class: 'wsum' }, wkStat ? `${fmtHours(wkStat.worked)} / ${fmtHours(wkStat.target)}` : '')));
    });
  });
  return [
    h('div', { class: 'legend noprint' },
      h('span', {}, h('b', {}, '14–19'), ' Dienst'),
      h('span', {}, h('sup', {}, 'T'), ' Termin (Anfangsbuchstabe)'),
      h('span', {}, h('i', { class: 'lg-badcell' }), 'Problem'),
      h('span', {}, h('i', { class: 'lg-locked' }), 'fixiert')),
    h('div', { class: 'tablewrap' }, h('table', { class: 'cal' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), order.map((wd) => h('th', {}, WEEKDAYS_SHORT[wd])), h('th', {}, ''))),
      h('tbody', {}, rows))),
  ];
}

function renderStats(s, P, A, key) {
  const active = A.stats.filter((r) => r.person.active || r.worked);
  const weekLabel = (w) => {
    const ds = P.weekDays[w];
    return `${P.days[ds[0]].date.slice(8).replace(/^0/, '')}.–${P.days[ds[ds.length - 1]].date.slice(8).replace(/^0/, '')}.`;
  };
  const balName = s.config.balanceWeekdays.map((d) => WEEKDAYS_SHORT[d]).join('/') || '–';
  return h('div', { class: 'stats' },
    h('h2', {}, 'Stunden je Woche (Ist / Soll)'),
    h('div', { class: 'tablewrap' }, h('table', { class: 'grid hours' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Person'), P.weekKeys.map((_, w) => h('th', {}, weekLabel(w))), h('th', {}, 'Monat'))),
      h('tbody', {}, active.map((r) => h('tr', {},
        h('td', {}, r.person.name),
        r.weeks.map((wk) => {
          const diff = wk.worked - wk.target;
          return h('td', { class: Math.abs(diff) >= 1 ? 'off' : '' }, `${fmtHours(wk.worked)} / ${fmtHours(wk.target)}`, Math.abs(diff) >= 1 ? h('small', {}, ` ${diff > 0 ? '+' : ''}${fmtHours(diff)}`) : null);
        }),
        h('td', {}, h('strong', {}, `${fmtHours(r.worked)} / ${fmtHours(r.target)}`))))))),
    h('h2', { class: 'noprint' }, 'Ausgleich'),
    h('table', { class: 'grid noprint' },
      h('thead', {}, h('tr', {}, ['Person', `${balName}-Dienste (mit Vormonaten)`, 'Wochenenddienste', 'Nur-Termin-Dienste', 'Folgetage', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, active.map((r) => h('tr', {},
        h('td', {}, r.person.name),
        h('td', {}, `${r.balance - r.hist} (${r.balance})`),
        h('td', {}, String(r.weekend)),
        h('td', {}, String(r.apptOnly)),
        h('td', {}, String(r.consecutive)),
        h('td', {}, r.worked ? h('button', { class: 'btn quiet', onClick: () => downloadFile(`${r.person.name}-${key}.ics`, planToIcs(s, P, r.person.id), 'text/calendar') }, 'Kalender (.ics)') : ''))))),
    A.pairStats.length ? h('p', { class: 'hint noprint' }, 'Gemeinsame Stunden: ', A.pairStats.map((x) => `${x.a} + ${x.b}: ${fmtHours(x.hours)} h`).join(' · ')) : null);
}

function renderMessages(A) {
  if (!A.messages.length) return h('div', { class: 'noprint' });
  return h('div', { class: 'messages noprint' },
    h('h2', {}, 'Hinweise'),
    h('ul', {}, A.messages.slice(0, 80).map((m) => h('li', { class: m.level }, h('b', {}, m.level === 'bad' ? 'Problem: ' : 'Hinweis: '), m.text))));
}

function changeMonth(d) {
  store.state.ui.month = shiftMonth(store.state.ui.month, d);
  save();
  store.render();
}

function undo(key) {
  for (let i = undoStack.length - 1; i >= 0; i--) {
    if (undoStack[i].key === key) {
      getPlan(store.state, key).duties = JSON.parse(undoStack[i].json);
      undoStack.splice(i, 1);
      save();
      store.render();
      return;
    }
  }
}

function clearPlan(key) {
  confirmModal('Plan leeren', 'Alle nicht fixierten Dienste dieses Monats werden entfernt.', 'Leeren', () => {
    pushUndo(key);
    const plan = getPlan(store.state, key);
    for (const [k, v] of Object.entries(plan.duties)) if (!v.locked) delete plan.duties[k];
    save();
    store.render();
  });
}

function timeOptions(from, to, selected) {
  const out = [];
  for (let m = from; m <= to; m += STEP) out.push(h('option', { value: fmtMin(m), selected: fmtMin(m) === selected }, fmtMin(m)));
  return out;
}

function openEditor(P, A, person, day, d) {
  const s = store.state;
  const plan = getPlan(s, P.key);
  const k = dutyKey(person.id, day.date);
  const du = plan.duties[k];
  const p = P.pIndex.get(person.id);
  const ap = P.appts[p][d];
  const defFrom = du?.from || (ap.length ? fmtMin(Math.min(...ap.map((a) => a.from))) : '14:00');
  const defTo = du?.to || fmtMin(minutesOf(defFrom) + Math.round((day.weekend ? s.config.weekendDuty.hours : person.prefLen) * 60));
  let fromSel;
  let toSel;
  let lockBox;
  const apply = (close, remove) => {
    pushUndo(P.key);
    if (remove) delete plan.duties[k];
    else {
      if (minutesOf(toSel.value) <= minutesOf(fromSel.value)) { toast('Das Ende muss nach dem Beginn liegen.'); return; }
      plan.duties[k] = { from: fromSel.value, to: toSel.value, ...(lockBox.checked ? { locked: true } : {}) };
    }
    save();
    close();
    store.render();
  };
  const blockedText = [];
  const avs = P.av[p][d];
  for (let i = 0; i < avs.length; i++) if (avs[i] === 'x' && (i === 0 || avs[i - 1] !== 'x')) {
    let j = i; while (j < avs.length && avs[j] === 'x') j++;
    blockedText.push(`${fmtMin(i * STEP)}–${fmtMin(j * STEP)}`);
  }
  openModal(`${person.name} · ${formatDay(day.date)}`, (close) => h('div', {},
    A.dutyIssues[p][d].length ? h('ul', { class: 'notes' }, A.dutyIssues[p][d].map((x) => h('li', { class: x.level }, x.text))) : null,
    blockedText.length ? h('p', { class: 'hint' }, `Kann nicht: ${blockedText.join(', ')}`) : null,
    ap.length ? h('p', { class: 'hint' }, `Termine: ${ap.map((a) => `${a.title} ${fmtMin(a.from)}–${fmtMin(a.to)}`).join(', ')}`) : null,
    h('div', { class: 'row' },
      (fromSel = h('select', { 'aria-label': 'Beginn' }, timeOptions(0, 24 * 60 - STEP, defFrom))),
      h('span', {}, 'bis'),
      (toSel = h('select', { 'aria-label': 'Ende' }, timeOptions(STEP, 24 * 60, defTo)))),
    h('label', { class: 'check' }, (lockBox = h('input', { type: 'checkbox', checked: !!du?.locked })), 'Fixieren (bleibt bei „Plan erstellen“ erhalten)'),
    h('div', { class: 'row end' },
      du ? h('button', { class: 'btn', onClick: () => apply(close, true) }, 'Kein Dienst') : null,
      h('button', { class: 'btn solid', onClick: () => apply(close, false) }, 'Speichern'))));
}

async function runGeneration() {
  const s = store.state;
  const key = s.ui.month;
  if (!s.people.some((p) => p.active)) { toast('Bitte zuerst Personen anlegen.'); return; }
  const P = buildProblem(s, key, { keep: genOptions.keepAll ? 'all' : 'locked' });
  if (genOptions.keepAll) {
    // keep existing duties, but let the generator fill days that are still empty
    P.people.forEach((person, p) => P.days.forEach((day, d) => {
      if (!s.plans[key]?.duties?.[dutyKey(person.id, day.date)]) P.fixed[p][d] = false;
    }));
    const fresh = buildProblem(s, key, { keep: 'locked' });
    P.people.forEach((person, p) => P.days.forEach((day, d) => {
      if (!P.fixed[p][d]) { P.cand[p][d] = fresh.cand[p][d]; P.forced[p][d] = fresh.forced[p][d]; P.initial[p][d] = fresh.initial[p][d]; }
    }));
  }
  const bar = h('i', { style: 'width:0%' });
  const info = h('p', { class: 'hint' }, 'Erster Durchlauf …');
  const search = createSearch(P, { timeoutMs: genOptions.time || 3000, runMs: genOptions.time >= 60000 ? 6000 : 3000, untilMet: genOptions.time > 0, seed: Date.now() % 100000 });
  const close = openModal('Plan wird berechnet …', () => h('div', {},
    h('p', {}, 'Die Berechnung läuft lokal in diesem Browser.'),
    h('span', { class: 'meter' }, bar), info,
    genOptions.time > 0 ? h('div', { class: 'row end' }, h('button', { class: 'btn', onClick: () => search.stop() }, 'Beenden und beste Lösung übernehmen')) : null));
  await new Promise((r) => setTimeout(r, 30));
  while (!search.step(80)) {
    const st = search.state();
    bar.style.width = `${Math.round(search.progress() * 100)}%`;
    info.textContent = st.runs ? `${st.runs} Durchläufe · beste Lösung bisher: ${st.open === 0 ? 'alle Regeln erfüllt' : `${st.open} Regel(n) nicht ganz erfüllt`} · ${Math.round(st.spent / 1000)} s` : 'Erster Durchlauf …';
    await new Promise((r) => setTimeout(r, 0));
  }
  const res = search.result();
  pushUndo(key);
  const plan = getPlan(s, key);
  const locked = Object.fromEntries(Object.entries(plan.duties).filter(([, v]) => v.locked));
  plan.duties = { ...res.duties, ...locked };
  if (plan.status === 'collecting') plan.status = 'draft';
  lastRun = { key, runs: res.runs, spent: res.spent, reason: res.reason, open: res.open.length };
  save();
  close();
  toast(res.open.length ? `Plan erstellt. ${res.open.length} Regel(n) nicht ganz erfüllt – siehe „Regelprüfung“.` : 'Plan erstellt. Alle Regeln erfüllt.');
  store.render();
}

/** Settings for the shown month only: no morning duties (all or single persons), weekly wishes paused, other hours. */
function renderMonthSettings(s, key) {
  const ms = monthSettingsOf(s, key);
  const people = s.people.filter((p) => p.active);
  const changed = ms.noMorning || people.some((p) => { const pm = personMonthOf(ms, p.id); return pm.noMorning || pm.noWishes || pm.hours !== ''; });
  const setGlobal = (f, v) => { editMonthSettings(s, key)[f] = v; save(); store.render(); };
  const setPerson = (pid, f, v) => {
    const m = editMonthSettings(s, key);
    m.people[pid] = { ...personMonthOf(m, pid), [f]: v };
    save();
    store.render();
  };
  return h('details', { class: 'card monthset noprint', open: changed ? true : null },
    h('summary', {}, `Einstellungen nur für ${formatMonth(key)}`, changed ? h('span', { class: 'hint' }, ' – aktiv') : null),
    h('p', { class: 'hint' }, 'Gilt nur in diesem Monat und ändert die Personen nicht dauerhaft. Termine (z. B. ein Hilfeplangespräch am Vormittag) finden trotzdem statt.'),
    h('div', { class: 'row wrap' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ms.noMorning, onChange: (e) => setGlobal('noMorning', e.target.checked) }), 'Keine Vormittagsdienste für alle'),
      h('label', {}, 'Vormittag = Beginn vor ', h('input', { type: 'time', step: '1800', value: ms.morningUntil, onChange: (e) => setGlobal('morningUntil', e.target.value || '12:00') }))),
    people.length ? h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ['Person', 'Keine Vormittagsdienste', 'Wöchentliche Wünsche aussetzen', 'Wochenstunden in diesem Monat'].map((x) => h('th', {}, x)))),
      h('tbody', {}, people.map((p) => {
        const pm = personMonthOf(ms, p.id);
        return h('tr', {},
          h('td', {}, p.name),
          h('td', {}, h('input', { type: 'checkbox', 'aria-label': `${p.name}: keine Vormittagsdienste`, checked: pm.noMorning || ms.noMorning, disabled: ms.noMorning, onChange: (e) => setPerson(p.id, 'noMorning', e.target.checked) })),
          h('td', {}, (p.weeklyWishes || []).length ? h('input', { type: 'checkbox', 'aria-label': `${p.name}: wöchentliche Wünsche aussetzen`, checked: pm.noWishes, onChange: (e) => setPerson(p.id, 'noWishes', e.target.checked) }) : h('span', { class: 'hint' }, 'keine')),
          h('td', {}, h('input', { type: 'number', class: 'narrow', min: '0', max: '60', step: '0.5', placeholder: String(p.weeklyHours), value: pm.hours, 'aria-label': `${p.name}: Wochenstunden in diesem Monat`, onChange: (e) => setPerson(p.id, 'hours', e.target.value === '' ? '' : Number(e.target.value)) }),
            h('span', { class: 'hint' }, ` sonst ${fmtHours(p.weeklyHours)}`)));
      }))) : null);
}

/**
 * Rule check of the stored plan: rules that are not fully met, with their weight for a new
 * generation, and rules that no plan can meet completely (lower bounds).
 */
function renderRuleCheck(s, P0, key) {
  if (!Object.keys(getPlan(s, key).duties).length) return null;
  const report = buildReport(P0, storedChoice(P0));
  const open = openConstraints(report);
  const labels = Object.fromEntries(WEIGHT_DEFS.map(([k, l]) => [k, l]));
  const w = s.config.weights;
  const run = lastRun && lastRun.key === key ? lastRun : null;
  const runText = run ? `Letzte Berechnung: ${run.runs} Durchläufe in ${Math.round(run.spent / 1000)} s, ${run.reason === 'met' ? 'beendet, weil alle Regeln erfüllt sind' : run.reason === 'timeout' ? 'beendet, weil die Zeit abgelaufen ist' : run.reason === 'stopped' ? 'von Hand beendet' : 'ein Durchlauf'}.` : '';
  return h('details', { class: 'card rulecheck noprint', open: open.length ? true : null },
    h('summary', {}, 'Regelprüfung: ', open.length ? h('span', { class: open.some((c) => c.status === 'bad') ? 'badtext' : '' }, `${open.length} Regel(n) nicht ganz erfüllt`) : 'alle Regeln erfüllt', ` (${report.summary.ok} von ${report.summary.total} erfüllt)`),
    runText ? h('p', { class: 'hint' }, runText) : null,
    open.length ? [
      h('p', { class: 'hint' }, 'Nicht alle Regeln lassen sich immer gleichzeitig erfüllen. Höheres Gewicht = diese Regel wird beim nächsten Erstellen wichtiger genommen (andere geben dafür eher nach). Harte Regeln hängen an den Einträgen (Wünsche, Termine) und werden nie zugunsten anderer gebrochen.'),
      h('table', { class: 'grid' },
        h('thead', {}, h('tr', {}, ['Regel', 'Stand', 'Gewicht', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, open.map((c) => {
          const k = weightFor(c.id);
          return h('tr', {},
            h('td', {}, h('span', { class: c.status === 'bad' ? 'badtext' : '' }, c.label), c.detail ? h('div', { class: 'hint' }, c.detail) : null),
            h('td', { class: 'nowrap' }, c.total != null ? `${c.met} / ${c.total}` : c.status === 'bad' ? 'deutlich ungleich' : 'etwas ungleich'),
            h('td', { class: 'nowrap' }, k ? [
              h('input', { type: 'number', class: 'narrow', min: '0', value: w[k], title: labels[k], 'aria-label': `Gewicht: ${labels[k]}`, onChange: (e) => { w[k] = Number(e.target.value) || 0; save(); } }),
              h('button', { class: 'btn quiet', title: 'Gewicht verdoppeln', onClick: () => { w[k] = Math.max(1, w[k] * 2); save(); store.render(); } }, '×2')]
              : h('span', { class: 'hint' }, c.group === 'hart' ? 'hart: Einträge prüfen' : '–')),
            h('td', { class: 'hint' }, k ? labels[k] : ''));
        }))),
      h('div', { class: 'row' }, h('button', { class: 'btn solid', onClick: () => runGeneration() }, 'Mit diesen Gewichten neu erstellen'),
        h('span', { class: 'hint' }, 'Alle Gewichte: Einrichtung → Gewichtung.'))] : null,
    report.hints.length ? [h('h3', {}, 'Nicht vollständig erfüllbar'), h('p', { class: 'hint' }, 'Abweichungen, die kein Plan vermeiden kann (sie zählen in der Prüfung nicht als Verstoß), und Vorschläge für die Einstellungen.'),
      h('ul', { class: 'notes' }, report.hints.map((t) => h('li', {}, t)))] : null);
}
