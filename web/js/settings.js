import { getMeta, setMeta, syncNow, onSync, testServer, serverUrl, allRecords, importRecords, resetSyncCursor } from './store.js';
import { h, toast, confirmBox, fill } from './ui.js';
import { download, exportCsv } from './records.js';

export async function renderSettings(root) {
  const url = h('input', { type: 'url', placeholder: 'http://192.168.1.50:8080', value: await getMeta('serverUrl', '') });
  const token = h('input', { type: 'password', placeholder: 'Only if you set PADBENCH_TOKEN on the server', value: await getMeta('token', '') });
  const effective = await serverUrl();
  const statusBox = h('div', { class: 'notice' });
  let off = null;
  off = onSync((s) => {
    if (off && !statusBox.isConnected && root.dataset.view !== 'settings') { off(); return; }
    const line = {
      ok: `Synced with ${s.server}${s.lastOk ? ' at ' + new Date(s.lastOk).toLocaleTimeString() : ''}.`,
      syncing: `Syncing with ${s.server}…`,
      offline: `Can’t reach ${s.server}. ${s.detail}`,
      local: 'No server set. Everything is saved on this device only.',
      idle: 'Waiting for the first sync.',
    }[s.state] || '';
    statusBox.className = 'notice' + (s.state === 'offline' ? ' bad' : '');
    fill(statusBox, h('div', {}, line), s.pending ? h('div', { class: 'small' }, `${s.pending} change${s.pending > 1 ? 's' : ''} waiting to be sent.`) : null);
  });

  const save = async () => {
    await setMeta('serverUrl', url.value.trim().replace(/\/+$/, ''));
    await setMeta('token', token.value.trim());
    toast('Server settings saved');
    syncNow();
  };
  const test = async () => {
    const u = url.value.trim() || effective;
    if (!u) return toast('Enter the server address first', true);
    try { const r = await testServer(u, token.value.trim()); toast(`Server reachable: ${r.controllers} controllers stored`); }
    catch (e) { toast(`Can’t reach ${u}: ${e.message}`, true, 6000); }
  };

  const fileIn = h('input', { type: 'file', accept: 'application/json,.json', class: 'hidden', onchange: async () => {
    const f = fileIn.files[0]; fileIn.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const n = await importRecords(Array.isArray(data) ? data : data.controllers || []);
      toast(`Imported ${n} controllers`);
    } catch (e) { toast('Import failed: ' + e.message, true); }
  } });

  fill(root,
    h('h1', { style: { marginBottom: '18px' } }, 'Sync and backup'),
    h('div', { class: 'rec-grid' },
      h('div', {},
        h('div', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h2', {}, 'Home server')),
          h('div', { class: 'stack' },
            statusBox,
            h('p', { class: 'muted', style: { margin: 0 } }, 'Every change is saved on this device first, then sent to your server whenever it can be reached. Other PCs pointed at the same server get the same database.'),
            h('label', { class: 'field' }, h('span', {}, 'Server address'), url,
              effective && !url.value ? h('small', {}, `Using ${effective} because this page is served from it.`) : null),
            h('label', { class: 'field' }, h('span', {}, 'Access token'), token),
            h('div', { class: 'row' },
              h('button', { class: 'btn primary', onclick: save }, 'Save'),
              h('button', { class: 'btn', onclick: test }, 'Test connection'),
              h('button', { class: 'btn', onclick: () => syncNow() }, 'Sync now')))),
        h('div', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h2', {}, 'Backup')),
          h('div', { class: 'stack' },
            h('p', { class: 'muted', style: { margin: 0 } }, 'The server also keeps a daily JSON snapshot for the last 14 days.'),
            h('div', { class: 'row' },
              h('button', { class: 'btn', onclick: async () => download(new Blob([JSON.stringify(strip(await allRecords({ includeDeleted: true })))], { type: 'application/json' }), `padbench-backup-${new Date().toISOString().slice(0, 10)}.json`) }, 'Download backup (JSON)'),
              h('button', { class: 'btn', onclick: async () => exportCsv(await allRecords()) }, 'Export CSV for spreadsheets'),
              h('button', { class: 'btn', onclick: () => fileIn.click() }, 'Import backup'), fileIn),
            h('button', { class: 'btn ghost sm', style: { justifySelf: 'start' }, onclick: async () => {
              if (await confirmBox('Resend everything?', 'Sends every controller on this device to the server again and downloads everything back. Use it after pointing the app at a new or restored server.', 'Resend')) { await resetSyncCursor(); syncNow(); }
            } }, 'Resend everything to the server')))),
      h('div', {},
        h('div', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h2', {}, 'Where each feature works')),
          h('dl', { class: 'kv', style: { fontSize: '14px', gap: '10px 16px' } },
            h('dt', {}, 'Windows app'), h('dd', {}, 'Everything, USB and Bluetooth.'),
            h('dt', {}, 'Chrome or Edge'), h('dd', {}, 'Everything, when opened from https://<server>:8443 or localhost.'),
            h('dt', {}, 'Firefox'), h('dd', {}, 'Database, plus buttons, sticks and triggers through the Gamepad API. Type the serial by hand.'))),
        h('div', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h2', {}, 'About')),
          h('p', { class: 'muted small', style: { margin: 0 } }, 'PadBench 1.0. Controller protocol based on dualshock-tools (MIT, © the_al) and the Linux hid-playstation driver. Saira and Atkinson Hyperlegible fonts under the SIL Open Font License.'),
          h('p', { class: 'muted small' }, `This device: ${(await allRecords()).length} controllers. Theme follows your system.`)))));
}

const strip = (list) => list.map(({ _dirty, ...r }) => r);
