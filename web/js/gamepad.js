// Fallback for browsers without WebHID (Firefox): standard Gamepad API.
// Gives buttons, sticks and triggers only — no serial, lights, rumble, IMU or calibration.
const STD = ['cross', 'circle', 'square', 'triangle', 'l1', 'r1', 'l2', 'r2', 'create', 'options',
  'l3', 'r3', 'up', 'down', 'left', 'right', 'ps', 'touchpad'];

export class GamepadSource {
  constructor(index, id) {
    this.index = index;
    this.id = id;
    this.model = /edge|0df2/i.test(id) ? 'DualSense Edge' : 'DualSense';
    this.isEdge = this.model === 'DualSense Edge';
    this.connection = 'gamepad-api';
    this.limited = true;
    this.onState = null;
    this.state = {
      lx: 128, ly: 128, rx: 128, ry: 128, l2: 0, r2: 0, buttons: {}, touch: [],
      gyro: { x: 0, y: 0, z: 0 }, accel: { x: 0, y: 0, z: 0 },
      battery: null, headphones: false, mic: false, full: false,
    };
    this._raf = 0;
  }

  async open() {
    const tick = () => {
      const gp = navigator.getGamepads()[this.index];
      if (gp) this._read(gp);
      this._raf = requestAnimationFrame(tick);
    };
    tick();
  }

  async close() { cancelAnimationFrame(this._raf); }

  _read(gp) {
    const s = this.state, ax = (i) => Math.round(((gp.axes[i] ?? 0) + 1) * 127.5);
    if (gp.mapping === 'standard') {
      STD.forEach((name, i) => { s.buttons[name] = !!gp.buttons[i]?.pressed; });
      s.lx = ax(0); s.ly = ax(1); s.rx = ax(2); s.ry = ax(3);
      s.l2 = Math.round((gp.buttons[6]?.value ?? 0) * 255);
      s.r2 = Math.round((gp.buttons[7]?.value ?? 0) * 255);
    } else {
      // Unmapped layout (Firefox on some platforms): HID order for DualSense.
      const order = ['square', 'cross', 'circle', 'triangle', 'l1', 'r1', 'l2', 'r2', 'create', 'options', 'l3', 'r3', 'ps', 'touchpad', 'mute'];
      order.forEach((name, i) => { s.buttons[name] = !!gp.buttons[i]?.pressed; });
      s.lx = ax(0); s.ly = ax(1); s.rx = ax(2); s.ry = ax(5);
      s.l2 = ax(3); s.r2 = ax(4);
      const hat = gp.axes[9];
      if (hat !== undefined) {
        const h = Math.round((hat + 1) * 3.5); // 0..7, >7 = released
        s.buttons.up = h === 0 || h === 1 || h === 7; s.buttons.right = h >= 1 && h <= 3;
        s.buttons.down = h >= 3 && h <= 5; s.buttons.left = h >= 5 && h <= 7;
      }
    }
    this.onState?.(s);
  }

  async getInfo() { return { model: this.model, connection: this.connection, serial: null, limited: true }; }
  // Rumble through the Gamepad API where the browser supports it.
  async setRumble(l, r) {
    const gp = navigator.getGamepads()[this.index];
    const act = gp?.vibrationActuator;
    if (act?.playEffect) await act.playEffect('dual-rumble', { duration: 600, strongMagnitude: l / 255, weakMagnitude: r / 255 });
    else throw new Error('This browser cannot drive rumble');
  }
}

export function findDualSenseGamepads() {
  return [...navigator.getGamepads()].filter((g) => g && /054c|dualsense|wireless controller|playstation|sony/i.test(g.id));
}
