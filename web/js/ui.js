// Tiny DOM helpers.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function toast(msg, bad = false, ms = 3500) {
  const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

export function dialog({ title, body, actions = [{ label: 'Close', value: null }] }) {
  return new Promise((resolve) => {
    const d = h('dialog', {},
      h('h2', {}, title),
      typeof body === 'string' ? h('p', {}, body) : body,
      h('div', { class: 'row' }, actions.map((a) => h('button', {
        class: 'btn ' + (a.kind || ''), onclick: () => { d.close(); resolve(a.value); },
      }, a.label))));
    d.addEventListener('close', () => { d.remove(); resolve(null); });
    document.body.append(d);
    d.showModal();
  });
}

export const confirmBox = (title, body, okLabel = 'Continue', kind = 'primary') =>
  dialog({ title, body, actions: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, kind }] });

export function fmtDate(ts, withTime = false) {
  if (!ts) return '';
  const d = new Date(ts);
  return withTime ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function money(v) {
  if (v === '' || v === null || v === undefined || isNaN(+v)) return '—';
  return (+v).toLocaleString(undefined, { style: 'currency', currency: 'EUR' });
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Swatch colours for official DualSense finishes.
export const COLOR_HEX = {
  'White': '#f4f5f7', 'Midnight Black': '#1d1f24', 'Cosmic Red': '#a3152a', 'Nova Pink': '#f2a9c4',
  'Galactic Purple': '#5b3c9e', 'Starlight Blue': '#9cc3ea', 'Grey Camouflage': '#8a8f94',
  'Volcanic Red': '#c0272d', 'Sterling Silver': '#c4c8cc', 'Cobalt Blue': '#1f4fa8',
  'Chroma Teal': '#3fb7b0', 'Chroma Indigo': '#3b3f9e', 'Chroma Pearl': '#e9e4dc',
  'HyperPop Techno Red': '#e8323c', 'HyperPop Remix Green': '#6fd36a', 'HyperPop Rhythm Blue': '#3a7bf2',
};
export const swatch = (name) => h('span', { class: 'swatch', style: { background: COLOR_HEX[name] || 'linear-gradient(135deg,#ddd,#888)' } });

// replaceChildren that accepts nested arrays and skips null/false.
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
  return el;
}
