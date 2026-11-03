import { renderTester, initConnections } from './tester.js';
import { renderList, renderRecord } from './records.js';
import { renderSettings } from './settings.js';
import { onSync, onChange, syncNow } from './store.js';
import { $, $$ } from './ui.js';

const view = $('#view');

async function route() {
  const hash = location.hash || '#/test';
  const [, name, arg] = hash.split('/');
  const nav = name === 'c' ? 'db' : name;
  $$('.rail a').forEach((a) => { if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  view.dataset.view = name;
  view.replaceChildren();
  window.scrollTo(0, 0);
  if (name === 'db') await renderList(view);
  else if (name === 'c') await renderRecord(view, decodeURIComponent(arg || ''));
  else if (name === 'settings') await renderSettings(view);
  else { view.dataset.view = 'test'; renderTester(view); }
}

window.addEventListener('hashchange', route);
// Re-render the list when another device's changes arrive.
onChange((e) => { if (e.type === 'bulk' && view.dataset.view === 'db') renderList(view); });

const dot = $('#syncdot');
onSync((s) => {
  dot.dataset.state = s.state;
  dot.querySelector('span').textContent = { ok: 'Synced', syncing: 'Syncing', offline: s.pending ? `${s.pending} waiting` : 'Offline', local: 'Local only', idle: 'Local' }[s.state] || 'Local';
  dot.title = s.detail || (s.server ? 'Server: ' + s.server : 'Saved on this device');
});
dot.addEventListener('click', () => { location.hash = '#/settings'; });

route();
initConnections();
syncNow();
