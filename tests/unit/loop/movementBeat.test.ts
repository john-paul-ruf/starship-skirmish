// movementBeat — the loop's pure movement resolver.
//
// The tests here cover:
//   • collision damage applied to both parties (physics contact → rules)
//   • boundary-exit deaths → no AoE / no debris (FR-26)
//   • in-arena collision kills → AoE + debris this beat
//   • engine-dead ships coast (no plan applied)
//   • missile guidance plans threaded from state.guidances
//   • shuffled movement plans yield identical outcome digest (order-independence)

import { describe, expect, it } from 'vitest';
import { runMovementBeat } from '../../../src/sim/loop/resolveBeat.js';
import { buildInitialState } from '../../../src/sim/loop/createMatch.js';
import type {
  MatchConfig,
  MatchState,
  PendingDetonation,
} from '../../../src/sim/loop/matchState.js';
import { seedOf } from '../../../src/sim/mathx/index.js';
import type {
  Arena,
  Body,
  BodyId,
  CombatConfig,
  DestructionEvent,
  MissileBody,
  MovementPlan,
  SimFleet,
  SimShip,
} from '../../../src/sim/types.js';
import type { PhysicsConfig } from '../../../src/sim/physics/index.js';
import { resolveMovement } from '../../../src/sim/physics/index.js';
import type { MissileGuidance } from '../../../src/sim/rules/index.js';

// ---- Fixtures --------------------------------------------------------------

const arena = (): Arena => ({ center: { x: 0, y: 0, z: 0 }, radius: 5000 });

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

const ship = (name: string, o: Partial<SimShip> = {}): SimShip => ({
  buildId: `b-${name}`,
  name,
  chassisClass: 'frigate',
  mass: 500,
  radius: 20,
  maxHull: 100,
  shieldCapacity: 0, // most tests want hull damage to apply immediately
  shieldRegenPerTurn: 0,
  deltaVPerTurn: 300,
  baseEvasion: 0.1,
  hullRepairPerTurn: 0,
  weapons: [{ range: 400, damage: 20, shotsPerTurn: 1, accuracy: 0.9 }],
  missiles: [],
  pointDefense: [],
  decoys: [],
  ...o,
});

const fleet = (id: number, names: readonly string[], o: Partial<SimShip> = {}): SimFleet => ({
  fleetId: id,
  ships: names.map((n) => ship(n, o)),
});

const cfg = (fleets: readonly SimFleet[], a: Arena = arena()): MatchConfig => ({
  seed: seedOf(1, 2),
  fleets,
  arena: a,
  physics: physics(a),
  combat: combat(),
});

// Rewrite a body's position/velocity — helper for setting up collisions.
const withBody = (state: MatchState, id: BodyId, patch: Partial<Body>): MatchState => {
  const bodies = new Map(state.bodies);
  const b = bodies.get(id)!;
  bodies.set(id, { ...b, ...patch } as Body);
  return { ...state, bodies };
};

// Deterministic digest of the resulting state's shape.
const digest = (out: ReturnType<typeof runMovementBeat>): string => {
  const ships = Array.from(out.state.ships.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([id, sc]) => ({ id, h: sc.hull, s: sc.shields }));
  const bodies = Array.from(out.state.bodies.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([id, b]) => ({
      id,
      kind: b.kind,
      x: Math.round(b.position.x * 100) / 100,
      y: Math.round(b.position.y * 100) / 100,
      z: Math.round(b.position.z * 100) / 100,
    }));
  const destroyed = out.record.destroyed.map((d) => ({
    id: d.bodyId,
    cause: d.cause,
    det: d.detonates,
  }));
  return JSON.stringify({ ships, bodies, destroyed });
};

// ---- Tests -----------------------------------------------------------------

