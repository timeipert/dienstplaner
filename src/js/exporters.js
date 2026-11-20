// File exports (CSV, iCalendar). Pure functions that return text; nothing is sent anywhere.
import { icsStamp, formatDay, minutesOf } from './util.js';
import { dutyKey } from './model.js';

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

