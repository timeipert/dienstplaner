// Data model (schema 2, "hour model"), defaults and presets.
//
// Duties have free start and end times on a 30-minute grid. The plan must cover time windows
// (for example Mon–Fri 14:00–20:00 with at least one person), each person should reach the
// weekly hours of their contract, and appointments (team meeting, case conference) force
// the presence of persons at a given time.
//
// Everything the app stores lives in one JSON object ("state"):
//   state.config        rules and requirements (see defaultConfig)
//   state.people[]      persons (see newPerson)
//   state.availability  { "YYYY-MM": { personId: { "YYYY-MM-DD": dayString } } }
//   state.plans         { "YYYY-MM": { duties: { "personId|YYYY-MM-DD": { from, to, locked } }, status } }
//   state.ui, state.meta
//
// dayString: 48 characters, one per half hour of the day (index 0 = 00:00–00:30).
//   '.' no entry   'x' cannot work (hard)   '-' rather not (soft)   '+' wants to work
//   'o' can work (overrides the weekly pattern for that half hour)

import { uid, currentMonthKey, shiftMonth, minutesOf } from './util.js';

export const SCHEMA_VERSION = 2;
export const STEP = 30; // minutes per grid cell
export const CELLS = 48; // grid cells per day
export const EMPTY_DAY = '.'.repeat(CELLS);
export const STATUS = { collecting: 'Wünsche sammeln', draft: 'Entwurf', final: 'Abgeschlossen' };

export const WEIGHT_DEFS = [
  ['coverage', 'Fehlende Besetzung', 'je halbe Stunde und fehlende Person'],
  ['weeklyCoverage', 'Wöchentliche Besetzung verfehlt', 'je Woche'],
  ['hours', 'Abweichung von den Wochenstunden', 'je Stunde und Woche'],
  ['weekend', 'Wochenenddienste nicht wie vorgegeben', 'je Dienst zu viel oder zu wenig'],
  ['weekendLate', 'Wochenenddienst nach der Wunsch-Endzeit', 'je halbe Stunde'],
  ['apptOnly', 'Zu viele Dienste nur für einen Termin', 'je Dienst'],
  ['length', 'Dienstlänge weicht von Wunschlänge ab', 'je halbe Stunde'],
  ['prefDay', 'Dienst an einem nicht bevorzugten Wochentag', 'je Dienst'],
  ['consecutive', 'Dienste an zwei Tagen hintereinander (falls vermeiden)', 'je Paar'],
  ['want', '„Möchte arbeiten“ nicht berücksichtigt', 'je Tag'],
  ['outside', 'Dienstzeit außerhalb der benötigten Besetzung (werktags)', 'je halbe Stunde'],
  ['align', 'Dienste am selben Tag beginnen/enden nicht gleichzeitig (siehe Einrichtung)', 'je halbe Stunde Abstand'],
  ['rather', 'Dienst in „eher nicht“-Zeit', 'je halbe Stunde'],
  ['weeklyWish', 'Wöchentlicher Wunsch (z. B. einmal vormittags) nicht erfüllt', 'je fehlendem Dienst'],
  ['vacation', 'Dienst am Tag vor oder nach einer Abwesenheit (Urlaub)', 'je Dienst'],
  ['emptyWeekend', 'Zu viele Wochenenden ganz ohne Dienst', 'je Wochenende über der Grenze'],
  ['balanceDay', 'Ungleich verteilte Ausgleichstage (z. B. Freitage)', 'Faktor'],
  ['pairs', 'Ungleich verteilte gemeinsame Zeit', 'Faktor'],
  ['lateBalance', 'Ungleich verteilte späte Dienste (Ende nach der Grenze der Spätregel)', 'Faktor'],
];

export function defaultWeights() {
  return { coverage: 200, weeklyCoverage: 300, hours: 20, weekend: 400, weekendLate: 40, apptOnly: 300, length: 8, prefDay: 15, consecutive: 40, want: 25, emptyWeekend: 500, rather: 15, weeklyWish: 120, align: 10, outside: 3, balanceDay: 60, pairs: 3, vacation: 80, lateBalance: 5 };
}