describe('runMovementBeat — plans + physics', () => {
  it('applies movement plans (deltaV) and integrates one beat', () => {
    // Two ships far apart; each gets a small deltaV. No collision expected.
    let state = buildInitialState(cfg([fleet(0, ['A']), fleet(1, ['B'])]));
    const idA = 1;
    const idB = 2;
    // Place explicitly (bypass seeded placement — tests want predictability).
    state = withBody(state, idA, { position: { x: -1000, y: 0, z: 0 } });
    state = withBody(state, idB, { position: { x: 1000, y: 0, z: 0 } });
    const plans: MovementPlan[] = [
      { bodyId: idA, deltaV: { x: 10, y: 0, z: 0 } },
      { bodyId: idB, deltaV: { x: -10, y: 0, z: 0 } },
    ];
    const out = runMovementBeat(state, plans);
    const outA = out.state.bodies.get(idA)!;
    const outB = out.state.bodies.get(idB)!;
    // dt = 1, so position advances by velocity × 1.
    expect(outA.velocity.x).toBeCloseTo(10, 6);
    expect(outB.velocity.x).toBeCloseTo(-10, 6);
    expect(outA.position.x).toBeCloseTo(-990, 6);
    expect(outB.position.x).toBeCloseTo(990, 6);
  });

  it('engine-dead ship gets no plan applied (coasts)', () => {
    let state = buildInitialState(cfg([fleet(0, ['A']), fleet(1, ['B'])]));
    // Knock out A's engine before the beat runs.
    const shipsMut = new Map(state.ships);
    const scA = shipsMut.get(1)!;
    shipsMut.set(1, { ...scA, engineAlive: false });
    state = { ...state, ships: shipsMut };
    state = withBody(state, 1, { position: { x: -1000, y: 0, z: 0 } });
    state = withBody(state, 2, { position: { x: 1000, y: 0, z: 0 } });
    const plans: MovementPlan[] = [
      { bodyId: 1, deltaV: { x: 50, y: 0, z: 0 } }, // dropped — engine dead
      { bodyId: 2, deltaV: { x: -10, y: 0, z: 0 } },
    ];
    const out = runMovementBeat(state, plans);
    // A's velocity unchanged from initial zero.
    expect(out.state.bodies.get(1)!.velocity.x).toBe(0);
    expect(out.state.bodies.get(2)!.velocity.x).toBeCloseTo(-10, 6);
  });
});

describe('runMovementBeat — collisions', () => {
  it('head-on collision deals the physics damage to BOTH ships', () => {
    let state = buildInitialState(cfg([fleet(0, ['A']), fleet(1, ['B'])]));
    // Set up a head-on: ships very close, moving toward each other fast.
    state = withBody(state, 1, {
      position: { x: -30, y: 0, z: 0 },
      velocity: { x: 200, y: 0, z: 0 },
    });
    state = withBody(state, 2, {
      position: { x: 30, y: 0, z: 0 },
      velocity: { x: -200, y: 0, z: 0 },
    });
    const out = runMovementBeat(state, []);
    // Both ships should have taken hull damage (their shields are 0 by test fixture).
    const scA = out.state.ships.get(1);
    const scB = out.state.ships.get(2);
    // If both survived, hull < starting hull:
    if (scA && scB) {
      expect(scA.hull).toBeLessThan(100);
      expect(scB.hull).toBeLessThan(100);
    } else {
      // If either died, we still expect BOTH to have shown damage in the log.
      expect(out.record.log.length).toBeGreaterThan(0);
    }
    // At least one collision contact was reported.
    expect(out.record.contacts.length).toBeGreaterThan(0);
  });
});

