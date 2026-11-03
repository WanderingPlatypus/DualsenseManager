import { DualSense, HID_FILTERS, colorFromSerial, FINETUNE_LABELS } from './ds5.js';
import { GamepadSource, findDualSenseGamepads } from './gamepad.js';
import { loadPad } from './padsvg.js';
import { gradePicker } from './grade.js';
import { COMPONENT_GROUPS, STATUS, SALE_STATUS, emptyRecord, uid, suggestGrade } from './schema.js';
import { getRecord, saveRecord, findByMac, allRecords } from './store.js';
import { h, $, $$, toast, confirmBox, swatch, debounce, fill } from './ui.js';

const hasHID = 'hid' in navigator;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- module state survives switching tabs ----
let src = null;          // DualSense | GamepadSource
let info = null;
let record = null;
let session = null;
let root = null;
let frame = 0;
let padView = null;
let gradeRefresh = null;
const desktop = !!window.padbench?.desktop;

function newSession() {
  return {
    id: uid(), startedAt: Date.now(), results: {}, manual: new Set(), actions: [],
    seen: {}, trig: { l2: 0, r2: 0 }, touchCells: new Set(),
    imu: { min: { x: 9, y: 9, z: 9 }, max: { x: -9, y: -9, z: -9 } },
    circ: { l: new Float32Array(72), r: new Float32Array(72) }, circResult: { l: null, r: null },
    drift: null, trace: { l: [], r: [] },
  };
}

const lightbarEl = () => document.getElementById('lightbar');
function setLightbarUi(r, g, b) {
  const el = lightbarEl();
  if (r === null) { el.classList.remove('live'); return; }
  el.style.setProperty('--lightbar', `rgb(${r},${g},${b})`);
  el.classList.add('live');
}

// ================= connection =================
export async function initConnections() {
  if (hasHID) {
    navigator.hid.addEventListener('connect', ({ device }) => { if (!src && isDs(device)) attachHid(device); });
    navigator.hid.addEventListener('disconnect', ({ device }) => { if (src?.device === device) detach('Controller disconnected'); });
    const known = (await navigator.hid.getDevices()).filter(isDs);
    if (known.length && !src) attachHid(known[0]);
  }
  window.addEventListener('gamepadconnected', (e) => {
    if (src || hasHID) return;
    if (/054c|dualsense|wireless controller|sony/i.test(e.gamepad.id)) attachGamepad(e.gamepad);
  });
  window.addEventListener('gamepaddisconnected', (e) => { if (src?.index === e.gamepad.index) detach('Controller disconnected'); });
}
const isDs = (d) => HID_FILTERS.some((f) => f.vendorId === d.vendorId && f.productId === d.productId);

async function requestHid() {
  try {
    const known = (await navigator.hid.getDevices()).filter(isDs);
    const devs = known.length ? known : await navigator.hid.requestDevice({ filters: HID_FILTERS });
    if (devs[0]) await attachHid(devs[0]);
    else toast('No DualSense found. Plug it in by USB, or turn on a paired controller with the PS button.', true, 6000);
  } catch (e) { toast('Could not open the controller: ' + e.message, true); }
}

async function attachHid(device) {
  const ds = new DualSense(device);
  src = ds; session = newSession(); info = { model: ds.model, connection: ds.connection, loading: true };
  render();
  try {
    await ds.open();
    ds.onState = onState;
    info = { ...(await ds.getInfo()), loading: false };
    if (!info.clone) {
      try { await ds.initOutput(); await ds.setLightbar(63, 111, 232); setLightbarUi(63, 111, 232); } catch (e) { console.warn('output init', e); }
    }
    if (ds.bt) {
      // Over Bluetooth the controller starts in a basic mode without touchpad, motion or battery data.
      for (let i = 0; i < 3 && !ds.state.full; i++) { await sleep(800); await ds.enableFullReports(); }
    }
    if (ds.connection === 'usb' ) autoResult('usb', 'ok');
    if (ds.connection === 'bluetooth') autoResult('bluetooth', 'ok');
    await identify();
  } catch (e) {
    console.error(e);
    info = { ...info, loading: false, infoError: e.message };
    toast('Connected, but reading controller info failed: ' + e.message, true);
  }
  render();
}

function attachGamepad(gp) {
  const s = new GamepadSource(gp.index, gp.id);
  src = s; session = newSession(); info = { model: s.model, connection: 'gamepad-api', limited: true };
  s.onState = onState;
  s.open();
  record = null;
  render();
}

async function detach(msg) {
  const s = src;
  src = null; info = null; record = null;
  cancelAnimationFrame(frame);
  setLightbarUi(null);
  try { await s?.close(); } catch { /* gone */ }
  if (msg) toast(msg);
  render();
}

async function identify() {
  let serial = info.serial;
  if (!serial && info.mac) {
    const byMac = await findByMac(info.mac);
    if (byMac) serial = byMac.serial;
  }
  if (!serial) { record = null; return; }
  await linkSerial(serial, true);
}

