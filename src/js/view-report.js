// Evaluation tab: how well the plan meets each rule, fairness per person, who works with whom.
import { h, monthNav } from './ui-core.js';
import { store, save } from './store.js';
import { buildProblem, storedChoice } from './scheduler.js';
import { buildReport } from './report.js';
import { formatMonth, shiftMonth, fmtHours, WEEKDAYS_SHORT } from './util.js';

const STATUS_TEXT = { ok: 'erfüllt', warn: 'teilweise', bad: 'verletzt', na: 'nicht betroffen' };
const STATUS_MARK = { ok: '●', warn: '◐', bad: '○', na: '–' };
const GROUPS = [['hart', 'Immer einzuhalten'], ['weich', 'Ziele und Wünsche'], ['ausgleich', 'Ausgleich zwischen den Personen']];

export function renderReportView() {
  const s = store.state;
  const key = s.ui.month;
  const P = buildProblem(s, key, { keep: 'all' });
  const rep = buildReport(P, storedChoice(P));
  const has = Object.keys(s.plans[key]?.duties || {}).length > 0;
  const move = (d) => { s.ui.month = shiftMonth(key, d); save(); store.render(); };

  const constraintRow = (c) => h('tr', { class: `st-${c.status}` },
    h('td', { class: 'mark', title: STATUS_TEXT[c.status] }, STATUS_MARK[c.status]),
    h('td', {}, c.label, c.detail ? h('div', { class: 'hint' }, c.detail) : null),
    h('td', { class: 'nowrap' }, STATUS_TEXT[c.status]),
    h('td', { class: 'nowrap' }, c.total != null && c.total > 0
      ? [h('span', { class: 'fillbar' }, h('i', { style: `width:${c.percent}%` })), ` ${fmtHours(c.met)} von ${fmtHours(c.total)} ${c.unit}`]
      : ''));

  const table = h('table', { class: 'grid report' },
    h('thead', {}, h('tr', {}, ['', 'Regel', 'Ergebnis', 'Erfüllung'].map((x) => h('th', {}, x)))),
    GROUPS.map(([g, title]) => {
      const list = rep.constraints.filter((c) => c.group === g);
      return list.length ? h('tbody', {}, h('tr', { class: 'group' }, h('th', { colspan: 4 }, title)), list.map(constraintRow)) : null;
    }));

  // fairness table with min/max marking
  const cols = [
    ['Dienste', (r) => r.duties, (v) => String(v)],
    ['Stunden Ist / Soll', (r) => r.hours, (v, r) => `${fmtHours(v)} / ${fmtHours(r.target)}`],
    ['Vertrag erfüllt', (r) => r.ratio, (v) => `${Math.round(v * 100)} %`],
    ['Ø Dienstlänge', (r) => r.avgLen, (v) => `${fmtHours(v)} Std.`],
    ['Vormittagsdienste', (r) => r.morning, (v) => String(v)],
    ['Späte Dienste', (r) => r.late, (v) => String(v)],
    [`${s.config.balanceWeekdays.map((d) => WEEKDAYS_SHORT[d]).join('/') || 'Ausgleichstage'} (Monat / gesamt)`, (r) => r.balanceTotal, (v, r) => `${r.balanceMonth} / ${v}`],
    ['Wochenenddienste', (r) => r.weekend, (v) => String(v)],
    ['Wochenende nach Wunschende', (r) => r.weekendLate, (v) => String(v)],
    ['Folgetage', (r) => r.consec, (v) => String(v)],
    ['Nur-Termin-Dienste', (r) => r.apptOnly, (v) => String(v)],
  ];
  const act = rep.persons.filter((r) => r.person.active);
  const range = (f) => { const v = act.map(f); return [Math.min(...v), Math.max(...v)]; };
  const fairness = h('div', { class: 'tablewrap' }, h('table', { class: 'grid fair' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Person'), cols.map(([t]) => h('th', {}, t)))),
    h('tbody', {},
      rep.persons.map((r) => h('tr', { class: r.person.active ? '' : 'archived' }, h('td', {}, r.person.name),
        cols.map(([, get, fmt]) => {
          const [lo, hi] = act.length > 1 ? range(get) : [0, 0];
          const v = get(r);
          const mark = act.length > 1 && hi > lo && r.person.active ? (v === hi ? 'hi' : v === lo ? 'lo' : '') : '';
          return h('td', { class: mark }, fmt(v, r));
        }))),
      act.length > 1 ? h('tr', { class: 'range' }, h('td', {}, 'Spannweite (min – max)'), cols.map(([, get, fmt]) => {
        const [lo, hi] = range(get);
        return h('td', {}, lo === hi ? fmt(lo, { target: 0, balanceMonth: 0 }).split(' / ')[0] : `${fmtHours(lo)} – ${fmtHours(hi)}`);
      })) : null)));

  // pair matrix
  const pairTable = h('table', { class: 'grid pairs' },
    h('thead', {}, h('tr', {}, h('th', {}, ''), rep.persons.map((r) => h('th', {}, r.person.name)))),
    h('tbody', {}, rep.persons.map((a) => h('tr', {}, h('th', {}, a.person.name), rep.persons.map((b) => {
      if (a.idx === b.idx) return h('td', { class: 'self' }, '');
      const pr = rep.pairs[a.idx][b.idx];
      return h('td', {}, h('strong', {}, `${fmtHours(pr.hours)} Std.`), h('div', { class: 'hint' }, `an ${pr.days} Tag(en)`));
    })))));

  // weekday matrix
  const order = s.config.weekStart === 0 ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];
  const wdTable = h('table', { class: 'grid compact' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Person'), order.map((d) => h('th', { class: s.config.balanceWeekdays.includes(d) ? 'em' : '' }, WEEKDAYS_SHORT[d])), h('th', {}, 'Summe'))),
    h('tbody', {},
      rep.persons.map((r) => h('tr', {}, h('td', {}, r.person.name), order.map((d) => h('td', { class: s.config.balanceWeekdays.includes(d) ? 'em' : '' }, String(r.byWd[d]))), h('td', {}, h('strong', {}, String(r.duties))))),
      h('tr', { class: 'range' }, h('td', {}, 'alle'), order.map((d) => h('td', {}, String(rep.weekdayTotals[d]))), h('td', {}, String(rep.weekdayTotals.reduce((a, b) => a + b, 0))))));

  const sm = rep.summary;
  return h('section', { class: 'view report' },
    h('div', { class: 'toolbar' }, monthNav(formatMonth(key), () => move(-1), () => move(1)),
      h('button', { class: 'btn', onClick: () => window.print() }, 'Drucken')),
    h('p', { class: 'print-title' }, `${s.config.title} – Auswertung ${formatMonth(key)}`),
    !has ? h('div', { class: 'empty-state' }, h('p', {}, 'Für diesen Monat gibt es noch keinen Plan. Erst unter „Plan“ einen Plan erstellen.')) : null,
    h('div', { class: 'scorecard' },
      h('div', {}, h('strong', {}, `${sm.ok} von ${sm.total}`), h('span', {}, 'Regeln erfüllt')),
      h('div', {}, h('strong', {}, String(sm.warn)), h('span', {}, 'teilweise')),
      h('div', {}, h('strong', { class: sm.bad ? 'badtext' : '' }, String(sm.bad)), h('span', {}, 'verletzt'))),
    h('h2', {}, 'Regeln und wie gut der Plan sie erfüllt'),
    h('p', { class: 'hint' }, '● erfüllt  ◐ teilweise (mindestens 90 %)  ○ verletzt oder deutlich verfehlt  – kommt in diesem Monat nicht vor. „Immer einzuhalten“ darf nie verletzt sein.'),
    h('div', { class: 'tablewrap' }, table),
    rep.hints.length ? [h('h3', {}, 'Nicht vollständig erfüllbar'), h('ul', { class: 'notes' }, rep.hints.map((t) => h('li', {}, t)))] : null,
    h('h2', {}, 'Verteilung je Person'),
    h('p', { class: 'hint' }, 'Fett unterstrichen: höchster Wert, kursiv: niedrigster Wert der Spalte (nur wenn die Werte sich unterscheiden). Ausgeglichen heißt: kleine Spannweite.'),
    fairness,
    h('h2', {}, 'Wer arbeitet mit wem'),
    h('p', { class: 'hint' }, 'Stunden, in denen beide gleichzeitig im Dienst sind, und Anzahl der Tage.'),
    h('div', { class: 'tablewrap' }, pairTable),
    h('h2', {}, 'Dienste je Wochentag'),
    h('div', { class: 'tablewrap' }, wdTable));
}
