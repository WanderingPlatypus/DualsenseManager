// Local-first store (IndexedDB) with background sync to the home server.
import { mergeRecords } from './merge.js';

const DB_NAME = 'padbench';
let dbp;

function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('controllers', { keyPath: 'serial' });
        d.createObjectStore('meta');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
  });
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function getMeta(key, dflt = null) {
  const v = await tx('meta', 'readonly', (s) => req(s.get(key)));
  return v === undefined ? dflt : v;
}
export const setMeta = (key, val) => tx('meta', 'readwrite', (s) => req(s.put(val, key)));

export async function allRecords({ includeDeleted = false } = {}) {
  const all = await tx('controllers', 'readonly', (s) => req(s.getAll()));
  return includeDeleted ? all : all.filter((r) => !r.deleted);
}
export async function getRecord(serial) {
  const r = await tx('controllers', 'readonly', (s) => req(s.get(serial)));
  return r && !r.deleted ? r : null;
}
export async function findByMac(mac) {
  if (!mac) return null;
  return (await allRecords()).find((r) => r.mac && r.mac.toUpperCase() === mac.toUpperCase()) || null;
}

const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (what) => listeners.forEach((fn) => fn(what));

export async function saveRecord(rec, { quiet = false } = {}) {
  rec.updatedAt = Math.max(Date.now(), (rec.updatedAt || 0) + 1);
  rec._dirty = 1;
  await tx('controllers', 'readwrite', (s) => req(s.put(rec)));
  if (!quiet) emit({ type: 'record', serial: rec.serial });
  scheduleSync(800);
  return rec;
}

export async function deleteRecord(serial) {
  const r = await tx('controllers', 'readonly', (s) => req(s.get(serial)));
  if (!r) return;
  r.deleted = true;
  await saveRecord(r);
}

export async function importRecords(list) {
  let n = 0;
  for (const inc of list) {
    if (!inc || !inc.serial) continue;
    const cur = await tx('controllers', 'readonly', (s) => req(s.get(inc.serial)));
    const merged = mergeRecords(cur, { ...inc, updatedAt: Math.max(inc.updatedAt || 0, (cur?.updatedAt || 0) + 1) });
    merged._dirty = 1;
    await tx('controllers', 'readwrite', (s) => req(s.put(merged)));
    n++;
  }
  emit({ type: 'bulk' });
  scheduleSync(200);
  return n;
}

// ---------------- sync ----------------
export const sync = { state: 'idle', detail: '', pending: 0, lastOk: 0, server: '' };
const syncListeners = new Set();
export const onSync = (fn) => { syncListeners.add(fn); fn(sync); return () => syncListeners.delete(fn); };
const setSync = (patch) => { Object.assign(sync, patch); syncListeners.forEach((fn) => fn(sync)); };

export async function serverUrl() {
  const configured = (await getMeta('serverUrl', '')).trim().replace(/\/+$/, '');
  if (configured) return configured;
  // When the app is served by the padbench server itself, sync to the same origin.
  if (/^https?:$/.test(location.protocol) && !['localhost', '127.0.0.1'].includes(location.hostname)) return location.origin;
  if (/^https?:$/.test(location.protocol) && (await getMeta('sameOriginServer', false))) return location.origin;
  return '';
}

async function net(url, opts) {
  if (window.padbench?.net) return window.padbench.net(url, opts); // Electron: request made by the main process
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeout || 8000);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    const text = await r.text();
    return { ok: r.ok, status: r.status, body: text };
  } finally { clearTimeout(t); }
}

let syncTimer = 0, running = null;
export function scheduleSync(ms = 1000) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow().catch(() => {}), ms);
}

export async function syncNow() {
  if (running) return running;
  running = (async () => {
    const all = await allRecords({ includeDeleted: true });
    const dirty = all.filter((r) => r._dirty);
    const base = await serverUrl();
    setSync({ server: base, pending: dirty.length });
    if (!base) { setSync({ state: 'local', detail: 'No server set — saved on this device only' }); return; }
    setSync({ state: 'syncing', detail: '' });
    try {
      const since = await getMeta('lastSeq', 0);
      const token = await getMeta('token', '');
      const sent = dirty.map(({ _dirty, ...r }) => r);
      const res = await net(base + '/api/sync', {
        method: 'POST', timeout: 15000,
        headers: { 'content-type': 'application/json', ...(token ? { 'x-padbench-token': token } : {}) },
        body: JSON.stringify({ since, changes: sent }),
      });
      if (res.status === 401) throw new Error('Server rejected the access token');
      if (!res.ok) throw new Error('Server answered ' + res.status);
      const data = JSON.parse(res.body);

      // Mark what we sent as clean, unless it changed while we were syncing.
      const sentAt = new Map(sent.map((r) => [r.serial, r.updatedAt]));
      let changed = 0;
      for (const remote of data.changes || []) {
        const local = await tx('controllers', 'readonly', (s) => req(s.get(remote.serial)));
        const localStillDirty = local?._dirty && local.updatedAt !== sentAt.get(remote.serial);
        if (localStillDirty) continue; // newer local edit — goes up on the next round
        await tx('controllers', 'readwrite', (s) => req(s.put({ ...remote, _dirty: 0 })));
        changed++;
      }
      for (const [serial, at] of sentAt) {
        const local = await tx('controllers', 'readonly', (s) => req(s.get(serial)));
        if (local && local.updatedAt === at && local._dirty) {
          local._dirty = 0;
          await tx('controllers', 'readwrite', (s) => req(s.put(local)));
        }
      }
      await setMeta('lastSeq', data.seq || since);
      const left = (await allRecords({ includeDeleted: true })).filter((r) => r._dirty).length;
      setSync({ state: 'ok', detail: '', pending: left, lastOk: Date.now() });
      if (changed) emit({ type: 'bulk' });
      if (left) scheduleSync(500);
    } catch (e) {
      const msg = e.name === 'AbortError' || e instanceof TypeError || /fetch|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH/i.test(e.message) ? 'Server not reachable' : (e.message || String(e));
      setSync({ state: 'offline', detail: msg + ' — changes are kept on this device and sent when it is back' });
    }
  })();
  try { return await running; } finally { running = null; }
}

export async function testServer(url, token) {
  const r = await net(url.replace(/\/+$/, '') + '/api/health', { method: 'GET', timeout: 5000, headers: token ? { 'x-padbench-token': token } : {} });
  if (!r.ok) throw new Error(r.status === 401 ? 'Wrong access token' : 'Server answered ' + r.status);
  return JSON.parse(r.body);
}

export async function resetSyncCursor() {
  await setMeta('lastSeq', 0);
  const all = await allRecords({ includeDeleted: true });
  for (const r of all) { r._dirty = 1; await tx('controllers', 'readwrite', (s) => req(s.put(r))); }
}

setInterval(() => scheduleSync(0), 30000);
window.addEventListener('online', () => scheduleSync(0));
