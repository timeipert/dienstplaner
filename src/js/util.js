// Date, id and formatting helpers. Pure functions, no DOM access.
// Dates are strings "YYYY-MM-DD", months are strings "YYYY-MM".
// Times are handled as "UTC milliseconds of local wall-clock time" so that
// results do not depend on the time zone or daylight saving changes.

export const WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const WEEKDAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export const pad2 = (n) => String(n).padStart(2, '0');

export function uid(prefix = 'x') {
  return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}

export function dayNumber(s) {
  const { y, m, d } = parseDate(s);
  return Math.floor(Date.UTC(y, m - 1, d) / 864e5);
}

export function dateFromDayNumber(n) {
  const dt = new Date(n * 864e5);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(s) {
  return (((dayNumber(s) + 4) % 7) + 7) % 7;
}

export function addDays(s, n) {
  return dateFromDayNumber(dayNumber(s) + n);
}

export function daysOfMonth(key) {
  const [y, m] = key.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${key}-${pad2(i + 1)}`);
}

export function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${pad2((t % 12) + 1)}`;
}

export function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export function minutesOf(t) {
  const [h, m] = String(t || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function formatMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function formatDay(s) {
  const { d, m } = parseDate(s);
  return `${WEEKDAYS_SHORT[weekdayOf(s)]} ${d}.${m}.`;
}

/** Formats a UTC-ms "wall clock" value as local floating ICS time: 20261203T080000. */
export function icsStamp(ms) {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}${pad2(dt.getUTCMonth() + 1)}${pad2(dt.getUTCDate())}T${pad2(dt.getUTCHours())}${pad2(dt.getUTCMinutes())}00`;
}

/** Small deterministic random generator (mulberry32), so tests are reproducible. */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 870 -> "14:30". */
export function fmtMin(m) {
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** 1.5 -> "1,5" (German decimal comma, at most one decimal). */
export function fmtHours(h) {
  return (Math.round(h * 10) / 10).toString().replace('.', ',');
}
