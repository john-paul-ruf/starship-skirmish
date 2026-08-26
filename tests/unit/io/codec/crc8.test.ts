// M07 IO — CRC-8 (poly 0x07) tests.
//
// Proves:
//   1. A stable output for a known vector (the polynomial is frozen; a
//      changed value invalidates every share token in the wild).
//   2. A one-bit flip changes the output — the whole point of a checksum.
//   3. Empty buffer → 0 (init is `0x00`, no bytes to fold in).
//   4. Deterministic across calls; never mutates the input.

import { describe, expect, it } from 'vitest';
import { crc8 } from '../../../../src/io/codec/crc8.js';

describe('crc8 — pinned output', () => {
  it('returns 0 for the empty buffer (init = 0x00)', () => {
    expect(crc8(new Uint8Array(0))).toBe(0);
  });

  it('returns a stable value for a known vector (pin — polynomial 0x07)', () => {
    // The classic "123456789" test vector for CRC-8/SMBUS (poly 0x07, init 0x00,
    // no reflect, no final xor) is 0xF4. If this changes, the polynomial or
    // parameters were altered — which silently invalidates every share token.
    const bytes = new Uint8Array(9);
    for (let i = 0; i < 9; i += 1) bytes[i] = 0x31 + i; // '1'..'9'
    expect(crc8(bytes)).toBe(0xf4);
  });

  it('is deterministic across repeated calls', () => {
    const bytes = new Uint8Array([0x53, 0x01, 0x01, 0x02, 0x03, 0x00]);
    const first = crc8(bytes);
    const second = crc8(bytes);
    expect(first).toBe(second);
  });
});

describe('crc8 — sensitivity', () => {
  it('differs on a one-bit flip', () => {
    const a = new Uint8Array([0x53, 0x01, 0x01, 0x02, 0x03, 0x00]);
    const b = new Uint8Array([0x53, 0x01, 0x01, 0x02, 0x03, 0x01]); // last byte flipped
    expect(crc8(a)).not.toBe(crc8(b));
  });

  it('differs on a byte reorder', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([4, 3, 2, 1]);
    expect(crc8(a)).not.toBe(crc8(b));
  });

  it('does not mutate the input', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const snapshot = Array.from(bytes);
    crc8(bytes);
    expect(Array.from(bytes)).toEqual(snapshot);
  });
});
