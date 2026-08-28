// labels — projection stays a pure column-major helper (arch §9). Presentation,
// priority-aware declutter, and the hazard-body cap all belong to the same file so
// the tests here are the only place the semantic contract is asserted; the DOM
// overlay itself is a screen-e2e concern.

import { describe, expect, it } from 'vitest';
import {
  LABEL_PRIORITY,
  MAX_HAZARD_LABELS,
  capHazardLabels,
  debrisLabelText,
  declutterLabels,
  fleetGlyphOf,
  presentationFor,
  projectToScreen,
  shipLabelText,
  spentMissileLabelText,
  trackingMissileLabelText,
  type ScreenLabel,
  type TacticalLabelKind,
} from '../../../src/render/labels.js';
import type { FleetColor } from '../../../src/render/types.js';

// Column-major identity: clip = (x, y, z, 1). NDC == world for x,y in [-1,1].
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('projectToScreen', () => {
  it('maps the origin to the viewport centre', () => {
    const p = projectToScreen(IDENTITY, 0, 0, 0, 800, 600);
    expect(p.sx).toBeCloseTo(400, 6);
    expect(p.sy).toBeCloseTo(300, 6);
    expect(p.inFront).toBe(true);
  });

  it('flips y for screen space (top-left origin)', () => {
    const top = projectToScreen(IDENTITY, 0, 1, 0, 800, 600);
    const bottom = projectToScreen(IDENTITY, 0, -1, 0, 800, 600);
    expect(top.sy).toBeCloseTo(0, 6); // +y world → top of screen
    expect(bottom.sy).toBeCloseTo(600, 6);
  });

  it('maps NDC x to horizontal pixels', () => {
    expect(projectToScreen(IDENTITY, 1, 0, 0, 800, 600).sx).toBeCloseTo(800, 6);
    expect(projectToScreen(IDENTITY, -1, 0, 0, 800, 600).sx).toBeCloseTo(0, 6);
  });

  it('reports points behind the camera as not in front', () => {
    // A view-projection with w = -z: a point at +z lands behind the camera.
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0];
    expect(projectToScreen(m, 0, 0, 1, 800, 600).inFront).toBe(false);
  });
});

// ---- presentation ----------------------------------------------------------

