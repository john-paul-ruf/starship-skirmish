// createMatch — seeded fleet placement + initial MatchState assembly (FR-12, §7).
//
// These tests pin the invariants the loop's determinism relies on: monotonic
// gap-free BodyIds, zero start velocity, every fleet centroid equidistant from
// the arena boundary, no ship-ship overlap, mutual out-of-weapons-range, and
// seed-reproducibility (same seed ⇒ same layout; different seed ⇒ different).

import { describe, expect, it } from 'vitest';
import {
  buildInitialState,
  fleetsOutOfMutualWeaponsRange,
  minFleetCentroidSeparation,
  shipsNoOverlap,
} from '../../../src/sim/loop/createMatch.js';
import type { MatchConfig } from '../../../src/sim/loop/matchState.js';
import { seedOf } from '../../../src/sim/mathx/index.js';
import type {
  Arena,
  CombatConfig,
  SimFleet,
  SimShip,
  SimWeapon,
} from '../../../src/sim/types.js';
import type { PhysicsConfig } from '../../../src/sim/physics/index.js';
import tuningFile from '../../../catalog/tuning.json';

// ---- Fixtures --------------------------------------------------------------

const weapon = (range = 400): SimWeapon => ({
  range,
  damage: 20,
  shotsPerTurn: 1,
  accuracy: 0.9,
});

const ship = (name: string, weapons: SimWeapon[] = [weapon()]): SimShip => ({
  buildId: `b-${name}`,
  name,
  chassisClass: 'frigate',
  mass: 500,
  radius: 20,
  maxHull: 100,
  shieldCapacity: 100,
  shieldRegenPerTurn: 20,
  deltaVPerTurn: 300,
  baseEvasion: 0.1,
  hullRepairPerTurn: 0,
  weapons,
  missiles: [],
  pointDefense: [],
  decoys: [],
});

const arena = (radius = 10000): Arena => ({
  center: { x: 0, y: 0, z: 0 },
  radius,
});

const physics = (a: Arena): PhysicsConfig => ({
  dt: 1,
  subStepMin: 4,
  subStepMax: 64,
  restitution: 0.15,
  collisionDamageCoefficient: 0.0012,
  arena: a,
});

const combat = (): CombatConfig => ({
  hazards: {
    maxSimultaneousBodies: 300,
    debrisLifetimeTurns: 4,
    debrisPerDestruction: { fighter: 2, frigate: 4, cruiser: 6, 'mega-destroyer': 12 },
    debrisScatterImpulse: 50,
    debrisMassFractionOfHull: 0.02,
    debrisRadius: 5,
  },
  destruction: {
    aoeRadiusByClass: { fighter: 60, frigate: 90, cruiser: 130, 'mega-destroyer': 200 },
    aoeDamageByClass: { fighter: 25, frigate: 40, cruiser: 60, 'mega-destroyer': 100 },
  },
  missiles: { trackingBeats: 2, spentRemainsArmed: true, reacquireOnTargetLoss: false },
  shields: { regenTicksRegardlessOfDamage: true },
});

const fleet = (id: number, names: readonly string[]): SimFleet => ({
  fleetId: id,
  ships: names.map((n) => ship(n)),
});

const configOf = (
  seed: MatchConfig['seed'],
  fleets: readonly SimFleet[],
  a: Arena = arena(),
): MatchConfig => ({
  seed,
  fleets,
  arena: a,
  physics: physics(a),
  combat: combat(),
});

// ---- Tests -----------------------------------------------------------------

describe('createMatch — id assignment', () => {
  it('mints BodyIds monotonically, gap-free, in (fleetId, shipIndex) order', () => {
    const cfg = configOf(seedOf(1, 2), [
      fleet(0, ['A', 'B']),
      fleet(1, ['C', 'D', 'E']),
    ]);
    const state = buildInitialState(cfg);
    const ids = Array.from(state.ships.keys()).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 4, 5]);
    expect(state.nextBodyId).toBe(6);
    // Fleet 0 gets the first two ids (A, B); fleet 1 gets the next three.
    expect(state.fleetOf.get(1)).toBe(0);
    expect(state.fleetOf.get(2)).toBe(0);
    expect(state.fleetOf.get(3)).toBe(1);
    expect(state.fleetOf.get(4)).toBe(1);
    expect(state.fleetOf.get(5)).toBe(1);
  });

  it('turn starts at 1; guidances + debrisAge are empty', () => {
    const cfg = configOf(seedOf(1, 1), [fleet(0, ['X'])]);
    const state = buildInitialState(cfg);
    expect(state.turn).toBe(1);
    expect(state.guidances.size).toBe(0);
    expect(state.debrisAge.size).toBe(0);
  });
});

