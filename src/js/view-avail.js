// Wishes view: the planner enters, per person and half hour, when they cannot work,
// when they want to work, and exceptions to the weekly pattern.
// Resolution (scheduler.effectiveDay): absence > entry for the date > weekly pattern.
import { h, monthNav, labelled } from './ui-core.js';
import { store, save } from './store.js';
import { EMPTY_DAY, STEP } from './model.js';
import { effectiveDay, appointmentsFor, isAbsent } from './scheduler.js';
import { formatMonth, formatDay, shiftMonth, daysOfMonth, weekdayOf, minutesOf, WEEKDAYS_SHORT } from './util.js';

const BRUSHES = [['x', 'Kann nicht'], ['+', 'Möchte arbeiten'], ['o', 'Kann (Ausnahme)'], ['.', 'Löschen']];
const wishUi = { person: null, brush: 'x' };
const LABEL = { x: 'kann nicht', '+': 'möchte', '.': '' };

function setChar(str, i, ch) {
  const base = str || EMPTY_DAY;
  return base.slice(0, i) + ch + base.slice(i + 1);
}

export function renderAvailView() {
  const s = store.state;
  const key = s.ui.month;
  const cfg = s.config;
  const people = s.people.filter((p) => p.active);
  if (!people.length) {
    return h('section', { class: 'view' }, h('div', { class: 'empty-state' }, h('h2', {}, 'Noch keine Personen'), h('p', {}, 'Zuerst unter „Personen“ die Mitarbeitenden anlegen.')));
  }
  if (!people.some((p) => p.id === wishUi.person)) wishUi.person = people[0].id;
  const person = people.find((p) => p.id === wishUi.person);
  const v0 = Math.floor(minutesOf(cfg.viewFrom) / STEP);
  const v1 = Math.ceil(minutesOf(cfg.viewTo) / STEP);
  const idx = [];
  for (let i = v0; i < v1; i++) idx.push(i);
  const dates = daysOfMonth(key);

  const monthStore = () => {
    s.availability[key] = s.availability[key] || {};
    s.availability[key][person.id] = s.availability[key][person.id] || {};
    return s.availability[key][person.id];
  };
  const paintDate = (date, i) => {
    const m = monthStore();
    m[date] = setChar(m[date], i, wishUi.brush);
    if (m[date] === EMPTY_DAY) delete m[date];
  };
  const paintPattern = (wd, i) => {
    const ch = wishUi.brush === 'o' ? '.' : wishUi.brush;
    person.pattern[wd] = setChar(person.pattern[wd], i, ch);
    if (person.pattern[wd] === EMPTY_DAY) delete person.pattern[wd];
  };

  // painting with pointer drag; the grid is rebuilt after each change
  let painting = null;
  const stop = () => { if (painting) { painting = null; save(); store.render(); } };
  window.addEventListener('pointerup', stop, { once: true });

  const cellFor = (kind, rowKey, i, effChar, explicitChar, appt) => {
    const el = h('td', {
      class: `hc c${effChar === '+' ? 'w' : effChar === 'x' ? 'x' : 'f'} ${explicitChar && explicitChar !== '.' ? 'exp' : 'inh'} ${appt ? 'ap' : ''} ${i % 2 === 0 ? 'hr' : ''}`,
      title: `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'} ${LABEL[effChar] || ''}${appt ? ' · Termin' : ''}`,
    });
    const apply = () => {
      if (kind === 'date') paintDate(rowKey, i); else paintPattern(rowKey, i);
      const ch = wishUi.brush === 'o' || wishUi.brush === '.' ? 'f' : wishUi.brush === '+' ? 'w' : 'x';
      el.className = `hc c${ch} exp ${appt ? 'ap' : ''} ${i % 2 === 0 ? 'hr' : ''}`;
    };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); painting = kind; apply(); });
    el.addEventListener('pointerenter', () => { if (painting === kind) apply(); });
    return el;
  };

  const head = h('tr', {}, h('th', {}, ''), idx.map((i) => h('th', { class: i % 2 === 0 ? 'hr' : '' }, i % 2 === 0 ? String(i / 2) : '')));
  const rows = dates.map((date) => {
    const eff = effectiveDay(s, person, date);
    const ex = s.availability[key]?.[person.id]?.[date] || '';
    const ap = appointmentsFor(cfg, person, date);
    const inAppt = (i) => ap.some((a) => a.from <= i * STEP && a.to > i * STEP);
    const absent = isAbsent(person, date);
    return h('tr', { class: cfg.weekendDays.includes(weekdayOf(date)) ? 'we' : '' },
      h('th', { class: 'day clickable', title: 'Ganzen Tag mit dem Pinsel füllen', onClick: () => { idx.forEach((i) => paintDate(date, i)); save(); store.render(); } }, formatDay(date), absent ? h('small', {}, ' abwesend') : null),
      idx.map((i) => cellFor('date', date, i, eff[i], ex[i], inAppt(i))));
  });

  const order = [1, 2, 3, 4, 5, 6, 0];
  const patternRows = order.map((wd) => {
    const str = person.pattern[wd] || EMPTY_DAY;
    return h('tr', {}, h('th', { class: 'day' }, WEEKDAYS_SHORT[wd]), idx.map((i) => cellFor('pattern', wd, i, str[i] === 'o' ? '.' : str[i], str[i], false)));
  });

  const absences = person.absences;
  const absenceList = h('div', {},
    absences.map((a, i) => h('div', { class: 'row absence' },
      h('input', { type: 'date', value: a.from || '', onChange: (e) => { a.from = e.target.value; save(); } }),
      h('span', {}, 'bis'),
      h('input', { type: 'date', value: a.to || '', onChange: (e) => { a.to = e.target.value; save(); } }),
      h('input', { type: 'text', placeholder: 'Notiz (z. B. Urlaub)', value: a.note || '', onChange: (e) => { a.note = e.target.value; save(); } }),
      h('button', { class: 'btn quiet', onClick: () => { absences.splice(i, 1); save(); store.render(); } }, 'Entfernen'))),
    h('button', { class: 'btn', onClick: () => { absences.push({ from: `${key}-01`, to: `${key}-01`, note: '' }); save(); store.render(); } }, 'Abwesenheit hinzufügen'));

  const entered = (p) => Object.keys(s.availability[key]?.[p.id] || {}).length;

  return h('section', { class: 'view' },
    h('div', { class: 'toolbar' },
      monthNav(formatMonth(key), () => { s.ui.month = shiftMonth(key, -1); save(); store.render(); }, () => { s.ui.month = shiftMonth(key, 1); save(); store.render(); }),
      h('div', { class: 'row' },
        labelled('Person', h('select', { onChange: (e) => { wishUi.person = e.target.value; store.render(); } }, people.map((p) => h('option', { value: p.id, selected: p.id === person.id }, `${p.name}${entered(p) ? '' : ' (noch nichts eingetragen)'}`)))),
        h('div', { class: 'brushes', role: 'radiogroup', 'aria-label': 'Pinsel' }, BRUSHES.map(([v, l]) => h('button', { class: `btn ${wishUi.brush === v ? 'on' : ''}`, role: 'radio', 'aria-checked': String(wishUi.brush === v), onClick: () => { wishUi.brush = v; store.render(); } }, l))))),
    h('p', { class: 'hint' }, 'Pinsel wählen, dann Felder anklicken oder mit gedrückter Maustaste darüberziehen (je halbe Stunde). Klick auf das Datum füllt den ganzen Tag. „Kann nicht“ wird nie verplant. „Möchte arbeiten“ wird bevorzugt. „Kann (Ausnahme)“ hebt das Wochenmuster für diesen Tag auf. Helle Felder stammen aus dem Wochenmuster. Umrandete Felder sind Termine.'),
    h('div', { class: 'legend' },
      h('span', {}, h('i', { class: 'lg-x' }), 'kann nicht'), h('span', {}, h('i', { class: 'lg-w' }), 'möchte arbeiten'), h('span', {}, h('i', { class: 'lg-ap' }), 'Termin')),
    h('h2', {}, `Wünsche ${formatMonth(key)}: ${person.name}`),
    h('div', { class: 'tablewrap' }, h('table', { class: 'hgrid' }, h('thead', {}, head), h('tbody', {}, rows))),
    h('div', { class: 'cols' },
      h('div', {},
        h('h2', {}, 'Wochenmuster (gilt jeden Monat)'),
        h('p', { class: 'hint' }, `Regelmäßige Einschränkungen, z. B. „mittwochs erst ab 16:30“. Gilt, solange für den Tag nichts anderes eingetragen ist.`),
        h('div', { class: 'tablewrap' }, h('table', { class: 'hgrid' }, h('thead', {}, head.cloneNode(true)), h('tbody', {}, patternRows)))),
      h('div', {},
        h('h2', {}, 'Abwesenheiten'),
        h('p', { class: 'hint' }, 'Urlaub, Krankheit, Fortbildung: an diesen Tagen kein Dienst und keine Sollstunden.'),
        absenceList)));
}

