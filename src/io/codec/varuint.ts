// M07 IO — unsigned LEB128 varuint codec (specs/database.md §5, architecture §8.1).
//
// The share token stores every numeric field as a varuint: 7 payload bits per
// byte, high bit = "another byte follows". Small numbers (every catalog v1
// ordinal, every slot count, every legal `nameLen`) fit in one byte, which is
// why a fully-fitted 12-slot mega destroyer lands at ~52 base64url characters
// (§5 "Size check").
//
// The reader is HOSTILE-INPUT-SAFE: it can be called on foreign bytes with any
// shape whatsoever, so truncation (continuation bit set past the end of input)
// and overlong encodings (more than 5 bytes for a 32-bit-safe value) return
// `null` rather than throw. Callers surface `null` as `ERR_TRUNCATED` and stop
// (§10 note 7: never take a length from foreign data without a cap).
//
// Deliberately module-private to `src/io/codec/**` — this is a wire-format
// primitive, not a general utility. The io barrel does not re-export it.

/**
 * Maximum bytes the reader will consume for one varuint. Five 7-bit groups
 * cover 35 bits — sufficient for every value the share token layout will ever
 * hold (max ordinal at v1 is 38; even a v100 catalog with 100k ordinals fits
 * in 3 bytes). A hostile input encoding `Infinity` via 1000 continuation bytes
 * therefore stops at 5 rather than looping.
 */
const MAX_VARUINT_BYTES = 5;

/**
 * Append the unsigned LEB128 encoding of `n` to `out`. `n` must be a
 * non-negative safe integer; the encoder is called only from
 * `encodeShareToken` on values the encoder itself produced (chassis ordinal,
 * slot count, nameLen), never on foreign input. Precondition guards throw a
 * `RangeError` because they signal an encoder bug, not a foreign-input error.
 */
export const writeVaruint = (n: number, out: number[]): void => {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`writeVaruint: expected a non-negative integer (got ${n}).`);
  }
  let value = n;
  // Every byte except the last has its high bit set (continuation).
  while (value >= 0x80) {
    out.push((value & 0x7f) | 0x80);
    value = Math.floor(value / 128);
  }
  out.push(value & 0x7f);
};

/**
 * Read one unsigned LEB128 varuint from `bytes` starting at `offset`. Returns
 * `{ value, next }` on success, or `null` on truncation (continuation bit set
 * at end of input) or overlong encoding (> `MAX_VARUINT_BYTES`).
 *
 * `next` is the byte offset immediately after the last consumed byte, ready to
 * pass into the next read. The reader never mutates `bytes`.
 */
export const readVaruint = (
  bytes: Uint8Array,
  offset: number,
): { readonly value: number; readonly next: number } | null => {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  for (let i = 0; i < MAX_VARUINT_BYTES; i += 1) {
    if (cursor >= bytes.length) return null; // truncated
    const byte = bytes[cursor] as number;
    cursor += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) {
      return { value, next: cursor };
    }
    shift += 7;
  }
  // Ran past MAX_VARUINT_BYTES with the continuation bit still set — overlong.
  return null;
};