describe('createMatch — starting posture', () => {
  it('every ship starts with zero velocity', () => {
    const cfg = configOf(seedOf(1, 2), [
      fleet(0, ['A', 'B']),
      fleet(1, ['C', 'D']),
    ]);
    const state = buildInitialState(cfg);
    for (const [, body] of state.bodies) {
      expect(body.velocity).toEqual({ x: 0, y: 0, z: 0 });
    }
  });

  it('every fleet centroid is equidistant from the arena boundary', () => {
    // Compute each fleet's centroid; assert its radius from arena.center is
    // the same (within numeric epsilon) for all fleets. That is the FR-12
    // "equidistant from boundary" invariant.
    const cfg = configOf(seedOf(3, 4), [
      fleet(0, ['A']),
      fleet(1, ['B']),
      fleet(2, ['C']),
    ]);
    const state = buildInitialState(cfg);
    const radii: number[] = [];
    const byFleet = new Map<number, { sum: { x: number; y: number; z: number }; count: number }>();
    for (const [id, body] of state.bodies) {
      const fid = state.fleetOf.get(id)!;
      const acc = byFleet.get(fid) ?? { sum: { x: 0, y: 0, z: 0 }, count: 0 };
      acc.sum.x += body.position.x;
      acc.sum.y += body.position.y;
      acc.sum.z += body.position.z;
      acc.count += 1;
      byFleet.set(fid, acc);
    }
    for (const [, acc] of byFleet) {
      const cx = acc.sum.x / acc.count;
      const cy = acc.sum.y / acc.count;
      const cz = acc.sum.z / acc.count;
      radii.push(Math.sqrt(cx * cx + cy * cy + cz * cz));
    }
    // The equatorial line offsets in each fleet cancel in the centroid, so
    // every centroid ends up at (nearly) the same shell radius. Tolerance
    // accounts for the [-0.5, +0.5] jitter within a fleet averaging out
    // approximately, not exactly, to zero.
    const target = cfg.arena.radius * 0.72;
    for (const r of radii) {
      // Loose tolerance — jitter is fleet-side only and can bias the centroid
      // slightly along the perpendicular axis for small N.
      expect(Math.abs(r - target)).toBeLessThan(30);
    }
  });

  it('no two ships overlap at start', () => {
    const cfg = configOf(seedOf(7, 8), [
      fleet(0, ['A', 'B', 'C']),
      fleet(1, ['D', 'E', 'F']),
    ]);
    const state = buildInitialState(cfg);
    expect(shipsNoOverlap(state)).toBe(true);
  });

  it('fleets start mutually out of weapons range (range 400 < arena diameter)', () => {
    const cfg = configOf(seedOf(11, 13), [
      fleet(0, ['A', 'B']),
      fleet(1, ['C', 'D']),
    ]);
    const state = buildInitialState(cfg);
    expect(fleetsOutOfMutualWeaponsRange(state)).toBe(true);
  });
});

describe('createMatch — min fleet-centroid separation (CP5, D-MINSEP)', () => {
  // Read the reconciled tuning value the sim placement must satisfy.
  const minSepFrac = tuningFile.arena.minFleetSeparationFraction;
  const maxFleets = tuningFile.match.maxFleets;

  it(`placement satisfies minFleetSeparationFraction (=${minSepFrac} · R) for N=2..${maxFleets}`, () => {
    // For each supported fleet count, build a match with that many single-ship
    // fleets and assert the min pairwise centroid separation is ≥ threshold.
    // Uses a stable per-N seed so failures reproduce.
    const arenaRadius = 5000;
    for (let n = 2; n <= maxFleets; n += 1) {
      const fleets: SimFleet[] = [];
      for (let fid = 0; fid < n; fid += 1) {
        fleets.push(fleet(fid, [`F${fid}`]));
      }
      const cfg = configOf(
        seedOf(0x101 + n, 0x202 + n),
        fleets,
        arena(arenaRadius),
      );
      const state = buildInitialState(cfg);
      const sep = minFleetCentroidSeparation(state);
      const threshold = minSepFrac * arenaRadius;
      expect(sep).toBeGreaterThanOrEqual(threshold);
    }
  });

  it('returns +Infinity for a single-fleet match (nothing to separate)', () => {
    const cfg = configOf(seedOf(1, 1), [fleet(0, ['X'])]);
    const state = buildInitialState(cfg);
    expect(minFleetCentroidSeparation(state)).toBe(Infinity);
  });
});

describe('createMatch — determinism', () => {
  it('same seed ⇒ identical positions (deep-equal)', () => {
    const cfg1 = configOf(seedOf(42, 100), [
      fleet(0, ['A', 'B']),
      fleet(1, ['C']),
    ]);
    const cfg2 = configOf(seedOf(42, 100), [
      fleet(0, ['A', 'B']),
      fleet(1, ['C']),
    ]);
    const s1 = buildInitialState(cfg1);
    const s2 = buildInitialState(cfg2);
    // Bodies with matching ids must have matching positions.
    for (const [id, b1] of s1.bodies) {
      const b2 = s2.bodies.get(id)!;
      expect(b1.position).toEqual(b2.position);
    }
  });

  it('different seed ⇒ different layout', () => {
    const cfg1 = configOf(seedOf(1, 1), [fleet(0, ['A']), fleet(1, ['B'])]);
    const cfg2 = configOf(seedOf(2, 2), [fleet(0, ['A']), fleet(1, ['B'])]);
    const s1 = buildInitialState(cfg1);
    const s2 = buildInitialState(cfg2);
    // At least one body's position differs — the seeded phase changes
    // the equatorial rotation.
    let anyDifferent = false;
    for (const [id, b1] of s1.bodies) {
      const b2 = s2.bodies.get(id)!;
      if (
        b1.position.x !== b2.position.x ||
        b1.position.y !== b2.position.y ||
        b1.position.z !== b2.position.z
      ) {
        anyDifferent = true;
        break;
      }
    }
    expect(anyDifferent).toBe(true);
  });
});
