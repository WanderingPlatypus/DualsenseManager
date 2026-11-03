import { serverUrl, getMeta, setMeta } from './store.js';
import { dialog, toast } from './ui.js';

// Windows app only: download a newer version of the app from the PadBench server.
export async function checkForUpdates({ quiet = true } = {}) {
  const bridge = window.padbench;
  if (!bridge?.checkUpdate) { if (!quiet) toast('Updates come from the server automatically in the browser.'); return null; }
  const base = await serverUrl();
  if (!base) { if (!quiet) toast('Set the server address first', true); return null; }
  try {
    const r = await bridge.checkUpdate(base, await getMeta('token', ''));
    await setMeta('lastUpdateCheck', Date.now());
    if (r.updated) {
      const go = await dialog({ title: `PadBench ${r.version} is ready`, body: 'The update has been downloaded from your server. Restart the app to use it.',
        actions: [{ label: 'Later', value: false }, { label: 'Restart now', value: true, kind: 'primary' }] });
      if (go) bridge.restart();
    } else if (!quiet) toast(`PadBench ${r.version} is up to date`);
    return r;
  } catch (e) {
    if (!quiet) toast('Update check failed: ' + e.message, true);
    return null;
  }
}

export async function scheduleUpdateChecks() {
  if (!window.padbench?.checkUpdate) return;
  const run = async () => {
    const last = await getMeta('lastUpdateCheck', 0);
    if (Date.now() - last > 3 * 3600_000) checkForUpdates();
  };
  setTimeout(run, 5000);
  setInterval(run, 3600_000);
}

export async function appVersion() {
  if (window.padbench?.version) return (await window.padbench.version()).version;
  try { return (await (await fetch('version.json', { cache: 'no-store' })).json()).version; } catch { return '?'; }
}
