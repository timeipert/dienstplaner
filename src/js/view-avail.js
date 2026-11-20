// Wishes view ("Wünsche"). Everything that can be entered is visible at once as a short text;
// a click on an item opens its editor:
//   - the month as a calendar: each day shows its entries ("nicht bis 12", "eher nicht ab 20");
//     a click opens the day editor (whole day, time range, half-hour strip),
//   - the weekly pattern (same editor, valid every month),
//   - weekly wishes ("once a week a morning duty") and absences as lists; a click opens a form.
// Resolution (scheduler.effectiveDay): absence > entry for the date > weekly pattern.
import { h, openModal, monthNav } from './ui-core.js';
import { store, save } from './store.js';
import { EMPTY_DAY, STEP, visibleRange } from './model.js';
import { effectiveDay, appointmentsFor, isAbsent } from './scheduler.js';
import { describeDay } from './wishtext.js';
import { formatMonth, formatDay, shiftMonth, daysOfMonth, weekdayOf, fmtMin, WEEKDAYS_SHORT, WEEKDAYS_LONG, uid } from './util.js';

const AVAIL_FULL = 'x'.repeat(48);
const AVAIL_BRUSHES = [['x', 'Kann nicht'], ['-', 'Eher nicht'], ['+', 'Möchte arbeiten'], ['o', 'Kann (Ausnahme)'], ['.', 'Löschen']];
const AVAIL_CLS = { x: 'x', '-': 'r', '+': 'w', '.': 'f', o: 'f' };
const wishUi = { person: null };
const hm = (m) => fmtMin(m).replace(/:00$/, '').replace(/^0/, '');

const withChar = (str, i, ch) => (str || EMPTY_DAY).slice(0, i) + ch + (str || EMPTY_DAY).slice(i + 1);
const resolveChar = (own, inherit, i) => {
  const e = own[i];
  if (e !== '.') return e === 'o' ? '.' : e;
  const p = inherit ? inherit[i] : '.';
  return p === 'o' ? '.' : p;
};

/**
 * Editor for one day string (a date or a weekday of the weekly pattern).
 * opts: title, hint, range [from, to] in minutes, brushes, get() -> own string, set(str),
 * inherit() -> string of the weekly pattern or null, absent (text) if an absence overrides the day.
 */
