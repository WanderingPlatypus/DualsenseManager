// DualSense / DualSense Edge protocol over WebHID (USB and Bluetooth).
// Protocol details cross-checked against dualshock-tools (MIT, (c) 2024 the_al)
// and the Linux hid-playstation driver.
import { crc32WithHeader } from './crc32.js';

export const SONY = 0x054c;
export const PID_DS5 = 0x0ce6;
export const PID_EDGE = 0x0df2;
export const HID_FILTERS = [
  { vendorId: SONY, productId: PID_DS5 },
  { vendorId: SONY, productId: PID_EDGE },
];

export const COLOR_CODES = {
  '00': 'White', '01': 'Midnight Black', '02': 'Cosmic Red', '03': 'Nova Pink',
  '04': 'Galactic Purple', '05': 'Starlight Blue', '06': 'Grey Camouflage',
  '07': 'Volcanic Red', '08': 'Sterling Silver', '09': 'Cobalt Blue',
  '10': 'Chroma Teal', '11': 'Chroma Indigo', '12': 'Chroma Pearl',
  '13': 'HyperPop Techno Red', '14': 'HyperPop Remix Green', '15': 'HyperPop Rhythm Blue',
  '30': '30th Anniversary', 'Z1': 'God of War Ragnarök', 'Z2': "Spider-Man 2",
  'Z3': 'Astro Bot', 'Z4': 'Fortnite', 'Z6': 'The Last of Us',
  'ZA': 'God of War 20th Anniversary', 'ZB': 'Icon Blue Limited Edition',
  'ZC': 'Ghost of Yōtei Limited Edition', 'ZD': 'Marathon Limited Edition',
  'ZE': 'Genshin Impact Limited Edition', 'ZF': '007 First Light Limited Edition',
};

export function colorFromSerial(serial) {
  if (!serial || serial.length < 6) return '';
  return COLOR_CODES[serial.slice(4, 6).toUpperCase()] || '';
}

function boardFromHw(hw) {
  const a = (hw >> 8) & 0xff;
  return ({ 3: 'BDM-010', 4: 'BDM-020', 5: 'BDM-030', 6: 'BDM-040', 7: 'BDM-050', 8: 'BDM-050',
    9: 'BDM-060R', 0x11: 'BDM-060M', 0x13: 'BDM-060X' })[a] || 'Unknown';
}

const hex = (v, w) => '0x' + (v >>> 0).toString(16).toUpperCase().padStart(w, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v | 0));

function withTimeout(p, ms, label) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label + ' timed out')), ms); })])
    .finally(() => clearTimeout(t));
}

export const BUTTONS = [
  'cross', 'circle', 'square', 'triangle', 'up', 'down', 'left', 'right',
  'l1', 'r1', 'l2', 'r2', 'l3', 'r3', 'create', 'options', 'ps', 'touchpad', 'mute',
];
export const EDGE_BUTTONS = ['fn_left', 'fn_right', 'paddle_left', 'paddle_right'];

const TRIGGER_MODES = { off: 0x00, resistance: 0x01, single: 0x02, auto: 0x06 };

export class DualSense {
  constructor(device) {
    this.device = device;
    this.isEdge = device.productId === PID_EDGE;
    this.model = this.isEdge ? 'DualSense Edge' : 'DualSense';
    this.bt = device.collections.some((c) => (c.inputReports || []).some((r) => r.reportId === 0x31));
    this.connection = this.bt ? 'bluetooth' : 'usb';
    this.btSeq = 0;
    this.onState = null;
    this.out = {
      flag0: 0, flag1: 0, flag2: 0, rumbleR: 0, rumbleL: 0,
      hpVol: 0, spkVol: 0, micVol: 0, audio: 0, muteLed: 0,
      trigR: [0, 0, 0, 0], trigL: [0, 0, 0, 0], lightSetup: 0,
      player: 0, r: 0, g: 0, b: 255,
    };
    this.state = {
      lx: 128, ly: 128, rx: 128, ry: 128, l2: 0, r2: 0,
      buttons: {}, touch: [], gyro: { x: 0, y: 0, z: 0 }, accel: { x: 0, y: 0, z: 0 },
      battery: { level: 0, charging: false, full: false, error: false },
      headphones: false, mic: false, seq: 0, full: false,
    };
    this._onInput = this._onInput.bind(this);
  }

