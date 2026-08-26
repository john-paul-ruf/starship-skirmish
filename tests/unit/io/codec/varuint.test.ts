// M07 IO — varuint codec tests.
//
// Proves the four things the share-token layout depends on:
//   1. Every value the wire format will ever carry (0, 1, 127, 128, 16383,
//      16384) round-trips exactly.
//   2. A truncated buffer (continuation bit set past end-of-input) returns
//      `null` and does not throw.
//   3. An overlong encoding (> 5 bytes with the continuation bit still set)
//      returns `null` and does not throw.
//   4. The reader never mutates the buffer.

import { describe, expect, it } from 'vitest';
import { readVaruint, writeVaruint } from '../../../../src/io/codec/varuint.js';

const roundTrip = (n: number): number => {
  const out: number[] = [];
  writeVaruint(n, out);
  const bytes = new Uint8Array(out);
  const read = readVaruint(bytes, 0);
  if (read === null) throw new Error(`round-trip failed for ${n}: readVaruint returned null`);
  expect(read.next).toBe(bytes.length);
  return read.value;
};

describe('writeVaruint + readVaruint — round-trip', () => {
  it('round-trips zero (single-byte encoding)', () => {
    expect(roundTrip(0)).toBe(0);
  });

  it('round-trips small values (fits in one 7-bit byte)', () => {
    for (const n of [1, 2, 63, 126, 127]) expect(roundTrip(n)).toBe(n);
  });

  it('round-trips values that straddle the one/two-byte boundary', () => {
    expect(roundTrip(128)).toBe(128);
    expect(roundTrip(129)).toBe(129);
  });

  it('round-trips values that straddle the two/three-byte boundary', () => {
    expect(roundTrip(16_383)).toBe(16_383);
    expect(roundTrip(16_384)).toBe(16_384);
  });

  it('round-trips a large value (v100+ future ordinal space)', () => {
    expect(roundTrip(1_000_000)).toBe(1_000_000);
  });

  it('advances `next` past the last consumed byte', () => {
    const out: number[] = [];
    writeVaruint(128, out);
    writeVaruint(1, out);
    const bytes = new Uint8Array(out);
    const first = readVaruint(bytes, 0);
    expect(first).not.toBeNull();
    if (first === null) return;
    expect(first.value).toBe(128);
    const second = readVaruint(bytes, first.next);
    expect(second).not.toBeNull();
    if (second === null) return;
    expect(second.value).toBe(1);
    expect(second.next).toBe(bytes.length);
  });
});

describe('readVaruint — hostile input', () => {
  it('returns null on an empty buffer (offset === length)', () => {
    expect(readVaruint(new Uint8Array(0), 0)).toBeNull();
  });

  it('returns null on truncation (continuation bit set at end of input)', () => {
    // Legal encoding of 128 is [0x80, 0x01]; drop the terminator to force
    // truncation on the second byte.
    expect(readVaruint(new Uint8Array([0x80]), 0)).toBeNull();
  });

  it('returns null on overlong encoding (> 5 bytes with continuation bit set)', () => {
    // Every byte has the continuation bit set — the reader must give up after
    // MAX_VARUINT_BYTES rather than loop forever.
    const overlong = new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01]);
    expect(readVaruint(overlong, 0)).toBeNull();
  });

  it('reads past an offset into the middle of a buffer', () => {
    // [garbage, 42-encoded, garbage] — start at offset 1.
    const bytes = new Uint8Array([0xff, 42, 0xff]);
    const r = readVaruint(bytes, 1);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.value).toBe(42);
    expect(r.next).toBe(2);
  });

  it('does not throw or mutate the buffer', () => {
    const bytes = new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80]);
    const snapshot = Array.from(bytes);
    expect(() => readVaruint(bytes, 0)).not.toThrow();
    expect(Array.from(bytes)).toEqual(snapshot);
  });
});

describe('writeVaruint — precondition guards', () => {
  it('throws RangeError on a negative integer (encoder-side bug)', () => {
    expect(() => writeVaruint(-1, [])).toThrow(RangeError);
  });

  it('throws RangeError on a non-integer (encoder-side bug)', () => {
    expect(() => writeVaruint(1.5, [])).toThrow(RangeError);
  });
});
