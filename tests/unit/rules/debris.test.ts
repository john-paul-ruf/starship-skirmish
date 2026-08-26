// debris.test — spawn count/mass/scatter, lifetime tick, hazard cap.

import { describe, expect, it } from 'vitest';
import {
  enforceHazardCap,
  spawnDebris,
  tickDebrisLifetime,
} from '../../../src/sim/rules/debris.js';
import { of, seedOf } from '../../../src/sim/mathx/index.js';
import type {
  CombatConfig,
  DestructionEvent,
  SimShip,
} from '../../../src/sim/types.js';

const cfg = (o: Partial<CombatConfig['hazards']> = {}): CombatConfig => ({
  hazards: {
    maxSimultaneousBodies: 300,
    debrisLifetimeTurns: 6,
    debrisPerDestruction: { fighter: 2, frigate: 4, cruiser: 7, 'mega-destroyer': 12 },
    debrisScatterImpulse: 120,
    debrisMassFractionOfHull: 0.06,
    debrisRadius: 12,
    ...o,
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
  position: of(10, 20, 30),
  velocity: of(1, 2, 3),
  cause: 'weapon',
  detonates: true,
  ...o,
});

const ship = (o: Partial<SimShip> = {}): SimShip => ({
  buildId: 'b',
  name: 'Test',
  chassisClass: 'frigate',
  mass: 800,
  radius: 20,
  maxHull: 200,
  shieldCapacity: 100,
  shieldRegenPerTurn: 10,
  deltaVPerTurn: 300,
  baseEvasion: 0,
  hullRepairPerTurn: 0,
  weapons: [],
  missiles: [],
  pointDefense: [],
  decoys: [],
  ...o,
});

describe('spawnDebris — count-by-class and mass/radius', () => {
  it('fighter class ⇒ 2 shards', () => {
    const s = spawnDebris(dest({ chassisClass: 'fighter' }), ship({ chassisClass: 'fighter' }), seedOf(1, 2), 3, cfg());
    expect(s).toHaveLength(2);
  });

  it('mega-destroyer ⇒ 12 shards', () => {
    const s = spawnDebris(dest({ chassisClass: 'mega-destroyer' }), ship({ chassisClass: 'mega-destroyer' }), seedOf(1, 2), 3, cfg());
    expect(s).toHaveLength(12);
  });

  it('mass = ship.mass × debrisMassFractionOfHull; radius from config', () => {
    const s = spawnDebris(dest(), ship({ mass: 800 }), seedOf(1, 2), 3, cfg());
    expect(s[0]!.mass).toBeCloseTo(800 * 0.06, 10);
    expect(s[0]!.radius).toBe(12);
  });

  it('velocity = parent velocity + scatter of magnitude debrisScatterImpulse', () => {
    const parentVel = of(10, 20, 30);
    const s = spawnDebris(dest({ velocity: parentVel }), ship(), seedOf(1, 2), 3, cfg({ debrisScatterImpulse: 120 }));
    for (const shard of s) {
      // scatter = shard.velocity − parentVel — its magnitude equals impulse.
      const sx = shard.velocity.x - parentVel.x;
      const sy = shard.velocity.y - parentVel.y;
      const sz = shard.velocity.z - parentVel.z;
      const mag = Math.sqrt(sx * sx + sy * sy + sz * sz);
      // Small tolerance — the mathx trig kernels have ~1e-9 error.
      expect(mag).toBeCloseTo(120, 5);
    }
  });

  it('is seed-reproducible', () => {
    const a = spawnDebris(dest(), ship(), seedOf(0xabc, 0xdef), 4, cfg());
    const b = spawnDebris(dest(), ship(), seedOf(0xabc, 0xdef), 4, cfg());
    expect(b).toEqual(a);
  });
});

describe('tickDebrisLifetime — cull at lifetime', () => {
  it('increments age and drops entries reaching lifetime', () => {
    const ages = [
      { bodyId: 10, age: 0 },
      { bodyId: 11, age: 4 }, // 4 → 5, still alive (lifetime 6)
      { bodyId: 12, age: 5 }, // 5 → 6, culled
    ];
    const r = tickDebrisLifetime(ages, cfg());
    expect(r.survivors.map((s) => s.bodyId)).toEqual([10, 11]);
    expect(r.survivors.find((s) => s.bodyId === 10)!.age).toBe(1);
    expect(r.culled).toEqual([12]);
  });

  it('returns survivors sorted by bodyId', () => {
    const ages = [
      { bodyId: 30, age: 0 },
      { bodyId: 10, age: 0 },
      { bodyId: 20, age: 0 },
    ];
    const r = tickDebrisLifetime(ages, cfg());
    expect(r.survivors.map((s) => s.bodyId)).toEqual([10, 20, 30]);
  });
});

describe('enforceHazardCap — no-op below cap, cull-oldest above', () => {
  it('below cap ⇒ kept === input', () => {
    const entries = [{ bodyId: 1, age: 0 }, { bodyId: 2, age: 0 }];
    const r = enforceHazardCap(entries, cfg({ maxSimultaneousBodies: 10 }));
    expect(r.kept).toEqual(entries);
    expect(r.droppedCount).toBe(0);
    expect(r.droppedIds).toEqual([]);
  });

  it('over cap ⇒ oldest culled first, drop count reported (no silent truncation)', () => {
    const entries = [
      { bodyId: 1, age: 3 }, // oldest → dropped
      { bodyId: 2, age: 1 },
      { bodyId: 3, age: 0 },
    ];
    const r = enforceHazardCap(entries, cfg({ maxSimultaneousBodies: 2 }));
    expect(r.droppedCount).toBe(1);
    expect(r.droppedIds).toEqual([1]);
    expect(r.kept.map((e) => e.bodyId).sort()).toEqual([2, 3]);
  });

  it('ties on age break by ascending bodyId (deterministic)', () => {
    const entries = [
      { bodyId: 5, age: 3 },
      { bodyId: 2, age: 3 }, // same age, lower id → dropped first
      { bodyId: 9, age: 0 },
    ];
    const r = enforceHazardCap(entries, cfg({ maxSimultaneousBodies: 2 }));
    expect(r.droppedIds).toEqual([2]);
  });
});
