// Live controller drawing. The artwork is dualshock-tools' DualSense / Edge SVG
// (MIT, (c) 2024 the_al — see assets/LICENSE-dualshock-tools.txt); the update logic mirrors theirs.
const cache = {};
const C = { outline: '#6f7789', buttonLine: '#8d96a8', infill: '#262932', pressed: '#3f6fe8', seen: '#1d4a45' };

const SVG_NAME = {
  cross: 'Cross', circle: 'Circle', square: 'Square', triangle: 'Triangle', l1: 'L1', r1: 'R1',
  create: 'Create', options: 'Options', ps: 'PS', mute: 'Mute', touchpad: 'Trackpad',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right', l3: 'L3', r3: 'R3',
  fn_left: 'Fn_left', fn_right: 'Fn_right', paddle_left: 'Paddle_left', paddle_right: 'Paddle_right',
};
const STICKS = {
  ds5: { max: 25, scale: ' scale(0.70)', base: 'translate(0,0.65)' },
  edge: { max: 25, scale: '', base: '' },
};

function paint(group, color) {
  if (!group) return;
  for (const el of group.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon')) {
    if (el.classList.contains('ds-touch')) continue;
    el.setAttribute('fill', color);
    el.setAttribute('stroke', color);
  }
}

function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

export async function loadPad(container, { edge = false } = {}) {
  const file = edge ? 'ds-edge-controller.svg' : 'dualsense-controller.svg';
  cache[file] ??= fetch('assets/' + file).then((r) => r.text());
  container.innerHTML = await cache[file];
  const svg = container.querySelector('svg');
  svg.removeAttribute('style');
  svg.removeAttribute('id');
  svg.classList.add('pad');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Live controller input');
  const q = (id) => svg.querySelector(`[id="${id}"]`);
  paint(q('Controller'), C.outline);
  for (const id of ['Button_outlines', 'Button_outlines_behind', 'L3_outline', 'R3_outline', 'Trackpad_outline', 'Speaker_grill']) paint(q(id), C.buttonLine);
  for (const id of ['Controller_infills', 'Button_infills', 'Button_infills_behind', 'L3_infill', 'R3_infill', 'Trackpad_infill']) paint(q(id), C.infill);
  for (const id of ['L2_percentage', 'R2_percentage']) q(id)?.setAttribute('opacity', '0');
  return new PadView(svg, edge, q);
}

class PadView {
  constructor(svg, edge, q) {
    this.svg = svg; this.q = q; this.cfg = edge ? STICKS.edge : STICKS.ds5;
    this.last = {};
    this.trackpad = q('Trackpad_infill');
    this.tpBox = null;
  }

  update(s, seen = {}) {
    for (const [name, id] of Object.entries(SVG_NAME)) {
      const color = s.buttons[name] ? C.pressed : seen[name] ? C.seen : C.infill;
      if (this.last[name] !== color) { paint(this.q(id + '_infill'), color); this.last[name] = color; }
    }
    for (const t of ['l2', 'r2']) {
      const v = s[t] | 0;
      const key = t + v + (seen[t] ? 's' : '');
      if (this.last[t] !== key) {
        this.last[t] = key;
        paint(this.q(t.toUpperCase() + '_infill'), mix(seen[t] ? C.seen : C.infill, C.pressed, v / 255));
        const pct = this.q(t.toUpperCase() + '_percentage');
        if (pct) {
          const p = Math.round((v / 255) * 100);
          pct.textContent = p + ' %';
          pct.setAttribute('opacity', p > 0 ? '1' : '0');
          pct.setAttribute('fill', '#ffffff');
        }
      }
    }
    const n = (v) => (v - 127.5) / 127.5;
    const { max, scale, base } = this.cfg;
    this.q('L3')?.setAttribute('transform', `${base} translate(${n(s.lx) * max},${n(s.ly) * max})${scale}`);
    this.q('R3')?.setAttribute('transform', `${base} translate(${n(s.rx) * max},${n(s.ry) * max})${scale}`);
    this._touch(s.touch || []);
  }

  _touch(points) {
    const tp = this.trackpad;
    if (!tp) return;
    tp.querySelectorAll('circle.ds-touch').forEach((c) => c.remove());
    const active = points.filter((p) => p.active);
    if (!active.length) return;
    this.tpBox ??= tp.querySelector('path')?.getBBox();
    const b = this.tpBox;
    if (!b) return;
    const r = b.width * 0.05;
    active.forEach((pt, i) => {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('class', 'ds-touch');
      c.setAttribute('cx', b.x + r + (Math.min(pt.x, 1919) / 1920) * (b.width - 2 * r));
      c.setAttribute('cy', b.y + r + (Math.min(pt.y, 1079) / 1080) * (b.height - 2 * r));
      c.setAttribute('r', r);
      c.setAttribute('fill', i === 0 ? '#3f6fe8' : '#c4519f');
      c.setAttribute('fill-opacity', '0.6');
      c.setAttribute('stroke', '#9db5ff');
      c.setAttribute('stroke-width', '3');
      tp.appendChild(c);
    });
  }
}
