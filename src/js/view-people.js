// People view: contract hours, duty lengths, preferred weekdays, rhythm.
import { h, confirmModal } from './ui-core.js';
import { store, save } from './store.js';
import { newPerson } from './model.js';
import { WEEKDAYS_SHORT } from './util.js';

const ORDER = [1, 2, 3, 4, 5];

export function renderPeopleView() {
  const s = store.state;
  const num = (obj, field, step = '0.5') => h('input', { type: 'number', min: '0', max: '60', step, value: obj[field], class: 'narrow', onChange: (e) => { obj[field] = Number(e.target.value) || 0; if (obj.maxLen < obj.minLen) obj.maxLen = obj.minLen; save(); store.render(); } });

  const row = (p) => {
    const perWeek = p.prefLen > 0 ? p.weeklyHours / p.prefLen : 0;
    return h('tr', { class: p.active ? '' : 'archived' },
      h('td', {}, h('input', { type: 'text', value: p.name, 'aria-label': 'Name', onChange: (e) => { p.name = e.target.value.trim() || 'Ohne Namen'; save(); } })),
      h('td', {}, num(p, 'weeklyHours')),
      h('td', { class: 'nowrap' }, num(p, 'minLen'), ' – ', num(p, 'maxLen')),
      h('td', {}, num(p, 'prefLen'), h('div', { class: 'hint' }, perWeek ? `≈ ${Math.round(perWeek * 10) / 10} Dienste/Woche` : '')),
      h('td', { class: 'nowrap' }, ORDER.map((wd) => h('label', { class: 'check tight' }, h('input', { type: 'checkbox', checked: p.preferredWeekdays.includes(wd), onChange: (e) => {
        p.preferredWeekdays = e.target.checked ? [...new Set([...p.preferredWeekdays, wd])] : p.preferredWeekdays.filter((x) => x !== wd);
        save();
      } }), WEEKDAYS_SHORT[wd]))),
      h('td', {}, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: p.avoidConsecutive, onChange: (e) => { p.avoidConsecutive = e.target.checked; save(); } }), 'vermeiden')),
      h('td', {}, h('input', { type: 'text', value: p.note, placeholder: 'Notiz', onChange: (e) => { p.note = e.target.value; save(); } })),
      h('td', { class: 'actions' },
        h('button', { class: 'btn quiet', onClick: () => { p.active = !p.active; save(); store.render(); } }, p.active ? 'Archivieren' : 'Reaktivieren'),
        h('button', { class: 'btn quiet', onClick: () => confirmModal('Person löschen', `„${p.name}“ endgültig löschen? Ihre Dienste und Wünsche werden entfernt. Zum Behalten der alten Pläne besser archivieren.`, 'Löschen', () => removePerson(p.id)) }, 'Löschen')));
  };

  return h('section', { class: 'view' },
    h('div', { class: 'toolbar' },
      h('h2', {}, 'Personen'),
      h('button', { class: 'btn solid', onClick: () => { s.people.push(newPerson()); save(); store.render(); } }, 'Person hinzufügen')),
    s.people.length ? h('div', { class: 'tablewrap' }, h('table', { class: 'grid people' },
      h('thead', {}, h('tr', {}, ['Name', 'Std. / Woche', 'Dienstlänge (Std.)', 'Wunschlänge', 'Bevorzugte Tage', 'Folgetage', 'Notiz', ''].map((x) => h('th', {}, x)))),
      h('tbody', {}, s.people.map(row))))
      : h('div', { class: 'empty-state' }, h('p', {}, 'Noch keine Personen angelegt.')),
    h('p', { class: 'hint' }, 'Std. / Woche: vertragliche Wochenstunden; Wochenenddienste zählen mit. Dienstlänge: kürzester und längster Dienst unter der Woche (Termine dürfen ihn verlängern). Bevorzugte Tage sind eine leichte Regel. „Folgetage vermeiden“: Dienste möglichst nicht an zwei Tagen hintereinander. Regelmäßige Einschränkungen (z. B. montags erst ab 15:00) stehen unter „Wünsche“ im Wochenmuster.'));
}

function removePerson(id) {
  const s = store.state;
  s.people = s.people.filter((p) => p.id !== id);
  for (const plan of Object.values(s.plans)) for (const k of Object.keys(plan.duties)) if (k.startsWith(id + '|')) delete plan.duties[k];
  for (const month of Object.values(s.availability)) delete month[id];
  for (const a of s.config.appointments) if (Array.isArray(a.participants)) a.participants = a.participants.filter((x) => x !== id);
  save();
  store.render();
}