  async open() {
    if (!this.device.opened) await this.device.open();
    this.device.addEventListener('inputreport', this._onInput);
    if (this.bt) {
      // Reading the calibration report switches BT controllers into full (0x31) mode.
      try { await withTimeout(this.device.receiveFeatureReport(0x05), 1500, 'calibration'); } catch { /* ignore */ }
    }
  }

  async close() {
    this.device.removeEventListener('inputreport', this._onInput);
    try { await this.stopEffects(); } catch { /* unplugged */ }
    if (this.device.opened) await this.device.close();
  }

  // ---------- input ----------
  _onInput({ reportId, data }) {
    const s = this.state;
    let o;
    if (reportId === 0x01 && data.byteLength >= 60) o = 0;      // USB full report
    else if (reportId === 0x31) o = 1;                          // BT full report
    else if (reportId === 0x01) {                               // BT simple report
      s.lx = data.getUint8(0); s.ly = data.getUint8(1); s.rx = data.getUint8(2); s.ry = data.getUint8(3);
      this._buttons(data.getUint8(4), data.getUint8(5), data.getUint8(6));
      s.l2 = data.getUint8(7); s.r2 = data.getUint8(8); s.full = false;
      this.onState?.(s);
      return;
    } else return;

    s.full = true;
    s.lx = data.getUint8(o); s.ly = data.getUint8(o + 1);
    s.rx = data.getUint8(o + 2); s.ry = data.getUint8(o + 3);
    s.l2 = data.getUint8(o + 4); s.r2 = data.getUint8(o + 5);
    s.seq = data.getUint8(o + 6);
    this._buttons(data.getUint8(o + 7), data.getUint8(o + 8), data.getUint8(o + 9));

    const g = (i) => data.getInt16(o + i, true);
    s.gyro = { x: g(15) / 14.31, y: g(17) / 14.31, z: g(19) / 14.31 };      // deg/s (nominal)
    s.accel = { x: g(21) / 8192, y: g(23) / 8192, z: g(25) / 8192 };        // g (nominal)

    const touch = [];
    for (let i = 0; i < 2; i++) {
      const b = o + 32 + i * 4;
      const b0 = data.getUint8(b), b1 = data.getUint8(b + 1), b2 = data.getUint8(b + 2), b3 = data.getUint8(b + 3);
      touch.push({ active: (b0 & 0x80) === 0, id: b0 & 0x7f, x: ((b2 & 0x0f) << 8) | b1, y: (b3 << 4) | (b2 >> 4) });
    }
    s.touch = touch;

    const bat = data.getUint8(o + 52);
    const lvl = bat & 0x0f, st = bat >> 4;
    s.battery = {
      level: st === 2 ? 100 : st === 15 ? 0 : Math.min(lvl * 10 + 5, 100),
      charging: st === 1 || st === 15, full: st === 2, error: ![0, 1, 2, 15].includes(st),
    };
    const plug = data.getUint8(o + 53);
    s.headphones = (plug & 0x01) !== 0;
    s.mic = (plug & 0x02) !== 0;
    this.onState?.(s);
  }

  _buttons(b7, b8, b9) {
    const hat = b7 & 0x0f, B = this.state.buttons;
    B.up = hat === 0 || hat === 1 || hat === 7;
    B.right = hat >= 1 && hat <= 3;
    B.down = hat >= 3 && hat <= 5;
    B.left = hat >= 5 && hat <= 7;
    B.square = !!(b7 & 0x10); B.cross = !!(b7 & 0x20); B.circle = !!(b7 & 0x40); B.triangle = !!(b7 & 0x80);
    B.l1 = !!(b8 & 0x01); B.r1 = !!(b8 & 0x02); B.l2 = !!(b8 & 0x04); B.r2 = !!(b8 & 0x08);
    B.create = !!(b8 & 0x10); B.options = !!(b8 & 0x20); B.l3 = !!(b8 & 0x40); B.r3 = !!(b8 & 0x80);
    B.ps = !!(b9 & 0x01); B.touchpad = !!(b9 & 0x02); B.mute = !!(b9 & 0x04);
    if (this.isEdge) {
      B.fn_left = !!(b9 & 0x10); B.fn_right = !!(b9 & 0x20);
      B.paddle_left = !!(b9 & 0x40); B.paddle_right = !!(b9 & 0x80);
    }
  }