export function defaultConfig() {
  const win = (on, from, to) => ({ on, from, to });
  return {
    title: 'Dienstplan',
    weekStart: 1,
    viewFrom: '10:00', // normal visible range; the views extend it when duties or appointments lie outside
    viewTo: '21:00',
    deadlineDay: 4, // wishes and plan for month M are due on this day of month M-1
    // when duties may take place, per weekday (0 = Sunday)
    dayWindows: { 0: win(true, '10:00', '21:00'), 1: win(true, '10:00', '21:00'), 2: win(true, '10:00', '21:00'), 3: win(true, '10:00', '21:00'), 4: win(true, '10:00', '21:00'), 5: win(true, '10:00', '21:00'), 6: win(true, '10:00', '21:00') },
    coverage: [{ id: uid('cv'), weekdays: [1, 2, 3, 4, 5], from: '14:00', to: '20:00', min: 1 }],
    weeklyCoverage: [], // { id, weekdays, from, to, min, days }: on `days` days per week the window is covered
    weekendDays: [6, 0],
    weekendDuty: { perMonth: 1, hours: 3, avoidAfter: '20:00' }, // per person
    // Same-day alignment of duties inside the morning group (start before `split`) and the afternoon group.
    // mode: none | start (start together) | end (end together) | either (one of both) | both
    align: { mode: 'none', split: '13:00' },
    maxEmptyWeekends: 1, // weekends of the month on which nobody works (team-wide)
    appointments: [], // { id, title, repeat: 'weekly'|'once', weekday, date, from, to, participants: 'all'|[ids] }
    appointmentOnlyMax: 1, // duties that consist only of an appointment, per person and month
    lateRule: { on: true, endAfter: '20:30', nextFrom: '13:00' }, // hard
    balanceWeekdays: [5], // weekdays whose duties are spread evenly over persons
    balanceHistoryMonths: 3,
    maxDayHours: 8,
    closedDates: [], // { date, note }
    weights: defaultWeights(),
  };
}

export function newPerson(name = 'Neue Person', extra = {}) {
  return {
    id: uid('pe'), name, weeklyHours: 15, minLen: 5, maxLen: 5, prefLen: 5,
    preferredWeekdays: [], avoidConsecutive: true, weeklyWishes: [], pattern: {}, absences: [], active: true, note: '', ...extra,
  };
}

/** Builds a day string with 'x' in [from, to) (minutes). */
export function blockString(from, to, ch = 'x', base = EMPTY_DAY) {
  const a = base.split('');
  for (let i = Math.floor(from / STEP); i < Math.ceil(to / STEP) && i < CELLS; i++) a[i] = ch;
  return a.join('');
}

export const PRESETS = {
  team3: {
    label: 'Nachmittagsdienst, 3 Personen (Beispiel)',
    build: () => {
      const c = defaultConfig();
      c.title = 'Dienstplan Team';
      c.dayWindows[3].from = '12:00'; // Wednesday: no morning duties
      c.weeklyCoverage = [{ id: uid('wc'), weekdays: [1, 2, 3, 4, 5], from: '20:00', to: '21:00', min: 1, days: 1 }];
      c.appointments = [{ id: uid('ap'), title: 'Teamsitzung', repeat: 'weekly', weekday: 2, date: '', from: '14:00', to: '15:30', participants: 'all' }];
      const people = [
        newPerson('J1', { weeklyHours: 15, minLen: 5, maxLen: 5, prefLen: 5, preferredWeekdays: [1, 3, 5], avoidConsecutive: true,
          pattern: { 5: blockString(20 * 60, 21 * 60, '-') }, note: 'Beispiel: freitags eher nicht bis 21 Uhr' }),
        newPerson('J2', {
          weeklyHours: 15, minLen: 5, maxLen: 5, prefLen: 5, preferredWeekdays: [1, 3, 5], avoidConsecutive: true,
          pattern: { 3: blockString(0, 16 * 60 + 30), 5: blockString(18 * 60, 24 * 60) },
          note: 'Beispiel: mittwochs erst ab 16:30, freitags nur bis 18:00',
        }),
        newPerson('N', { weeklyHours: 25, minLen: 5, maxLen: 6, prefLen: 6, avoidConsecutive: true }),
      ];
      return { config: c, people };
    },
  },
  blank: {
    label: 'Leer',
    build: () => ({ config: defaultConfig(), people: [] }),
  },
};

export function newState(presetId = 'blank') {
  const preset = (PRESETS[presetId] || PRESETS.blank).build();
  return normalizeState({
    version: SCHEMA_VERSION, config: preset.config, people: preset.people, availability: {}, plans: {}, monthSettings: {},
    ui: { month: shiftMonth(currentMonthKey(), 1), tab: 'plan', planView: 'timeline' }, meta: { onboarded: false },
  });
}