describe('presentationFor', () => {
  const FLEETS: readonly FleetColor[] = [0, 1, 2, 3, 4];

  it('gives every fleet a distinct ship glyph', () => {
    const glyphs = FLEETS.map((f) => presentationFor('ship', f).glyph);
    expect(new Set(glyphs).size).toBe(FLEETS.length);
    // The session's authoritative list — a future edit that drops shape identity dies here.
    expect(glyphs).toEqual(['▲', '●', '■', '◆', '✦']);
  });

  it('mirrors fleet glyphs through fleetGlyphOf', () => {
    for (const f of FLEETS) {
      expect(fleetGlyphOf(f)).toBe(presentationFor('ship', f).glyph);
    }
  });

  it('pins hazard/missile glyphs by kind', () => {
    expect(presentationFor('debris').glyph).toBe('✳');
    expect(presentationFor('missile-tracking').glyph).toBe('➤');
    expect(presentationFor('missile-spent').glyph).toBe('◇');
  });

  it('gives every kind a visible, non-empty treatment', () => {
    const kinds: readonly TacticalLabelKind[] = [
      'ship',
      'debris',
      'missile-tracking',
      'missile-spent',
    ];
    for (const kind of kinds) {
      const pres = kind === 'ship' ? presentationFor(kind, 0) : presentationFor(kind);
      expect(pres.glyph.length).toBeGreaterThan(0);
      expect(pres.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      // A dark translucent backing so labels survive the grid + bloom.
      expect(pres.background).toMatch(/^rgba\(/);
      // Multi-direction text shadow — several stops means several axes.
      expect(pres.shadow.split(',').length).toBeGreaterThanOrEqual(4);
    }
  });

  it('uses distinct colors across the three hazard kinds', () => {
    const cs = new Set([
      presentationFor('debris').color,
      presentationFor('missile-tracking').color,
      presentationFor('missile-spent').color,
    ]);
    expect(cs.size).toBe(3);
  });

  it('falls back to fleet 0 when no fleet slot is supplied for a ship', () => {
    const p = presentationFor('ship');
    expect(p.glyph).toBe(presentationFor('ship', 0).glyph);
    expect(p.color).toBe(presentationFor('ship', 0).color);
  });

  it('nudges labels below the anchor so the glyph does not cover the ship', () => {
    expect(presentationFor('ship', 0).offsetY).toBeGreaterThan(0);
    expect(presentationFor('debris').offsetY).toBeGreaterThan(0);
  });
});

// ---- priority + declutter --------------------------------------------------

const label = (
  id: number,
  sx: number,
  sy: number,
  depth: number,
  opts: {
    kind?: TacticalLabelKind;
    priority?: number;
    inFront?: boolean;
  } = {},
): ScreenLabel => {
  const kind = opts.kind ?? 'ship';
  return {
    id,
    kind,
    sx,
    sy,
    depth,
    inFront: opts.inFront ?? true,
    priority: opts.priority ?? LABEL_PRIORITY[kind],
  };
};

describe('LABEL_PRIORITY', () => {
  it('ranks ships above every hazard', () => {
    expect(LABEL_PRIORITY.ship).toBeGreaterThan(LABEL_PRIORITY['missile-tracking']);
    expect(LABEL_PRIORITY.ship).toBeGreaterThan(LABEL_PRIORITY['missile-spent']);
    expect(LABEL_PRIORITY.ship).toBeGreaterThan(LABEL_PRIORITY.debris);
  });

  it('ranks a tracking missile above a spent one above debris', () => {
    expect(LABEL_PRIORITY['missile-tracking']).toBeGreaterThan(LABEL_PRIORITY['missile-spent']);
    expect(LABEL_PRIORITY['missile-spent']).toBeGreaterThan(LABEL_PRIORITY.debris);
  });
});

describe('declutterLabels', () => {
  it('keeps the nearer label when two collide within the gap (same kind, same priority)', () => {
    const near = label(1, 100, 100, 0.2);
    const far = label(2, 108, 104, 0.5); // within 26px of `near`
    const kept = declutterLabels([far, near], 26);
    expect(kept.map((l) => l.id)).toEqual([1]);
  });

  it('keeps both when they are farther apart than the gap', () => {
    const a = label(1, 100, 100, 0.2);
    const b = label(2, 400, 300, 0.5);
    const kept = declutterLabels([a, b], 26);
    expect(new Set(kept.map((l) => l.id))).toEqual(new Set([1, 2]));
  });

  it('drops labels behind the camera before decluttering', () => {
    const front = label(1, 100, 100, 0.2, { inFront: true });
    const behind = label(2, 400, 300, 0.5, { inFront: false });
    const kept = declutterLabels([front, behind], 26);
    expect(kept.map((l) => l.id)).toEqual([1]);
  });

  it('is deterministic under equal depth (ties break by id)', () => {
    const a = label(2, 100, 100, 0.3);
    const b = label(1, 104, 102, 0.3); // collides with a
    const kept = declutterLabels([a, b], 26);
    expect(kept.map((l) => l.id)).toEqual([1]); // lower id wins the tie
  });

  it('keeps the ship when a ship and a hazard collide, even when the hazard is nearer', () => {
    const ship = label(9, 100, 100, 0.8, { kind: 'ship' });
    const debris = label(3, 104, 102, 0.2, { kind: 'debris' });
    const kept = declutterLabels([debris, ship], 26);
    expect(kept.map((l) => l.id)).toEqual([9]);
    expect(kept[0]!.kind).toBe('ship');
  });

  it('keeps the tracking missile when it collides with spent or debris', () => {
    const track = label(5, 100, 100, 0.5, { kind: 'missile-tracking' });
    const spent = label(6, 104, 102, 0.3, { kind: 'missile-spent' });
    const debris = label(7, 108, 100, 0.2, { kind: 'debris' });
    const kept = declutterLabels([debris, spent, track], 26);
    expect(kept.map((l) => l.id)).toEqual([5]);
    expect(kept[0]!.kind).toBe('missile-tracking');
  });

  it('breaks equal-priority ties by depth then id', () => {
    const a = label(2, 100, 100, 0.3, { kind: 'debris' });
    const b = label(1, 200, 200, 0.5, { kind: 'debris' }); // far away, no collision
    const c = label(3, 104, 102, 0.3, { kind: 'debris' }); // collides with a
    const kept = declutterLabels([a, b, c], 26).map((l) => l.id);
    expect(kept).toContain(2); // a wins over c on lower id at same depth
    expect(kept).toContain(1); // b survives (no collision)
    expect(kept).not.toContain(3);
  });
});

// ---- hazard cap ------------------------------------------------------------

describe('capHazardLabels', () => {
  it('exposes a positive, finite ceiling', () => {
    expect(MAX_HAZARD_LABELS).toBeGreaterThan(0);
    expect(Number.isFinite(MAX_HAZARD_LABELS)).toBe(true);
  });

  it('keeps every ship regardless of the cap', () => {
    const ships = [
      label(1, 10, 10, 0.1, { kind: 'ship' }),
      label(2, 20, 20, 0.2, { kind: 'ship' }),
      label(3, 30, 30, 0.3, { kind: 'ship' }),
    ];
    const kept = capHazardLabels(ships, 0);
    expect(kept.map((l) => l.id)).toEqual([1, 2, 3]);
  });

  it('trims hazards nearest-first when they overflow the cap', () => {
    const ships = [label(100, 0, 0, 0.05, { kind: 'ship' })];
    const hazards: ScreenLabel[] = [];
    // Emit a "swarm" larger than the cap with strictly increasing depth so the
    // nearest-first ordering can be pinned deterministically.
    for (let i = 0; i < MAX_HAZARD_LABELS + 12; i += 1) {
      hazards.push(label(i + 1, 10 + i, 20 + i, 0.1 + i * 0.01, { kind: 'debris' }));
    }
    const kept = capHazardLabels([...hazards, ...ships], MAX_HAZARD_LABELS);
    const hazardKept = kept.filter((l) => l.kind !== 'ship');
    const shipKept = kept.filter((l) => l.kind === 'ship');
    expect(hazardKept.length).toBe(MAX_HAZARD_LABELS);
    expect(shipKept.map((l) => l.id)).toEqual([100]);
    // Nearest hazards win — the first MAX by depth ascending.
    const expected: number[] = [];
    for (let i = 0; i < MAX_HAZARD_LABELS; i += 1) expected.push(i + 1);
    expect(hazardKept.map((l) => l.id).sort((a, b) => a - b)).toEqual(expected);
  });

  it('is deterministic across input permutations (ties break by id)', () => {
    const forward: ScreenLabel[] = [];
    const backward: ScreenLabel[] = [];
    // All at the same depth — the tiebreaker is pure id.
    for (let i = 0; i < MAX_HAZARD_LABELS + 5; i += 1) {
      const l = label(i + 1, 10 + i, 20 + i, 0.4, { kind: 'debris' });
      forward.push(l);
      backward.unshift(l);
    }
    const a = capHazardLabels(forward, MAX_HAZARD_LABELS).map((l) => l.id);
    const b = capHazardLabels(backward, MAX_HAZARD_LABELS).map((l) => l.id);
    expect(a).toEqual(b);
  });

  it('classes missile-tracking and missile-spent as hazards, not ships', () => {
    const ships = [label(1, 0, 0, 0.1, { kind: 'ship' })];
    const missiles: ScreenLabel[] = [];
    for (let i = 0; i < MAX_HAZARD_LABELS + 4; i += 1) {
      const kind: TacticalLabelKind = i % 2 === 0 ? 'missile-tracking' : 'missile-spent';
      missiles.push(label(i + 2, 10 + i, 10 + i, 0.1 + i * 0.005, { kind }));
    }
    const kept = capHazardLabels([...ships, ...missiles], MAX_HAZARD_LABELS);
    const shipKept = kept.filter((l) => l.kind === 'ship');
    const nonShipKept = kept.filter((l) => l.kind !== 'ship');
    expect(shipKept.length).toBe(1);
    expect(nonShipKept.length).toBe(MAX_HAZARD_LABELS);
  });
});

// ---- text builders ---------------------------------------------------------

describe('shipLabelText', () => {
  it('prefixes the build name with the fleet glyph', () => {
    expect(shipLabelText('WIDOWMAKER', 0, false)).toBe('▲ WIDOWMAKER');
    expect(shipLabelText('IRON VERDICT', 1, false)).toBe('● IRON VERDICT');
    expect(shipLabelText('DULL EDGE', 2, false)).toBe('■ DULL EDGE');
  });

  it('appends `· SHLD 0` when the shield generator has bottomed', () => {
    expect(shipLabelText('SPUR', 1, true)).toBe('● SPUR · SHLD 0');
  });

  it('never appends the shield cue when the ship has shields left', () => {
    expect(shipLabelText('SPUR', 1, false)).not.toMatch(/SHLD/);
  });
});

describe('debrisLabelText', () => {
  it('formats as `✳ DEBRIS D-{id}`', () => {
    expect(debrisLabelText(4)).toBe('✳ DEBRIS D-4');
    expect(debrisLabelText(9)).toBe('✳ DEBRIS D-9');
  });
});

describe('trackingMissileLabelText', () => {
  it('formats as `➤ MISSILE {id} · T{n} ↦ {target}`', () => {
    expect(trackingMissileLabelText(12, 2, 'WIDOWMAKER')).toBe(
      '➤ MISSILE 12 · T2 ↦ WIDOWMAKER',
    );
  });

  it('accepts a `BODY {id}` fallback for a target the caller could not name', () => {
    expect(trackingMissileLabelText(7, 1, 'BODY 42')).toBe('➤ MISSILE 7 · T1 ↦ BODY 42');
  });
});

describe('spentMissileLabelText', () => {
  it('formats as `◇ MISSILE {id} · SPENT · ARMED`', () => {
    expect(spentMissileLabelText(15)).toBe('◇ MISSILE 15 · SPENT · ARMED');
  });
});