async function linkSerial(serial, fromDevice = false) {
  serial = serial.trim().toUpperCase();
  if (!serial) return;
  let rec = await getRecord(serial);
  const isNew = !rec;
  if (!rec) rec = emptyRecord(serial);
  // Fill hardware facts read from the controller; never overwrite what the user typed.
  const hw = { model: info.model, mac: info.mac, board: info.board, fwVersion: info.fwVersion, fwBuildDate: info.fwBuildDate,
    hwModel: info.hwModel, pcbaId: info.pcbaId, batteryBarcode: info.batteryBarcode, mcuId: info.mcuId, vcmLeft: info.vcmLeft, vcmRight: info.vcmRight };
  let changed = isNew;
  for (const [k, v] of Object.entries(hw)) if (v && rec[k] !== v) { rec[k] = v; changed = true; }
  if (!rec.color && (info.color || colorFromSerial(serial))) { rec.color = info.color || colorFromSerial(serial); changed = true; }
  if (fromDevice && info.clone && !rec.clone) { rec.clone = true; changed = true; }
  rec.lastSeen = Date.now();
  record = await saveRecord(rec, { quiet: !changed });
  if (isNew) toast(`New controller ${serial} added to the database`);
  render();
}

// ================= live input =================
let latest = null;
function onState(s) {
  latest = s;
  const B = s.buttons;
  for (const [k, v] of Object.entries(B)) if (v) { session.seen[k] = true; if (k !== 'l2' && k !== 'r2') autoResult(k, 'ok'); }
  session.trig.l2 = Math.max(session.trig.l2, s.l2);
  session.trig.r2 = Math.max(session.trig.r2, s.r2);
  if (session.trig.l2 >= 250 && session.seen.l2) autoResult('l2', 'ok');
  if (session.trig.r2 >= 250 && session.seen.r2) autoResult('r2', 'ok');
  // stick envelope for circularity
  for (const [side, x, y] of [['l', s.lx, s.ly], ['r', s.rx, s.ry]]) {
    const nx = (x - 127.5) / 127.5, ny = (y - 127.5) / 127.5;
    const r = Math.hypot(nx, ny);
    if (r > 0.25) {
      const b = Math.floor(((Math.atan2(ny, nx) + Math.PI) / (2 * Math.PI)) * 72) % 72;
      if (r > session.circ[side][b]) session.circ[side][b] = r;
    }
    const tr = session.trace[side];
    tr.push(nx, ny);
    if (tr.length > 600) tr.splice(0, 2);
  }
  // touch coverage, 16x9 grid
  for (const t of s.touch || []) if (t.active) session.touchCells.add(Math.min(15, (t.x / 120) | 0) + 16 * Math.min(8, (t.y / 120) | 0));
  if (session.touchCells.size >= 130) autoResult('touch_surface', 'ok');
  if (s.full) {
    const m = session.imu;
    for (const a of ['x', 'y', 'z']) { m.min[a] = Math.min(m.min[a], s.accel[a]); m.max[a] = Math.max(m.max[a], s.accel[a]); }
    if (['x', 'y', 'z'].every((a) => m.max[a] - m.min[a] > 1.2)) autoResult('imu', 'ok');
    if (s.battery && !s.battery.error && (s.battery.charging || s.battery.full || s.battery.level > 0)) autoResult('battery', 'ok');
  }
  if (!frame) frame = requestAnimationFrame(draw);
}

function autoResult(key, val) {
  if (!session || session.manual.has(key) || session.results[key] === val) return;
  session.results[key] = val;
  queueChecklist();
}
const queueChecklist = debounce(() => renderChecklist(), 120);

function draw() {
  frame = 0;
  if (!root || !latest || !src) return;
  const s = latest;
  if (padView?.svg.isConnected) padView.update(s, session.seen);
  const mode = $('#btmode', root);
  if (mode) mode.classList.toggle('hidden', !!s.full || src.connection !== 'bluetooth');
  drawStick('l', s.lx, s.ly);
  drawStick('r', s.rx, s.ry);
  for (const t of ['l2', 'r2']) {
    const bar = $(`#bar-${t}`, root);
    if (bar) {
      bar.firstChild.style.width = (s[t] / 255) * 100 + '%';
      bar.lastChild.style.left = `calc(${(session.trig[t] / 255) * 100}% - 2px)`;
      $(`#val-${t}`, root).textContent = s[t];
    }
  }
  drawTouch(s);
  const imu = $('#imu', root);
  if (imu && s.full) {
    const f = (v) => (v >= 0 ? '+' : '') + v.toFixed(2);
    imu.innerHTML = `<div>Gyro X<b class="num">${s.gyro.x.toFixed(0)}°/s</b></div><div>Gyro Y<b class="num">${s.gyro.y.toFixed(0)}°/s</b></div><div>Gyro Z<b class="num">${s.gyro.z.toFixed(0)}°/s</b></div>
      <div>Accel X<b class="num">${f(s.accel.x)} g</b></div><div>Accel Y<b class="num">${f(s.accel.y)} g</b></div><div>Accel Z<b class="num">${f(s.accel.z)} g</b></div>`;
  }
  const bat = $('#battery', root);
  if (bat && s.battery) bat.textContent = s.battery.error ? 'Battery error' : `${s.battery.level}%${s.battery.full ? ' full' : s.battery.charging ? ' charging' : ''}`;
  const hp = $('#hpstate', root);
  if (hp) hp.textContent = s.headphones ? 'Headphones plugged in' : 'No headphones detected';
}

