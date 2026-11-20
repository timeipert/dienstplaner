// Exports: table for pasting into a template, list of duties, iCalendar, Excel. Pure functions that
// return text or bytes; nothing is sent anywhere.
import { icsStamp, formatDay, minutesOf, fmtMin, fmtHours, formatMonth, WEEKDAYS_SHORT, MONTHS } from './util.js';
import { dutyKey, STATUS } from './model.js';
import { analyze, storedChoice } from './scheduler.js';
import { buildWorkbook } from './xlsx.js';

/** One row per duty: date, weekday, person, start, end, hours (sheet "Daten" of the Excel file). */
export function planToList(state, P) {
  const plan = state.plans[P.key] || { duties: {} };
  const rows = [['Datum', 'Tag', 'Person', 'Beginn', 'Ende', 'Stunden']];
  for (const day of P.days) {
    for (const person of P.people) {
      const du = plan.duties[dutyKey(person.id, day.date)];
      if (!du) continue;
      const h = (minutesOf(du.to) - minutesOf(du.from)) / 60;
      rows.push([dateDe(day.date), WEEKDAYS_SHORT[day.wd], person.name, du.from, du.to, String(h).replace('.', ',')]);
    }
  }
  return rows;
}

const dateDe = (date) => `${date.slice(8)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;

/**
 * Options of the table for pasting into an existing Excel template (planToGrid):
 *   header: 'two' = weekday row and date row, 'one' = "Mo 01.12." in one row, 'none'
 *   days:   'all' = every day of the month, 'weekdays' = without weekend days
 *   names:  first column with the person names
 *   time:   'short' = "14–19" (half hours "14:30–19"), 'long' = "14:00–19:00"
 */
export const GRID_DEFAULTS = { header: 'two', days: 'all', names: true, time: 'short' };

/**
 * The plan as a plain table: one row per person, one column per day, a cell holds only the duty
 * time. Meant to be pasted into a template whose layout is not known to the app: the template
 * keeps its formatting, only values are inserted. Returns rows of strings.
 */
export function planToGrid(state, P, options = {}) {
  const o = { ...GRID_DEFAULTS, ...options };
  const plan = state.plans[P.key] || { duties: {} };
  const days = P.days.filter((d) => o.days === 'all' || !d.weekend);
  const people = P.people.filter((person) => person.active || Object.keys(plan.duties).some((k) => k.startsWith(person.id + '|')));
  const fmt = (t) => (o.time === 'long' ? t : shortT(t));
  const lead = o.names ? [''] : [];
  const rows = [];
  if (o.header === 'two') {
    rows.push([...lead, ...days.map((d) => WEEKDAYS_SHORT[d.wd])]);
    rows.push([...lead, ...days.map((d) => dateDe(d.date))]);
  } else if (o.header === 'one') {
    rows.push([...lead, ...days.map((d) => `${WEEKDAYS_SHORT[d.wd]} ${d.date.slice(8)}.${d.date.slice(5, 7)}.`)]);
  }
  for (const person of people) {
    rows.push([...(o.names ? [person.name] : []), ...days.map((d) => {
      const du = plan.duties[dutyKey(person.id, d.date)];
      return du ? `${fmt(du.from)}–${fmt(du.to)}` : '';
    })]);
  }
  return rows;
}

/** Tab-separated text: pasting it into Excel fills one cell per value. */
export function gridToTsv(rows) {
  return rows.map((r) => r.map((v) => String(v).replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\r\n') + '\r\n';
}

function icsText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** Calendar file with the duties of one person, in floating local time. */
export function planToIcs(state, P, personId) {
  const plan = state.plans[P.key] || { duties: {} };
  const person = P.people.find((p) => p.id === personId);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dienstplaner//lokal//DE', 'CALSCALE:GREGORIAN'];
  for (const day of P.days) {
    const du = plan.duties[dutyKey(personId, day.date)];
    if (!du) continue;
    const base = day.dn * 864e5;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${day.date.replace(/-/g, '')}-${personId.replace(/[^A-Za-z0-9]/g, '')}@dienstplaner.local`,
      `DTSTAMP:${icsStamp(Date.now())}`,
      `DTSTART:${icsStamp(base + minutesOf(du.from) * 6e4)}`,
      `DTEND:${icsStamp(base + minutesOf(du.to) * 6e4)}`,
      `SUMMARY:${icsText(`Dienst ${du.from}–${du.to}`)}`,
      `DESCRIPTION:${icsText(`${state.config.title} – ${person?.name ?? ''}`)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}


/** ISO calendar week of a date string (Excel export). */
function isoWeekOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}
const shortT = (t) => t.replace(/:00$/, '');

/**
 * Excel file (.xlsx) laid out like the calendar view: columns Mon–Sun (or Sun–Sat), one block
 * per week with a date row and one row per person, duty times as text ("14–19"), the last column
 * worked / target hours of the week. Appointments are marked with their initial letter; cells
 * with a rule violation are red. P: buildProblem(state, key, { keep: 'all' }).
 * Second sheet "Zum Einfügen" (planToGrid with gridOptions), third sheet "Daten" (planToList).
 */
export function planToXlsx(state, P, gridOptions = GRID_DEFAULTS) {
  const plan = state.plans[P.key] || { duties: {}, status: 'collecting' };
  const A = analyze(P, storedChoice(P));
  const cfg = P.cfg;
  const order = [0, 1, 2, 3, 4, 5, 6].map((i) => (cfg.weekStart + i) % 7);
  const byDn = new Map(P.days.map((d) => [d.dn, d]));
  const people = P.people.filter((person) => person.active || Object.keys(plan.duties).some((k) => k.startsWith(person.id + '|')));
  const rows = [];
  rows.push([{ v: `${cfg.title} – ${formatMonth(P.key)}${plan.status !== 'final' ? ` (${STATUS[plan.status] || 'Entwurf'})` : ''}`, s: 'title' }]);
  rows.push([]);
  rows.push([{ v: '', s: 'header' }, ...order.map((wd) => ({ v: WEEKDAYS_SHORT[wd], s: 'header' })), { v: 'Std. Woche', s: 'header' }]);
  const used = new Map();
  P.weekKeys.forEach((wk, w) => {
    rows.push([{ v: `KW ${isoWeekOf(P.days[P.weekDays[w][0]].date)}`, s: 'weekhead' }, ...order.map((_, i) => {
      const day = byDn.get(wk + i);
      if (!day) return { v: '', s: 'dayhead' };
      const n = Number(day.date.slice(8));
      const gaps = A.dayInfo[day.d].gaps;
      const label = `${n}.${n === 1 ? ' ' + MONTHS[Number(day.date.slice(5, 7)) - 1] : ''}${day.closed ? ' geschlossen' : ''}${gaps.length ? ' – ' + gaps.map(([a, b]) => `${shortT(fmtMin(a))}–${shortT(fmtMin(b))} offen`).join(', ') : ''}`;
      return { v: label, s: day.weekend ? 'dayhead-we' : 'dayhead' };
    }), { v: '', s: 'dayhead' }]);
    for (const person of people) {
      const p = P.pIndex.get(person.id);
      const wkStat = A.stats[p].weeks[w];
      rows.push([{ v: person.name, s: 'name' }, ...order.map((_, i) => {
        const day = byDn.get(wk + i);
        if (!day || day.closed) return { v: '', s: 'out' };
        const du = plan.duties[dutyKey(person.id, day.date)];
        const bad = A.dutyIssues[p][day.d].some((x) => x.level === 'bad');
        const ap = P.appts[p][day.d];
        for (const a of ap) used.set((a.title || 'T')[0], a.title || 'Termin');
        const marks = ap.map((a) => (a.title || 'T')[0]).join('');
        const v = du ? `${shortT(du.from)}–${shortT(du.to)}${marks ? ' ' + marks : ''}` : bad ? '!' : '';
        return { v, s: bad ? 'cell-bad' : day.weekend ? 'cell-we' : 'cell' };
      }), { v: wkStat ? `${fmtHours(wkStat.worked)} / ${fmtHours(wkStat.target)}` : '', s: 'sum' }]);
    }
  });
  rows.push([]);
  const legend = ['14–19 = Dienst von 14:00 bis 19:00', ...[...used].map(([k, t]) => `${k} = ${t}`), 'rot = Regel verletzt', 'Std. Woche = geleistet / Soll'];
  rows.push([{ v: legend.join(' · '), s: 'hint' }]);
  const calendar = { name: formatMonth(P.key), rows, widths: [11, 15, 15, 15, 15, 15, 15, 15, 12], merges: ['A1:I1', `A${rows.length}:I${rows.length}`], freezeRows: 3, landscape: true };
  // sheet "Zum Einfügen": the same table as "Für Excel kopieren", to copy from the file into a template
  const grid = planToGrid(state, P, gridOptions);
  const gridSheet = { name: 'Zum Einfügen', rows: grid.map((r) => r.map((v) => ({ v, s: 'cell' }))), widths: grid[0] ? grid[0].map(() => 11) : [], landscape: true };
  // sheet "Daten": one row per duty, for templates that look values up with formulas
  const list = planToList(state, P);
  const listSheet = { name: 'Daten', rows: list.map((r, i) => r.map((v) => ({ v, s: i === 0 ? 'header' : 'cell' }))), widths: [12, 6, 14, 8, 8, 8], freezeRows: 1 };
  return buildWorkbook([calendar, gridSheet, listSheet]);
}