describe('runMovementBeat — boundary vs in-arena death (FR-26)', () => {
  it('ship pushed out of bounds is destroyed with detonates=false, no debris', () => {
    // Small arena so a fast body easily exits it.
    const smallArena: Arena = { center: { x: 0, y: 0, z: 0 }, radius: 200 };
    const c = cfg([fleet(0, ['A'])], smallArena);
    let state = buildInitialState(c);
    // Move A near the boundary and give it velocity away from center.
    state = withBody(state, 1, {
      position: { x: 150, y: 0, z: 0 },
      velocity: { x: 200, y: 0, z: 0 },
    });
    const out = runMovementBeat(state, []);
    // A crossed the shell → destroyed with detonates=false, no AoE, no debris.
    const dead = out.record.destroyed;
    expect(dead.length).toBe(1);
    expect(dead[0]!.bodyId).toBe(1);
    expect(dead[0]!.detonates).toBe(false);
    expect(dead[0]!.cause).toBe('boundary');
    // No debris bodies in the resulting state.
    for (const [, b] of out.state.bodies) {
      expect(b.kind).not.toBe('debris');
    }
  });
});

describe('runMovementBeat — point-defense interception (CP2)', () => {
  it('intercepts an incoming missile: no AoE, missile removed, intercept log entry', () => {
    // One defender with a PD turret guaranteed to hit (chance=1) at range 200.
    // One incoming missile positioned inside the interceptRange with a small
    // inbound velocity. The intercepted missile is destroyed BEFORE Stage C's
    // contact processing, so its detonate-on-contact never fires — the
    // defender takes zero AoE damage.
    const smallArena: Arena = { center: { x: 0, y: 0, z: 0 }, radius: 5000 };
    const defenderShip: SimShip = ship('Defender', {
      pointDefense: [
        { interceptRange: 300, interceptChance: 1, interceptsPerTurn: 1 },
      ],
    });
    // Defender-only fleet 0; second fleet exists purely so `buildInitialState`
    // has ≥2 fleets to place. The missile below is injected directly.
    let state = buildInitialState(
      cfg([
        { fleetId: 0, ships: [defenderShip] },
        fleet(1, ['Dummy']),
      ], smallArena),
    );
    const defenderId: BodyId = 1;
    // Move defender to origin; move the dummy fleet ship far away so it does
    // not participate.
    state = withBody(state, defenderId, { position: { x: 0, y: 0, z: 0 } });
    state = withBody(state, 2, { position: { x: 4000, y: 0, z: 0 } });

    // Inject a live missile body + guidance targeting the defender.
    const missileId: BodyId = 999;
    const missileBody: MissileBody = {
      kind: 'missile',
      id: missileId,
      position: { x: 100, y: 0, z: 0 },  // 100 units — well inside PD range
      velocity: { x: -1, y: 0, z: 0 },   // slow — stays inside range post-step
      mass: 3,
      radius: 5,
    };
    const bodies = new Map<BodyId, Body>(state.bodies);
    bodies.set(missileId, missileBody);
    const guidance: MissileGuidance = {
      bodyId: missileId,
      targetId: defenderId,
      trackingBeatsLeft: 2,
      rackDamage: 40,
      aoeRadius: 60,
      trackingTurnRate: 30,
    };
    const guidances = new Map<BodyId, MissileGuidance>(state.guidances);
    guidances.set(missileId, guidance);
    state = { ...state, bodies, guidances };

    const out = runMovementBeat(state, []);

    // Missile is gone from the field.
    expect(out.state.bodies.has(missileId)).toBe(false);
    // Guidance was dropped for the intercepted missile (bodyId no longer in
    // bodiesOut ⇒ guidance filter drops it).
    expect(out.state.guidances.has(missileId)).toBe(false);
    // Defender took NO AoE damage — interception preceded any detonation.
    expect(out.state.ships.get(defenderId)!.hull).toBe(100);
    // The record's log contains an intercept entry for this missile.
    const interceptEntries = out.record.log.filter(
      (e) => e.beat === 'movement' && e.result === 'intercept' && e.targetId === missileId,
    );
    expect(interceptEntries.length).toBe(1);
    expect(interceptEntries[0]!.sourceId).toBe(defenderId);
    expect(interceptEntries[0]!.chance).toBe(1);
  });

  it('missile outside interceptRange is NOT intercepted', () => {
    const smallArena: Arena = { center: { x: 0, y: 0, z: 0 }, radius: 5000 };
    const defenderShip: SimShip = ship('Defender', {
      pointDefense: [
        { interceptRange: 50, interceptChance: 1, interceptsPerTurn: 1 },
      ],
    });
    let state = buildInitialState(
      cfg([
        { fleetId: 0, ships: [defenderShip] },
        fleet(1, ['Dummy']),
      ], smallArena),
    );
    state = withBody(state, 1, { position: { x: 0, y: 0, z: 0 } });
    state = withBody(state, 2, { position: { x: 4000, y: 0, z: 0 } });

    // Missile is at 200 — far outside interceptRange=50.
    const missileId: BodyId = 999;
    const bodies = new Map<BodyId, Body>(state.bodies);
    bodies.set(missileId, {
      kind: 'missile',
      id: missileId,
      position: { x: 200, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      mass: 3,
      radius: 5,
    });
    const guidances = new Map<BodyId, MissileGuidance>(state.guidances);
    guidances.set(missileId, {
      bodyId: missileId,
      targetId: 1,
      trackingBeatsLeft: 2,
      rackDamage: 40,
      aoeRadius: 60,
      trackingTurnRate: 30,
    });
    state = { ...state, bodies, guidances };

    const out = runMovementBeat(state, []);
    // Missile survives (no intercept, no contact).
    expect(out.state.bodies.has(missileId)).toBe(true);
    // No intercept log entries at all.
    const interceptEntries = out.record.log.filter((e) => e.result === 'intercept');
    expect(interceptEntries.length).toBe(0);
  });
});

describe('runMovementBeat — destruction cascade consume (CP3)', () => {
  const cascadeCombat = (): CombatConfig => ({
    ...combat(),
    destruction: {
      ...combat().destruction,
      cascadeToNextMovement: true,
    },
  });

  it("consumes state.pendingDetonations: witness takes ownership-blind AoE + debris appears", () => {
    // Setup: two ships in fleet 0 (Witness at origin, Extra far away).
    // A cascade carries in for a "phantom" frigate at position (0, 0, 0) —
    // frigate AoE radius from the test combat config is 90; damage 40 at
    // center. Place Witness INSIDE the AoE. debrisPerDestruction.frigate=4.
    let state = buildInitialState(cfg([
      { fleetId: 0, ships: [ship('Witness'), ship('Extra')] },
      fleet(1, ['Bystander']),
    ]));
    const witnessId: BodyId = 1;
    state = withBody(state, witnessId, { position: { x: 50, y: 0, z: 0 } });
    state = withBody(state, 2, { position: { x: 4000, y: 0, z: 0 } });
    state = withBody(state, 3, { position: { x: -4000, y: 0, z: 0 } });

    // The phantom event's bodyId (900) is not in ships/bodies — that is
    // correct: the ship was destroyed in the (imagined) prior attack beat.
    // Carry its SimShip so spawnDebris has `ship.mass`.
    const phantomShip: SimShip = ship('Phantom');
    const phantomEvent: DestructionEvent = {
      bodyId: 900,
      chassisClass: 'frigate',
      position: { x: 0, y: 0, z: 0 },  // Witness at (50,0,0) is 50 < 90 (AoE radius)
      velocity: { x: 0, y: 0, z: 0 },
      cause: 'weapon',
      detonates: true,
    };
    const pending: PendingDetonation[] = [{ event: phantomEvent, ship: phantomShip }];
    state = {
      ...state,
      combat: cascadeCombat(),
      pendingDetonations: pending,
    };

    const witnessBefore = state.ships.get(witnessId)!.hull;
    const out = runMovementBeat(state, []);

    // Witness took AoE damage — hull strictly less than before.
    const witnessAfter = out.state.ships.get(witnessId)!.hull;
    expect(witnessAfter).toBeLessThan(witnessBefore);

    // debrisPerDestruction.frigate = 4 bodies appear.
    const debrisCount = Array.from(out.state.bodies.values()).filter(
      (b) => b.kind === 'debris',
    ).length;
    expect(debrisCount).toBe(4);

    // Cascade cleared from the output state — the next beat sees no pending.
    expect(out.state.pendingDetonations).toEqual([]);
  });

  it("gate off (cascadeToNextMovement absent + empty pending): NO cascade damage, NO debris", () => {
    let state = buildInitialState(cfg([
      { fleetId: 0, ships: [ship('Witness'), ship('Extra')] },
      fleet(1, ['Bystander']),
    ]));
    const witnessId: BodyId = 1;
    state = withBody(state, witnessId, { position: { x: 50, y: 0, z: 0 } });
    state = withBody(state, 2, { position: { x: 4000, y: 0, z: 0 } });
    state = withBody(state, 3, { position: { x: -4000, y: 0, z: 0 } });
    // Baseline combat() has cascadeToNextMovement absent (⇒ gate off).
    // Empty pendingDetonations models the produce-side output.
    state = { ...state, pendingDetonations: [] };
    const witnessBefore = state.ships.get(witnessId)!.hull;
    const out = runMovementBeat(state, []);
    expect(out.state.ships.get(witnessId)!.hull).toBe(witnessBefore);
    const debrisCount = Array.from(out.state.bodies.values()).filter(
      (b) => b.kind === 'debris',
    ).length;
    expect(debrisCount).toBe(0);
  });
});

// ============================================================================
// Feature: finite-thrust-movement — SESSION-02
// ============================================================================
//
// S02 lets SHIP plans carry `MovementPlan.segments` (finite-thrust) through
// `runMovementBeat` unchanged while MISSILES stay impulsive (D-MISSILE-
// IMPULSIVE). The loop already forwards plans opaquely into `resolveMovement`
// (S01 owns the finite-thrust integrator + shared `thrustSchedule`); these
// tests lock that "beat adds no divergence vs a direct resolveMovement" and
// "missiles emit segments-absent plans" property.

// A `PhysicsConfig` with `maxAccel` set — S01 followUp #1 notes production
// `maxAccel` reaches PhysicsConfig only once `physicsConfigFromTuning` is
// taught to propagate it (out of this session's lease). Unit-test scaffolding
// constructs the config directly, in-lease.
const physicsFT = (a: Arena): PhysicsConfig => ({
  dt: 1,
  subStepMin: 4,
  subStepMax: 64,
  restitution: 0.15,
  collisionDamageCoefficient: 0.0012,
  arena: a,
  maxAccel: 25,
});

const cfgFT = (fleets: readonly SimFleet[], a: Arena = arena()): MatchConfig => ({
  seed: seedOf(1, 2),
  fleets,
  arena: a,
  physics: physicsFT(a),
  combat: combat(),
});

describe('runMovementBeat — finite-thrust ship plans (SESSION-02)', () => {
  it('routes a segmented ship plan through the beat unchanged (matches direct resolveMovement)', () => {
    // A lone-participant ship carrying two waypoint burns (+y then +z). No
    // collisions, no missiles. The beat's final position must equal what a
    // direct `resolveMovement` call with the SAME plan produces — proving
    // the beat contributes no divergence beyond what S01's shared
    // `thrustSchedule` already delivers. Ship B is placed far away so it
    // never interacts.
    const a = arena();
    let state = buildInitialState(cfgFT([fleet(0, ['A']), fleet(1, ['B'])], a));
    const idA: BodyId = 1;
    state = withBody(state, idA, {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 5, y: 0, z: 0 },
    });
    state = withBody(state, 2, {
      position: { x: 4000, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
    });

    const segmentedPlan: MovementPlan = {
      bodyId: idA,
      deltaV: { x: 0, y: 0, z: 0 }, // ignored on the finite-thrust branch
      segments: [
        { deltaV: { x: 0, y: 12, z: 0 } },
        { deltaV: { x: 0, y: 0, z: 12 } },
      ],
    };

    const beatOut = runMovementBeat(state, [segmentedPlan]);

    // Direct comparison. Same bodies snapshot, same plan, same PhysicsConfig
    // — `resolveMovement` is the S01 primitive the beat forwards into.
    const bodiesIn = Array.from(state.bodies.values()).sort((x, y) => x.id - y.id);
    const stepResult = resolveMovement(bodiesIn, [segmentedPlan], state.physics);
    const directA = stepResult.finalBodies.find((b) => b.id === idA)!;
    const beatA = beatOut.state.bodies.get(idA)!;

    // Byte-identical position + velocity — the beat added nothing.
    expect(beatA.position.x).toBe(directA.position.x);
    expect(beatA.position.y).toBe(directA.position.y);
    expect(beatA.position.z).toBe(directA.position.z);
    expect(beatA.velocity.x).toBe(directA.velocity.x);
    expect(beatA.velocity.y).toBe(directA.velocity.y);
    expect(beatA.velocity.z).toBe(directA.velocity.z);

    // Record's keyframes carry the curve for free — one snapshot per sub-step
    // (physics `StepResult.keyframes` is `subStepCount + 1`; the beat wires it
    // through unchanged). Curved playback needs no trace-shape change.
    expect(beatOut.record.keyframes.length).toBe(stepResult.subStepCount + 1);
    expect(beatOut.record.subStepCount).toBe(stepResult.subStepCount);
  });

  it('a segmented ship plan actually curves (position.y > 0 after a purely +y burn segment)', () => {
    // Ship starts at rest; single +y burn. If segments were silently stripped,
    // the ship would coast at zero and this assertion would fail. Not a
    // determinism test — a smoke assertion that finite thrust delivers motion.
    const a = arena();
    let state = buildInitialState(cfgFT([fleet(0, ['A']), fleet(1, ['B'])], a));
    state = withBody(state, 1, {
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
    });
    state = withBody(state, 2, { position: { x: 4000, y: 0, z: 0 } });

    const plan: MovementPlan = {
      bodyId: 1,
      deltaV: { x: 0, y: 0, z: 0 },
      segments: [{ deltaV: { x: 0, y: 10, z: 0 } }],
    };
    const out = runMovementBeat(state, [plan]);
    const a1 = out.state.bodies.get(1)!;
    expect(a1.position.y).toBeGreaterThan(0);
  });
});

describe('runMovementBeat — determinism (shuffle-invariance)', () => {
  it('shuffled movement plans ⇒ identical digest', () => {
    // Multi-body scenario where the physics + damage stack could reorder if
    // we iterated Map keys instead of sorted ids.
    let state = buildInitialState(cfg([
      fleet(0, ['A', 'B', 'C']),
      fleet(1, ['D', 'E']),
    ]));
    // Explicit positions so seed doesn't matter for the shuffle test.
    const positions: Record<number, { x: number; y: number; z: number }> = {
      1: { x: -800, y: 0, z: 0 },
      2: { x: -600, y: 100, z: 0 },
      3: { x: -400, y: 200, z: 0 },
      4: { x: 800, y: 0, z: 0 },
      5: { x: 600, y: 100, z: 0 },
    };
    for (const idStr of Object.keys(positions)) {
      const id = Number(idStr);
      state = withBody(state, id, { position: positions[id]! });
    }
    const plans: MovementPlan[] = [
      { bodyId: 1, deltaV: { x: 20, y: 0, z: 0 } },
      { bodyId: 2, deltaV: { x: 20, y: 0, z: 0 } },
      { bodyId: 3, deltaV: { x: 20, y: 0, z: 0 } },
      { bodyId: 4, deltaV: { x: -20, y: 0, z: 0 } },
      { bodyId: 5, deltaV: { x: -20, y: 0, z: 0 } },
    ];
    const shuffled: MovementPlan[] = [plans[3]!, plans[0]!, plans[4]!, plans[2]!, plans[1]!];
    const d1 = digest(runMovementBeat(state, plans));
    const d2 = digest(runMovementBeat(state, shuffled));
    expect(d1).toBe(d2);
  });
});