const isDayString = (s) => typeof s === 'string' && s.length === CELLS;

/** Fills missing fields. Data of schema 1 (shift-slot model) cannot be converted and is replaced. */
export function normalizeState(s) {
  if (!s || typeof s !== 'object' || (s.version && s.version < SCHEMA_VERSION)) {
    return newState('blank');
  }
  s.version = SCHEMA_VERSION;
  const base = defaultConfig();
  const c = (s.config = { ...base, ...(s.config || {}) });
  c.dayWindows = { ...base.dayWindows, ...(c.dayWindows || {}) };
  c.weekendDuty = { ...base.weekendDuty, ...(c.weekendDuty || {}) };
  c.lateRule = { ...base.lateRule, ...(c.lateRule || {}) };
  c.align = { ...base.align, ...(c.align || {}) };
  c.weights = { ...defaultWeights(), ...(c.weights || {}) };
  for (const k of ['coverage', 'weeklyCoverage', 'appointments', 'closedDates', 'balanceWeekdays', 'weekendDays']) {
    if (!Array.isArray(c[k])) c[k] = base[k];
  }
  s.people = (Array.isArray(s.people) ? s.people : []).map((p) => {
    const q = { ...newPerson(), ...p };
    q.pattern = q.pattern && typeof q.pattern === 'object' ? q.pattern : {};
    for (const k of Object.keys(q.pattern)) if (!isDayString(q.pattern[k])) delete q.pattern[k];
    q.absences = Array.isArray(q.absences) ? q.absences : [];
    q.preferredWeekdays = Array.isArray(q.preferredWeekdays) ? q.preferredWeekdays : [];
    q.weeklyWishes = Array.isArray(q.weeklyWishes) ? q.weeklyWishes : [];
    for (const k of ['weeklyHours', 'minLen', 'maxLen', 'prefLen']) q[k] = Number(q[k]) || 0;
    if (q.maxLen < q.minLen) q.maxLen = q.minLen;
    return q;
  });
  s.availability = s.availability && typeof s.availability === 'object' ? s.availability : {};
  s.plans = s.plans && typeof s.plans === 'object' ? s.plans : {};
  s.monthSettings = s.monthSettings && typeof s.monthSettings === 'object' ? s.monthSettings : {};
  for (const plan of Object.values(s.plans)) { plan.duties = plan.duties || {}; plan.status = plan.status || 'collecting'; }
  s.ui = { month: shiftMonth(currentMonthKey(), 1), tab: 'plan', planView: 'timeline', ...(s.ui || {}) };
  s.meta = { onboarded: false, ...(s.meta || {}) };
  return s;
}

export function getPlan(state, key) {
  if (!state.plans[key]) state.plans[key] = { duties: {}, status: 'collecting' };
  return state.plans[key];
}

/**
 * Visible range in minutes: the configured range, widened to full hours so that every given
 * interval [from, to] (duties, appointments) is visible, for example a duty from 07:30.
 */
export function visibleRange(cfg, intervals) {
  let a = minutesOf(cfg.viewFrom);
  let b = minutesOf(cfg.viewTo);
  for (const [f, t] of intervals) { if (f < a) a = f; if (t > b) b = t; }
  return [Math.floor(a / 60) * 60, Math.min(24 * 60, Math.ceil(b / 60) * 60)];
}

/**
 * Settings that apply to one month only (key 'YYYY-MM'), for example "no morning duties in
 * this month" for everybody or for one person, weekly wishes paused, or other weekly hours.
 * Morning duty = duty that starts before morningUntil. Appointments (for example a case
 * conference at 10:00) still take place; the duty of a participant may then start earlier.
 */
export function monthSettingsOf(state, key) {
  const ms = state.monthSettings?.[key] || {};
  return { noMorning: false, morningUntil: '12:00', ...ms, people: ms.people || {} };
}

/** Per-person part of the month settings. hours: '' = contract hours apply. */
export function personMonthOf(ms, personId) {
  return { noMorning: false, noWishes: false, hours: '', ...(ms.people[personId] || {}) };
}

/** Writable month settings (created on first change). */
export function editMonthSettings(state, key) {
  if (!state.monthSettings) state.monthSettings = {};
  if (!state.monthSettings[key]) state.monthSettings[key] = { noMorning: false, morningUntil: '12:00', people: {} };
  const ms = state.monthSettings[key];
  if (!ms.people) ms.people = {};
  return ms;
}

export const dutyKey = (personId, date) => `${personId}|${date}`;