function drawStick(side, x, y) {
  const c = $(`#stick-${side}`, root);
  if (!c) return;
  const dpr = devicePixelRatio || 1, W = c.clientWidth * dpr;
  if (c.width !== W) { c.width = W; c.height = W; }
  const g = c.getContext('2d'), R = W / 2 - 8 * dpr, cx = W / 2;
  g.clearRect(0, 0, W, W);
  g.strokeStyle = '#3a3f4b'; g.lineWidth = dpr;
  g.beginPath(); g.arc(cx, cx, R, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(cx, cx, R * 0.1, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(cx - R, cx); g.lineTo(cx + R, cx); g.moveTo(cx, cx - R); g.lineTo(cx, cx + R); g.stroke();
  // envelope
  const env = session.circ[side];
  g.strokeStyle = '#1f9e8f'; g.lineWidth = 2 * dpr; g.beginPath();
  let started = false;
  for (let i = 0; i <= 72; i++) {
    const r = env[i % 72];
    if (!r) { started = false; continue; }
    const a = ((i % 72) + 0.5) / 72 * Math.PI * 2 - Math.PI;
    const px = cx + Math.cos(a) * r * R, py = cx + Math.sin(a) * r * R;
    if (!started) { g.moveTo(px, py); started = true; } else g.lineTo(px, py);
  }
  g.stroke();
  // trace
  const tr = session.trace[side];
  g.fillStyle = 'rgba(63,111,232,.35)';
  for (let i = 0; i < tr.length; i += 2) g.fillRect(cx + tr[i] * R - dpr, cx + tr[i + 1] * R - dpr, 2 * dpr, 2 * dpr);
  const nx = (x - 127.5) / 127.5, ny = (y - 127.5) / 127.5;
  g.fillStyle = '#e9ebf0'; g.beginPath(); g.arc(cx + nx * R, cx + ny * R, 5 * dpr, 0, Math.PI * 2); g.fill();

  const filled = env.filter((v) => v > 0).length;
  let err = null;
  if (filled >= 65) {
    let sum = 0, n = 0;
    env.forEach((v) => { if (v) { sum += (v - 1) ** 2; n++; } });
    err = Math.sqrt(sum / n) * 100;
    session.circResult[side] = err;
  }
  const ro = $(`#ro-${side}`, root);
  if (ro) ro.innerHTML = `<span>X <b class="num">${x}</b> Y <b class="num">${y}</b></span><span>Offset <b class="num">${(Math.hypot(nx, ny) * 100).toFixed(1)}%</b></span><span>${err === null ? `Rotate: <b class="num">${Math.round(filled / 72 * 100)}%</b> covered` : `Circularity error <b class="num">${err.toFixed(1)}%</b>`}</span>`;
}

function drawTouch(s) {
  const c = $('#tp', root);
  if (!c) return;
  if (c.width !== 640) { c.width = 640; c.height = 360; }
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(31,158,143,.22)';
  for (const cell of session.touchCells) g.fillRect((cell % 16) * 40, ((cell / 16) | 0) * 40, 40, 40);
  g.fillStyle = '#3f6fe8';
  for (const t of s.touch || []) if (t.active) { g.beginPath(); g.arc(t.x / 3, t.y / 3, 3, 0, Math.PI * 2); g.fill(); }
  const pct = $('#tp-pct', root);
  if (pct) pct.textContent = Math.round((session.touchCells.size / 144) * 100) + '% of the surface touched';
}

// ================= actions =================
async function run(label, fn) {
  try { await fn(); session.actions.push({ label, at: Date.now() }); }
  catch (e) { console.error(e); toast(`${label} failed: ${e.message}`, true, 6000); }
}

const ACTIONS = {
  rumble_l: { label: 'Play', go: () => run('Haptic L', async () => { await src.setRumble(255, 0); await sleep(700); await src.setRumble(0, 0); }) },
  rumble_r: { label: 'Play', go: () => run('Haptic R', async () => { await src.setRumble(0, 255); await sleep(700); await src.setRumble(0, 0); }) },
  trigger_l: { label: 'Resist', go: () => run('Adaptive triggers', async () => { await src.triggerPreset('heavy'); toast('Both triggers now resist — press them. They release in 8 seconds.'); await sleep(8000); await src.triggerPreset('off'); }) },
  trigger_r: { label: 'Resist', go: () => ACTIONS.trigger_l.go() },
  speaker: { label: 'Tone', go: () => run('Speaker tone', () => src.playTone('speaker', 1200)) },
  headphone: { label: 'Tone', go: () => run('Headphone tone', () => src.playTone('headphones', 1200)) },
  microphone: { label: 'Listen', go: () => micTest() },
  lightbar: { label: 'Cycle', go: () => run('Lightbar', async () => {
    for (const [r, g, b] of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]]) { await src.setLightbar(r, g, b); setLightbarUi(r, g, b); await sleep(600); }
    await src.setLightbar(63, 111, 232); setLightbarUi(63, 111, 232);
  }) },
  player_leds: { label: 'Cycle', go: () => run('Player LEDs', async () => {
    for (const m of [1, 2, 4, 8, 16, 31, 0]) { await src.setPlayerLeds(m); await sleep(350); }
  }) },
  mute_led: { label: 'Blink', go: () => run('Mute LED', async () => { await src.setMuteLed(1); await sleep(1200); await src.setMuteLed(0); }) },
};

