// Setup view: duty windows per weekday, coverage, weekly coverage, weekend duty, rules, weights.
import { h, labelled } from './ui-core.js';
import { store, save } from './store.js';
import { WEIGHT_DEFS, defaultWeights } from './model.js';
import { uid, WEEKDAYS_SHORT, WEEKDAYS_LONG } from './util.js';

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function renderSetupView() {
  const s = store.state;
  const c = s.config;
  const rerender = () => { save(); store.render(); };
  const time = (obj, f) => h('input', { type: 'time', step: '1800', value: obj[f], onChange: (e) => { obj[f] = e.target.value; save(); } });
  const num = (obj, f, extra = {}) => h('input', { type: 'number', class: 'narrow', min: '0', value: obj[f], onChange: (e) => { obj[f] = Number(e.target.value) || 0; save(); }, ...extra });
  const dayChecks = (obj, f = 'weekdays', order = WEEK_ORDER) => order.map((wd) => h('label', { class: 'check tight' }, h('input', { type: 'checkbox', checked: obj[f].includes(wd), onChange: (e) => { obj[f] = e.target.checked ? [...new Set([...obj[f], wd])] : obj[f].filter((x) => x !== wd); save(); } }), WEEKDAYS_SHORT[wd]));

  const general = h('div', { class: 'card' },
    h('h2', {}, 'Allgemein'),
    h('div', { class: 'formgrid' },
      labelled('Titel des Plans', h('input', { type: 'text', value: c.title, onChange: (e) => { c.title = e.target.value; rerender(); } })),
      labelled('Abgabe am … des Vormonats', num(c, 'deadlineDay', { max: '28' })),
      labelled('Woche beginnt am', h('select', { onChange: (e) => { c.weekStart = Number(e.target.value); rerender(); } }, [1, 0].map((d) => h('option', { value: d, selected: c.weekStart === d }, WEEKDAYS_LONG[d])))),
      labelled('Anzeige von', time(c, 'viewFrom')),
      labelled('Anzeige bis', time(c, 'viewTo')),
      labelled('Längster Dienst pro Tag (Std.)', num(c, 'maxDayHours'))));

  const windows = h('div', { class: 'card' },
    h('h2', {}, 'Dienstzeiten je Wochentag'),
    h('p', { class: 'hint' }, 'In welchem Zeitraum Dienste liegen dürfen (z. B. mittwochs erst ab 12:00 = keine Vormittagsdienste). Termine dürfen außerhalb liegen.'),
    h('table', { class: 'grid' }, h('tbody', {}, WEEK_ORDER.map((wd) => {
      const w = c.dayWindows[wd];
      return h('tr', {}, h('th', {}, WEEKDAYS_LONG[wd]),
        h('td', {}, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: w.on, onChange: (e) => { w.on = e.target.checked; save(); } }), 'Dienste möglich')),
        h('td', { class: 'nowrap' }, time(w, 'from'), ' – ', time(w, 'to')));
    }))));

  const coverage = h('div', { class: 'card wide' },
    h('h2', {}, 'Benötigte Besetzung'),
    h('p', { class: 'hint' }, 'Zeitfenster, in denen mindestens so viele Personen da sein sollen. Lücken werden im Plan schraffiert angezeigt.'),
    h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ['Wochentage', 'von', 'bis', 'mind. Personen', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, c.coverage.map((r, i) => h('tr', {},
        h('td', { class: 'nowrap' }, dayChecks(r)), h('td', {}, time(r, 'from')), h('td', {}, time(r, 'to')), h('td', {}, num(r, 'min')),
        h('td', {}, h('button', { class: 'btn quiet', onClick: () => { c.coverage.splice(i, 1); rerender(); } }, 'Löschen')))))),
    h('button', { class: 'btn', onClick: () => { c.coverage.push({ id: uid('cv'), weekdays: [1, 2, 3, 4, 5], from: '14:00', to: '20:00', min: 1 }); rerender(); } }, 'Zeitfenster hinzufügen'),
    h('h3', {}, 'An einigen Tagen pro Woche'),
    h('p', { class: 'hint' }, 'Zum Beispiel: an 1 Tag pro Woche ist jemand bis 21:00 da (Tag frei wählbar).'),
    h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ['Wochentage', 'von', 'bis', 'mind. Personen', 'Tage pro Woche', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, c.weeklyCoverage.map((r, i) => h('tr', {},
        h('td', { class: 'nowrap' }, dayChecks(r)), h('td', {}, time(r, 'from')), h('td', {}, time(r, 'to')), h('td', {}, num(r, 'min')), h('td', {}, num(r, 'days')),
        h('td', {}, h('button', { class: 'btn quiet', onClick: () => { c.weeklyCoverage.splice(i, 1); rerender(); } }, 'Löschen')))))),
    h('button', { class: 'btn', onClick: () => { c.weeklyCoverage.push({ id: uid('wc'), weekdays: [1, 2, 3, 4, 5], from: '20:00', to: '21:00', min: 1, days: 1 }); rerender(); } }, 'Regel hinzufügen'));

  const wd = c.weekendDuty;
  const weekend = h('div', { class: 'card' },
    h('h2', {}, 'Wochenende'),
    h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Wochenendtage'), dayChecks(c, 'weekendDays', [6, 0])),
    h('div', { class: 'formgrid' },
      labelled('Wochenenddienste je Person und Monat', num(wd, 'perMonth')),
      labelled('Länge eines Wochenenddienstes (Std.)', num(wd, 'hours', { step: '0.5' })),
      labelled('Möglichst enden bis', time(wd, 'avoidAfter')),
      labelled('Höchstens so viele Wochenenden im Monat ohne Dienst', num(c, 'maxEmptyWeekends'))),
    h('p', { class: 'hint' }, 'Wochenenddienste zählen zu den Wochenstunden. Wer an einem Wochenendtag „möchte arbeiten“ einträgt, wird dort bevorzugt.'));

  const rules = h('div', { class: 'card' },
    h('h2', {}, 'Weitere Regeln'),
    h('div', { class: 'row' }, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: c.lateRule.on, onChange: (e) => { c.lateRule.on = e.target.checked; save(); } }), 'Nach spätem Dienst am Folgetag nicht früh')),
    h('div', { class: 'formgrid' },
      labelled('Spät = Dienstende nach', time(c.lateRule, 'endAfter')),
      labelled('Folgetag frühestens ab', time(c.lateRule, 'nextFrom')),
      labelled('Dienste nur für einen Termin je Person und Monat (höchstens)', num(c, 'appointmentOnlyMax')),
      labelled('Monate Vorgeschichte für den Ausgleich', num(c, 'balanceHistoryMonths'))),
    h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Gleichmäßig verteilen:'), dayChecks(c, 'balanceWeekdays')),
    h('p', { class: 'hint' }, 'Dienste an diesen Wochentagen (z. B. Freitag) werden über die Personen gleich verteilt, auch über die Vormonate.'));

  const align = h('div', { class: 'card' },
    h('h2', {}, 'Gleichzeitiger Beginn oder Ende'),
    h('p', { class: 'hint' }, 'Wenn an einem Tag mehrere Personen am Vormittag oder mehrere am Nachmittag arbeiten, sollen sie möglichst zur selben Zeit beginnen und/oder enden. Weiche Regel (Gewicht unter „Gewichtung“).'),
    h('div', { class: 'formgrid' },
      labelled('Dienste am selben Tag', h('select', { onChange: (e) => { c.align.mode = e.target.value; save(); } },
        [['none', 'keine Vorgabe'], ['start', 'gleichzeitig beginnen'], ['end', 'gleichzeitig enden'], ['either', 'gleichzeitig beginnen oder enden'], ['both', 'gleichzeitig beginnen und enden']].map(([v, l]) => h('option', { value: v, selected: c.align.mode === v }, l)))),
      labelled('Vormittag = Beginn vor', time(c.align, 'split'), 'Dienste, die später beginnen, zählen als Nachmittag. Vormittags- und Nachmittagsdienste werden getrennt verglichen.')));

  const weights = h('div', { class: 'card wide' },
    h('h2', {}, 'Gewichtung'),
    h('p', { class: 'hint' }, 'Wie stark der Generator eine Abweichung bestraft. Höher = wichtiger. „Kann nicht“, Termine, Dienstzeiten und die Regel nach spätem Dienst gelten immer, unabhängig davon.'),
    h('table', { class: 'grid' }, h('tbody', {}, WEIGHT_DEFS.map(([k, label, unit]) => h('tr', {},
      h('td', {}, label), h('td', {}, num(c.weights, k)), h('td', { class: 'hint' }, unit))))),
    h('button', { class: 'btn quiet', onClick: () => { c.weights = defaultWeights(); rerender(); } }, 'Standardwerte'));

  const closed = h('div', { class: 'card' },
    h('h2', {}, 'Geschlossene Tage'),
    h('p', { class: 'hint' }, 'Feiertage, Schließtage: kein Dienst, keine Besetzung nötig, keine Sollstunden.'),
    c.closedDates.map((cd, i) => h('div', { class: 'row' },
      h('input', { type: 'date', value: cd.date, onChange: (e) => { cd.date = e.target.value; save(); } }),
      h('input', { type: 'text', value: cd.note, placeholder: 'Notiz', onChange: (e) => { cd.note = e.target.value; save(); } }),
      h('button', { class: 'btn quiet', onClick: () => { c.closedDates.splice(i, 1); rerender(); } }, 'Entfernen'))),
    h('button', { class: 'btn', onClick: () => { c.closedDates.push({ date: `${s.ui.month}-01`, note: '' }); rerender(); } }, 'Tag hinzufügen'));

  return h('section', { class: 'view setup' }, general, windows, coverage, weekend, align, rules, closed, weights);
}