  // ---------- feature reports ----------
  _featureLen(id) {
    for (const c of this.device.collections) {
      const r = (c.featureReports || []).find((x) => x.reportId === id);
      if (r) return r.items.reduce((n, it) => n + (it.reportSize * it.reportCount) / 8, 0);
    }
    return 63;
  }

  async sendFeature(id, bytes) {
    const len = this._featureLen(id) || bytes.length;
    const buf = new Uint8Array(len);
    buf.set(bytes.slice(0, len));
    if (this.bt && len >= 4) {
      const crc = crc32WithHeader([0x53, id], buf, len - 4);
      new DataView(buf.buffer).setUint32(len - 4, crc, true);
    }
    await withTimeout(this.device.sendFeatureReport(id, buf), 2000, 'sendFeature ' + id);
  }

  async getFeature(id, ms = 2000) {
    // DataView includes the report ID at byte 0.
    return withTimeout(this.device.receiveFeatureReport(id), ms, 'getFeature ' + id);
  }

  async sysInfo(base, num, length, decode = true) {
    await this.sendFeature(0x80, [base, num]);
    const v = await this.getFeature(0x81);
    if (v.getUint8(1) !== base || v.getUint8(2) !== num || v.getUint8(3) !== 2) return null;
    const slice = new Uint8Array(v.buffer, v.byteOffset + 4, length);
    if (decode) return new TextDecoder().decode(slice).replace(/\0+$/, '').trim();
    return [...slice].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async getSerial() {
    try { return await this.sysInfo(1, 19, 17); } catch { return null; }
  }

  async getMac() {
    try {
      const v = await this.getFeature(0x09, 1500);
      const b = [];
      for (let i = 6; i >= 1; i--) b.push(v.getUint8(i).toString(16).padStart(2, '0'));
      const mac = b.join(':').toUpperCase();
      return mac === '00:00:00:00:00:00' ? null : mac;
    } catch { return null; }
  }

  async getInfo() {
    const info = { model: this.model, connection: this.connection };
    info.mac = await this.getMac();
    try {
      const v = await this.getFeature(0x20);
      if (v.getUint8(0) === 0x20) {
        const td = new TextDecoder();
        const u8 = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
        info.fwBuildDate = (td.decode(u8.slice(1, 12)) + ' ' + td.decode(u8.slice(12, 20))).trim();
        const hw = v.getUint32(24, true);
        info.hwModel = hex(hw, 8);
        info.fwVersion = hex(v.getUint32(28, true), 8);
        info.fwUpdate = hex(v.getUint16(44, true), 4);
        info.board = this.isEdge ? 'Edge' : boardFromHw(hw);
      }
    } catch (e) { info.infoError = String(e.message || e); }

    info.serial = await this.getSerial();
    if (info.serial) {
      info.color = colorFromSerial(info.serial);
      const extra = async (k, ...a) => { try { const r = await this.sysInfo(...a); if (r) info[k] = r; } catch { /* optional */ } };
      await extra('mcuId', 1, 9, 9, false);
      await extra('pcbaId', 1, 17, 14);
      if (info.pcbaId) info.pcbaId = [...info.pcbaId].reverse().join('');
      await extra('batteryBarcode', 1, 24, 23);
      await extra('vcmLeft', 1, 26, 16);
      await extra('vcmRight', 1, 28, 16);
    }

    // Clone heuristics: firmware dated in the future, or no answer to the finetune query.
    info.clone = false;
    const year = parseInt((info.fwBuildDate || '').slice(7, 11), 10);
    if (year && year > new Date().getFullYear()) info.clone = true;
    if (!this.bt && info.serial) {
      try { if (!(await this.readFinetune())) info.clone = true; } catch { info.clone = true; }
    }
    if (!info.serial && !this.bt) info.clone = true;
    if (/ 2020| 2021/.test(info.fwBuildDate || '')) info.oldFirmware = true;
    return info;
  }

  // ---------- output ----------
  _pack() {
    const o = this.out, b = new Uint8Array(47);
    b[0] = o.flag0; b[1] = o.flag1; b[2] = o.rumbleR; b[3] = o.rumbleL;
    b[4] = o.hpVol; b[5] = o.spkVol; b[6] = o.micVol; b[7] = o.audio;
    b[8] = o.muteLed;
    b.set(o.trigR, 10); b.set(o.trigL, 21);
    b[38] = o.flag2; b[41] = o.lightSetup;
    b[43] = o.player; b[44] = o.r; b[45] = o.g; b[46] = o.b;
    return b;
  }

  async _send(setFlags) {
    const o = this.out;
    o.flag0 |= setFlags.f0 || 0; o.flag1 |= setFlags.f1 || 0; o.flag2 |= setFlags.f2 || 0;
    const common = this._pack();
    o.flag0 &= ~(setFlags.f0 || 0); o.flag1 &= ~(setFlags.f1 || 0); o.flag2 &= ~(setFlags.f2 || 0);
    if (!this.bt) {
      await this.device.sendReport(0x02, common);
      return;
    }
    const r = new Uint8Array(77);
    r[0] = (this.btSeq++ & 0x0f) << 4;
    r[1] = 0x10;
    r.set(common, 2);
    new DataView(r.buffer).setUint32(73, crc32WithHeader([0xa2, 0x31], r, 73), true);
    await this.device.sendReport(0x31, r);
  }

  async initOutput() {
    // Same order as the Linux driver: first release the firmware's own lightbar (it runs a
    // pairing animation over Bluetooth and ignores colour changes until released), then set LEDs.
    this.out.lightSetup = 0x02;
    await this._send({ f2: 0x02 });
    this.out.lightSetup = 0;
    await sleep(this.bt ? 150 : 20);
    await this._send({ f1: 0x04 | 0x10 | 0x01 });
  }

  async enableFullReports() {
    if (this.state.full) return;
    try { await withTimeout(this.device.receiveFeatureReport(0x05), 1500, 'calibration'); } catch { /* ignore */ }
    try { await this._send({}); } catch { /* ignore */ }
  }

  setLightbar(r, g, b) { Object.assign(this.out, { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255) }); return this._send({ f1: 0x04 }); }
  setPlayerLeds(mask) { this.out.player = clamp(mask, 0, 31); return this._send({ f1: 0x10 }); }
  setMuteLed(mode) { this.out.muteLed = clamp(mode, 0, 2); return this._send({ f1: 0x01 }); }
  setRumble(heavyLeft, lightRight) {
    this.out.rumbleL = clamp(heavyLeft, 0, 255); this.out.rumbleR = clamp(lightRight, 0, 255);
    return this._send({ f0: 0x03 });
  }
  setTriggers(left, right) {
    const enc = (t) => [TRIGGER_MODES[t.mode] ?? 0, t.start | 0, t.end | 0, t.force | 0];
    this.out.trigL = enc(left); this.out.trigR = enc(right);
    return this._send({ f0: 0x0c });
  }
  async triggerPreset(name) {
    const p = {
      off: { mode: 'off', start: 0, end: 0, force: 0 },
      light: { mode: 'single', start: 10, end: 80, force: 150 },
      medium: { mode: 'single', start: 15, end: 100, force: 200 },
      heavy: { mode: 'single', start: 20, end: 120, force: 255 },
      wall: { mode: 'resistance', start: 60, end: 0, force: 255 },
    }[name];
    return this.setTriggers(p, p);
  }

