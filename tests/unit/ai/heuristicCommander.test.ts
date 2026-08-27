// HeuristicCommander — the M12 Commander implementation (S04 CP3).
//
// Locks the load-bearing contract properties:
//   * Implements the `Commander` interface (fleetId + planMovement + planAttack).
//   * Emits plans ONLY for owned live ships (delegation to S03's movement
//     planner + this session's attack planner).
//   * Deterministic — same view → same plans across repeated calls.
//   * Tier differentiation is observable (rookie ≠ ace on the same view).
//   * Blind-safe — does not mutate the frozen `BlindMatchView`
//     (`Object.isFrozen(view)` still true after a call).
//
// Fixtures replicate the minimal-view pattern movementPlanner.test.ts uses
// (in-file — the shared-helper hoist to tests/support/blindView.ts is a
// Forge follow-up outside this session's lease).

import { describe, expect, it } from 'vitest';
import { of } from '../../../src/sim/mathx/index.js';
import type { Vec3 } from '../../../src/sim/mathx/index.js';
import type { Body, BodyId, SimShip } from '../../../src/sim/types.js';
import type {
  BlindMatchView,
  BlindShipView,
  Commander,
} from '../../../src/sim/loop/index.js';
import type { PhysicsConfig } from '../../../src/sim/physics/index.js';
import { HeuristicCommander } from '../../../src/ai/HeuristicCommander.js';

// ---------------------------------------------------------------------------
// Fixture builders — same shape as movementPlanner.test.ts + attackPlanner.test.
// ---------------------------------------------------------------------------

const PHYSICS: PhysicsConfig = {
  dt: 1,
  subStepMin: 4,
  subStepMax: 64,
  restitution: 0.15,
  collisionDamageCoefficient: 0.0012,
  arena: { center: of(0, 0, 0), radius: 5000 },
};

const shipProfile = (
  name: string,
  overrides: Partial<SimShip> = {},
): SimShip => ({
  buildId: `b-${name}`,
  name,
  chassisClass: 'frigate',
  mass: 500,
  radius: 20,
  maxHull: 100,
  shieldCapacity: 60,
  shieldRegenPerTurn: 15,
  deltaVPerTurn: 80,
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
  });

const body = (id: BodyId, position: Vec3, velocity: Vec3 = of(0, 0, 0)): Body => ({
  kind: 'ship',
  id,
  position,
  velocity,
  mass: 500,
  radius: 20,
});

interface Entry {
  readonly bodyId: BodyId;
  readonly fleetId: number;
  readonly position: Vec3;
  readonly velocity?: Vec3;
  readonly view: BlindShipView;
}
const buildView = (
  selfFleetId: number,
  entries: readonly Entry[],
): BlindMatchView => {
  const sorted = entries.slice().sort((a, b) => a.bodyId - b.bodyId);
  return Object.freeze({
    turn: 1,
    arena: PHYSICS.arena,
    selfFleetId,
    bodies: Object.freeze(
      sorted.map((e) => body(e.bodyId, e.position, e.velocity ?? of(0, 0, 0))),
    ),
    ships: Object.freeze(sorted.map((e) => e.view)),
  });
};

// ---------------------------------------------------------------------------
// Commander interface contract
// ---------------------------------------------------------------------------

