// App shell: header, tabs, welcome screen, rendering.
import { h, toast } from './ui-core.js';
import { store, loadState, save } from './store.js';
import { PRESETS } from './model.js';
import { renderPlanView } from './view-plan.js';
import { renderAvailView } from './view-avail.js';
import { renderPeopleView } from './view-people.js';
import { renderSetupView } from './view-setup.js';
import { renderRulesView } from './view-rules.js';
import { renderApptView } from './view-appts.js';
import { renderReportView } from './view-report.js';

// order follows the monthly workflow: enter wishes and appointments, create the plan, check it;
// people, rules and settings change rarely
const TABS = [
  ['plan', 'Plan', renderPlanView],
  ['avail', 'Wünsche', renderAvailView],
  ['appts', 'Termine', renderApptView],
  ['report', 'Auswertung', renderReportView],
  ['people', 'Personen', renderPeopleView, 'rare'],
  ['rules', 'Regeln', renderRulesView, 'rare'],
  ['setup', 'Einstellungen', renderSetupView, 'rare'],
];

function welcome() {
  const s = store.state;
  return h('section', { class: 'view welcome' },
    h('h1', {}, 'Dienstplaner'),
    h('p', { class: 'lead' }, 'Monatlicher Dienstplan mit freien Dienstzeiten: Eine Person trägt Wünsche („kann nicht“), Termine und Regeln ein und erzeugt daraus einen Plan, der Besetzung, Wochenstunden und Ausgleich berücksichtigt. Alles läuft in diesem Browser. Es werden keine Daten übertragen.'),
    h('h2', {}, 'Womit beginnen?'),
    h('div', { class: 'row wrap' }, Object.entries(PRESETS).map(([id, p]) => h('button', { class: 'btn solid', onClick: () => { const b = p.build(); s.config = b.config; s.people = b.people; s.meta.onboarded = true; s.ui.tab = b.people.length ? 'plan' : 'setup'; save(); store.render(); } }, p.label))),
    h('p', { class: 'hint' }, 'Alles lässt sich danach ändern: benötigte Besetzung, Dienstzeiten je Wochentag, Wochenenddienste, Termine, Personen mit Wochenstunden und Dienstlängen, Gewichtung der Regeln.'),
    h('p', { class: 'hint' }, 'Ablauf je Monat: 1. Wünsche und Abwesenheiten eintragen  2. Einzeltermine eintragen  3. Plan erstellen und von Hand nachbessern  4. Bis zum Stichtag drucken oder als Kalenderdatei verschicken.'));
}

export function render() {
  const root = document.getElementById('app');
  const y = window.scrollY;
  const s = store.state;
  if (s.ui.tab === 'data') s.ui.tab = 'setup'; // tab "Daten" merged into "Einstellungen" (0.4.0)
  const tab = TABS.find((t) => t[0] === s.ui.tab) || TABS[0];
  root.replaceChildren(...[
    h('header', { class: 'top noprint' },
      h('div', { class: 'brand' }, h('span', { class: 'name' }, s.config.title || 'Dienstplaner'), h('span', { class: 'local', title: 'Es werden keine Daten übertragen.' }, 'Nur lokal gespeichert')),
      h('nav', { 'aria-label': 'Bereiche' }, TABS.map(([id, label, , rare]) => h('button', { class: `tab ${id === tab[0] ? 'on' : ''} ${rare === 'rare' && TABS.find((t) => t[3] === 'rare')[0] === id ? 'gap' : ''}`, 'aria-current': id === tab[0] ? 'page' : null, onClick: () => { s.ui.tab = id; save(); render(); } }, label)))),
    store.saveError ? h('div', { class: 'banner noprint' }, store.saveError) : null,
    h('main', {}, !s.meta.onboarded && !s.people.length ? welcome() : tab[2]())].filter(Boolean));
  window.scrollTo(0, y);
}

export function start() {
  loadState();
  store.render = render;
  render();
  window.addEventListener('beforeunload', () => { try { localStorage.setItem('dienstplaner.v1', JSON.stringify(store.state)); } catch (e) { /* ignored: user was warned on failed saves */ } });
}
