// Persistence. The whole state is one JSON string in the browser's localStorage under one key.
// Nothing leaves the device: there is no network code anywhere in this app (see index.html CSP).
import { newState, normalizeState } from './model.js';

export const STORAGE_KEY = 'dienstplaner.v1';

export const store = {
  state: null,
  listeners: [],
  saveError: null,
};

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    store.state = raw ? normalizeState(JSON.parse(raw)) : newState('blank');
  } catch (e) {
    store.state = newState('blank');
    store.saveError = 'Gespeicherte Daten konnten nicht gelesen werden.';
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  return store.state;
}

let saveTimer = null;
export function saveNow() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store.state));
    store.saveError = null;
  } catch (e) {
    store.saveError = 'Speichern im Browser ist fehlgeschlagen (Speicher voll oder gesperrt). Bitte eine Sicherung herunterladen.';
  }
}
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 150);
}

export function storageBytes() {
  try { return (localStorage.getItem(STORAGE_KEY) || '').length * 2; } catch (e) { return 0; }
}

export function replaceState(next) {
  store.state = normalizeState(next);
  saveNow();
}