describe('HeuristicCommander — Commander interface', () => {
  it('exposes fleetId and satisfies the Commander shape structurally', () => {
    const cmd: Commander = new HeuristicCommander(7, 'rookie', PHYSICS);
    expect(cmd.fleetId).toBe(7);
    expect(typeof cmd.planMovement).toBe('function');
    expect(typeof cmd.planAttack).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// planMovement / planAttack — owned live ships only, sorted BodyId ASC
// ---------------------------------------------------------------------------

describe('HeuristicCommander — plans only for owned live ships', () => {
  const p = shipProfile('X');

  const mixedFleetView = (): BlindMatchView =>
    buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(-100, 0, 0), view: shipView(1, 0, 100, 60, p) },
      { bodyId: 2, fleetId: 1, position: of(300, 0, 0), view: shipView(2, 1, 100, 60, p) },
      { bodyId: 3, fleetId: 0, position: of(50, 0, 0), view: shipView(3, 0, 100, 60, p) },
      // Dead own ship — should NOT get a plan.
      { bodyId: 4, fleetId: 0, position: of(0, 100, 0), view: shipView(4, 0, 0, 0, p) },
    ]);

  it('planMovement returns one plan per owned live ship, BodyId ASC', () => {
    const cmd = new HeuristicCommander(0, 'rookie', PHYSICS);
    const plans = cmd.planMovement(mixedFleetView());
    expect(plans.map((p) => p.bodyId)).toEqual([1, 3]);
  });

  it('planAttack returns plans only from owned live ships', () => {
    const cmd = new HeuristicCommander(0, 'rookie', PHYSICS);
    const plans = cmd.planAttack(mixedFleetView());
    // Each owned live ship has one alive weapon → one plan per ship.
    expect(plans).toHaveLength(2);
    const shooters = plans.map((p) => p.shooterId).sort((a, b) => a - b);
    expect(shooters).toEqual([1, 3]);
    for (const plan of plans) {
      expect(plan.targetId).toBe(2); // the only enemy
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism — identical view → identical plans across repeated calls
// ---------------------------------------------------------------------------

describe('HeuristicCommander — determinism (pure function of the view)', () => {
  const p = shipProfile('X');

  const twoFleetView = (): BlindMatchView =>
    buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(-100, 0, 0), view: shipView(1, 0, 100, 60, p) },
      { bodyId: 2, fleetId: 1, position: of(300, 0, 0), view: shipView(2, 1, 100, 60, p) },
      { bodyId: 3, fleetId: 0, position: of(50, 20, 0), view: shipView(3, 0, 100, 60, p) },
    ]);

  it('same view → same movement plans on repeated calls', () => {
    const cmd = new HeuristicCommander(0, 'veteran', PHYSICS);
    const a = cmd.planMovement(twoFleetView());
    const b = cmd.planMovement(twoFleetView());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('same view → same attack plans on repeated calls', () => {
    const cmd = new HeuristicCommander(0, 'ace', PHYSICS);
    const a = cmd.planAttack(twoFleetView());
    const b = cmd.planAttack(twoFleetView());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// Tier differentiation — rookie vs ace produce OBSERVABLY different plans
// ---------------------------------------------------------------------------

describe('HeuristicCommander — tier differentiation is observable', () => {
  it('rookie vs ace differ on movement plans against the same view', () => {
    // A view with a nearer soft target and a farther heavy target — rookie
    // uses spatially-nearest (movement planner), ace uses threat-map. The
    // baseline arc + candidate ladder differ enough that at least one plan's
    // deltaV should differ.
    const p = shipProfile('X');
    const heavy = shipProfile('heavy', { maxHull: 400, shieldCapacity: 200 });
    const soft = shipProfile('soft', { maxHull: 40, shieldCapacity: 10 });
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, p) },
      // heavy is nearer (rookie target); soft is farther (ace threat-map target).
      { bodyId: 2, fleetId: 1, position: of(100, 0, 0), view: shipView(2, 1, 400, 200, heavy) },
      { bodyId: 3, fleetId: 1, position: of(-800, 0, 0), view: shipView(3, 1, 40, 10, soft) },
    ]);
    const rookie = new HeuristicCommander(0, 'rookie', PHYSICS);
    const ace = new HeuristicCommander(0, 'ace', PHYSICS);
    const rMove = rookie.planMovement(view);
    const aMove = ace.planMovement(view);
    // Same ship gets a plan; the deltaVs should NOT be identical (different
    // target direction → different baseline arc for at least one tier).
    expect(rMove).toHaveLength(1);
    expect(aMove).toHaveLength(1);
    expect(JSON.stringify(rMove[0]!.deltaV)).not.toBe(
      JSON.stringify(aMove[0]!.deltaV),
    );
  });

  it('rookie vs veteran differ on attack plans against a zero-shield target', () => {
    // Veteran emits calledShot (shield-generator); rookie does not.
    const p = shipProfile('X');
    const dropped = shipView(2, 1, 100, 0, p);
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, p) },
      { bodyId: 2, fleetId: 1, position: of(200, 0, 0), view: dropped },
    ]);
    const rookie = new HeuristicCommander(0, 'rookie', PHYSICS);
    const veteran = new HeuristicCommander(0, 'veteran', PHYSICS);
    const rAtk = rookie.planAttack(view);
    const vAtk = veteran.planAttack(view);
    expect(rAtk[0]!.calledShot).toBeUndefined();
    expect(vAtk[0]!.calledShot).toEqual({ kind: 'shield-generator' });
  });
});

// ---------------------------------------------------------------------------
// Blind-safety — the commander does NOT mutate the frozen view
// ---------------------------------------------------------------------------

describe('HeuristicCommander — does not mutate the frozen view', () => {
  it('view stays frozen after planMovement + planAttack', () => {
    const p = shipProfile('X');
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, p) },
      { bodyId: 2, fleetId: 1, position: of(200, 0, 0), view: shipView(2, 1, 100, 60, p) },
    ]);
    const cmd = new HeuristicCommander(0, 'ace', PHYSICS);
    cmd.planMovement(view);
    cmd.planAttack(view);
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.bodies)).toBe(true);
    expect(Object.isFrozen(view.ships)).toBe(true);
  });
});
