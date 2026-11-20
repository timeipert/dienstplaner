// File exports (CSV, iCalendar, Excel). Pure functions that return text or bytes; nothing is sent anywhere.
import { icsStamp, formatDay, minutesOf, fmtMin, fmtHours, formatMonth, WEEKDAYS_SHORT, MONTHS } from './util.js';
import { dutyKey, STATUS } from './model.js';
import { analyze, storedChoice } from './scheduler.js';
import { buildXlsx } from './xlsx.js';

function csvCell(v) {
  const s = String(v ?? '');
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per duty: date, weekday, person, start, end, hours. Semicolon separated (German Excel). */
export function planToCsv(state, P) {
  const plan = state.plans[P.key] || { duties: {} };
  const rows = [['Datum', 'Tag', 'Person', 'Beginn', 'Ende', 'Stunden']];
  for (const day of P.days) {
    for (const person of P.people) {
      const du = plan.duties[dutyKey(person.id, day.date)];
      if (!du) continue;
      const h = (minutesOf(du.to) - minutesOf(du.from)) / 60;
      rows.push([day.date, formatDay(day.date).split(' ')[0], person.name, du.from, du.to, String(h).replace('.', ',')]);
    }
  }
  return '\ufeff' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
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
 */
export function planToXlsx(state, P) {
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
  return buildXlsx({ name: formatMonth(P.key), rows, widths: [11, 15, 15, 15, 15, 15, 15, 15, 12], merges: ['A1:I1', `A${rows.length}:I${rows.length}`], freezeRows: 3, landscape: true });
}
