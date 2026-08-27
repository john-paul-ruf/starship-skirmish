// hazards — the atlas UV indexing and the Body.kind → glyph mapping are the pure
// helpers behind the single-draw-call instanced field. The InstancedMesh + canvas
// atlas are a screen-e2e concern.

import { describe, expect, it } from 'vitest';
import {
  ATLAS_COLS,
  ATLAS_ROWS,
  HazardGlyph,
  bodyKindToGlyph,
  glyphAtlasRect,
} from '../../../src/render/hazards.js';

describe('glyphAtlasRect', () => {
  it('places each glyph in its own 2×2 cell', () => {
    expect(glyphAtlasRect(HazardGlyph.Debris)).toEqual({ u: 0, v: 0, w: 0.5, h: 0.5 });
    expect(glyphAtlasRect(HazardGlyph.TrackingMissile)).toEqual({ u: 0.5, v: 0, w: 0.5, h: 0.5 });
    expect(glyphAtlasRect(HazardGlyph.SpentMissile)).toEqual({ u: 0, v: 0.5, w: 0.5, h: 0.5 });
  });

  it('cell size matches the atlas grid', () => {
    for (const g of [HazardGlyph.Debris, HazardGlyph.TrackingMissile, HazardGlyph.SpentMissile]) {
      const r = glyphAtlasRect(g);
      expect(r.w).toBe(1 / ATLAS_COLS);
      expect(r.h).toBe(1 / ATLAS_ROWS);
    }
  });

  it('the three glyph sub-rects do not overlap', () => {
    const rects = [HazardGlyph.Debris, HazardGlyph.TrackingMissile, HazardGlyph.SpentMissile].map(
      glyphAtlasRect,
    );
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i]!;
        const b = rects[j]!;
        const overlap = a.u < b.u + b.w && a.u + a.w > b.u && a.v < b.v + b.h && a.v + a.h > b.v;
        expect(overlap).toBe(false);
      }
    }
  });
});

describe('bodyKindToGlyph', () => {
  it('maps debris to ✳ and a live missile body to the tracking ➤', () => {
    expect(bodyKindToGlyph('debris')).toBe(HazardGlyph.Debris);
    expect(bodyKindToGlyph('missile')).toBe(HazardGlyph.TrackingMissile);
  });
});
