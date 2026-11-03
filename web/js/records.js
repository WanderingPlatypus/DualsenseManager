import { COMPONENT_GROUPS, STATUS, GRADES, SALE_STATUS, COSMETIC_TAGS, DIRT_TAGS, FAULT_TAGS, emptyRecord, uid } from './schema.js';
import { COLOR_CODES } from './ds5.js';
import { allRecords, getRecord, saveRecord, deleteRecord } from './store.js';
import { h, $, $$, toast, confirmBox, dialog, fmtDate, money, debounce, swatch, fill } from './ui.js';

const saleLabel = Object.fromEntries(SALE_STATUS);
const faultCount = (r) => Math.max(Object.values(r.components || {}).filter((v) => v === "faulty").length, (r.faults || []).length);

// ===================== list =====================
let listState = { q: '', status: 'all', grade: 'all' };

export async function renderList(root) {
  const all = (await allRecords()).sort((a, b) => (b.lastSeen || b.updatedAt) - (a.lastSeen || a.updatedAt));
  const search = h('input', { type: 'search', placeholder: 'Search serial, color, notes, faults…', value: listState.q, 'aria-label': 'Search controllers' });
  const body = h('tbody');
  const stats = h('div', { class: 'stats' });
  const filters = h('div', { class: 'filters' });

  const match = (r) => {
    const q = listState.q.trim().toLowerCase();
    if (listState.status !== 'all' && (r.sale?.status || 'testing') !== listState.status) return false;
    if (listState.grade !== 'all' && (r.grade || '') !== listState.grade) return false;
    if (!q) return true;
    const hay = [r.serial, r.mac, r.color, r.colorCustom, r.model, r.notes, r.location, r.cosmeticNotes, r.dirtNotes, r.faultNotes,
      ...(r.faults || []), ...(r.cosmetic || []), ...(r.dirt || []), ...(r.tags || []), r.sale?.buyer, r.sale?.platform, r.sale?.source].join(' ').toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  };

  const draw = () => {
    const rows = all.filter(match);
    const sold = all.filter((r) => r.sale?.status === 'sold');
    const profit = sold.reduce((s, r) => s + ((+r.sale.salePrice || 0) - (+r.sale.purchasePrice || 0)), 0);
    fill(stats,
      stat(all.length, 'controllers'),
      stat(all.filter((r) => !['sold', 'parts', 'keeping'].includes(r.sale?.status)).length, 'in stock'),
      stat(sold.length, 'sold'),
      stat(money(profit), 'profit on sold'));
    fill(filters,
      chipBtn('All', listState.status === 'all', () => { listState.status = 'all'; draw(); }),
      SALE_STATUS.map(([v, l]) => chipBtn(`${l} ${all.filter((r) => (r.sale?.status || 'testing') === v).length || ''}`.trim(), listState.status === v, () => { listState.status = v; draw(); })),
      h('span', { style: { width: '12px' } }),
      chipBtn('Any grade', listState.grade === 'all', () => { listState.grade = 'all'; draw(); }),
      GRADES.map(([g]) => chipBtn(g, listState.grade === g, () => { listState.grade = g; draw(); })));
    fill(body, ...rows.map((r) => {
      const color = r.colorCustom || r.color;
      const fc = faultCount(r);
      const tested = (r.tests || []).at(-1)?.date;
      return h('tr', { tabindex: 0, onclick: () => { location.hash = '#/c/' + encodeURIComponent(r.serial); }, onkeydown: (e) => { if (e.key === 'Enter') location.hash = '#/c/' + encodeURIComponent(r.serial); } },
        h('td', {}, h('div', { class: 'ser' }, r.serial), h('div', { class: 'muted small' }, r.model)),
        h('td', {}, h('span', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } }, color ? swatch(r.color) : null, color || '—')),
        h('td', {}, r.grade ? h('span', { class: 'grade' }, r.grade) : h('span', { class: 'muted' }, '—')),
        h('td', {}, h('span', { class: 'status', 'data-s': r.sale?.status }, saleLabel[r.sale?.status || 'testing'])),
        h('td', { class: 'hide-sm' }, fc ? h('span', { class: 'faultcount' }, fc + (fc === 1 ? ' fault' : ' faults')) : h('span', { class: 'muted' }, 'none noted')),
        h('td', { class: 'hide-sm muted' }, tested ? fmtDate(tested) : 'never'),
        h('td', { class: 'hide-sm num' }, r.sale?.status === 'sold' ? money(r.sale.salePrice) : r.sale?.salePrice ? h('span', { class: 'muted' }, money(r.sale.salePrice)) : ''));
    }));
    if (!rows.length) body.append(h('tr', {}, h('td', { colspan: 7, class: 'empty' }, all.length ? 'No controller matches. Clear the search or filters.' : 'No controllers yet. Plug one in on the Test tab, or add one by serial number.')));
  };
  search.addEventListener('input', () => { listState.q = search.value; draw(); });

  const addBtn = h('button', { class: 'btn', onclick: addManual }, 'Add by serial');
  fill(root,
    h('div', { class: 'db-head' },
      h('div', {}, h('h1', { style: { marginBottom: '14px' } }, 'Controllers'), stats),
      h('div', { class: 'row' }, addBtn, h('button', { class: 'btn', onclick: () => exportCsv(all) }, 'Export CSV'))),
    h('div', { class: 'row' }, h('label', { class: 'search' },
      h('span', { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' }), search)),
    filters,
    h('div', { class: 'panel', style: { padding: '6px 10px', overflowX: 'auto' } },
      h('table', { class: 'list' }, h('thead', {}, h('tr', {},
        ['Serial', 'Color', 'Grade', 'Status'].map((t) => h('th', {}, t)),
        ['Faults', 'Last tested', 'Price'].map((t) => h('th', { class: 'hide-sm' }, t)))), body)));
  draw();
  search.focus();
}

const stat = (v, l) => h('div', { class: 'stat' }, h('b', { class: 'num' }, v), h('span', {}, l));
const chipBtn = (label, on, fn) => h('button', { class: 'tag', 'aria-pressed': String(on), onclick: fn }, label);

async function addManual() {
  const inp = h('input', { type: 'text', placeholder: 'Serial number', autocomplete: 'off' });
  const ok = await dialog({ title: 'Add a controller', body: h('div', { class: 'stack' }, h('p', { class: 'muted', style: { margin: 0 } }, 'Use the serial printed on the box or read over USB.'), inp), actions: [{ label: 'Cancel', value: false }, { label: 'Add', value: true, kind: 'primary' }] });
  const serial = inp.value.trim().toUpperCase();
  if (!ok || !serial) return;
  if (!(await getRecord(serial))) {
    const r = emptyRecord(serial);
    r.color = COLOR_CODES[serial.slice(4, 6)] || '';
    await saveRecord(r);
  }
  location.hash = '#/c/' + encodeURIComponent(serial);
}

function csvCell(v) { const s = v === null || v === undefined ? '' : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
export function exportCsv(list) {
  const keys = COMPONENT_GROUPS.flatMap((g) => g.items);
  const head = ['serial', 'model', 'color', 'grade', 'status', 'purchase_price', 'purchase_date', 'source', 'sale_price', 'sale_date', 'platform', 'buyer',
    'cosmetic', 'dirt', 'faults', 'notes', 'location', 'mac', 'board', 'firmware', 'tests', 'last_tested', ...keys.map(([k]) => k)];
  const rows = list.map((r) => [r.serial, r.model, r.colorCustom || r.color, r.grade, r.sale?.status, r.sale?.purchasePrice, r.sale?.purchaseDate, r.sale?.source,
    r.sale?.salePrice, r.sale?.saleDate, r.sale?.platform, r.sale?.buyer, [...(r.cosmetic || []), r.cosmeticNotes].filter(Boolean).join(' | '),
    [...(r.dirt || []), r.dirtNotes].filter(Boolean).join(' | '), [...(r.faults || []), r.faultNotes].filter(Boolean).join(' | '),
    r.notes, r.location, r.mac, r.board, r.fwBuildDate, (r.tests || []).length, fmtDate((r.tests || []).at(-1)?.date),
    ...keys.map(([k]) => r.components?.[k] || '')]);
  const csv = '﻿' + [head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  download(new Blob([csv], { type: 'text/csv' }), `padbench-${new Date().toISOString().slice(0, 10)}.csv`);
}
export function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ===================== editor =====================
export async function renderRecord(root, serial) {
  let rec = await getRecord(serial);
  if (!rec) {
    fill(root, h('div', { class: 'empty' }, h('h2', {}, `No controller with serial ${serial}`), h('p', {}, h('a', { href: '#/db' }, 'Back to the list'))));
    return;
  }
  const persist = debounce(async () => { rec = await saveRecord(rec, { quiet: true }); }, 400);
  const set = (path, v) => {
    const parts = path.split('.');
    let o = rec;
    while (parts.length > 1) { const p = parts.shift(); o[p] = o[p] || {}; o = o[p]; }
    o[parts[0]] = v;
    persist();
  };
  const text = (path, label, attrs = {}) => {
    const val = path.split('.').reduce((o, k) => o?.[k], rec) ?? '';
    const tag = attrs.multiline ? 'textarea' : 'input';
    const el = h(tag, { type: attrs.type || 'text', placeholder: attrs.placeholder || '', step: attrs.step });
    el.value = val;
    el.addEventListener('input', () => { set(path, el.value); if (attrs.after) attrs.after(); });
    return h('label', { class: 'field' + (attrs.full ? ' full' : '') }, h('span', {}, label), el);
  };
  const tagGroup = (key, tags, cls) => {
    const sel = new Set(rec[key] || []);
    const extra = [...sel].filter((t) => !tags.includes(t));
    return h('div', { class: 'tags' }, [...tags, ...extra].map((t) => h('button', { class: 'tag ' + cls, 'aria-pressed': String(sel.has(t)), onclick: (e) => {
      sel.has(t) ? sel.delete(t) : sel.add(t);
      e.currentTarget.setAttribute('aria-pressed', String(sel.has(t)));
      rec[key] = [...sel]; persist();
    } }, t)), h('button', { class: 'tag', onclick: async (e) => {
      const inp = h('input', { type: 'text', placeholder: 'Describe it' });
      if (await dialog({ title: 'Add your own', body: inp, actions: [{ label: 'Cancel', value: false }, { label: 'Add', value: true, kind: 'primary' }] }) && inp.value.trim()) {
        sel.add(inp.value.trim()); rec[key] = [...sel]; persist();
        e.currentTarget.parentNode.replaceWith(tagGroup(key, tags, cls));
      }
    } }, '+ Other'));
  };

  // ---- header ----
  const color = rec.colorCustom || rec.color;
  const head = h('div', { class: 'rec-head' },
    h('div', {},
      h('div', { class: 'muted small', style: { marginBottom: '6px' } }, h('a', { href: '#/db' }, 'Controllers')),
      h('div', { class: 'serial' }, rec.serial),
      h('div', { class: 'row muted', style: { marginTop: '8px' } }, color ? swatch(rec.color) : null, [rec.model, color].filter(Boolean).join(', '),
        rec.clone ? h('span', { class: 'chip warn' }, 'Likely clone') : null,
        h('span', { class: 'small' }, `Added ${fmtDate(rec.createdAt)}`))),
    h('div', { class: 'row' },
      h('button', { class: 'btn danger', onclick: async () => {
        if (await confirmBox('Delete this controller?', `${rec.serial} and its whole history will be removed from every synced device.`, 'Delete', 'danger')) {
          await deleteRecord(rec.serial); toast('Deleted ' + rec.serial); location.hash = '#/db';
        }
      } }, 'Delete')));

  // ---- sale ----
  const profitEl = h('div', { class: 'profit num' });
  const updProfit = () => {
    const p = (+rec.sale?.salePrice || 0) - (+rec.sale?.purchasePrice || 0);
    const has = rec.sale?.salePrice !== '' && rec.sale?.salePrice !== undefined && rec.sale?.purchasePrice !== '' && rec.sale?.purchasePrice !== undefined;
    profitEl.textContent = has ? money(p) : '—';
    profitEl.className = 'profit num ' + (has ? (p < 0 ? 'neg' : 'pos') : '');
  };
  updProfit();
  const statusSel = h('select', { onchange: (e) => {
    set('sale.status', e.target.value);
    if (e.target.value === 'sold' && !rec.sale.saleDate) { set('sale.saleDate', new Date().toISOString().slice(0, 10)); renderRecord(root, serial); }
  } }, SALE_STATUS.map(([v, l]) => h('option', { value: v, selected: (rec.sale?.status || 'testing') === v }, l)));
  const sale = h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Sale'), h('div', { style: { textAlign: 'right' } }, profitEl, h('div', { class: 'muted small' }, 'profit'))),
    h('div', { class: 'form-grid' },
      h('label', { class: 'field full' }, h('span', {}, 'Status'), statusSel),
      text('sale.purchasePrice', 'Bought for (€)', { type: 'number', step: '0.01', after: updProfit }),
      text('sale.purchaseDate', 'Bought on', { type: 'date' }),
      text('sale.source', 'Bought from', { placeholder: 'Leboncoin, lot, friend…', full: true }),
      text('sale.salePrice', 'Sold / asking price (€)', { type: 'number', step: '0.01', after: updProfit }),
      text('sale.saleDate', 'Sold on', { type: 'date' }),
      text('sale.platform', 'Platform', { placeholder: 'Vinted, eBay, Leboncoin…' }),
      text('sale.buyer', 'Buyer'),
      text('sale.listingUrl', 'Listing link', { type: 'url', full: true }),
      text('location', 'Where it is', { placeholder: 'Shelf, box, drawer…', full: true })));

  // ---- condition ----
  const gradeBtns = h('div', { class: 'grades' }, GRADES.map(([g, label]) => h('button', { title: label, 'aria-pressed': String(rec.grade === g), onclick: (e) => {
    rec.grade = rec.grade === g ? '' : g; persist();
    $$('button', e.currentTarget.parentNode).forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === rec.grade)));
  } }, g)));
  const groups = COMPONENT_GROUPS.filter((g) => !g.edge || /edge/i.test(rec.model));
  const compGrid = h('div', {}, groups.map((g) => h('div', { class: 'group' },
    h('div', { class: 'group-head' }, h('h3', {}, g.name)),
    g.items.map(([k, label]) => {
      const mark = h('span', { class: 'mark', 'data-s': rec.components?.[k] || '' });
      const seg = h('div', { class: 'seg' }, [['ok', 'OK'], ['minor', 'Issue'], ['faulty', 'Faulty']].map(([v, l]) => h('button', { 'data-v': v, 'aria-pressed': String(rec.components?.[k] === v), onclick: (e) => {
        rec.components = rec.components || {};
        rec.components[k] = rec.components[k] === v ? 'untested' : v;
        $$('button', e.currentTarget.parentNode).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === rec.components[k])));
        mark.dataset.s = rec.components[k]; persist();
      } }, l)));
      return h('div', { class: 'item' }, h('div', { class: 'name' }, mark, label), seg);
    }))));
  const condition = h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'What works'), h('span', { class: 'muted small' }, 'Filled in by saved test sessions; change anything by hand')),
    h('div', { class: 'field', style: { marginBottom: '12px' } }, h('span', {}, 'Overall grade'), gradeBtns),
    compGrid);

  const cosmetic = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Cosmetic defects')),
    h('div', { class: 'stack' }, tagGroup('cosmetic', COSMETIC_TAGS, 'cos'), text('cosmeticNotes', 'Details', { multiline: true, placeholder: 'Where, how bad, visible in photos…' })));
  const dirt = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Dirty parts')),
    h('div', { class: 'stack' }, tagGroup('dirt', DIRT_TAGS, ''), text('dirtNotes', 'Details', { multiline: true, placeholder: 'What needs cleaning, what was cleaned…' })));
  const faults = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Hardware faults')),
    h('div', { class: 'stack' }, tagGroup('faults', FAULT_TAGS, 'fault'), text('faultNotes', 'Details', { multiline: true, placeholder: 'Symptoms, suspected part, what you tried…' })));

  // ---- repairs ----
  const repList = h('div', { class: 'timeline' });
  const drawRepairs = () => fill(repList, ...(rec.repairs || []).slice().reverse().map((r) => h('div', { class: 'ev' },
    h('header', {}, h('span', {}, r.what), h('span', { class: 'muted small' }, fmtDate(r.date))),
    r.cost ? h('div', { class: 'muted small' }, 'Parts cost ' + money(r.cost)) : null,
    h('button', { class: 'btn sm ghost danger', onclick: () => { rec.repairs = rec.repairs.filter((x) => x.id !== r.id); rec.tombstones = [...(rec.tombstones || []), r.id]; persist(); drawRepairs(); } }, 'Remove'))),
  (rec.repairs || []).length ? [] : h('p', { class: 'muted', style: { margin: 0 } }, 'No repairs logged.'));
  drawRepairs();
  const repWhat = h('input', { type: 'text', placeholder: 'e.g. Replaced left stick module, cleaned R2' });
  const repCost = h('input', { type: 'number', step: '0.01', placeholder: 'Parts €', style: { maxWidth: '120px' } });
  const repairs = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Repairs and cleaning')),
    h('div', { class: 'stack' }, h('div', { class: 'row' }, h('div', { style: { flex: 1, minWidth: '200px' } }, repWhat), repCost,
      h('button', { class: 'btn', onclick: () => {
        if (!repWhat.value.trim()) return;
        rec.repairs = [...(rec.repairs || []), { id: uid(), date: Date.now(), what: repWhat.value.trim(), cost: repCost.value }];
        repWhat.value = ''; repCost.value = ''; persist(); drawRepairs();
      } }, 'Log it')), repList));

  // ---- photos ----
  const photoGrid = h('div', { class: 'photos' });
  const drawPhotos = () => fill(photoGrid, ...(rec.photos || []).map((p) => h('figure', {},
    h('img', { src: p.data, alt: 'Controller photo', onclick: () => { const d = h('dialog', { class: 'photo', onclick: () => d.close() }, h('img', { src: p.data, alt: '' })); d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal(); } }),
    h('button', { 'aria-label': 'Remove photo', onclick: () => { rec.photos = rec.photos.filter((x) => x.id !== p.id); rec.tombstones = [...(rec.tombstones || []), p.id]; persist(); drawPhotos(); } }, '×'))));
  drawPhotos();
  const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'hidden', onchange: async () => {
    for (const f of fileIn.files) rec.photos = [...(rec.photos || []), { id: uid(), date: Date.now(), data: await shrink(f) }];
    fileIn.value = ''; persist(); drawPhotos();
  } });
  const photos = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Photos'), h('button', { class: 'btn sm', onclick: () => fileIn.click() }, 'Add photos'), fileIn), photoGrid);

  // ---- tests ----
  const tests = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Test history'), h('span', { class: 'muted small' }, `${(rec.tests || []).length} sessions`)),
    h('div', { class: 'timeline' }, (rec.tests || []).length ? rec.tests.slice().reverse().map(testEv) : h('p', { class: 'muted', style: { margin: 0 } }, 'Connect this controller on the Test tab and save a session.')));

  // ---- hardware ----
  const hwRows = [['MAC address', rec.mac], ['Board', rec.board], ['Firmware build', rec.fwBuildDate], ['Firmware version', rec.fwVersion], ['HW model', rec.hwModel],
    ['PCBA ID', rec.pcbaId], ['Battery barcode', rec.batteryBarcode], ['VCM left', rec.vcmLeft], ['VCM right', rec.vcmRight], ['Last connected', fmtDate(rec.lastSeen, true)]].filter(([, v]) => v);
  const colorSel = h('select', { onchange: (e) => { rec.color = e.target.value; persist(); } },
    h('option', { value: '' }, 'Unknown'), Object.values(COLOR_CODES).map((c) => h('option', { value: c, selected: rec.color === c }, c)));
  const modelSel = h('select', { onchange: (e) => { rec.model = e.target.value; persist(); } }, ['DualSense', 'DualSense Edge'].map((m) => h('option', { selected: rec.model === m }, m)));
  const hardware = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Identity')),
    h('div', { class: 'form-grid' },
      h('label', { class: 'field' }, h('span', {}, 'Model'), modelSel),
      h('label', { class: 'field' }, h('span', {}, 'Color'), colorSel),
      text('colorCustom', 'Custom shell / color notes', { full: true, placeholder: 'Aftermarket shell, custom paint…' })),
    hwRows.length ? h('dl', { class: 'kv', style: { marginTop: '14px' } }, hwRows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])) : null);

  const notes = h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', {}, 'Notes')), text('notes', 'General notes', { multiline: true }));

  fill(root, head, h('div', { class: 'rec-grid' },
    h('div', {}, condition, cosmetic, dirt, faults, repairs),
    h('div', {}, sale, notes, photos, tests, hardware)));
}

