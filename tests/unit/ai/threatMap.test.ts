// threatMap — deterministic enemy-scoring ranking + `nearestEnemyBodyId`.
//
// The public surface is small (`threatScore`, `rankThreats`, `nearestEnemyBodyId`).
// Every test here builds a minimal `BlindMatchView`-shaped literal so ranking
// behaviour is pinned WITHOUT depending on `createMatch`/`resolveFleet` — the
// planner is tier-parameterized and consumed by S04's Commander; the surface it
// depends on is the frozen view, not the full match assembly.

import { describe, expect, it } from 'vitest';
import type { Body, BodyId, SimShip } from '../../../src/sim/types.js';
import type { Vec3 } from '../../../src/sim/mathx/index.js';
import { of } from '../../../src/sim/mathx/index.js';
import type {
  BlindMatchView,
  BlindShipView,
} from '../../../src/sim/loop/blindView.js';
import {
  nearestEnemyBodyId,
  rankThreats,
  threatScore,
} from '../../../src/ai/threatMap.js';

// ---- Fixture builders ----------------------------------------------------

const shipProfile = (
  buildId: string,
  overrides: Partial<SimShip> = {},
): SimShip => ({
  buildId,
  name: buildId,
  chassisClass: 'frigate',
  mass: 500,
  radius: 20,
  maxHull: 100,
  shieldCapacity: 60,
  shieldRegenPerTurn: 15,
  deltaVPerTurn: 300,
  baseEvasion: 0.1,
  hullRepairPerTurn: 0,
  weapons: [{ range: 400, damage: 20, shotsPerTurn: 1, accuracy: 0.9 }],
  missiles: [],
  pointDefense: [],
  decoys: [],
  ...overrides,
});

const shipView = (
  bodyId: BodyId,
  fleetId: number,
  hull: number,
  shields: number,
  profile: SimShip,
  overrides: Partial<BlindShipView> = {},
): BlindShipView =>
  Object.freeze({
    bodyId,
    fleetId,
    name: profile.name,
    chassisClass: profile.chassisClass,
    hull,
    maxHull: profile.maxHull,
    shields,
    shieldCapacity: profile.shieldCapacity,
    shieldGenAlive: true,
    engineAlive: true,
    weaponAlive: Object.freeze(profile.weapons.map(() => true)),
    missileAlive: Object.freeze(profile.missiles.map(() => true)),
    missileAmmo: Object.freeze(profile.missiles.map((m) => m.ammo)),
    pdAlive: Object.freeze(profile.pointDefense.map(() => true)),
    decoyAlive: Object.freeze(profile.decoys.map(() => true)),
    decoyCharges: Object.freeze(profile.decoys.map((d) => d.charges)),
    decoyActiveUntilTurn: 0,
    ship: profile,
    ...overrides,
  });

const body = (id: BodyId, position: Vec3): Body =>
  ({
    kind: 'ship',
    id,
    position,
    velocity: of(0, 0, 0),
    mass: 500,
    radius: 20,
  });

const buildView = (
  selfFleetId: number,
  entries: readonly {
    readonly bodyId: BodyId;
    readonly fleetId: number;
    readonly position: Vec3;
    readonly view: BlindShipView;
  }[],
): BlindMatchView => {
  const sorted = entries.slice().sort((a, b) => a.bodyId - b.bodyId);
  return Object.freeze({
    turn: 1,
    arena: { center: of(0, 0, 0), radius: 10000 },
    selfFleetId,
    bodies: Object.freeze(sorted.map((e) => body(e.bodyId, e.position))),
    ships: Object.freeze(sorted.map((e) => e.view)),
  });
};

// ---- threatScore — single-ship contributions ------------------------------

describe('threatScore — single enemy contribution', () => {
  it('is strictly positive for a live weaponized enemy at finite range', () => {
    const p = shipProfile('X');
    const v = shipView(1, 1, 100, 60, p);
    const s = threatScore(v, of(0, 0, 0), of(100, 0, 0));
    expect(s).toBeGreaterThan(0);
  });

  it('rewards higher offensive throughput at equal survivability + range', () => {
    const heavy = shipProfile('heavy', {
      weapons: [{ range: 400, damage: 40, shotsPerTurn: 2, accuracy: 0.9 }],
    });
    const light = shipProfile('light', {
      weapons: [{ range: 400, damage: 10, shotsPerTurn: 1, accuracy: 0.9 }],
    });
    const from = of(0, 0, 0);
    const at = of(100, 0, 0);
    const heavyScore = threatScore(shipView(1, 1, 100, 60, heavy), from, at);
    const lightScore = threatScore(shipView(1, 1, 100, 60, light), from, at);
    expect(heavyScore).toBeGreaterThan(lightScore);
  });

  it('rewards a closer target over a distant one, all else equal', () => {
    const p = shipProfile('X');
    const near = threatScore(shipView(1, 1, 100, 60, p), of(0, 0, 0), of(50, 0, 0));
    const far = threatScore(shipView(1, 1, 100, 60, p), of(0, 0, 0), of(500, 0, 0));
    expect(near).toBeGreaterThan(far);
  });

  it('biases against high-HP targets (survivability inverse)', () => {
    const p = shipProfile('X');
    const at = of(100, 0, 0);
    const soft = threatScore(shipView(1, 1, 10, 0, p), of(0, 0, 0), at);
    const tough = threatScore(shipView(1, 1, 500, 300, p), of(0, 0, 0), at);
    expect(soft).toBeGreaterThan(tough);
  });
});

