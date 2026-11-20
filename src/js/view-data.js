// Data view: backup, restore, presets, erase, and the privacy statement.
import { h, downloadFile, toast, confirmModal } from './ui-core.js';
import { store, save, saveNow, storageBytes, replaceState } from './store.js';
import { normalizeState } from './model.js';
import { PRESETS } from './model.js';
import { pad2 } from './util.js';

export function renderDataView() {
  const s = store.state;
  const kb = Math.max(1, Math.round(storageBytes() / 1024));
  const now = new Date();
  const stamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden', onChange: (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const next = JSON.parse(String(rd.result));
        if (!next || typeof next !== 'object' || !next.config) throw new Error('kein Dienstplaner-Datei');
        confirmModal('Sicherung einspielen', 'Alle aktuellen Daten in diesem Browser werden durch den Inhalt der Datei ersetzt.', 'Einspielen', () => { replaceState(next); toast('Sicherung eingespielt.'); store.render(); });
      } catch (err) { toast('Die Datei konnte nicht gelesen werden.'); }
    };
    rd.readAsText(f);
    e.target.value = '';
  } });

  return h('div', { class: 'data' },
    h('div', { class: 'card wide privacy' },
      h('h2', {}, 'Datenschutz'),
      h('ul', { class: 'plain' },
        h('li', {}, 'Alle Eingaben bleiben in diesem Browser auf diesem Gerät (localStorage). Es gibt keinen Server, kein Konto, keine Statistik.'),
        h('li', {}, 'Die Seite sendet technisch nichts ins Netz: Eine Sicherheitsrichtlinie (Content-Security-Policy) im Dokumentkopf verbietet jede Verbindung nach außen, es werden keine Schriften, Skripte oder Bilder von anderen Adressen geladen.'),
        h('li', {}, 'Wer dieses Gerät und dieses Browserprofil nutzen kann, sieht die Daten. Bei geteilten Geräten ein eigenes Browserprofil verwenden und die Festplatte verschlüsseln.'),
        h('li', {}, 'Löscht man Browserdaten oder wechselt das Gerät, sind die Daten weg. Deshalb regelmäßig eine Sicherung herunterladen und sicher aufbewahren (sie enthält Klarnamen).'))),
    h('div', { class: 'card' },
      h('h2', {}, 'Sicherung'),
      h('p', { class: 'hint' }, `Belegter Speicher: ca. ${kb} KB.`),
      h('div', { class: 'row' },
        h('button', { class: 'btn solid', onClick: () => downloadFile(`dienstplaner-sicherung-${stamp}.json`, JSON.stringify(s, null, 1), 'application/json') }, 'Sicherung herunterladen'),
        h('button', { class: 'btn', onClick: () => fileInput.click() }, 'Sicherung einspielen'), fileInput)),
    h('div', { class: 'card' },
      h('h2', {}, 'Vorlagen'),
      h('p', { class: 'hint' }, 'Eine Vorlage ersetzt Regeln, Einstellungen, Termine und (falls die Vorlage Personen enthält) die Personen. Pläne und Wünsche bleiben.'),
      h('div', { class: 'row wrap' }, Object.entries(PRESETS).map(([id, p]) => h('button', { class: 'btn', onClick: () => confirmModal('Vorlage anwenden', `„${p.label}“ ersetzt Regeln, Einstellungen und Termine${p.build().people.length ? ' sowie die Personen' : ''}.`, 'Anwenden', () => {
        const built = p.build();
        s.config = built.config;
        if (built.people.length) s.people = built.people;
        s.meta.onboarded = true;
        save();
        store.render();
      }) }, p.label)))),
    h('div', { class: 'card' },
      h('h2', {}, 'Alles löschen'),
      h('p', { class: 'hint' }, 'Entfernt alle Daten aus diesem Browser. Vorher eine Sicherung herunterladen.'),
      h('button', { class: 'btn danger', onClick: () => confirmModal('Alles löschen', 'Alle Personen, Eingaben und Pläne werden unwiderruflich gelöscht.', 'Endgültig löschen', () => { store.state = normalizeState({ version: 2 }); store.state.meta.onboarded = false; saveNow(); toast('Alle Daten gelöscht.'); store.render(); }) }, 'Alle Daten löschen')));
}
