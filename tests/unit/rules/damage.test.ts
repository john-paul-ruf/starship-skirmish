// damage.test — hit chance formula, seeded rolls, order-independent damage application,
// AoE falloff. Determinism-focused: the shuffle test is the load-bearing invariant.

import { describe, expect, it } from 'vitest';
import {
  HIT_CEIL,
  HIT_FLOOR,
  RANGE_EXP,
  STREAM_ATTACK,
  VELOCITY_REF,
  aoeFalloff,
  applyDamageBundle,
  hitChance,
  rollHit,
} from '../../../src/sim/rules/damage.js';
import { newShipCombat } from '../../../src/sim/rules/combatState.js';
import type { Damage } from '../../../src/sim/rules/combatState.js';
import { rand01, seedOf } from '../../../src/sim/mathx/index.js';
import type { SimShip, SimWeapon } from '../../../src/sim/types.js';

const weapon = (overrides: Partial<SimWeapon> = {}): SimWeapon => ({
  range: 1000,
  damage: 20,
  shotsPerTurn: 1,
  accuracy: 0.8,
  ...overrides,
});

const ship = (overrides: Partial<SimShip> = {}): SimShip => ({
  buildId: 'b',
  name: 'Test',
  chassisClass: 'frigate',
  mass: 500,
  radius: 20,
  maxHull: 200,
  shieldCapacity: 100,
  shieldRegenPerTurn: 10,
  deltaVPerTurn: 300,
  baseEvasion: 0.1,
  hullRepairPerTurn: 0,
  weapons: [],
  missiles: [],
  pointDefense: [],
  decoys: [],
  ...overrides,
});