async function micTest() {
  let stream, ctx;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const mic = devices.find((d) => d.kind === 'audioinput' && /dualsense|wireless controller/i.test(d.label));
    stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: mic ? { exact: mic.deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const label = stream.getAudioTracks()[0]?.label || 'default microphone';
    ctx = new AudioContext();
    const an = ctx.createAnalyser(); an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    const meter = h('div', { class: 'meter' }, h('i'));
    const isPadMic = /dualsense|wireless controller/i.test(label);
    const note = isPadMic ? '' : ' — this is not the controller mic, so the test won’t pass by itself. Pick the DualSense as input in Windows sound settings.';
    const status = h('p', { class: 'small muted' }, 'Waiting for sound…');
    const stop = confirmBox('Microphone test', h('div', { class: 'stack' },
      h('p', {}, `Listening on: ${label}${note}`), h('p', {}, 'Blow or speak into the controller. The bar should move.'), meter, status), 'Done');
    let peak = 0, raf, loudFrames = 0, passed = false;
    const loop = () => {
      an.getByteTimeDomainData(buf);
      let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128));
      peak = Math.max(peak * 0.92, m / 128);
      const level = Math.min(100, peak * 140);
      meter.firstChild.style.width = level + '%';
      // About a fifth of the bar for a quarter of a second counts as a working mic.
      if (level > 20) loudFrames++;
      if (!passed && isPadMic && loudFrames > 15) {
        passed = true;
        session.manual.delete('microphone');
        autoResult('microphone', 'ok');
        status.textContent = 'Microphone works — marked OK. You can close this.';
        status.style.color = 'var(--triangle)';
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    await stop;
    cancelAnimationFrame(raf);
  } catch (e) { toast('Microphone unavailable: ' + e.message, true); }
  finally { stream?.getTracks().forEach((t) => t.stop()); ctx?.close(); }
}

async function measureDrift(btn) {
  btn.disabled = true;
  btn.textContent = 'Hands off… 3';
  const samples = { l: 0, r: 0 };
  const t0 = performance.now();
  while (performance.now() - t0 < 3000) {
    const s = latest;
    if (s) {
      samples.l = Math.max(samples.l, Math.hypot((s.lx - 127.5) / 127.5, (s.ly - 127.5) / 127.5));
      samples.r = Math.max(samples.r, Math.hypot((s.rx - 127.5) / 127.5, (s.ry - 127.5) / 127.5));
    }
    btn.textContent = 'Hands off… ' + Math.ceil((3000 - (performance.now() - t0)) / 1000);
    await sleep(30);
  }
  session.drift = { l: +(samples.l * 100).toFixed(1), r: +(samples.r * 100).toFixed(1) };
  btn.disabled = false;
  updateStickResults();
  render();
}

function stickVerdict(drift, circ) {
  let v = 'ok';
  if (drift > 10 || (circ ?? 0) > 18) v = 'faulty';
  else if (drift > 5 || (circ ?? 0) > 10) v = 'minor';
  return v;
}
function updateStickResults() {
  if (!session.drift) return;
  autoResult('lstick', stickVerdict(session.drift.l, session.circResult.l));
  autoResult('rstick', stickVerdict(session.drift.r, session.circResult.r));
}

async function saveSession() {
  if (!record) { toast('Link this controller to a serial number first', true); return; }
  updateStickResults();
  const results = Object.fromEntries(Object.entries(session.results).filter(([, v]) => v && v !== 'untested'));
  if (!Object.keys(results).length && !session.actions.length) { toast('Nothing tested yet', true); return; }
  const rec = await getRecord(record.serial) || record;
  rec.components = { ...(rec.components || {}), ...results };
  const faults = new Set(rec.faults || []);
  if (results.lstick === 'faulty' && session.drift?.l > 10) faults.add('Left stick drift');
  if (results.rstick === 'faulty' && session.drift?.r > 10) faults.add('Right stick drift');
  if ([session.circResult.l, session.circResult.r].some((c) => c > 18)) faults.add('Poor stick circularity');
  if (info?.clone) faults.add('Clone / not genuine');
  rec.faults = [...faults];
  // Saving the same session twice replaces the earlier entry.
  rec.tests = dedupeById([...(rec.tests || []), {
    id: session.id, date: Date.now(), connection: info?.connection, fwVersion: info?.fwVersion,
    battery: latest?.battery?.level ?? null, results,
    drift: session.drift, circularity: { l: round1(session.circResult.l), r: round1(session.circResult.r) },
    actions: session.actions.map((a) => a.label).filter((v, i, a) => a.indexOf(v) === i && /calibrat|fine-tun/i.test(v)),
  }]);
  record = await saveRecord(rec);
  toast(`Saved ${Object.keys(results).length} results to ${rec.serial}${rec.gradeManual ? '' : rec.grade ? ', grade ' + rec.grade + ' suggested' : ''}`);
  render();
}
const round1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);
function dedupeById(list) { const m = new Map(); for (const t of list) m.set(t.id, t); return [...m.values()]; }

