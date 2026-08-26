// M07 IO — base64url codec tests.
//
// Proves:
//   1. Every byte value 0..255 round-trips exactly through encode→decode.
//   2. Trailing-group handling is correct for 1-byte and 2-byte tails.
//   3. Non-alphabet input (including standard base64's `+`, `/`, `=`) returns
//      `null` — padding is not part of the wire format.
//   4. An illegal 1-character trailing group returns `null` (would decode to 0
//      bytes but signal malformed input).
//   5. Empty in → empty out.
//   6. The decoder never throws on hostile input.

import { describe, expect, it } from 'vitest';
import { fromBase64url, toBase64url } from '../../../../src/io/codec/base64url.js';

describe('toBase64url + fromBase64url — round-trip', () => {
  it('round-trips the empty buffer', () => {
    expect(toBase64url(new Uint8Array(0))).toBe('');
    expect(fromBase64url('')).toEqual(new Uint8Array(0));
  });

  it('round-trips every byte value 0..255 (single-byte cases)', () => {
    for (let i = 0; i < 256; i += 1) {
      const bytes = new Uint8Array([i]);
      const encoded = toBase64url(bytes);
      const decoded = fromBase64url(encoded);
      expect(decoded).not.toBeNull();
      if (decoded === null) return;
      expect(Array.from(decoded)).toEqual([i]);
    }
  });

  it('round-trips the full 0..255 sweep as one buffer (all trailing lengths mod 3)', () => {
    for (const extra of [[], [0xab], [0xab, 0xcd]]) {
      const bytes = new Uint8Array(256 + extra.length);
      for (let i = 0; i < 256; i += 1) bytes[i] = i;
      for (let j = 0; j < extra.length; j += 1) bytes[256 + j] = extra[j] as number;

      const encoded = toBase64url(bytes);
      const decoded = fromBase64url(encoded);
      expect(decoded).not.toBeNull();
      if (decoded === null) return;
      expect(decoded.length).toBe(bytes.length);
      for (let i = 0; i < bytes.length; i += 1) {
        expect(decoded[i]).toBe(bytes[i]);
      }
    }
  });

  it('uses `-` and `_` (never `+` or `/`) — the URL-safe alphabet', () => {
    // A byte pattern that produces both `-` (encoded 62) and `_` (encoded 63).
    // 62 = 111110b, 63 = 111111b. `[0xfb, 0xff]` → first 6 bits 111110 (62 `-`),
    // next 6 bits 111111 (63 `_`), last 4 bits 1111 (48 `w`).
    const encoded = toBase64url(new Uint8Array([0xfb, 0xff]));
    expect(encoded).toContain('-');
    expect(encoded).toContain('_');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
  });

  it('produces no padding characters', () => {
    for (const b of [[1], [1, 2], [1, 2, 3], [1, 2, 3, 4]]) {
      expect(toBase64url(new Uint8Array(b))).not.toContain('=');
    }
  });
});

describe('fromBase64url — hostile input', () => {
  it('rejects standard-base64 padding (`=`) — not part of the wire format', () => {
    expect(fromBase64url('AA==')).toBeNull();
  });

  it('rejects standard-base64 alphabet characters (`+`, `/`)', () => {
    expect(fromBase64url('a+b')).toBeNull();
    expect(fromBase64url('a/b')).toBeNull();
  });

  it('rejects arbitrary punctuation', () => {
    expect(fromBase64url('!!!!')).toBeNull();
    expect(fromBase64url('AA!A')).toBeNull();
  });

  it('rejects a lone whitespace character', () => {
    expect(fromBase64url('A A')).toBeNull();
    expect(fromBase64url('\n')).toBeNull();
  });

  it('rejects a non-ASCII character', () => {
    expect(fromBase64url('AÿA')).toBeNull();
    expect(fromBase64url('☃')).toBeNull(); // snowman
  });

  it('rejects an illegal 1-character trailing group', () => {
    // Length % 4 === 1 is never a valid base64url encoding.
    expect(fromBase64url('A')).toBeNull();
    expect(fromBase64url('AAAAB')).toBeNull();
  });

  it('does not throw on any hostile input', () => {
    for (const bad of ['', '!', '!!!!', 'A', 'A A', 'AA==', '☃', '::::']) {
      expect(() => fromBase64url(bad)).not.toThrow();
    }
  });
});
