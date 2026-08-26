// destruction.test — AoE geometry, ownership-blind, boundary deaths yield nothing.

import { describe, expect, it } from 'vitest';
import { detonate } from '../../../src/sim/rules/destruction.js';
import { of } from '../../../src/sim/mathx/index.js';
import type {
  CombatConfig,
  DestructionEvent,
} from '../../../src/sim/types.js';

const cfg = (): CombatConfig => ({
  hazards: {
    maxSimultaneousBodies: 300,
    debrisLifetimeTurns: 6,
    debrisPerDestruction: { fighter: 2, frigate: 4, cruiser: 7, 'mega-destroyer': 12 },
    debrisScatterImpulse: 120,
    debrisMassFractionOfHull: 0.06,
    debrisRadius: 12,
  },
  destruction: {
    aoeRadiusByClass: { fighter: 90, frigate: 160, cruiser: 260, 'mega-destroyer': 400 },
    aoeDamageByClass: { fighter: 12, frigate: 30, cruiser: 70, 'mega-destroyer': 140 },
  },
  missiles: { trackingBeats: 2, spentRemainsArmed: true, reacquireOnTargetLoss: false },
  shields: { regenTicksRegardlessOfDamage: true },
});

const dest = (o: Partial<DestructionEvent> = {}): DestructionEvent => ({
  bodyId: 1,
  chassisClass: 'frigate',
  position: of(0, 0, 0),
  velocity: of(0, 0, 0),
  cause: 'weapon',
  detonates: true,
  ...o,
});

describe('detonate — ownership-blind AoE (FR-23, Decision 13)', () => {
  it('hits every body within radius, in ascending id', () => {
    // Frigate: radius 160, centerDamage 30.
    const positions = new Map([
      [1, of(0, 0, 0)], // dead ship
      [10, of(50, 0, 0)], // inside
      [11, of(160, 0, 0)], // exactly at edge → 0 damage → NOT reported
      [12, of(200, 0, 0)], // outside
      [13, of(80, 0, 0)], // inside
    ]);
    const r = detonate(dest(), positions, cfg())!;
    expect(r.hits.map((h) => h.bodyId)).toEqual([10, 13]);
    // Falloff: 30 * (1 - 50/160) and 30 * (1 - 80/160).
    expect(r.hits[0]!.damage).toBeCloseTo(30 * (1 - 50 / 160), 10);
    expect(r.hits[1]!.damage).toBeCloseTo(30 * (1 - 80 / 160), 10);
  });

  it('does not damage the dying body itself', () => {
    const positions = new Map([[1, of(0, 0, 0)]]);
    const r = detonate(dest(), positions, cfg())!;
    expect(r.hits).toHaveLength(0);
  });

  it('boundary death (detonates=false) returns null — no AoE, no debris', () => {
    const positions = new Map([[10, of(10, 0, 0)]]);
    const r = detonate(dest({ detonates: false }), positions, cfg());
    expect(r).toBeNull();
  });

  it('AoE spec reports center/radius/centerDamage from tuning', () => {
    const r = detonate(dest({ chassisClass: 'cruiser', position: of(1, 2, 3) }), new Map(), cfg())!;
    expect(r.aoe.center).toEqual({ x: 1, y: 2, z: 3 });
    expect(r.aoe.radius).toBe(260);
    expect(r.aoe.centerDamage).toBe(70);
  });
});
