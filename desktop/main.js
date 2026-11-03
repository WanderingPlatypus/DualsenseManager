// PadBench desktop shell (Electron). Loads the web app with WebHID enabled and
// keeps it up to date from your PadBench server.
const { app, BrowserWindow, protocol, net, session, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

app.setName('PadBench');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const BUNDLED = path.join(__dirname, 'web');
const SONY = 0x054c;
const PIDS = [0x0ce6, 0x0df2];
const isPad = (d) => d && d.vendorId === SONY && PIDS.includes(d.productId);

if (!app.requestSingleInstanceLock()) app.quit();

// ---------- web app version handling ----------
const readVersion = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'version.json'), 'utf8')).version || '0'; } catch { return '0'; } };
const newer = (a, b) => { // a > b ?
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0; }
  return false;
};
const cacheDir = () => path.join(app.getPath('userData'), 'web-cache');
let WEB = BUNDLED;
function pickWebDir() {
  const c = cacheDir();
  WEB = fs.existsSync(path.join(c, 'index.html')) && newer(readVersion(c), readVersion(BUNDLED)) ? c : BUNDLED;
  return WEB;
}

async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function checkForUpdate(server, token) {
  if (!/^https?:\/\//i.test(server || '')) return { updated: false, version: readVersion(WEB), reason: 'no server' };
  const headers = token ? { 'x-padbench-token': token } : {};
  const r = await fetchWithTimeout(server.replace(/\/+$/, '') + '/api/app-manifest', { headers });
  if (!r.ok) throw new Error('Server answered ' + r.status);
  const man = await r.json();
  const current = readVersion(WEB);
  if (!man.version || !newer(man.version, current)) return { updated: false, version: current, latest: man.version };

  const staging = path.join(app.getPath('userData'), 'web-staging');
  fs.rmSync(staging, { recursive: true, force: true });
  for (const f of man.files) {
    const rel = path.normalize(f.path);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Bad path in manifest: ' + f.path);
    const dest = path.join(staging, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const local = path.join(WEB, rel);
    if (fs.existsSync(local) && sha256(fs.readFileSync(local)) === f.sha256) { fs.copyFileSync(local, dest); continue; }
    const res = await fetchWithTimeout(server.replace(/\/+$/, '') + '/' + f.path.split('/').map(encodeURIComponent).join('/'), { headers }, 30000);
    if (!res.ok) throw new Error(`Download of ${f.path} failed (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha256(buf) !== f.sha256) throw new Error(`Checksum mismatch for ${f.path}`);
    fs.writeFileSync(dest, buf);
  }
  if (readVersion(staging) !== man.version) throw new Error('Downloaded update is incomplete');
  fs.rmSync(cacheDir(), { recursive: true, force: true });
  fs.renameSync(staging, cacheDir());
  return { updated: true, version: man.version, previous: current };
}

// ---------- window ----------
function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 960, minWidth: 380, minHeight: 600,
    backgroundColor: '#eceef2', autoHideMenuBar: true, title: 'PadBench',
    icon: path.join(BUNDLED, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.loadURL('app://padbench/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  return win;
}

app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });

app.whenReady().then(() => {
  pickWebDir();
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(WEB, decodeURIComponent(pathname)));
    if (!file.startsWith(WEB)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  const ses = session.defaultSession;
  // When the page asks for a controller, pick the DualSense. If Windows hasn't listed it yet,
  // wait up to 10 seconds for it to appear.
  let pendingPick = null;
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const d = details.deviceList.find(isPad);
    if (d) return callback(d.deviceId);
    const timer = setTimeout(() => { pendingPick = null; callback(''); }, 10000);
    pendingPick = (dev) => { clearTimeout(timer); pendingPick = null; callback(dev.deviceId); };
  });
  ses.on('hid-device-added', (_e, details) => { if (pendingPick && isPad(details.device)) pendingPick(details.device); });
  ses.setPermissionCheckHandler((_wc, permission) => ['hid', 'media', 'clipboard-sanitized-write'].includes(permission));
  ses.setDevicePermissionHandler((details) => details.deviceType === 'hid' && isPad(details.device));
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(['media', 'clipboard-sanitized-write'].includes(permission)));

  // Sync requests go through the main process so the LAN server is reachable over plain http.
  ipcMain.handle('net', async (_e, url, opts = {}) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs');
    try {
      const r = await fetchWithTimeout(url, { method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body }, opts.timeout || 8000);
      return { ok: r.ok, status: r.status, body: await r.text() };
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'Server not reachable (timeout)' : 'Server not reachable');
    }
  });
  ipcMain.handle('update:check', (_e, server, token) => checkForUpdate(server, token));
  ipcMain.handle('app:version', () => ({ version: readVersion(WEB), bundled: readVersion(BUNDLED), shell: app.getVersion() }));
  ipcMain.handle('app:restart', () => { pickWebDir(); BrowserWindow.getAllWindows().forEach((w) => w.webContents.reloadIgnoringCache()); });
  ipcMain.handle('open:bluetooth', () => shell.openExternal('ms-settings:bluetooth'));

  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => app.quit());