function testEv(t) {
  const res = Object.entries(t.results || {});
  const bad = res.filter(([, v]) => v === 'faulty').map(([k]) => k);
  const minor = res.filter(([, v]) => v === 'minor').map(([k]) => k);
  const label = (k) => COMPONENT_GROUPS.flatMap((g) => g.items).find(([x]) => x === k)?.[1] || k;
  return h('div', { class: 'ev' },
    h('header', {}, h('span', {}, `${res.length} checks, ${bad.length ? bad.length + ' faulty' : 'nothing faulty'}`), h('span', { class: 'muted small' }, fmtDate(t.date, true))),
    h('div', { class: 'muted small' }, [t.connection === 'usb' ? 'USB' : t.connection === 'bluetooth' ? 'Bluetooth' : t.connection, t.battery !== null && t.battery !== undefined ? `battery ${t.battery}%` : null,
      t.drift ? `drift L ${t.drift.l}% / R ${t.drift.r}%` : null, t.circularity?.l ? `circularity L ${t.circularity.l}%` : null, t.circularity?.r ? `R ${t.circularity.r}%` : null].filter(Boolean).join(', ')),
    bad.length ? h('div', { class: 'small', style: { color: 'var(--circle)' } }, 'Faulty: ' + bad.map(label).join(', ')) : null,
    minor.length ? h('div', { class: 'small', style: { color: 'var(--square)' } }, 'Issues: ' + minor.map(label).join(', ')) : null,
    t.actions?.length ? h('div', { class: 'small' }, t.actions.join(', ')) : null);
}

async function shrink(file, max = 1280) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}