// ================= rendering =================
export function renderTester(el) {
  root = el;
  render();
}

function render() {
  if (!root || !root.isConnected || root.dataset.view !== 'test') return;
  root.replaceChildren();
  if (!src) return root.append(connectScreen());
  root.append(identity(), bench());
  renderChecklist();
  if (latest) draw();
}

function connectScreen() {
  const isFirefox = !hasHID;
  const gps = isFirefox ? findDualSenseGamepads() : [];
  if (isFirefox && gps[0] && !src) setTimeout(() => attachGamepad(gps[0]));
  const art = h('div');
  loadPad(art).catch(() => {});
  const steps = h('ol', { class: 'steps' },
    h('li', {}, h('b', {}, 'USB: '), 'plug the controller into this PC. Every test, the serial number and calibration work over USB.'),
    h('li', {}, h('b', {}, 'Bluetooth, first time: '), 'hold Create and PS together until the light bar flashes, then add it in Windows Bluetooth settings as "Wireless Controller".'),
    h('li', {}, h('b', {}, 'Bluetooth, already paired: '), 'press PS on the controller.'));
  let actions;
  if (isFirefox) {
    actions = h('div', { class: 'notice' }, 'Firefox can only read buttons, sticks and triggers. Serial number, lights, rumble, speaker, motion and calibration need the Windows app, or Chrome or Edge opened on your server’s https address.');
  } else if (desktop) {
    actions = h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: requestHid }, 'Find controller'),
      h('button', { class: 'btn', onclick: () => window.padbench.openBluetoothSettings() }, 'Open Bluetooth settings'));
  } else {
    actions = h('div', { class: 'stack' },
      h('p', {}, 'The browser asks once which controller this page may use. After that it connects by itself.'),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: requestHid }, 'Choose controller')));
  }
  return h('section', { class: 'connect-hero' },
    h('div', { class: 'stack' },
      h('h1', {}, isFirefox ? 'Connect a controller' : 'Waiting for a controller'),
      h('p', {}, isFirefox ? 'Connect a DualSense by USB or Bluetooth, then press any button on it.' : 'It connects by itself as soon as Windows sees it.'),
      steps, actions),
    art);
}

function identity() {
  const serial = record?.serial || info?.serial;
  const color = record?.color || info?.color;
  const chips = [];
  chips.push(h('span', { class: 'chip' }, info.connection === 'usb' ? 'USB' : info.connection === 'bluetooth' ? 'Bluetooth' : 'Gamepad API (limited)'));
  if (src.state?.battery !== null) chips.push(h('span', { class: 'chip num', id: 'battery' }, '—'));
  if (info.fwBuildDate) chips.push(h('span', { class: 'chip' }, 'Firmware ' + info.fwBuildDate));
  if (info.board && info.board !== 'Unknown') chips.push(h('span', { class: 'chip' }, info.board));
  if (info.clone) chips.push(h('span', { class: 'chip warn' }, 'Likely clone — calibration disabled'));
  if (info.oldFirmware) chips.push(h('span', { class: 'chip warn' }, 'Old firmware — update on a PS5 or PC first'));
  if (info.loading) chips.push(h('span', { class: 'chip' }, 'Reading controller…'));

  const left = h('div', {},
    h('div', { class: 'model' }, color ? swatch(color) : null, [info.model, color].filter(Boolean).join(', ')),
    h('div', { class: 'serial' }, serial || 'Unknown serial'),
    h('div', { class: 'chips' }, chips));
  const right = h('div', { class: 'row' },
    record ? h('a', { class: 'btn', href: '#/c/' + encodeURIComponent(record.serial) }, 'Open full record') : null,
    h('button', { class: 'btn ghost', onclick: () => detach('Disconnected') }, 'Disconnect'));
  const wrap = h('div', {}, h('div', { class: 'ident' }, left, right));
  if (!record && !info.loading) wrap.append(linkBox());
  return wrap;
}

function linkBox() {
  const input = h('input', { type: 'text', placeholder: 'e.g. A1230512345678', 'aria-label': 'Serial number', autocomplete: 'off' });
  const list = h('datalist', { id: 'serials' });
  allRecords().then((all) => all.forEach((r) => list.append(h('option', { value: r.serial }, [r.color, r.notes?.slice(0, 40)].filter(Boolean).join(', ')))));
  input.setAttribute('list', 'serials');
  const go = () => linkSerial(input.value);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const why = info.connection === 'bluetooth'
    ? 'This controller has not been seen over USB yet, so its serial is unknown. Type it (on the box, or read it once over USB) or plug in a cable.'
    : info.connection === 'gamepad-api' ? 'This browser cannot read the serial. Type it to open or create the record.'
    : 'The serial could not be read from this controller. Type it to open or create the record.';
  return h('div', { class: 'panel', style: { marginBottom: '18px' } },
    h('div', { class: 'stack' }, h('h2', {}, 'Which controller is this?'), h('p', { class: 'muted', style: { margin: 0 } }, why),
      h('div', { class: 'row' }, h('div', { style: { flex: 1, minWidth: '220px' } }, input, list), h('button', { class: 'btn primary', onclick: go }, 'Link serial'))));
}

