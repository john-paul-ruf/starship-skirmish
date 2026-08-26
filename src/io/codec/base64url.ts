// M07 IO — base64url encode/decode (specs/database.md §5, architecture §8.1).
//
// Base64url alphabet ("A-Z a-z 0-9 - _"), NO PADDING — the wire format matches
// URL-fragment convention. Deliberately hand-rolled rather than using `atob`
// (browser-only, deprecated in Node) or `Buffer` (Node-only): the io layer must
// load identically in Vite (browser), Vitest (Node), and the tsx harness (Node
// bare CLI). One implementation, three runtimes, no environment sniffing.
//
// Deliberately module-private to `src/io/codec/**` — a wire-format primitive,
// not a general utility.

/** Base64url alphabet, in the order encoded value 0..63 maps to. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Reverse lookup: byte value of an alphabet character → its 6-bit encoded
 * value. Any non-alphabet character maps to `-1`, which the decoder treats as
 * a hard reject (`ERR_BAD_BASE64` at the caller). Built once at module init.
 */
const DECODE_TABLE: Int8Array = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i += 1) {
    table[ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/**
 * Encode `bytes` as base64url (no padding). Exact round-trip for every input
 * byte 0..255. Never throws.
 */
export const toBase64url = (bytes: Uint8Array): string => {
  let out = '';
  let i = 0;
  const len = bytes.length;
  // Full 3-byte groups → 4 base64 chars.
  while (i + 3 <= len) {
    const b0 = bytes[i] as number;
    const b1 = bytes[i + 1] as number;
    const b2 = bytes[i + 2] as number;
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    out += ALPHABET[b2 & 0x3f];
    i += 3;
  }
  const remainder = len - i;
  if (remainder === 1) {
    const b0 = bytes[i] as number;
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[(b0 & 0x03) << 4];
  } else if (remainder === 2) {
    const b0 = bytes[i] as number;
    const b1 = bytes[i + 1] as number;
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += ALPHABET[(b1 & 0x0f) << 2];
  }
  return out;
};

/**
 * Decode `str` from base64url (no padding). Returns `null` on ANY non-alphabet
 * character (padding `=` included — padding is not part of the wire format) or
 * on an illegal 1-character trailing group. Never throws.
 *
 * The caller (`decodeShareToken`) maps `null` to `ERR_BAD_BASE64` with the
 * offset already known from its own char index.
 */
export const fromBase64url = (str: string): Uint8Array | null => {
  const len = str.length;
  if (len === 0) return new Uint8Array(0);

  // Validate + decode into a scratch array of 6-bit values.
  const values = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    const code = str.charCodeAt(i);
    // Reject ANY character outside the alphabet (padding `=` included).
    if (code >= 128) return null;
    const v = DECODE_TABLE[code] as number;
    if (v < 0) return null;
    values[i] = v;
  }

  // Every 4 chars → 3 bytes; the trailing group is 2 chars → 1 byte or 3 chars
  // → 2 bytes. A remainder of 1 char is illegal base64.
  const remainder = len % 4;
  if (remainder === 1) return null;
  const fullGroups = (len - remainder) >> 2;
  const outLen = fullGroups * 3 + (remainder === 2 ? 1 : remainder === 3 ? 2 : 0);
  const out = new Uint8Array(outLen);

  let inCursor = 0;
  let outCursor = 0;
  for (let g = 0; g < fullGroups; g += 1) {
    const v0 = values[inCursor] as number;
    const v1 = values[inCursor + 1] as number;
    const v2 = values[inCursor + 2] as number;
    const v3 = values[inCursor + 3] as number;
    out[outCursor] = (v0 << 2) | (v1 >> 4);
    out[outCursor + 1] = ((v1 & 0x0f) << 4) | (v2 >> 2);
    out[outCursor + 2] = ((v2 & 0x03) << 6) | v3;
    inCursor += 4;
    outCursor += 3;
  }
  if (remainder === 2) {
    const v0 = values[inCursor] as number;
    const v1 = values[inCursor + 1] as number;
    out[outCursor] = (v0 << 2) | (v1 >> 4);
  } else if (remainder === 3) {
    const v0 = values[inCursor] as number;
    const v1 = values[inCursor + 1] as number;
    const v2 = values[inCursor + 2] as number;
    out[outCursor] = (v0 << 2) | (v1 >> 4);
    out[outCursor + 1] = ((v1 & 0x0f) << 4) | (v2 >> 2);
  }
  return out;
};
