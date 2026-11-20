// Rules view ("Regeln"): every rule of the generator as one sentence, grouped and collapsed.
// Each group shows a one-line summary; opening it shows the rules with their settings and an
// importance level (aus / wenig / normal / wichtig / sehr wichtig) instead of raw weights.
// Importance level = weight / default weight (factors 0, 0.3, 1, 3, 10). The exact weights are
// available at the bottom ("Genaue Gewichte").
import { h } from './ui-core.js';
import { store, save } from './store.js';
import { WEIGHT_DEFS, defaultWeights } from './model.js';
import { uid, WEEKDAYS_SHORT } from './util.js';

const RULE_WEEK = [1, 2, 3, 4, 5, 6, 0];
export const LEVELS = [[0, 'aus'], [0.3, 'wenig'], [1, 'normal'], [3, 'wichtig'], [10, 'sehr wichtig']];

/** Index into LEVELS that is closest to the current weight. */
export function levelOf(weights, key) {
  const def = defaultWeights()[key] || 1;
  const w = Number(weights[key]) || 0;
  if (w <= 0) return 0;
  let best = 1;
  for (let i = 1; i < LEVELS.length; i++) if (Math.abs(Math.log(w / def / LEVELS[i][0])) < Math.abs(Math.log(w / def / LEVELS[best][0]))) best = i;
  return best;
}

/** Segmented importance control for one weight key. */
export function importanceControl(key, onChange) {
  const c = store.state.config;
  const cur = levelOf(c.weights, key);
  return h('div', { class: 'levels', role: 'radiogroup', 'aria-label': 'Wichtigkeit' }, LEVELS.map(([f, label], i) => h('button', {
    class: `lv ${i === cur ? 'on' : ''}`, role: 'radio', 'aria-checked': String(i === cur),
    onClick: () => { c.weights[key] = Math.round((defaultWeights()[key] || 1) * f * 10) / 10; save(); (onChange || store.render)(); },
  }, label)));
}

const always = () => h('span', { class: 'always' }, 'gilt immer');