function bench() {
  const limited = info.limited;
  const padWrap = h('div', { class: 'pad-wrap' });
  padView = null;
  loadPad(padWrap, { edge: src.isEdge }).then((v) => { padView = v; if (latest) draw(); }).catch((e) => console.error(e));
  const live = h('section', { class: 'core' },
    padWrap,
    src.connection === 'bluetooth' ? h('div', { class: 'notice hidden', id: 'btmode', style: { marginTop: '12px' } },
      'Bluetooth basic mode: touchpad, motion and battery are not reported yet. ',
      h('button', { class: 'btn sm', onclick: () => src.enableFullReports() }, 'Retry')) : null,
    h('div', { class: 'gauges' },
      gauge('l', 'Left stick'), gauge('r', 'Right stick'),
      h('div', { class: 'gauge wide' },
        trig('l2', 'L2'), trig('r2', 'R2'),
        h('div', { class: 'readout' }, h('span', {}, 'Green tick marks the deepest press this session. Full travel reads 255.'))),
      limited ? null : h('div', { class: 'gauge wide' }, h('canvas', { class: 'tp', id: 'tp' }), h('div', { class: 'readout' }, h('span', { id: 'tp-pct' }, 'Drag a finger over the whole touchpad'), h('button', { class: 'btn sm', onclick: () => { session.touchCells.clear(); const c = $('#tp', root); c.getContext('2d').clearRect(0, 0, c.width, c.height); } }, 'Clear'))),
      limited ? null : h('div', { class: 'gauge wide' }, h('div', { class: 'imu', id: 'imu' }), h('div', { class: 'readout' }, h('span', {}, 'Turn the controller face down, on its side and upright. Motion passes when all three axes have swung.')))),
    h('div', { class: 'row', style: { marginTop: '14px' } },
      h('button', { class: 'btn', onclick: (e) => measureDrift(e.currentTarget) }, 'Measure stick drift'),
      session.drift ? h('span', { class: 'muted small' }, `Resting offset: left ${session.drift.l}%, right ${session.drift.r}% (under 5% is healthy)`) : h('span', { class: 'muted small' }, 'Let go of both sticks, then measure.'),
      h('button', { class: 'btn ghost sm', onclick: () => { session.circ.l.fill(0); session.circ.r.fill(0); session.trace.l = []; session.trace.r = []; session.circResult = { l: null, r: null }; } }, 'Reset stick traces')),
    limited ? null : tools());
  const side = h('section', {}, checklistPanel(), record ? quickRecord() : null);
  return h('div', { class: 'bench' }, live, side);
}

function gauge(side, label) {
  return h('div', { class: 'gauge' }, h('h3', { style: { marginBottom: '8px' } }, label), h('canvas', { id: 'stick-' + side }), h('div', { class: 'readout', id: 'ro-' + side }));
}
function trig(t, label) {
  return h('div', { class: 'trig' }, h('b', {}, label), h('div', { class: 'bar', id: 'bar-' + t }, h('i'), h('b')), h('span', { class: 'num', id: 'val-' + t }, '0'));
}

function tools() {
  const ds = src;
  const usb = ds.connection === 'usb';
  const color = h('input', { type: 'color', value: '#3f6fe8', oninput: debounce(async (e) => {
    const v = e.target.value; const [r, g, b] = [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
    try { await ds.setLightbar(r, g, b); setLightbarUi(r, g, b); } catch (err) { toast(err.message, true); }
  }, 60) });
  let mask = 0;
  const leds = h('div', { class: 'leds' }, [1, 2, 4, 8, 16].map((bit) => h('button', { 'aria-pressed': 'false', 'aria-label': 'Player LED', onclick: async (e) => {
    mask ^= bit; e.currentTarget.setAttribute('aria-pressed', String(!!(mask & bit))); try { await ds.setPlayerLeds(mask); } catch (err) { toast(err.message, true); }
  } })));
  const rl = h('input', { type: 'range', min: 0, max: 255, value: 0 });
  const rr = h('input', { type: 'range', min: 0, max: 255, value: 0 });
  const rum = debounce(() => ds.setRumble(+rl.value, +rr.value).catch((e) => toast(e.message, true)), 40);
  rl.oninput = rum; rr.oninput = rum;
  const preset = h('select', { onchange: (e) => ds.triggerPreset(e.target.value).catch((err) => toast(err.message, true)) },
    [['off', 'Off'], ['light', 'Light click'], ['medium', 'Medium click'], ['heavy', 'Heavy click'], ['wall', 'Hard wall']].map(([v, l]) => h('option', { value: v }, l)));

  const outputs = h('details', { open: true }, h('summary', {}, 'Lights, rumble and triggers'),
    h('div', { class: 'inner' },
      h('div', { class: 'row' }, h('label', {}, 'Lightbar '), color, h('label', { style: { marginLeft: '12px' } }, 'Player LEDs '), leds),
      h('label', {}, 'Heavy motor (left)', rl), h('label', {}, 'Light motor (right)', rr),
      h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => { rl.value = 0; rr.value = 0; ds.setRumble(0, 0); } }, 'Stop rumble'),
        h('label', {}, 'Trigger effect '), preset)));

  const calib = h('details', {}, h('summary', {}, 'Calibration'), h('div', { class: 'inner' }, calibrationBody(usb)));
  return h('div', { class: 'tools' }, outputs, calib);
}

