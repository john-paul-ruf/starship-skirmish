// M07 IO — CRC-8 integrity byte for the share token (specs/database.md §5,
// architecture §8.1).
//
// The CRC is the trailing byte of every share token; a mismatch on decode
// surfaces `ERR_CHECKSUM`. It catches accidental corruption (a URL truncated
// by a chat client, a stray-character paste) but is NOT a security primitive —
// the payload is untrusted regardless.
//
// POLYNOMIAL: 0x07 (the standard "CRC-8" polynomial, x^8 + x^2 + x + 1,
// sometimes called "CRC-8/SMBUS"), init 0x00, no reflect, no final XOR.
// FROZEN FOREVER — every share token ever generated depends on this exact
// polynomial. Changing it silently invalidates every token in the wild.

/** Polynomial (frozen). Documented above; do not change. */
const POLY = 0x07;

/**
 * Precomputed lookup table for CRC-8 with `POLY`. Built once at module init.
 * `readonly` on `Uint8Array` is expressed by never exporting the table (this
 * module owns it) and by not mutating it after construction.
 */
const TABLE: Uint8Array = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let b = 0; b < 8; b += 1) {
      c = (c & 0x80) !== 0 ? ((c << 1) ^ POLY) & 0xff : (c << 1) & 0xff;
    }
    t[i] = c;
  }
  return t;
})();

/**
 * CRC-8 (poly `0x07`, init `0x00`) over `bytes`. Returns a number in `0..255`.
 * Never throws; never allocates beyond the fixed table above.
 */
export const crc8 = (bytes: Uint8Array): number => {
  let crc = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i] as number;
    crc = TABLE[(crc ^ b) & 0xff] as number;
  }
  return crc;
};
