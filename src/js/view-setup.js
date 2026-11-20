// Settings view ("Einstellungen"): general settings, duty times per weekday, closed days, and
// the data section (privacy, backup, templates, erase). Rules and their importance live in the
// rules view (view-rules.js). Groups are collapsed and show a one-line summary.
import { h, labelled } from './ui-core.js';
import { store, save } from './store.js';
import { WEEKDAYS_SHORT, WEEKDAYS_LONG, formatDay } from './util.js';
import { renderDataView } from './view-data.js';

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function renderSetupView() {
  const s = store.state;
  const c = s.config;
  if (!s.ui.setupOpen) s.ui.setupOpen = { windows: true };
  const open = s.ui.setupOpen;
  const rerender = () => { save(); store.render(); };
  const time = (obj, f) => h('input', { type: 'time', step: '1800', value: obj[f], onChange: (e) => { obj[f] = e.target.value; rerender(); } });
  const num = (obj, f, extra = {}) => h('input', { type: 'number', class: 'narrow', min: '0', value: obj[f], onChange: (e) => { obj[f] = Number(e.target.value) || 0; rerender(); }, ...extra });
  const group = (id, title, summary, body) => h('details', { class: 'group', open: open[id] ? true : null, onToggle: (e) => { open[id] = e.target.open; save(); } },
    h('summary', {}, h('span', { class: 'gtitle' }, title), h('span', { class: 'gsum' }, summary)),
    h('div', { class: 'gbody' }, body()));

  const winText = WEEK_ORDER.map((wd) => { const w = c.dayWindows[wd]; return `${WEEKDAYS_SHORT[wd]} ${w.on ? `${w.from}–${w.to}` : 'frei'}`; }).join(' · ');

  return h('section', { class: 'view setup' },
    group('windows', 'Dienstzeiten je Wochentag', winText, () => [
      h('p', { class: 'hint' }, 'In welchem Zeitraum Dienste liegen dürfen (z. B. mittwochs erst ab 12:00 = keine Vormittagsdienste). Termine dürfen außerhalb liegen.'),
      h('table', { class: 'grid' }, h('tbody', {}, WEEK_ORDER.map((wd) => {
        const w = c.dayWindows[wd];
        return h('tr', {}, h('th', {}, WEEKDAYS_LONG[wd]),
          h('td', {}, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: w.on, onChange: (e) => { w.on = e.target.checked; rerender(); } }), 'Dienste möglich')),
          h('td', { class: 'nowrap' }, w.on ? [time(w, 'from'), ' – ', time(w, 'to')] : null));
      })))]),
    group('closed', 'Geschlossene Tage', c.closedDates.length ? c.closedDates.map((cd) => cd.date ? formatDay(cd.date) : '?').join(', ') : 'keine', () => [
      h('p', { class: 'hint' }, 'Feiertage, Schließtage: kein Dienst, keine Besetzung nötig, keine Sollstunden.'),
      c.closedDates.map((cd, i) => h('div', { class: 'row' },
        h('input', { type: 'date', value: cd.date, onChange: (e) => { cd.date = e.target.value; rerender(); } }),
        h('input', { type: 'text', value: cd.note, placeholder: 'Notiz', onChange: (e) => { cd.note = e.target.value; save(); } }),
        h('button', { class: 'btn quiet', onClick: () => { c.closedDates.splice(i, 1); rerender(); } }, 'entfernen'))),
      h('button', { class: 'btn quiet', onClick: () => { c.closedDates.push({ date: `${s.ui.month}-01`, note: '' }); rerender(); } }, '+ Tag')]),
    group('general', 'Allgemein', `${c.title} · Abgabe am ${c.deadlineDay}. des Vormonats · Anzeige ${c.viewFrom}–${c.viewTo}`, () =>
      h('div', { class: 'formgrid' },
        labelled('Titel des Plans', h('input', { type: 'text', value: c.title, onChange: (e) => { c.title = e.target.value; rerender(); } })),
        labelled('Abgabe am … des Vormonats', num(c, 'deadlineDay', { max: '28' })),
        labelled('Woche beginnt am', h('select', { onChange: (e) => { c.weekStart = Number(e.target.value); rerender(); } }, [1, 0].map((d) => h('option', { value: d, selected: c.weekStart === d }, WEEKDAYS_LONG[d])))),
        labelled('Anzeige von', time(c, 'viewFrom'), 'Dienste außerhalb werden trotzdem gezeigt.'),
        labelled('Anzeige bis', time(c, 'viewTo')))),
    group('data', 'Daten und Datenschutz', 'Nur in diesem Browser gespeichert · Sicherung · Vorlagen · alles löschen', () => renderDataView()));
}