function calibrationBody(usb) {
  const ds = src;
  if (!usb) return h('div', { class: 'notice' }, 'Calibration needs a USB cable.');
  if (info.clone) return h('div', { class: 'notice' }, 'This controller did not answer like a genuine DualSense, so calibration is disabled to avoid damaging it.');
  const nv = h('span', { class: 'num' }, '…');
  ds.nvStatus().then((s) => { nv.textContent = s; });
  const log = (l) => { session.actions.push({ label: l, at: Date.now() }); };
  const prog = h('span', { class: 'muted small' });

  const center = h('button', { class: 'btn', onclick: async () => {
    if (!(await confirmBox('Calibrate stick centers', 'Put the controller flat and do not touch either stick until it finishes. The new centers apply now and are lost on reboot unless you save them permanently.', 'Calibrate'))) return;
    try { await ds.calibrateCenters((p) => { prog.textContent = p + '%'; }); log('Calibrated stick centers'); toast('Stick centers calibrated. Test them, then save permanently.'); session.circ.l.fill(0); session.circ.r.fill(0); }
    catch (e) { toast(e.message, true, 7000); }
    prog.textContent = '';
  } }, 'Calibrate centers');

  let ranging = false;
  const range = h('button', { class: 'btn', onclick: async (e) => {
    const b = e.currentTarget;
    try {
      if (!ranging) {
        await ds.rangeBegin(); ranging = true; b.textContent = 'Finish range calibration'; b.classList.add('primary');
        toast('Rotate both sticks slowly around their full edge 3 or 4 times, then press Finish.', false, 8000);
      } else {
        await ds.rangeEnd(); ranging = false; b.textContent = 'Calibrate range'; b.classList.remove('primary');
        log('Calibrated stick range'); toast('Range calibrated. Test it, then save permanently.'); session.circ.l.fill(0); session.circ.r.fill(0);
      }
    } catch (err) { ranging = false; b.textContent = 'Calibrate range'; b.classList.remove('primary'); toast(err.message, true, 7000); }
  } }, 'Calibrate range');

  const ftWrap = h('div');
  const ft = h('button', { class: 'btn', onclick: async () => {
    try {
      const vals = await ds.readFinetune();
      if (!vals) throw new Error('Controller did not return fine-tune data');
      const inputs = vals.map((v, i) => h('input', { type: 'number', min: 0, max: ds.finetuneMax, value: v, 'aria-label': FINETUNE_LABELS[i] }));
      fill(ftWrap,
        h('p', { class: 'muted small', style: { margin: '0 0 6px' } }, 'Raw stick calibration values. Nudge in small steps (10–50), apply, and watch the stick view. Save permanently when happy.'),
        h('div', { class: 'ft-grid' }, inputs.map((inp, i) => h('label', {}, FINETUNE_LABELS[i], inp))),
        h('div', { class: 'row', style: { marginTop: '8px' } },
          h('button', { class: 'btn sm primary', onclick: async () => {
            try { await ds.writeFinetune(inputs.map((x) => Math.max(0, Math.min(ds.finetuneMax, +x.value | 0)))); log('Fine-tuned stick calibration'); toast('Fine-tune applied (temporary until saved)'); }
            catch (e) { toast(e.message, true); }
          } }, 'Apply'),
          h('button', { class: 'btn sm', onclick: () => ft.click() }, 'Reload')));
    } catch (e) { toast(e.message, true); }
  } }, 'Fine-tune');

  const save = h('button', { class: 'btn primary', disabled: ds.isEdge, onclick: async () => {
    if (!(await confirmBox('Save calibration permanently', 'This writes the current stick calibration to the controller’s memory. Keep the cable connected until it finishes.', 'Save permanently'))) return;
    try { await ds.savePermanently(); log('Saved calibration permanently'); toast('Calibration saved permanently'); nv.textContent = await ds.nvStatus(); }
    catch (e) { toast(e.message, true, 7000); }
  } }, 'Save permanently');

  return h('div', { class: 'stack' },
    h('p', { class: 'muted small', style: { margin: 0 } }, 'Changes apply immediately but are temporary until you save them permanently. Rebooting the controller discards unsaved changes.'),
    h('div', { class: 'row' }, center, range, ft, prog),
    ftWrap,
    h('div', { class: 'row' }, save,
      h('button', { class: 'btn', onclick: async () => { if (await confirmBox('Reboot controller', 'The controller disconnects and restarts. Unsaved calibration is discarded.', 'Reboot')) ds.reboot(); } }, 'Reboot controller'),
      h('span', { class: 'muted small' }, 'Memory: ', nv)),
    ds.isEdge ? h('p', { class: 'muted small', style: { margin: 0 } }, 'On the DualSense Edge, calibration is stored in the stick modules; finish the permanent save with dualshock-tools.') : null);
}