export function renderRulesView() {
  const s = store.state;
  const c = s.config;
  if (!s.ui.rulesOpen) s.ui.rulesOpen = {};
  const open = s.ui.rulesOpen;
  const rerender = () => { save(); store.render(); };
  const time = (obj, f) => h('input', { type: 'time', step: '1800', value: obj[f], onChange: (e) => { obj[f] = e.target.value; rerender(); } });
  const num = (obj, f, extra = {}) => h('input', { type: 'number', class: 'tiny', min: '0', value: obj[f], onChange: (e) => { obj[f] = Number(e.target.value) || 0; rerender(); }, ...extra });
  const days = (obj, f, order = RULE_WEEK) => h('span', { class: 'daypick' }, order.map((wd) => h('label', { class: `dp ${obj[f].includes(wd) ? 'on' : ''}` },
    h('input', { type: 'checkbox', checked: obj[f].includes(wd), onChange: (e) => { obj[f] = e.target.checked ? [...new Set([...obj[f], wd])] : obj[f].filter((x) => x !== wd); rerender(); } }), WEEKDAYS_SHORT[wd])));
  const dayText = (list) => {
    const sorted = RULE_WEEK.filter((d) => list.includes(d));
    if (sorted.length >= 3 && RULE_WEEK.indexOf(sorted[sorted.length - 1]) - RULE_WEEK.indexOf(sorted[0]) === sorted.length - 1) return `${WEEKDAYS_SHORT[sorted[0]]}–${WEEKDAYS_SHORT[sorted[sorted.length - 1]]}`;
    return sorted.map((d) => WEEKDAYS_SHORT[d]).join(', ') || 'keine Tage';
  };
  const rule = (text, key, extra = null) => h('div', { class: 'rule' },
    h('div', { class: 'rtext' }, text, extra),
    key === 'hard' ? always() : key ? importanceControl(key) : h('span', { class: 'always' }, 'aus'));

  const groups = [
    {
      id: 'cover', title: 'Besetzung',
      summary: [...c.coverage.map((r) => `${dayText(r.weekdays)} ${r.from}–${r.to}`), ...c.weeklyCoverage.map((r) => `${r.days}× pro Woche ${r.from}–${r.to}`)].join(' · ') || 'keine Vorgabe',
      body: () => [
        rule(h('span', {}, 'Zu diesen Zeiten ist mindestens die angegebene Zahl an Personen da:'), 'coverage',
          h('div', { class: 'sub' }, c.coverage.map((r, i) => h('div', { class: 'row' }, days(r, 'weekdays'), time(r, 'from'), '–', time(r, 'to'), 'mind.', num(r, 'min'), 'Person(en)',
            h('button', { class: 'btn quiet', onClick: () => { c.coverage.splice(i, 1); rerender(); } }, 'entfernen'))),
          h('button', { class: 'btn quiet', onClick: () => { c.coverage.push({ id: uid('cv'), weekdays: [1, 2, 3, 4, 5], from: '14:00', to: '20:00', min: 1 }); rerender(); } }, '+ Zeitfenster'))),
        rule(h('span', {}, 'An einigen Tagen pro Woche (Tag frei wählbar), z. B. einmal bis 21:00:'), 'weeklyCoverage',
          h('div', { class: 'sub' }, c.weeklyCoverage.map((r, i) => h('div', { class: 'row' }, 'an', num(r, 'days'), 'Tag(en) pro Woche', time(r, 'from'), '–', time(r, 'to'), 'mind.', num(r, 'min'), 'Person(en), möglich an', days(r, 'weekdays'),
            h('button', { class: 'btn quiet', onClick: () => { c.weeklyCoverage.splice(i, 1); rerender(); } }, 'entfernen'))),
          h('button', { class: 'btn quiet', onClick: () => { c.weeklyCoverage.push({ id: uid('wc'), weekdays: [1, 2, 3, 4, 5], from: '20:00', to: '21:00', min: 1, days: 1 }); rerender(); } }, '+ Regel'))),
        rule('Dienste möglichst nur dann, wenn Besetzung gebraucht wird (keine leeren Stunden).', 'outside'),
      ],
    },
    {
      id: 'time', title: 'Arbeitszeit',
      summary: `Wochenstunden laut „Personen“ · höchstens ${c.maxDayHours} Std. pro Tag${c.lateRule.on ? ` · nach Dienst bis nach ${c.lateRule.endAfter} am Folgetag ab ${c.lateRule.nextFrom}` : ''}`,
      body: () => [
        rule('Jede Person erreicht ihre Wochenstunden (unter „Personen“; Wochenenddienste zählen mit).', 'hours'),
        rule('Dienste haben die Wunschlänge der Person (unter „Personen“).', 'length'),
        rule(h('span', {}, 'Ein Dienst dauert höchstens ', num(c, 'maxDayHours'), ' Stunden.'), 'hard'),
        rule(h('span', {}, h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: c.lateRule.on, onChange: (e) => { c.lateRule.on = e.target.checked; rerender(); } }), 'Nach einem Dienst, der nach '), time(c.lateRule, 'endAfter'), ' endet, beginnt der Dienst am nächsten Tag frühestens ', time(c.lateRule, 'nextFrom'), '.'), c.lateRule.on ? 'hard' : null),
        rule(h('span', {}, 'Höchstens ', num(c, 'appointmentOnlyMax'), ' Dienst(e) pro Person und Monat, die nur aus einem Termin bestehen.'), 'apptOnly'),
      ],
    },
    {
      id: 'weekend', title: 'Wochenende',
      summary: c.weekendDuty.perMonth ? `je Person ${c.weekendDuty.perMonth}× pro Monat, ${String(c.weekendDuty.hours).replace('.', ',')} Std., möglichst bis ${c.weekendDuty.avoidAfter} · höchstens ${c.maxEmptyWeekends} Wochenende ohne Dienst` : 'keine Wochenenddienste',
      body: () => [
        rule(h('span', {}, 'Jede Person hat ', num(c.weekendDuty, 'perMonth'), ' Wochenenddienst(e) pro Monat, je ', num(c.weekendDuty, 'hours', { step: '0.5' }), ' Stunden. Wochenendtage: ', days(c, 'weekendDays', [6, 0])), 'weekend'),
        rule(h('span', {}, 'Wochenenddienste enden möglichst bis ', time(c.weekendDuty, 'avoidAfter'), '.'), 'weekendLate'),
        rule(h('span', {}, 'Höchstens ', num(c, 'maxEmptyWeekends'), ' Wochenende(n) im Monat ganz ohne Dienst.'), 'emptyWeekend'),
      ],
    },
    {
      id: 'wishes', title: 'Wünsche und Rhythmus',
      summary: '„Kann nicht“ gilt immer · „eher nicht“, Wunschtage, Folgetage, Urlaub nach Wichtigkeit',
      body: () => [
        rule('„Kann nicht“, Abwesenheiten und Termine werden immer eingehalten (unter „Wünsche“ und „Termine“).', 'hard'),
        rule('Zeiten mit „eher nicht“ werden gemieden.', 'rather'),
        rule('Tage mit „möchte arbeiten“ bekommen einen Dienst.', 'want'),
        rule('Wöchentliche Wünsche werden erfüllt (z. B. einmal pro Woche vormittags).', 'weeklyWish'),
        rule('Dienste an den bevorzugten Wochentagen der Person (unter „Personen“).', 'prefDay'),
        rule('Keine Dienste an zwei Tagen hintereinander (für Personen mit „Folgetage vermeiden“).', 'consecutive'),
        rule('Der Tag vor und der Tag nach einem Urlaub bleiben frei, damit der Urlaub länger wird.', 'vacation'),
      ],
    },
    {
      id: 'fair', title: 'Ausgleich',
      summary: `gleich verteilt: ${c.balanceWeekdays.length ? dayText(c.balanceWeekdays) + '-Dienste, ' : ''}späte Dienste, gemeinsame Zeit`,
      body: () => [
        rule(h('span', {}, 'Dienste an diesen Tagen sind gleich verteilt: ', days(c, 'balanceWeekdays'), ' – auch über die letzten ', num(c, 'balanceHistoryMonths'), ' Monate.'), 'balanceDay'),
        rule('Späte Dienste sind gleich verteilt.', 'lateBalance'),
        rule('Alle arbeiten etwa gleich viel Zeit miteinander.', 'pairs'),
        rule(h('span', {}, 'Mehrere Dienste am selben Vormittag oder Nachmittag ',
          h('select', { onChange: (e) => { c.align.mode = e.target.value; rerender(); } },
            [['none', '– keine Vorgabe –'], ['start', 'beginnen gleichzeitig'], ['end', 'enden gleichzeitig'], ['either', 'beginnen oder enden gleichzeitig'], ['both', 'beginnen und enden gleichzeitig']].map(([v, l]) => h('option', { value: v, selected: c.align.mode === v }, l))),
          c.align.mode !== 'none' ? h('span', {}, ' (Vormittag = Beginn vor ', time(c.align, 'split'), ')') : null), c.align.mode === 'none' ? null : 'align'),
      ],
    },
  ];

  const labels = Object.fromEntries(WEIGHT_DEFS.map(([k, l, u]) => [k, [l, u]]));
  return h('section', { class: 'view rules' },
    h('p', { class: 'lead' }, 'Was der Plan erfüllen soll. „Gilt immer“ wird nie gebrochen; alles andere wird nach Wichtigkeit abgewogen, wenn nicht alles gleichzeitig geht.'),
    groups.map((g) => h('details', { class: 'group', open: open[g.id] ? true : null, onToggle: (e) => { open[g.id] = e.target.open; save(); } },
      h('summary', {}, h('span', { class: 'gtitle' }, g.title), h('span', { class: 'gsum' }, g.summary)),
      h('div', { class: 'gbody' }, g.body()))),
    h('details', { class: 'group quietgroup' },
      h('summary', {}, h('span', { class: 'gtitle' }, 'Genaue Gewichte'), h('span', { class: 'gsum' }, 'für Fortgeschrittene')),
      h('div', { class: 'gbody' },
        h('p', { class: 'hint' }, 'Wie stark eine Abweichung zählt (normal = Standardwert). Die Wichtigkeit oben setzt diese Zahlen.'),
        h('table', { class: 'grid' }, h('tbody', {}, Object.keys(defaultWeights()).map((k) => h('tr', {},
          h('td', {}, labels[k]?.[0] || k),
          h('td', {}, h('input', { type: 'number', class: 'narrow', min: '0', value: c.weights[k], onChange: (e) => { c.weights[k] = Number(e.target.value) || 0; rerender(); } })),
          h('td', { class: 'hint' }, labels[k]?.[1] || ''))))),
        h('button', { class: 'btn quiet', onClick: () => { c.weights = defaultWeights(); rerender(); } }, 'Alle auf normal'))));
}
