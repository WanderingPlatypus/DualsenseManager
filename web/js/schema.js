// What a controller record can hold. Edit these lists to change the checklists in the app.

export const COMPONENT_GROUPS = [
  { name: 'Face buttons', items: [['cross', 'Cross'], ['circle', 'Circle'], ['square', 'Square'], ['triangle', 'Triangle']] },
  { name: 'D-pad', items: [['up', 'Up'], ['down', 'Down'], ['left', 'Left'], ['right', 'Right']] },
  { name: 'Shoulders and triggers', items: [['l1', 'L1'], ['r1', 'R1'], ['l2', 'L2 (analog)'], ['r2', 'R2 (analog)']] },
  { name: 'Sticks', items: [['lstick', 'Left stick'], ['rstick', 'Right stick'], ['l3', 'L3 click'], ['r3', 'R3 click']] },
  { name: 'System buttons', items: [['create', 'Create'], ['options', 'Options'], ['ps', 'PS'], ['mute', 'Mute'], ['touchpad', 'Touchpad click']] },
  { name: 'Edge extras', edge: true, items: [['fn_left', 'Fn left'], ['fn_right', 'Fn right'], ['paddle_left', 'Back paddle left'], ['paddle_right', 'Back paddle right']] },
  { name: 'Sensors', items: [['touch_surface', 'Touchpad surface'], ['imu', 'Gyro and accelerometer']] },
  { name: 'Feedback', items: [['trigger_l', 'Adaptive trigger L'], ['trigger_r', 'Adaptive trigger R'], ['rumble_l', 'Haptic motor L'], ['rumble_r', 'Haptic motor R'], ['speaker', 'Speaker'], ['microphone', 'Microphone'], ['headphone', 'Headphone jack']] },
  { name: 'Lights', items: [['lightbar', 'Lightbar'], ['player_leds', 'Player LEDs'], ['mute_led', 'Mute LED']] },
  { name: 'Power and connection', items: [['usb', 'USB-C port'], ['battery', 'Battery and charging'], ['bluetooth', 'Bluetooth']] },
];

export const STATUS = {
  untested: { label: 'Not tested', short: '—' },
  ok: { label: 'Works', short: 'OK' },
  minor: { label: 'Works, with issue', short: 'Issue' },
  faulty: { label: 'Faulty', short: 'Faulty' },
};

export const GRADES = [
  ['A', 'A — like new'], ['B', 'B — light wear'], ['C', 'C — visible wear'], ['D', 'D — heavy wear'], ['P', 'Parts only'],
];

export const SALE_STATUS = [
  ['testing', 'To test / repair'], ['ready', 'Ready to sell'], ['listed', 'Listed'],
  ['reserved', 'Reserved'], ['sold', 'Sold'], ['keeping', 'Keeping'], ['parts', 'Parted out'],
];

export const COSMETIC_TAGS = ['Scratches', 'Scuffs', 'Shiny / worn grips', 'Yellowed shell', 'Discoloration',
  'Cracked shell', 'Loose / creaky shell', 'Worn stick caps', 'Torn stick rubber', 'Faded button symbols',
  'Touchpad scratches', 'Sticker residue', 'Chewed / dented edges', 'Missing part'];

export const DIRT_TAGS = ['Grime in seams', 'Sticky buttons', 'Sticky triggers', 'Dirty stick caps',
  'Dust in ports', 'Dirty touchpad', 'Greasy grips', 'Smoke smell', 'Pet hair', 'Needs full clean'];

export const FAULT_TAGS = ['Left stick drift', 'Right stick drift', 'Poor stick circularity', 'Button not registering',
  'Double press', 'Mushy button', 'Trigger spring broken', 'Adaptive trigger motor dead', 'Rattle inside',
  "Won't charge", 'Short battery life', 'Loose USB port', "Won't pair over Bluetooth", 'Speaker crackle',
  'Weak haptics', 'Ribbon cable fault', 'Clone / not genuine'];

export function emptyRecord(serial) {
  const now = Date.now();
  return {
    serial,
    createdAt: now, updatedAt: now,
    model: 'DualSense', color: '', colorCustom: '', mac: '', board: '', fwVersion: '', fwBuildDate: '',
    hwModel: '', pcbaId: '', batteryBarcode: '', clone: false,
    grade: '', components: {},
    cosmetic: [], cosmeticNotes: '',
    dirt: [], dirtNotes: '',
    faults: [], faultNotes: '',
    repairs: [], tests: [], photos: [], tombstones: [],
    notes: '', location: '', tags: [],
    sale: { status: 'testing', purchasePrice: '', purchaseDate: '', source: '', salePrice: '', saleDate: '', platform: '', buyer: '', listingUrl: '' },
    deleted: false,
  };
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// Grade suggested from what is recorded: cosmetic wear sets the base, faults pull it down.
export function suggestGrade(rec) {
  const comps = Object.values(rec.components || {});
  const faulty = Math.max(comps.filter((v) => v === 'faulty').length, (rec.faults || []).filter((f) => !/clone/i.test(f)).length);
  const minor = comps.filter((v) => v === 'minor').length;
  const cos = rec.cosmetic || [];
  const tested = comps.some((v) => v && v !== 'untested');
  if (!tested && !cos.length && !faulty) return '';
  if (rec.clone || faulty >= 4) return 'P';
  let g = cos.length === 0 ? 0 : cos.length <= 2 ? 1 : cos.length <= 4 ? 2 : 3;
  if (cos.some((t) => /crack|missing|chewed|dent/i.test(t))) g = Math.max(g, 3);
  if (minor >= 1) g = Math.max(g, 1);
  if (minor >= 3) g = Math.max(g, 2);
  if (faulty >= 1) g = Math.max(g, 2);
  if (faulty >= 2) g = Math.max(g, 3);
  return 'ABCD'[g];
}

// Keeps the grade in step with the suggestion until the user picks one by hand.
export function applyAutoGrade(rec) {
  if (rec.gradeManual === undefined) rec.gradeManual = !!rec.grade;
  if (!rec.gradeManual) rec.grade = suggestGrade(rec);
  return rec;
}