// ---------- checklist ----------
function checklistPanel() {
  return h('div', { class: 'panel', id: 'checklist' });
}

function renderChecklist() {
  gradeRefresh?.();
  const panel = root && $('#checklist', root);
  if (!panel || !src) return;
  const groups = COMPONENT_GROUPS.filter((g) => !g.edge || src.isEdge);
  const keys = groups.flatMap((g) => g.items.map(([k]) => k));
  const done = keys.filter((k) => session.results[k]).length;
  const limited = info?.limited;
  const outputKeys = new Set(Object.keys(ACTIONS));

  fill(panel,
    h('div', { class: 'check-head' }, h('h2', {}, 'Checklist'),
      h('div', { class: 'row' },
        h('span', { class: 'muted small num' }, `${done} of ${keys.length} checked`),
        h('button', { class: 'btn primary sm', onclick: saveSession, disabled: !record }, 'Save to record'))),
    h('div', { class: 'progress' }, h('i', { style: { width: (done / keys.length) * 100 + '%' } })),
    h('p', { class: 'muted small', style: { margin: '0 0 6px' } }, 'Buttons, triggers, touchpad and motion tick themselves as you use them. Mark the rest after trying them.'),
    groups.map((g) => h('div', { class: 'group' },
      h('div', { class: 'group-head' }, h('h3', {}, g.name)),
      g.items.map(([k, label]) => {
        const v = session.results[k];
        const prev = record?.components?.[k];
        const act = ACTIONS[k];
        const needsUsb = k === 'speaker' || k === 'headphone';
        const canAct = act && (k === 'microphone' || (!limited && !info?.clone && (!needsUsb || info?.connection === 'usb')));
        return h('div', { class: 'item' },
          h('div', { class: 'name' }, h('span', { class: 'mark', 'data-s': v || '' }), label,
            prev && prev !== 'untested' && !v ? h('small', {}, `last: ${STATUS[prev]?.short}`) : null),
          h('div', { class: 'row', style: { gap: '6px' } },
            canAct ? h('button', { class: 'btn sm', onclick: act.go }, act.label)
              : outputKeys.has(k) ? h('small', { class: 'muted', title: limited ? 'Needs the Windows app or Chrome/Edge' : 'Needs a USB cable' }, limited ? 'n/a' : needsUsb ? 'USB only' : '') : null,
            k === 'headphone' && canAct ? h('small', { class: 'muted', id: 'hpstate' }) : null,
            seg(k, v)));
      }))));
}

function seg(k, v) {
  const set = (val) => {
    session.manual.add(k);
    session.results[k] = session.results[k] === val ? undefined : val;
    renderChecklist();
  };
  return h('div', { class: 'seg', role: 'group', 'aria-label': 'Result' },
    [['ok', 'OK'], ['minor', 'Issue'], ['faulty', 'Faulty']].map(([val, l]) =>
      h('button', { 'data-v': val, 'aria-pressed': String(v === val), onclick: () => set(val) }, l)));
}

function quickRecord() {
  const rec = record;
  const upd = async (patch) => { const cur = await getRecord(rec.serial) || rec; Object.assign(cur, patch); record = await saveRecord(cur, { quiet: true }); };
  const notes = h('textarea', { placeholder: 'Anything worth remembering about this one', oninput: debounce((e) => upd({ notes: e.target.value }), 500) });
  notes.value = rec.notes || '';
  // Preview the grade live from this session's results; it is stored when the session is saved.
  const preview = () => {
    const merged = { ...record, components: { ...(record.components || {}), ...session.results } };
    if (!merged.gradeManual) merged.grade = suggestGrade(merged);
    return merged;
  };
  const gradeBox = gradePicker(preview, upd);
  gradeRefresh = gradeBox.refresh;
  const status = h('select', { onchange: (e) => upd({ sale: { ...(record.sale || {}), status: e.target.value } }) },
    SALE_STATUS.map(([v, l]) => h('option', { value: v, selected: rec.sale?.status === v }, l)));
  return h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Record'), h('span', { class: 'muted small' }, `${(rec.tests || []).length} saved test sessions`)),
    h('div', { class: 'stack' },
      h('div', { class: 'field' }, h('span', {}, 'Grade'), gradeBox),
      h('label', { class: 'field' }, h('span', {}, 'Status'), status),
      h('label', { class: 'field' }, h('span', {}, 'Notes'), notes),
      h('a', { href: '#/c/' + encodeURIComponent(rec.serial) }, 'Cosmetic defects, dirt, faults, photos and sale details are in the full record')));
}

export function currentSerial() { return record?.serial; }