function openStripEditor(opts) {
  const [r0, r1] = opts.range;
  const v0 = r0 / STEP;
  const v1 = r1 / STEP;
  openModal(opts.title, (close) => {
    let cur = opts.get() || EMPTY_DAY;
    let brush = opts.brushes[0][0];
    let painting = false;
    const eff = () => Array.from({ length: 48 }, (_, i) => resolveChar(cur, opts.inherit?.(), i)).join('');
    const summary = h('p', { class: 'daysum' });
    const strip = h('table', { class: 'hgrid strip' });
    const brushBox = h('div', { class: 'brushes', role: 'radiogroup', 'aria-label': 'Pinsel' });
    const formBox = h('div', { class: 'row wrap rangeform' });
    const wholeBtn = h('button', { class: 'btn' });

    const commit = () => { opts.set(cur === EMPTY_DAY ? null : cur); save(); store.render(); };
    const cellClass = (i) => `hc c${AVAIL_CLS[resolveChar(cur, opts.inherit?.(), i)] || 'f'} ${cur[i] !== '.' ? 'exp' : 'inh'} ${i % 2 === 0 ? 'hr' : ''}`;
    const paint = (i, el) => { cur = withChar(cur, i, brush); el.className = cellClass(i); drawSummary(); };
    const drawSummary = () => {
      const parts = describeDay(eff(), cur, opts.range);
      summary.textContent = parts.length ? parts.map((p) => p.text).join(' · ') : 'Nichts eingetragen: ohne Einschränkung.';
      wholeBtn.textContent = cur === AVAIL_FULL ? 'Tag wieder freigeben' : 'Ganzer Tag nicht möglich';
    };
    const drawStrip = () => {
      const heads = [];
      for (let i = v0; i < v1; i += 2) heads.push(h('th', { colspan: '2', class: 'hr' }, String(i / 2)));
      const cells = [];
      for (let i = v0; i < v1; i++) {
        const td = h('td', { class: cellClass(i), title: `${hm(i * STEP)}–${hm((i + 1) * STEP)}` });
        td.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          painting = true;
          paint(i, td);
          window.addEventListener('pointerup', () => { painting = false; commit(); }, { once: true });
        });
        td.addEventListener('pointerenter', () => { if (painting) paint(i, td); });
        cells.push(td);
      }
      strip.replaceChildren(h('thead', {}, h('tr', {}, heads)), h('tbody', {}, h('tr', {}, cells)));
    };
    const drawBrushes = () => brushBox.replaceChildren(...opts.brushes.map(([v, l]) => h('button', { class: `btn ${brush === v ? 'on' : ''}`, role: 'radio', 'aria-checked': String(brush === v), onClick: () => { brush = v; drawBrushes(); } }, l)));
    const redraw = () => { drawSummary(); drawStrip(); drawBrushes(); };

    // time range: "Kann nicht von 12 bis 14 eintragen"
    let kind = 'x';
    let from = r0;
    let to = r1;
    const times = [];
    for (let m = r0; m <= r1; m += STEP) times.push(m);
    const timeSelect = (get, setv) => h('select', { onChange: (e) => setv(Number(e.target.value)) }, times.map((m) => h('option', { value: m, selected: m === get() }, hm(m))));
    formBox.append(
      h('select', { onChange: (e) => { kind = e.target.value; } }, opts.brushes.map(([v, l]) => h('option', { value: v, selected: v === kind }, l))),
      h('span', {}, 'von'), timeSelect(() => from, (v) => { from = v; }),
      h('span', {}, 'bis'), timeSelect(() => to, (v) => { to = v; }),
      h('button', { class: 'btn', onClick: () => {
        if (to <= from) return;
        for (let i = from / STEP; i < to / STEP; i++) cur = withChar(cur, i, kind);
        commit();
        redraw();
      } }, 'Eintragen'));
    wholeBtn.addEventListener('click', () => { cur = cur === AVAIL_FULL ? EMPTY_DAY : AVAIL_FULL; commit(); redraw(); });

    redraw();
    if (opts.absent) return h('div', {}, h('p', {}, opts.absent), h('div', { class: 'row end' }, h('button', { class: 'btn solid', onClick: close }, 'Schließen')));
    return h('div', { class: 'dayedit' },
      summary,
      h('div', { class: 'row wrap' }, wholeBtn, h('button', { class: 'btn quiet', onClick: () => { cur = EMPTY_DAY; commit(); redraw(); } }, 'Tag leeren')),
      h('h4', {}, 'Zeitraum eintragen'), formBox,
      h('h4', {}, 'Einzelne Zeiten'),
      h('p', { class: 'hint' }, 'Pinsel wählen, dann Felder anklicken oder mit gedrückter Maustaste darüberziehen (je halbe Stunde). Helle Felder stammen aus dem Wochenmuster.'),
      brushBox, strip,
      opts.hint ? h('p', { class: 'hint' }, opts.hint) : null,
      h('div', { class: 'row end' }, h('button', { class: 'btn solid', onClick: close }, 'Fertig')));
  });
}

