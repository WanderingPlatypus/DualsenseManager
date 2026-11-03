// Standard CRC-32 (IEEE 802.3), as used by DualSense Bluetooth reports.
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, seed = 0xffffffff) {
  let c = seed;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// CRC over a one-byte BT header followed by the payload, without allocating.
export function crc32WithHeader(header, bytes, len = bytes.length) {
  let c = 0xffffffff;
  for (const b of header) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  for (let i = 0; i < len; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
