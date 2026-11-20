// Tiny DOM helpers: element builder, modal, toast, file download.

/** h('div', {class:'x', onClick: fn}, child, [children], 'text') */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'value') value = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open') el[k] = true;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const append = (k) => {
    if (k == null || k === false) return;
    if (Array.isArray(k)) k.forEach(append);
    else el.append(k.nodeType ? k : document.createTextNode(String(k)));
  };
  kids.forEach(append);
  if (value !== undefined) el.value = value;
  return el;
}

export function downloadFile(filename, text, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: mime + ';charset=utf-8' }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function toast(message) {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: 'toast' }, message);
  box.append(t);
  setTimeout(() => t.remove(), 4200);
}

/** Opens a modal. `build(close)` returns the content node. Returns close(). */
export function openModal(title, build, opts = {}) {
  const back = h('div', { class: 'modal-back' });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); if (opts.onClose) opts.onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'btn quiet', onClick: close, 'aria-label': 'Schließen' }, '×')),
    h('div', { class: 'modal-body' }, build(close)));
  back.append(box);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  return close;
}

export function confirmModal(title, text, okLabel, onOk) {
  openModal(title, (close) => h('div', {},
    h('p', {}, text),
    h('div', { class: 'row end' },
      h('button', { class: 'btn', onClick: close }, 'Abbrechen'),
      h('button', { class: 'btn solid', onClick: () => { close(); onOk(); } }, okLabel))));
}

export function labelled(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
}

export function monthNav(label, onPrev, onNext) {
  return h('div', { class: 'monthnav' },
    h('button', { class: 'btn', onClick: onPrev, 'aria-label': 'Vorheriger Monat' }, '‹'),
    h('strong', { class: 'monthlabel' }, label),
    h('button', { class: 'btn', onClick: onNext, 'aria-label': 'Nächster Monat' }, '›'));
}
