// Shared by the app and the server. Last write wins on the whole record,
// except test sessions, photos and repairs, which are merged by id so that two devices
// testing the same controller offline never lose a session.
const LISTS = ['tests', 'photos', 'repairs'];

export function mergeRecords(a, b) {
  if (!a) return b;
  if (!b) return a;
  const [newer, older] = (b.updatedAt || 0) >= (a.updatedAt || 0) ? [b, a] : [a, b];
  const out = { ...newer };
  const tomb = new Set([...(a.tombstones || []), ...(b.tombstones || [])]);
  out.tombstones = [...tomb];
  for (const k of LISTS) {
    const map = new Map();
    for (const it of [...(older[k] || []), ...(newer[k] || [])]) if (it && it.id && !tomb.has(it.id)) map.set(it.id, it);
    out[k] = [...map.values()];
    if (k !== 'photos') out[k].sort((x, y) => (x.date || 0) - (y.date || 0));
  }
  return out;
}

export function sameRecord(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
