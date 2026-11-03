// PadBench desktop shell (Electron). Loads the bundled web app with WebHID enabled.
const { app, BrowserWindow, protocol, net, session, ipcMain, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

app.setName('PadBench');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const WEB = path.join(__dirname, 'web');
const SONY = 0x054c;
const PIDS = [0x0ce6, 0x0df2];
const isPad = (d) => d && d.vendorId === SONY && PIDS.includes(d.productId);

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 960, minWidth: 380, minHeight: 600,
    backgroundColor: '#eceef2', autoHideMenuBar: true, title: 'PadBench',
    icon: path.join(WEB, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.loadURL('app://padbench/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  return win;
}

app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(WEB, decodeURIComponent(pathname)));
    if (!file.startsWith(WEB)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  const ses = session.defaultSession;
  // Pick the DualSense automatically when the page asks for a HID device.
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const d = details.deviceList.find(isPad);
    callback(d ? d.deviceId : '');
  });
  ses.setPermissionCheckHandler((_wc, permission) => ['hid', 'media', 'clipboard-sanitized-write'].includes(permission));
  ses.setDevicePermissionHandler((details) => details.deviceType === 'hid' && isPad(details.device));
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(['media', 'clipboard-sanitized-write'].includes(permission)));

  // Sync requests go through the main process so the LAN server is reachable over plain http.
  ipcMain.handle('net', async (_e, url, opts = {}) => {
    if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs');
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), opts.timeout || 8000);
    try {
      const r = await fetch(url, { method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body, signal: ctl.signal });
      return { ok: r.ok, status: r.status, body: await r.text() };
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'Server not reachable (timeout)' : 'Server not reachable');
    } finally { clearTimeout(t); }
  });

  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => app.quit());
