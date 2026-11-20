// Appointments view: weekly and one-off appointments.
// Every participant's duty on that day must contain the appointment (one block, no second trip).
import { h } from './ui-core.js';
import { store, save } from './store.js';
import { uid, WEEKDAYS_LONG, formatDay, formatMonth } from './util.js';

export function renderApptView() {
  const s = store.state;
  const c = s.config;
  const people = s.people.filter((p) => p.active);
  const rerender = () => { save(); store.render(); };
  const field = (a, f, type) => h('input', { type, step: type === 'time' ? '1800' : null, value: a[f], placeholder: f === 'title' ? 'Bezeichnung' : null, onChange: (e) => { a[f] = e.target.value; rerender(); } });
  const participants = (a) => h('div', { class: 'row wrap' },
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: a.participants === 'all', onChange: (e) => { a.participants = e.target.checked ? 'all' : []; rerender(); } }), 'alle'),
    a.participants === 'all' ? null : people.map((p) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: a.participants.includes(p.id), onChange: (e) => {
      a.participants = e.target.checked ? [...a.participants, p.id] : a.participants.filter((x) => x !== p.id);
      rerender();
    } }), p.name)));
  const remove = (a) => h('button', { class: 'btn quiet', onClick: () => { c.appointments = c.appointments.filter((x) => x !== a); rerender(); } }, 'Löschen');

  const weekly = c.appointments.filter((a) => a.repeat === 'weekly');
  const once = c.appointments.filter((a) => a.repeat !== 'weekly').sort((a, b) => (a.date + a.from).localeCompare(b.date + b.from));
  const month = s.ui.month;

  return h('section', { class: 'view' },
    h('h2', {}, 'Wöchentliche Termine'),
    h('p', { class: 'hint' }, 'Termine, die jede Woche am selben Tag stattfinden. Der Dienst aller Teilnehmenden an diesem Tag schließt den Termin ein und zählt als Arbeitszeit.'),
    h('div', { class: 'tablewrap' }, h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ['Bezeichnung', 'Wochentag', 'von', 'bis', 'Teilnehmende', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, weekly.map((a) => h('tr', {},
        h('td', {}, field(a, 'title', 'text')),
        h('td', {}, h('select', { onChange: (e) => { a.weekday = Number(e.target.value); rerender(); } }, [1, 2, 3, 4, 5, 6, 0].map((d) => h('option', { value: d, selected: Number(a.weekday) === d }, WEEKDAYS_LONG[d])))),
        h('td', {}, field(a, 'from', 'time')), h('td', {}, field(a, 'to', 'time')),
        h('td', {}, participants(a)), h('td', {}, remove(a))))))),
    h('button', { class: 'btn', onClick: () => { c.appointments.push({ id: uid('ap'), title: '', repeat: 'weekly', weekday: 1, date: '', from: '14:00', to: '15:00', participants: 'all' }); rerender(); } }, 'Wöchentlichen Termin hinzufügen'),

    h('h2', {}, 'Einzeltermine'),
    h('p', { class: 'hint' }, 'Termine an einem bestimmten Datum. Die gewählten Personen haben an dem Tag einen zusammenhängenden Dienst, der den Termin enthält.'),
    h('div', { class: 'tablewrap' }, h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ['Bezeichnung', 'Datum', 'von', 'bis', 'Teilnehmende', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, once.map((a) => h('tr', { class: a.date && a.date.startsWith(month) ? '' : 'archived' },
        h('td', {}, field(a, 'title', 'text')),
        h('td', {}, field(a, 'date', 'date'), a.date ? h('div', { class: 'hint' }, formatDay(a.date)) : null),
        h('td', {}, field(a, 'from', 'time')), h('td', {}, field(a, 'to', 'time')),
        h('td', {}, participants(a)), h('td', {}, remove(a))))))),
    h('button', { class: 'btn', onClick: () => { c.appointments.push({ id: uid('ap'), title: '', repeat: 'once', weekday: 1, date: `${month}-01`, from: '14:00', to: '15:00', participants: people[0] ? [people[0].id] : [] }); rerender(); } }, `Einzeltermin hinzufügen (${formatMonth(month)})`));
}