/** Modal with form fields of one list item (weekly wish, absence) and delete / done. */
function openItemEditor(title, build, onDelete) {
  openModal(title, (close) => h('div', { class: 'itemedit' }, build(),
    h('div', { class: 'row end' },
      h('button', { class: 'btn quiet', onClick: () => { close(); onDelete(); } }, 'Löschen'),
      h('button', { class: 'btn solid', onClick: close }, 'Fertig'))), { onClose: () => { save(); store.render(); } });
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
  const dates = daysOfMonth(key);
  const apIntervals = dates.flatMap((d) => appointmentsFor(cfg, person, d).map((a) => [a.from, a.to]));
  const range = visibleRange(cfg, apIntervals);
  const rerender = () => { save(); store.render(); };
  const monthEntries = () => s.availability[key]?.[person.id] || {};

  // ----- month calendar
  const weekOrder = [0, 1, 2, 3, 4, 5, 6].map((i) => (cfg.weekStart + i) % 7);
  const dayCell = (date) => {
    const wd = weekdayOf(date);
    const own = monthEntries()[date] || EMPTY_DAY;
    const eff = effectiveDay(s, person, date);
    const absence = person.absences.find((a) => a.from && date >= a.from && date <= (a.to || a.from));
    const parts = absence ? [] : describeDay(eff, own, range);
    const ap = absence ? [] : appointmentsFor(cfg, person, date);
    const explicit = own !== EMPTY_DAY;
    return h('button', {
      class: `wd ${cfg.weekendDays.includes(wd) ? 'we' : ''} ${absence ? 'abs' : ''} ${explicit ? 'exp' : 'inh'}`,
      title: `${formatDay(date)}: anklicken zum Ändern`,
      onClick: () => openStripEditor({
        title: `${formatDay(date)} · ${person.name}`,
        range,
        brushes: AVAIL_BRUSHES,
        get: () => monthEntries()[date],
        set: (v) => {
          s.availability[key] = s.availability[key] || {};
          s.availability[key][person.id] = s.availability[key][person.id] || {};
          if (v == null) delete s.availability[key][person.id][date]; else s.availability[key][person.id][date] = v;
        },
        inherit: () => person.pattern[wd] || null,
        absent: absence ? `${person.name} ist an diesem Tag abwesend${absence.note ? ` (${absence.note})` : ''}. Die Abwesenheit steht unten unter „Abwesenheiten“.` : null,
      }),
    },
    h('span', { class: 'dn' }, `${Number(date.slice(8))}.`, h('span', { class: 'wdn' }, WEEKDAYS_SHORT[wd])),
    absence ? h('span', { class: 'e abs' }, `abwesend${absence.note ? ` · ${absence.note}` : ''}`) : null,
    parts.map((p) => h('span', { class: `e k${AVAIL_CLS[p.kind]}` }, p.text)),
    ap.map((a) => h('span', { class: 'ap' }, `Termin ${hm(a.from)}–${hm(a.to)}`)));
  };
  const blanks = (weekdayOf(dates[0]) - cfg.weekStart + 7) % 7;
  const calendar = h('div', { class: 'wcal' },
    weekOrder.map((wd) => h('div', { class: 'wh' }, WEEKDAYS_SHORT[wd])),
    Array.from({ length: blanks }, () => h('div', { class: 'wd blank' })),
    dates.map(dayCell));

  // ----- weekly pattern
  const patternCell = (wd) => {
    const own = person.pattern[wd] || EMPTY_DAY;
    const parts = describeDay(own.replace(/o/g, '.'), '.'.repeat(48), range);
    return h('button', {
      class: `wd ${cfg.weekendDays.includes(wd) ? 'we' : ''} exp`,
      title: `${WEEKDAYS_LONG[wd]}: anklicken zum Ändern`,
      onClick: () => openStripEditor({
        title: `Jeden ${WEEKDAYS_LONG[wd]} · ${person.name}`,
        range,
        brushes: AVAIL_BRUSHES.filter(([v]) => v !== 'o'),
        get: () => person.pattern[wd],
        set: (v) => { if (v == null) delete person.pattern[wd]; else person.pattern[wd] = v; },
        inherit: () => null,
        hint: 'Gilt in jedem Monat, solange für den Tag nichts anderes eingetragen ist.',
      }),
    }, h('span', { class: 'dn' }, h('span', { class: 'sh' }, WEEKDAYS_SHORT[wd]), h('span', { class: 'lg' }, WEEKDAYS_LONG[wd])), parts.map((p) => h('span', { class: `e k${AVAIL_CLS[p.kind]}` }, p.text)));
  };

  // ----- weekly wishes and absences
  const item = (text, onClick) => h('button', { class: 'item', onClick }, h('span', {}, text), h('span', { class: 'hint' }, 'ändern'));
  const fld = (label, control) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), control);
  const wishText = (w) => `${w.label || 'Wunsch'}: an ${w.days} Tag(en) pro Woche ein Dienst, der zwischen ${w.from} und ${w.to} beginnt`;
  const editWish = (w) => openItemEditor('Wöchentlicher Wunsch', () => h('div', { class: 'formgrid' },
    fld('Bezeichnung', h('input', { type: 'text', value: w.label || '', placeholder: 'z. B. Vormittag', onChange: (e) => { w.label = e.target.value; save(); } })),
    fld('Tage pro Woche', h('input', { type: 'number', min: '1', max: '7', class: 'narrow', value: w.days, onChange: (e) => { w.days = Math.max(1, Number(e.target.value) || 1); save(); } })),
    fld('Dienstbeginn von', h('input', { type: 'time', step: '1800', value: w.from, onChange: (e) => { w.from = e.target.value; save(); } })),
    fld('Dienstbeginn bis', h('input', { type: 'time', step: '1800', value: w.to, onChange: (e) => { w.to = e.target.value; save(); } }))),
  () => { person.weeklyWishes = person.weeklyWishes.filter((x) => x !== w); rerender(); });
  const absenceText = (a) => `${a.from ? formatDay(a.from) : '?'}${a.to && a.to !== a.from ? ` bis ${formatDay(a.to)}` : ''}${a.note ? ` · ${a.note}` : ''}`;
  const editAbsence = (a) => openItemEditor('Abwesenheit', () => h('div', { class: 'formgrid' },
    fld('Von', h('input', { type: 'date', value: a.from || '', onChange: (e) => { a.from = e.target.value; if (!a.to || a.to < a.from) a.to = a.from; save(); } })),
    fld('Bis', h('input', { type: 'date', value: a.to || '', onChange: (e) => { a.to = e.target.value; save(); } })),
    fld('Notiz', h('input', { type: 'text', placeholder: 'z. B. Urlaub', value: a.note || '', onChange: (e) => { a.note = e.target.value; save(); } }))),
  () => { person.absences = person.absences.filter((x) => x !== a); rerender(); });
  const addWish = () => { const w = { id: uid('ww'), label: 'Vormittag', days: 1, from: '10:00', to: '13:00' }; person.weeklyWishes.push(w); rerender(); editWish(w); };
  const addAbsence = () => { const a = { from: `${key}-01`, to: `${key}-01`, note: '' }; person.absences.push(a); rerender(); editAbsence(a); };

  const empty = !Object.keys(monthEntries()).length && !Object.keys(person.pattern).length && !person.absences.length && !person.weeklyWishes.length;
  return h('section', { class: 'view availview' },
    h('div', { class: 'toolbar' },
      monthNav(formatMonth(key), () => { s.ui.month = shiftMonth(key, -1); rerender(); }, () => { s.ui.month = shiftMonth(key, 1); rerender(); }),
      h('div', { class: 'brushes persons', role: 'radiogroup', 'aria-label': 'Person' }, people.map((p) => h('button', { class: `btn ${p.id === person.id ? 'on' : ''}`, role: 'radio', 'aria-checked': String(p.id === person.id), onClick: () => { wishUi.person = p.id; store.render(); } }, p.name)))),
    h('p', { class: 'hint' }, empty
      ? `Für ${person.name} ist noch nichts eingetragen. Einen Tag, ein Wochenmuster, einen Wunsch oder eine Abwesenheit anklicken, um zu beginnen.`
      : 'Alles anklicken, was geändert werden soll. Dunkel markierte Zeiten werden nie verplant („nicht“), gepunktete nur im Notfall („eher nicht“).'),
    h('h2', {}, `${formatMonth(key)} · ${person.name}`),
    calendar,
    h('div', { class: 'cols' },
      h('div', {},
        h('h2', {}, 'Wochenmuster (gilt jeden Monat)'),
        h('p', { class: 'hint' }, 'Regelmäßige Einschränkungen, z. B. „montags erst ab 15:00“. Einträge für einzelne Tage oben haben Vorrang.'),
        h('div', { class: 'wcal pattern' }, [1, 2, 3, 4, 5, 6, 0].map(patternCell))),
      h('div', {},
        h('h2', {}, 'Wöchentliche Wünsche'),
        h('p', { class: 'hint' }, 'Zum Beispiel „einmal pro Woche vormittags“. Weiche Regel; gilt nur für Wochen mit mindestens 3 möglichen Werktagen.'),
        h('div', { class: 'items' }, person.weeklyWishes.map((w) => item(wishText(w), () => editWish(w))), person.weeklyWishes.length ? null : h('p', { class: 'hint' }, 'keine')),
        h('button', { class: 'btn', onClick: addWish }, '+ Wunsch hinzufügen'),
        h('h2', {}, 'Abwesenheiten'),
        h('p', { class: 'hint' }, 'Urlaub, Krankheit, Fortbildung: an diesen Tagen kein Dienst und keine Sollstunden.'),
        h('div', { class: 'items' }, person.absences.map((a) => item(absenceText(a), () => editAbsence(a))), person.absences.length ? null : h('p', { class: 'hint' }, 'keine')),
        h('button', { class: 'btn', onClick: addAbsence }, '+ Abwesenheit hinzufügen'))));
}