describe('hitChance — D-HITCHANCE formula', () => {
  it('base equals weapon.accuracy exactly', () => {
    const b = hitChance(weapon({ accuracy: 0.72 }), 0, 0, 0);
    expect(b.base).toBe(0.72);
  });

  it('rangeFactor is 1 at point-blank and 0 at max range', () => {
    const w = weapon({ range: 1000 });
    expect(hitChance(w, 0, 0, 0).rangeFactor).toBe(1);
    expect(hitChance(w, 1000, 0, 0).rangeFactor).toBe(0);
  });

  it('rangeFactor uses the RANGE_EXP-th power (integer exponent, powi path)', () => {
    // With RANGE_EXP = 2 and r/R = 0.5, the range term = 1 - 0.5^2 = 0.75 exactly.
    expect(RANGE_EXP).toBe(2);
    const w = weapon({ range: 1000, accuracy: 1 });
    const b = hitChance(w, 500, 0, 0);
    expect(b.rangeFactor).toBeCloseTo(0.75, 12);
  });

  it('velocityFactor is 1 at rest and 0 at VELOCITY_REF', () => {
    const w = weapon();
    expect(hitChance(w, 0, 0, 0).velocityFactor).toBe(1);
    expect(hitChance(w, 0, VELOCITY_REF, 0).velocityFactor).toBe(0);
  });

  it('evasionFactor clamps to [0, 1] on both ends', () => {
    const w = weapon();
    expect(hitChance(w, 0, 0, -0.5).evasionFactor).toBe(1); // clamp positive
    expect(hitChance(w, 0, 0, 1.5).evasionFactor).toBe(0); // clamp negative
  });

  it('is monotonically non-increasing in range', () => {
    const w = weapon({ accuracy: 0.9, range: 1000 });
    let prev = Infinity;
    for (let r = 0; r <= 1000; r += 50) {
      const f = hitChance(w, r, 0, 0).final;
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
  });

  it('is monotonically non-increasing in target speed', () => {
    const w = weapon({ accuracy: 0.9 });
    let prev = Infinity;
    for (let s = 0; s <= VELOCITY_REF; s += 50) {
      const f = hitChance(w, 0, s, 0).final;
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
  });

  it('is monotonically non-increasing in target evasion', () => {
    const w = weapon({ accuracy: 0.9 });
    let prev = Infinity;
    for (let e = 0; e <= 1; e += 0.05) {
      const f = hitChance(w, 0, 0, e).final;
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
  });

  it('respects HIT_FLOOR and HIT_CEIL', () => {
    // Maximal target — all penalties saturated. Product would be 0; floor lifts it.
    const worst = hitChance(weapon({ accuracy: 0.9 }), 1000, VELOCITY_REF, 1);
    expect(worst.final).toBe(HIT_FLOOR);
    // Perfect setup, accuracy 1: still capped by HIT_CEIL.
    const best = hitChance(weapon({ accuracy: 1 }), 0, 0, 0);
    expect(best.final).toBe(HIT_CEIL);
  });
});

describe('rollHit — counter-based, order-independent', () => {
  const seed = seedOf(0xdeadbeef, 0xcafef00d);

  it('is pure — same coords ⇒ same roll', () => {
    const a = rollHit(0.5, seed, 3, 42, 99, 0);
    const b = rollHit(0.5, seed, 3, 42, 99, 0);
    expect(a).toEqual(b);
  });

  it('matches the published RNG stream tag STREAM_ATTACK', () => {
    const r = rollHit(0.5, seed, 3, 42, 99, 0);
    const expected = rand01(seed, 3, STREAM_ATTACK, 42, 99, 0);
    expect(r.roll).toBe(expected);
  });

  it('hit iff roll < chance (strict less-than)', () => {
    // Chance 0 never hits — even a roll of exactly 0 would fail the strict test.
    const r = rollHit(0, seed, 1, 1, 2, 0);
    expect(r.hit).toBe(false);
  });

  it('two shooters at the same target draw different rolls', () => {
    const a = rollHit(0.5, seed, 3, 10, 99, 0);
    const b = rollHit(0.5, seed, 3, 11, 99, 0);
    expect(a.roll).not.toBe(b.roll);
  });

  it('two targets from the same shooter draw different rolls', () => {
    const a = rollHit(0.5, seed, 3, 10, 20, 0);
    const b = rollHit(0.5, seed, 3, 10, 21, 0);
    expect(a.roll).not.toBe(b.roll);
  });
});

describe('applyDamageBundle — shields-first, overflow-hull, order-independent', () => {
  const s = ship({ maxHull: 200, shieldCapacity: 100 });

  const bundle: Damage[] = [
    { sourceId: 5, shotIndex: 0, amount: 30, source: 'weapon' },
    { sourceId: 3, shotIndex: 1, amount: 25, source: 'weapon' },
    { sourceId: 7, shotIndex: 0, amount: 40, source: 'missile' },
    { sourceId: 3, shotIndex: 0, amount: 15, source: 'weapon' },
  ];

  it('drains shields before hull', () => {
    const sc = newShipCombat(s, 1);
    const r = applyDamageBundle(sc, [
      { sourceId: 5, shotIndex: 0, amount: 40, source: 'weapon' },
    ]);
    expect(r.shieldAfter).toBe(60);
    expect(r.hullAfter).toBe(200);
  });

  it('overflows past shields into hull', () => {
    const sc = newShipCombat(s, 1);
    const r = applyDamageBundle(sc, [
      { sourceId: 5, shotIndex: 0, amount: 130, source: 'weapon' },
    ]);
    expect(r.shieldAfter).toBe(0);
    expect(r.hullAfter).toBe(200 - 30);
  });

  it('is order-independent (shuffle ⇒ identical after)', () => {
    const sc = newShipCombat(s, 1);
    const a = applyDamageBundle(sc, bundle);
    // Reverse the input; the sort inside must yield the same summation.
    const b = applyDamageBundle(sc, bundle.slice().reverse());
    expect(b.shieldAfter).toBe(a.shieldAfter);
    expect(b.hullAfter).toBe(a.hullAfter);
    expect(b.shieldDamage).toBe(a.shieldDamage);
    expect(b.hullDamage).toBe(a.hullDamage);

    // A permutation that isn't just reverse.
    const shuffled: Damage[] = [bundle[2]!, bundle[0]!, bundle[3]!, bundle[1]!];
    const c = applyDamageBundle(sc, shuffled);
    expect(c.shieldAfter).toBe(a.shieldAfter);
    expect(c.hullAfter).toBe(a.hullAfter);
  });

  it('does not mutate the input ShipCombat', () => {
    const sc = newShipCombat(s, 1);
    const beforeShields = sc.shields;
    const beforeHull = sc.hull;
    applyDamageBundle(sc, bundle);
    expect(sc.shields).toBe(beforeShields);
    expect(sc.hull).toBe(beforeHull);
  });

  it('accepts an empty bundle as a no-op', () => {
    const sc = newShipCombat(s, 1);
    const r = applyDamageBundle(sc, []);
    expect(r.shieldAfter).toBe(sc.shields);
    expect(r.hullAfter).toBe(sc.hull);
    expect(r.shieldDamage).toBe(0);
    expect(r.hullDamage).toBe(0);
  });
});

describe('aoeFalloff — linear, clamped ≥ 0', () => {
  it('centerDamage at distance 0', () => {
    expect(aoeFalloff(40, 0, 60)).toBe(40);
  });

  it('zero at the radius edge', () => {
    expect(aoeFalloff(40, 60, 60)).toBe(0);
  });

  it('linear halfway (matches mock: 40 at centre, ~12 at 44/60)', () => {
    // Straight linear: 40 * (1 - 44/60) = 40 * 16/60 ≈ 10.667.
    // The mock's "EST. 12" is a rounded UI value; formula uses the exact fraction.
    expect(aoeFalloff(40, 44, 60)).toBeCloseTo(40 * (1 - 44 / 60), 10);
  });

  it('clamps past the radius to 0 (not negative)', () => {
    expect(aoeFalloff(40, 200, 60)).toBe(0);
  });

  it('zero for a non-positive radius (degenerate)', () => {
    expect(aoeFalloff(40, 10, 0)).toBe(0);
    expect(aoeFalloff(40, 10, -5)).toBe(0);
  });
});