  async playTone(output = 'speaker', ms = 1000) {
    this.out.spkVol = 85; this.out.hpVol = 55;
    await this._send({ f0: 0x10 | 0x20 | 0x80 });
    if (output === 'headphones') await this.sendFeature(0x80, [6, 4, 0, 0, 0, 0, 4, 0, 6]);
    else await this.sendFeature(0x80, [6, 4, 0, 0, 8]);
    await this.sendFeature(0x80, [6, 2, 1, 1, 0]);
    await sleep(ms);
    await this.sendFeature(0x80, [6, 2, 0, 1, 0]);
    this.out.spkVol = 0;
    await this._send({ f0: 0x20 | 0x80 });
  }

  async stopEffects() {
    this.out.rumbleL = 0; this.out.rumbleR = 0;
    this.out.trigL = [0, 0, 0, 0]; this.out.trigR = [0, 0, 0, 0];
    await this._send({ f0: 0x03 | 0x0c });
  }

  // ---------- calibration (USB only) ----------
  async _assert83(cmd, expect) {
    await this.sendFeature(0x82, cmd);
    const v = await this.getFeature(0x83);
    const got = v.getUint32(0, false);
    if (got !== expect) throw new Error(`Controller answered ${hex(got, 8)} (expected ${hex(expect, 8)}) — likely not a genuine controller`);
  }

