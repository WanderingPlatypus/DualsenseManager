// Schematic top view of a DualSense. Every pressable part carries data-b="<button>".
export function padSvg({ edge = false } = {}) {
  const face = (cx, cy, name, sym) => `<g><circle class="b" data-b="${name}" cx="${cx}" cy="${cy}" r="15"/>${sym}</g>`;
  const tri = 'M470 126 l8 13 h-16 z';
  const cir = '<circle class="sym" cx="503" cy="165" r="6.5"/>';
  const crs = '<path class="sym" d="M464 189 l12 12 M476 189 l-12 12"/>';
  const sqr = '<rect class="sym" x="431" y="159" width="12" height="12"/>';
  const edgeParts = edge ? `
    <rect class="b" data-b="fn_left" x="232" y="262" width="26" height="9" rx="4.5"/>
    <rect class="b" data-b="fn_right" x="342" y="262" width="26" height="9" rx="4.5"/>
    <rect class="b" data-b="paddle_left" x="62" y="300" width="44" height="12" rx="6" stroke-dasharray="4 3"/>
    <rect class="b" data-b="paddle_right" x="494" y="300" width="44" height="12" rx="6" stroke-dasharray="4 3"/>
    <text class="lbl" x="84" y="330">paddle</text><text class="lbl" x="516" y="330">paddle</text>` : '';
  return `
<svg class="pad" viewBox="0 0 600 390" role="img" aria-label="Controller input map">
  <defs><clipPath id="clipL2"><rect x="95" y="16" width="100" height="22" rx="9"/></clipPath>
  <clipPath id="clipR2"><rect x="405" y="16" width="100" height="22" rx="9"/></clipPath></defs>
  <rect class="b" data-b="l2" x="95" y="16" width="100" height="22" rx="9"/>
  <rect class="tfill" id="l2fill" x="95" y="16" width="0" height="22" clip-path="url(#clipL2)"/>
  <rect class="b" data-b="r2" x="405" y="16" width="100" height="22" rx="9"/>
  <rect class="tfill" id="r2fill" x="405" y="16" width="0" height="22" clip-path="url(#clipR2)"/>
  <text class="lbl" x="145" y="31">L2</text><text class="lbl" x="455" y="31">R2</text>
  <rect class="b" data-b="l1" x="98" y="42" width="96" height="14" rx="6"/>
  <rect class="b" data-b="r1" x="406" y="42" width="96" height="14" rx="6"/>
  <path class="body" d="M150 60 C210 46 390 46 450 60 C520 70 560 110 575 170 C595 250 600 320 560 350 C530 372 490 362 470 330 C445 290 420 272 380 272 L220 272 C180 272 155 290 130 330 C110 362 70 372 40 350 C0 320 5 250 25 170 C40 110 80 70 150 60 Z"/>
  <rect class="b" data-b="touchpad" x="212" y="66" width="176" height="100" rx="16"/>
  <g id="touchdots"></g>
  <rect class="b" data-b="create" x="186" y="78" width="9" height="22" rx="4.5"/>
  <rect class="b" data-b="options" x="405" y="78" width="9" height="22" rx="4.5"/>
  <rect class="b" data-b="up" x="119" y="124" width="22" height="26" rx="5"/>
  <rect class="b" data-b="down" x="119" y="180" width="22" height="26" rx="5"/>
  <rect class="b" data-b="left" x="89" y="154" width="26" height="22" rx="5"/>
  <rect class="b" data-b="right" x="145" y="154" width="26" height="22" rx="5"/>
  ${face(470, 135, 'triangle', `<path class="sym" d="${tri}"/>`)}
  ${face(503, 165, 'circle', cir)}
  ${face(470, 195, 'cross', crs)}
  ${face(437, 165, 'square', sqr)}
  <circle class="b" data-b="l3" cx="215" cy="222" r="30"/>
  <circle class="b" data-b="r3" cx="385" cy="222" r="30"/>
  <circle class="stickdot" id="ldot" cx="215" cy="222" r="9"/>
  <circle class="stickdot" id="rdot" cx="385" cy="222" r="9"/>
  <circle class="b" data-b="ps" cx="300" cy="212" r="11"/>
  <rect class="b" data-b="mute" x="289" y="236" width="22" height="8" rx="4"/>
  ${edgeParts}
</svg>`;
}
