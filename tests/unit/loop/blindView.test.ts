// blindView — the FR-17 / §6.3 blind-commit invariant, at loop scope.
//
// The tests here prove blind-commit is STRUCTURAL, not policy. There are no
// paths from a `BlindMatchView` to any other fleet's plan because there are
// no fields to reach one through, and the returned wrapper + slices are
// frozen so a planner cannot even mutate its input.

import { describe, expect, it } from 'vitest';
import { buildInitialState } from '../../../src/sim/loop/createMatch.js';
import { makeBlindView } from '../../../src/sim/loop/blindView.js';
import type { MatchConfig } from '../../../src/sim/loop/matchState.js';
import { seedOf } from '../../../src/sim/mathx/index.js';
import type {
  Arena,
  CombatConfig,
  SimFleet,
  SimShip,
} from '../../../src/sim/types.js';
import type { PhysicsConfig } from '../../../src/sim/physics/index.js';

const ship = (name: string): SimShip => ({
  buildId: `b-${name}`,
  name,
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
});

const arena = (): Arena => ({ center: { x: 0, y: 0, z: 0 }, radius: 10000 });
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
const cfg = (seed: MatchConfig['seed'], f: readonly SimFleet[]): MatchConfig => {
  const a = arena();
  return { seed, fleets: f, arena: a, physics: physics(a), combat: combat() };
};

describe('BlindMatchView — structural blind-commit (§6.3, FR-17)', () => {
  it('has no enumerable key that could name a plan / pending plan / coordinator', () => {
    const state = buildInitialState(
      cfg(seedOf(1, 1), [fleet(0, ['A']), fleet(1, ['B'])]),
    );
    const view = makeBlindView(state, 0);
    const keys = new Set(Object.keys(view));
    // The exact allowed shape — nothing beyond it may exist.
    const allowed = ['turn', 'arena', 'selfFleetId', 'bodies', 'ships'];
    for (const k of keys) expect(allowed).toContain(k);
    for (const banned of ['plans', 'pendingPlans', 'coordinator', 'commanders']) {
      expect(keys.has(banned)).toBe(false);
    }
  });

  it('shows ALL fleets ships (no fog of war, Decision 6)', () => {
    const state = buildInitialState(
      cfg(seedOf(1, 2), [fleet(0, ['A']), fleet(1, ['B'])]),
    );
    const view = makeBlindView(state, 0);
    // The self view should still expose the enemy ship.
    const fleetIds = new Set(view.ships.map((s) => s.fleetId));
    expect(fleetIds.has(0)).toBe(true);
    expect(fleetIds.has(1)).toBe(true);
  });
});

describe('BlindMatchView — frozen inputs', () => {
  it('wrapper is frozen', () => {
    const state = buildInitialState(cfg(seedOf(1, 3), [fleet(0, ['A'])]));
    const view = makeBlindView(state, 0);
    expect(Object.isFrozen(view)).toBe(true);
  });

  it('bodies + ships slices are frozen (mutation throws in strict mode)', () => {
    const state = buildInitialState(
      cfg(seedOf(1, 4), [fleet(0, ['A', 'B']), fleet(1, ['C'])]),
    );
    const view = makeBlindView(state, 0);
    expect(Object.isFrozen(view.bodies)).toBe(true);
    expect(Object.isFrozen(view.ships)).toBe(true);
    // A push to a frozen array throws in strict mode (ES modules are strict).
    expect(() => {
      (view.bodies as unknown as unknown[]).push(null);
    }).toThrow();
    expect(() => {
      (view.ships as unknown as unknown[]).push(null);
    }).toThrow();
  });

  it('bodies are sorted by BodyId', () => {
    const state = buildInitialState(
      cfg(seedOf(1, 5), [fleet(0, ['A', 'B']), fleet(1, ['C', 'D'])]),
    );
    const view = makeBlindView(state, 0);
    for (let i = 1; i < view.bodies.length; i += 1) {
      expect(view.bodies[i]!.id).toBeGreaterThan(view.bodies[i - 1]!.id);
    }
  });
});

describe('BlindMatchView — reproducibility', () => {
  it('two views built from the same state are structurally equal', () => {
    const state = buildInitialState(
      cfg(seedOf(7, 11), [fleet(0, ['A']), fleet(1, ['B'])]),
    );
    const v1 = makeBlindView(state, 0);
    const v2 = makeBlindView(state, 0);
    // Deep structural equality via JSON — plain data by design.
    expect(JSON.stringify(v1)).toBe(JSON.stringify(v2));
  });

  it('per-ship view surfaces hull/shields/component-alive without leaking plans', () => {
    const state = buildInitialState(
      cfg(seedOf(2, 3), [fleet(0, ['Alpha'])]),
    );
    const view = makeBlindView(state, 0);
    const alpha = view.ships[0]!;
    expect(alpha.name).toBe('Alpha');
    expect(alpha.hull).toBe(100);
    expect(alpha.shields).toBe(60);
    expect(alpha.shieldGenAlive).toBe(true);
    expect(alpha.engineAlive).toBe(true);
    expect(alpha.weaponAlive).toEqual([true]);
    // No 'plan'/'plans' anywhere in the ship view either.
    for (const k of Object.keys(alpha)) {
      expect(k).not.toMatch(/plan/i);
    }
  });
});