  async calibrateCenters(progress = () => {}) {
    progress(10);
    await this._assert83([1, 1, 1], 0x83010101);
    for (let i = 0; i < 5; i++) {
      await sleep(120);
      await this._assert83([3, 1, 1], 0x83010101);
      progress(20 + i * 14);
    }
    await this._assert83([2, 1, 1], 0x83010102);
    progress(100);
  }

  rangeBegin() { return this._assert83([1, 1, 2], 0x83010201); }
  rangeEnd() { return this._assert83([2, 1, 2], 0x83010202); }

  async nvStatus() {
    try {
      await this.sendFeature(0x80, [3, 3]);
      const v = await this.getFeature(0x81);
      const r = v.getUint32(1, false);
      if (r === 0x15010100) return 'pending reboot';
      if (r === 0x03030201) return 'locked';
      if (r === 0x03030200) return 'unlocked';
      return 'unknown ' + hex(r, 8);
    } catch { return 'error'; }
  }
  async nvsLock() { await this.sendFeature(0x80, [3, 1]); await this.getFeature(0x81); }
  async nvsUnlock() { await this.sendFeature(0x80, [3, 2, 101, 50, 64, 12]); await this.getFeature(0x81); }

  // Commits the in-memory calibration to flash (DualSense only; Edge stores calibration in its stick modules).
  async savePermanently() {
    if (this.isEdge) throw new Error('Permanent save on the DualSense Edge needs module flashing — use dualshock-tools for that step.');
    await this.nvsUnlock();
    await this.nvsLock();
  }

  async reboot() { try { await this.sendFeature(0x80, [1, 1]); } catch { /* controller drops off the bus */ } }

  async readFinetune() {
    await this.sendFeature(0x80, [12, 2]);
    await sleep(100);
    const v = await this.getFeature(0x81);
    const [c, p1, p2, p3] = [0, 1, 2, 3].map((i) => v.getUint8(i));
    if (c !== 0x81 || p1 !== 12 || (p2 !== 2 && p2 !== 4) || p3 !== 2) return null;
    return Array.from({ length: 12 }, (_, i) => v.getUint16(4 + i * 2, true));
  }

  async writeFinetune(values) {
    if ((await this.nvStatus()) !== 'locked') await this.nvsLock();
    const pkg = [12, 1];
    for (const v of values) pkg.push(v & 0xff, (v >> 8) & 0xff);
    await this.sendFeature(0x80, pkg);
  }

  get finetuneMax() { return this.isEdge ? 4095 : 65535; }
}

export const FINETUNE_LABELS = [
  'Left stick · left edge', 'Left stick · top edge', 'Right stick · left edge', 'Right stick · top edge',
  'Left stick · right edge', 'Left stick · bottom edge', 'Right stick · right edge', 'Right stick · bottom edge',
  'Left stick · center X', 'Left stick · center Y', 'Right stick · center X', 'Right stick · center Y',
];
