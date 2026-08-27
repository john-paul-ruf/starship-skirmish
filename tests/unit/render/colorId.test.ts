// colorId — the GPU pick codec must be an exact round-trip for every live body id,
// including the endpoints (0 and the 360-body ceiling) that a match can actually mint.

import { describe, expect, it } from 'vitest';
import { decodeId, encodeId, idToUnitRgb } from '../../../src/render/colorId.js';

describe('encodeId / decodeId', () => {
  it('round-trips 0 and the max body-count ceiling (360)', () => {
    for (const id of [0, 1, 359, 360]) {
      expect(decodeId(encodeId(id))).toBe(id);
    }
  });

  it('round-trips a dense range across every byte boundary', () => {
    for (let id = 0; id <= 4096; id += 1) {
      expect(decodeId(encodeId(id))).toBe(id);
    }
  });

  it('round-trips ids straddling the green/red byte carries', () => {
    for (const id of [255, 256, 257, 65535, 65536, 65537, 0xffffff]) {
      expect(decodeId(encodeId(id))).toBe(id);
    }
  });

  it('emits channels strictly in 0..255', () => {
    for (const id of [0, 42, 360, 100000, 0xffffff]) {
      const [r, g, b] = encodeId(id);
      for (const c of [r, g, b]) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
        expect(Number.isInteger(c)).toBe(true);
      }
    }
  });

  it('normalizes to 0..1 unit rgb consistently with encodeId', () => {
    for (const id of [0, 128, 255, 360, 0xffffff]) {
      const [r, g, b] = encodeId(id);
      expect(idToUnitRgb(id)).toEqual([r / 255, g / 255, b / 255]);
    }
  });
});