// ---- rankThreats — ordering + determinism --------------------------------

describe('rankThreats — enemy-only, descending, BodyId tiebreak', () => {
  it('excludes own-fleet ships and dead ships', () => {
    const p = shipProfile('X');
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(50, 0, 0), view: shipView(1, 0, 100, 60, p) }, // self
      { bodyId: 2, fleetId: 1, position: of(100, 0, 0), view: shipView(2, 1, 100, 60, p) }, // live enemy
      { bodyId: 3, fleetId: 1, position: of(60, 0, 0), view: shipView(3, 1, 0, 0, p) }, // dead enemy
    ]);
    const ranked = rankThreats(view, 0, of(0, 0, 0));
    const ids = ranked.map((r) => r.bodyId);
    expect(ids).toContain(2);
    expect(ids).not.toContain(1);
    expect(ids).not.toContain(3);
  });

  it('is sorted by descending score', () => {
    const p = shipProfile('X');
    const view = buildView(0, [
      { bodyId: 5, fleetId: 1, position: of(300, 0, 0), view: shipView(5, 1, 100, 60, p) },
      { bodyId: 6, fleetId: 1, position: of(100, 0, 0), view: shipView(6, 1, 100, 60, p) },
      { bodyId: 7, fleetId: 1, position: of(200, 0, 0), view: shipView(7, 1, 100, 60, p) },
    ]);
    const ranked = rankThreats(view, 0, of(0, 0, 0));
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
    }
  });

  it('breaks score ties by ascending BodyId', () => {
    // Two identical enemy ships at the same distance — tied on every term.
    const p = shipProfile('X');
    const view = buildView(0, [
      { bodyId: 9, fleetId: 1, position: of(100, 0, 0), view: shipView(9, 1, 100, 60, p) },
      { bodyId: 4, fleetId: 1, position: of(100, 0, 0), view: shipView(4, 1, 100, 60, p) },
      { bodyId: 7, fleetId: 1, position: of(100, 0, 0), view: shipView(7, 1, 100, 60, p) },
    ]);
    const ranked = rankThreats(view, 0, of(0, 0, 0));
    // All scores must be equal, and the returned order must be BodyId ASC.
    expect(new Set(ranked.map((r) => r.score)).size).toBe(1);
    expect(ranked.map((r) => r.bodyId)).toEqual([4, 7, 9]);
  });

  it('is deterministic — repeated calls return the same ordering', () => {
    const p = shipProfile('X');
    const view = buildView(0, [
      { bodyId: 1, fleetId: 1, position: of(50, 30, 0), view: shipView(1, 1, 120, 40, p) },
      { bodyId: 2, fleetId: 1, position: of(-100, 20, 40), view: shipView(2, 1, 80, 90, p) },
      { bodyId: 3, fleetId: 1, position: of(200, -50, 10), view: shipView(3, 1, 100, 60, p) },
    ]);
    const a = rankThreats(view, 0, of(10, 10, 10));
    const b = rankThreats(view, 0, of(10, 10, 10));
    expect(a).toEqual(b);
  });

  it('handles the empty-enemy case as an empty ranking (never throws)', () => {
    const p = shipProfile('X');
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, p) },
    ]);
    expect(rankThreats(view, 0, of(0, 0, 0))).toEqual([]);
  });
});

// ---- nearestEnemyBodyId — the movement planner's `nearest` policy hook -----

describe('nearestEnemyBodyId — nearest-with-BodyId-tiebreak', () => {
  it('returns null when no enemy is live', () => {
    const p = shipProfile('X');
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, p) },
      { bodyId: 2, fleetId: 1, position: of(50, 0, 0), view: shipView(2, 1, 0, 0, p) },
    ]);
    expect(nearestEnemyBodyId(view, 0, of(0, 0, 0))).toBeNull();
  });

  it('picks the enemy with smallest distanceSq to `from`', () => {
    const p = shipProfile('X');
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, p) },
      { bodyId: 2, fleetId: 1, position: of(500, 0, 0), view: shipView(2, 1, 100, 60, p) },
      { bodyId: 3, fleetId: 1, position: of(100, 0, 0), view: shipView(3, 1, 100, 60, p) },
      { bodyId: 4, fleetId: 1, position: of(300, 0, 0), view: shipView(4, 1, 100, 60, p) },
    ]);
    expect(nearestEnemyBodyId(view, 0, of(0, 0, 0))).toBe(3);
  });

  it('tie-breaks equal-distance enemies by ascending BodyId', () => {
    const p = shipProfile('X');
    const view = buildView(0, [
      { bodyId: 8, fleetId: 1, position: of(100, 0, 0), view: shipView(8, 1, 100, 60, p) },
      { bodyId: 5, fleetId: 1, position: of(100, 0, 0), view: shipView(5, 1, 100, 60, p) },
      { bodyId: 7, fleetId: 1, position: of(100, 0, 0), view: shipView(7, 1, 100, 60, p) },
    ]);
    expect(nearestEnemyBodyId(view, 0, of(0, 0, 0))).toBe(5);
  });
});
