// movementPlanner — the tier-parameterized promotion of the Gate-2 planner.
//
// This file locks the three FINDINGS invariants at unit scope:
//   (a) Cruise-velocity convergence: post-plan speed toward the target
//       converges to `budget × TIER_CONFIG[tier].cruiseSpeedFraction` over
//       several beats — FINDINGS §1a, the load-bearing FR-29 fix.
//   (b) Rookie's `baseline-veto` ladder coasts when the baseline exits, while
//       veteran/ace recover via the full-7 ladder — FINDINGS §2 tier flavour.
//   (c) `planFleetMovement` emits one plan per owned live ship in ascending
//       BodyId order (architecture §7.3 rule 1).
//
// The FR-29 "zero unforced boundary deaths" cross-tier regression lives in
// `boundarySafety.test.ts` (CP3).

import { describe, expect, it } from 'vitest';
import { of, sub, length, distance } from '../../../src/sim/mathx/index.js';
import type { Vec3 } from '../../../src/sim/mathx/index.js';
import type { Body, BodyId, SimShip } from '../../../src/sim/types.js';
import type {
  BlindMatchView,
  BlindShipView,
} from '../../../src/sim/loop/blindView.js';
import type { PhysicsConfig } from '../../../src/sim/physics/index.js';
import { previewPath, resolveMovement } from '../../../src/sim/physics/index.js';
import { TIER_CONFIG, type BotTier } from '../../../src/ai/tiers.js';
import {
  baselineArc,
  buildCandidates,
  cruiseSpeedFor,
  pickTargetBodyId,
  planFleetMovement,
  planShipMovement,
} from '../../../src/ai/movementPlanner.js';

// ---------------------------------------------------------------------------
// Fixture builders — the same minimal-view pattern threatMap.test.ts uses.
// ---------------------------------------------------------------------------

const PHYSICS: PhysicsConfig = {
  dt: 1,
  subStepMin: 4,
  subStepMax: 64,
  restitution: 0.15,
  collisionDamageCoefficient: 0.0012,
  arena: { center: of(0, 0, 0), radius: 800 },
};

const shipProfile = (name: string, overrides: Partial<SimShip> = {}): SimShip => ({
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
  arena = PHYSICS.arena,
): BlindMatchView => {
  const sorted = entries.slice().sort((a, b) => a.bodyId - b.bodyId);
  return Object.freeze({
    turn: 1,
    arena,
    selfFleetId,
    bodies: Object.freeze(
      sorted.map((e) => body(e.bodyId, e.position, e.velocity ?? of(0, 0, 0))),
    ),
    ships: Object.freeze(sorted.map((e) => e.view)),
  });
};

// ---- pickTargetBodyId ----------------------------------------------------

describe('pickTargetBodyId — routes by TIER_CONFIG.targeting', () => {
  const p = shipProfile('X');

  it('rookie (nearest) picks the closer enemy', () => {
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, p) },
      { bodyId: 2, fleetId: 1, position: of(500, 0, 0), view: shipView(2, 1, 100, 60, p) },
      { bodyId: 3, fleetId: 1, position: of(100, 0, 0), view: shipView(3, 1, 100, 60, p) },
    ]);
    const self = view.bodies.find((b) => b.id === 1)!;
    expect(pickTargetBodyId(view, self, 'rookie')).toBe(3);
  });

  it('veteran (threat-weighted) picks the higher-scoring enemy', () => {
    // Two enemies at equal distance: one heavily armored (lower priority),
    // one soft (higher priority). Threat-weighted must pick the soft one.
    const heavy = shipProfile('heavy', {
      maxHull: 400,
      shieldCapacity: 200,
    });
    const soft = shipProfile('soft', { maxHull: 40, shieldCapacity: 10 });
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, p) },
      { bodyId: 2, fleetId: 1, position: of(100, 0, 0), view: shipView(2, 1, 400, 200, heavy) },
      { bodyId: 3, fleetId: 1, position: of(-100, 0, 0), view: shipView(3, 1, 40, 10, soft) },
    ]);
    const self = view.bodies.find((b) => b.id === 1)!;
    expect(pickTargetBodyId(view, self, 'veteran')).toBe(3);
  });

  it('ace (threat-map) also picks the higher-scoring enemy', () => {
    const heavy = shipProfile('heavy', { maxHull: 400, shieldCapacity: 200 });
    const soft = shipProfile('soft', { maxHull: 40, shieldCapacity: 10 });
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, p) },
      { bodyId: 2, fleetId: 1, position: of(100, 0, 0), view: shipView(2, 1, 400, 200, heavy) },
      { bodyId: 3, fleetId: 1, position: of(-100, 0, 0), view: shipView(3, 1, 40, 10, soft) },
    ]);
    const self = view.bodies.find((b) => b.id === 1)!;
    expect(pickTargetBodyId(view, self, 'ace')).toBe(3);
  });

  it('returns null when no live enemy exists', () => {
    const view = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, p) },
    ]);
    const self = view.bodies.find((b) => b.id === 1)!;
    expect(pickTargetBodyId(view, self, 'rookie')).toBeNull();
    expect(pickTargetBodyId(view, self, 'veteran')).toBeNull();
    expect(pickTargetBodyId(view, self, 'ace')).toBeNull();
  });
});

// ---- baselineArc ---------------------------------------------------------

describe('baselineArc — cruise-velocity target (FINDINGS §1a)', () => {
  it('returns ZERO if target is null (no enemies visible)', () => {
    const self = body(1, of(0, 0, 0));
    expect(baselineArc(self, null, 80, 40)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('aims at cruise velocity toward target and clamps to budget', () => {
    const self = body(1, of(0, 0, 0));
    const target = body(2, of(200, 0, 0));
    const dv = baselineArc(self, target, 80, 40);
    // Ship is stationary, cruise speed = 40 toward +X. Desired velocity is (40,0,0);
    // deltaV = desired - current = (40,0,0), well within budget.
    expect(dv.x).toBeCloseTo(40, 10);
    expect(dv.y).toBeCloseTo(0, 10);
    expect(dv.z).toBeCloseTo(0, 10);
  });

  it('clamps magnitude to budget when desired change is larger', () => {
    const self = body(1, of(0, 0, 0), of(-100, 0, 0));
    const target = body(2, of(200, 0, 0));
    // Desired velocity (40,0,0); deltaV = (140,0,0); budget 80 → clamped to (80,0,0).
    const dv = baselineArc(self, target, 80, 40);
    expect(length(dv)).toBeCloseTo(80, 6);
    expect(dv.x).toBeCloseTo(80, 6);
  });
});

// ---- buildCandidates -----------------------------------------------------

describe('buildCandidates — ladder shape per tier.candidateLadder', () => {
  const p = shipProfile('X');
  const view = buildView(0, [
    { bodyId: 1, fleetId: 0, position: of(200, 0, 0), view: shipView(1, 0, 100, 60, p) },
  ]);
  const self = view.bodies[0]!;

  it('rookie ladder is [baseline, ZERO]', () => {
    const baseline = { x: 40, y: 0, z: 0 } as const;
    const cands = buildCandidates(self, baseline, view, 80, 'rookie');
    expect(cands).toHaveLength(2);
    expect(cands[0]).toEqual(baseline);
    expect(cands[1]).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('veteran ladder is the full 7-candidate set', () => {
    const cands = buildCandidates(self, { x: 40, y: 0, z: 0 }, view, 80, 'veteran');
    expect(cands).toHaveLength(7);
  });

  it('ace ladder is the full 7-candidate set (wall cap is upstream on baseline)', () => {
    const cands = buildCandidates(self, { x: 40, y: 0, z: 0 }, view, 80, 'ace');
    expect(cands).toHaveLength(7);
  });
});

// ---- cruiseSpeedFor ------------------------------------------------------

describe('cruiseSpeedFor — tier cruise fraction + ace wall cap', () => {
  const p = shipProfile('X');
  const view = buildView(0, [
    { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, p) },
  ]);
  const self = view.bodies[0]!;

  it('rookie: cruise = budget × 0.5 far from wall (no cap)', () => {
    const cs = cruiseSpeedFor(self, view, TIER_CONFIG.rookie, 80, PHYSICS.dt);
    expect(cs).toBeCloseTo(40, 10);
  });

  it('veteran: cruise = budget × 0.66 far from wall (no cap)', () => {
    const cs = cruiseSpeedFor(self, view, TIER_CONFIG.veteran, 80, PHYSICS.dt);
    expect(cs).toBeCloseTo(80 * TIER_CONFIG.veteran.cruiseSpeedFraction, 10);
  });

  it('ace: cruise = min(budget × 0.85, wallDistance/dt/safety) — capped near wall', () => {
    // Place self near the wall. Arena radius 800, self at (750,0,0),
    // wallDistance = 50. safety = 2 → capped cruise = 50/1/2 = 25.
    // baseCruise = 80 * 0.85 = 68 → min(68, 25) = 25.
    const nearWall = buildView(0, [
      { bodyId: 1, fleetId: 0, position: of(750, 0, 0), view: shipView(1, 0, 100, 60, p) },
    ]);
    const cs = cruiseSpeedFor(nearWall.bodies[0]!, nearWall, TIER_CONFIG.ace, 80, PHYSICS.dt);
    expect(cs).toBeCloseTo(25, 10);
  });

  it('ace: cruise = baseCruise well inside the arena (uncapped)', () => {
    const cs = cruiseSpeedFor(self, view, TIER_CONFIG.ace, 80, PHYSICS.dt);
    expect(cs).toBeCloseTo(80 * 0.85, 10);
  });
});

// ---- planShipMovement — the load-bearing FR-29 invariants ---------------

// Sim a chase: `beats` iterations of `planShipMovement` + `resolveMovement` —
// like the Gate-2 harnessRun but at unit scope with a single fleet-of-1
// pursuer and a stationary target. Returns final speed along the target-vector.
//
// Uses a HUGE arena for both `view.arena` and the physics config passed to
// `resolveMovement` so the wall never bites — the invariant under test is
// cruise-velocity convergence, not boundary safety (that's CP3).
const chase = (
  tier: BotTier,
  beats: number,
  budget = 80,
): { finalSpeed: number; converged: number[] } => {
  const BIG_ARENA = { center: of(0, 0, 0), radius: 20000 };
  const chasePhysics: PhysicsConfig = { ...PHYSICS, arena: BIG_ARENA };
  const p = shipProfile('X');
  const target = shipProfile('T');
  let selfBody = body(1, of(0, 0, 0), of(0, 0, 0));
  const targetPos = of(5000, 0, 0);
  const converged: number[] = [];
  for (let beat = 0; beat < beats; beat += 1) {
    const view = buildView(
      0,
      [
        {
          bodyId: 1,
          fleetId: 0,
          position: selfBody.position,
          velocity: selfBody.velocity,
          view: shipView(1, 0, 100, 60, p),
        },
        {
          bodyId: 2,
          fleetId: 1,
          position: targetPos,
          view: shipView(2, 1, 100, 60, target),
        },
      ],
      BIG_ARENA,
    );
    const plan = planShipMovement(selfBody, view, tier, chasePhysics, budget);
    const step = resolveMovement([selfBody, view.bodies[1]!], [plan], chasePhysics);
    selfBody = step.finalBodies.find((b) => b.id === 1)!;
    converged.push(selfBody.velocity.x);
  }
  return { finalSpeed: selfBody.velocity.x, converged };
};

describe('planShipMovement — cruise-velocity convergence (FINDINGS §1a)', () => {
  it('rookie converges post-plan velocity to budget × 0.5 toward target', () => {
    const { finalSpeed } = chase('rookie', 10, 80);
    expect(finalSpeed).toBeCloseTo(40, 4);
  });

  it('veteran converges to budget × 0.66 toward target', () => {
    const { finalSpeed } = chase('veteran', 10, 80);
    expect(finalSpeed).toBeCloseTo(80 * TIER_CONFIG.veteran.cruiseSpeedFraction, 4);
  });

  it('ace converges to budget × 0.85 toward target (uncapped chase)', () => {
    // Chase runs against a huge arena so the wall cap does not kick in.
    const { finalSpeed } = chase('ace', 10, 80);
    expect(finalSpeed).toBeCloseTo(80 * 0.85, 4);
  });

  it('speed toward target does NOT accumulate above the cruise cap over many beats', () => {
    const { converged } = chase('rookie', 30, 80);
    // Every recorded per-beat speed must be within a small margin of cruise (40).
    // The exact FR-29 fix: even at beat 30 speed does not exceed 40 + small ε.
    for (let i = 0; i < converged.length; i += 1) {
      expect(converged[i]).toBeLessThanOrEqual(40 + 1e-6);
    }
  });
});

// ---- baseline-veto vs full-7 recovery ------------------------------------

describe('planShipMovement — rookie coasts when baseline exits; veteran/ace recover', () => {
  const p = shipProfile('X');

  // Setup A — RECOVERY: near the +X wall, at rest, with a target outside the
  // arena on +X. Baseline arc aims outbound → baseline preview exits. Rookie's
  // [baseline, ZERO] ladder falls back to ZERO (coast). Veteran/ace's fuller
  // ladders include reduced-magnitude and inward-brake candidates; with the
  // ship at rest, ZERO or a *smaller forward step* is both safe and boundary-
  // safe under lookahead. The tier difference the ladder proves: veteran/ace
  // can pick a plan whose preview stays inside for BOTH this beat AND the
  // horizon-N coast beats after — a claim rookie's ladder cannot make about
  // the baseline it must veto.
  const buildNearWallView = (): BlindMatchView =>
    buildView(0, [
      {
        bodyId: 1,
        fleetId: 0,
        position: of(770, 0, 0),
        velocity: of(0, 0, 0),
        view: shipView(1, 0, 100, 60, p),
      },
      // Target sits outside the shell so the cruise vector points outward.
      {
        bodyId: 2,
        fleetId: 1,
        position: of(2000, 0, 0),
        view: shipView(2, 1, 100, 60, p),
      },
    ]);

  // Setup B — INBOUND MOMENTUM: near the +X wall with a HIGH outbound velocity
  // that no small forward step can absorb — recovery requires the ladder to
  // reach a brake-inward candidate. Rookie coasts; veteran/ace pick an inward
  // (−X) plan.
  const buildInboundMomentumView = (): BlindMatchView =>
    buildView(0, [
      {
        bodyId: 1,
        fleetId: 0,
        position: of(770, 0, 0),
        velocity: of(60, 0, 0),
        view: shipView(1, 0, 100, 60, p),
      },
      {
        bodyId: 2,
        fleetId: 1,
        position: of(2000, 0, 0),
        view: shipView(2, 1, 100, 60, p),
      },
    ]);

  it('rookie: baseline preview exits → coast (deltaV == 0)', () => {
    const view = buildNearWallView();
    const self = view.bodies.find((b) => b.id === 1)!;
    const plan = planShipMovement(self, view, 'rookie', PHYSICS, 80);
    expect(plan.deltaV).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('veteran: baseline preview exits → recovers via ladder (plan is boundary-safe)', () => {
    const view = buildNearWallView();
    const self = view.bodies.find((b) => b.id === 1)!;
    const plan = planShipMovement(self, view, 'veteran', PHYSICS, 80);
    // The invariant the ladder must hold: chosen plan's preview stays inside
    // the arena (unlike the baseline, which does not). "Recovers" =
    // ladder-picked candidate is boundary-safe.
    const preview = previewPath(self, plan, PHYSICS);
    expect(preview.endsOutsideArena).toBe(false);
  });

  it('ace: baseline preview exits → recovers via ladder (plan is boundary-safe)', () => {
    const view = buildNearWallView();
    const self = view.bodies.find((b) => b.id === 1)!;
    const plan = planShipMovement(self, view, 'ace', PHYSICS, 80);
    const preview = previewPath(self, plan, PHYSICS);
    expect(preview.endsOutsideArena).toBe(false);
  });

  it('veteran with inbound momentum: ladder picks an inward-brake plan', () => {
    // 60 outbound + no thrust → position 830 next beat (outside). Rookie has
    // no ladder rung that can brake; veteran/ace should reach brake / brake-
    // and-center / toward-center in the full-7 ladder.
    const view = buildInboundMomentumView();
    const self = view.bodies.find((b) => b.id === 1)!;
    const plan = planShipMovement(self, view, 'veteran', PHYSICS, 80);
    expect(length(plan.deltaV)).toBeGreaterThan(1e-6);
    // Inward means the plan reduces speed toward the wall (+X). deltaV.x <= 0
    // — any brake / brake-and-center / toward-center rung has non-positive X.
    expect(plan.deltaV.x).toBeLessThanOrEqual(0);
  });

  it('ace with inbound momentum: ladder picks an inward-brake plan', () => {
    const view = buildInboundMomentumView();
    const self = view.bodies.find((b) => b.id === 1)!;
    const plan = planShipMovement(self, view, 'ace', PHYSICS, 80);
    expect(length(plan.deltaV)).toBeGreaterThan(1e-6);
    expect(plan.deltaV.x).toBeLessThanOrEqual(0);
  });
});

// ---- planFleetMovement — owned only, live only, BodyId-sorted -------------

describe('planFleetMovement — owned live ships in BodyId order', () => {
  const p = shipProfile('X');

  it('emits a plan for every owned live ship, never for enemies', () => {
    const view = buildView(
      0,
      [
        { bodyId: 1, fleetId: 0, position: of(-100, 0, 0), view: shipView(1, 0, 100, 60, p) },
        { bodyId: 2, fleetId: 1, position: of(200, 0, 0), view: shipView(2, 1, 100, 60, p) },
        { bodyId: 3, fleetId: 0, position: of(100, 0, 0), view: shipView(3, 0, 100, 60, p) },
      ],
      { center: of(0, 0, 0), radius: 5000 },
    );
    const plans = planFleetMovement(view, 'rookie', PHYSICS);
    const ids = plans.map((p) => p.bodyId);
    expect(ids).toEqual([1, 3]); // owned only, ASC
  });

  it('excludes dead owned ships (hull ≤ 0)', () => {
    const view = buildView(
      0,
      [
        { bodyId: 1, fleetId: 0, position: of(-100, 0, 0), view: shipView(1, 0, 100, 60, p) },
        { bodyId: 3, fleetId: 0, position: of(100, 0, 0), view: shipView(3, 0, 0, 0, p) },
        { bodyId: 5, fleetId: 1, position: of(0, 200, 0), view: shipView(5, 1, 100, 60, p) },
      ],
      { center: of(0, 0, 0), radius: 5000 },
    );
    const plans = planFleetMovement(view, 'rookie', PHYSICS);
    expect(plans.map((p) => p.bodyId)).toEqual([1]);
  });

  it('is deterministic — same view + tier → same plans', () => {
    const mk = (): BlindMatchView =>
      buildView(
        0,
        [
          { bodyId: 1, fleetId: 0, position: of(-100, 0, 0), view: shipView(1, 0, 100, 60, p) },
          { bodyId: 3, fleetId: 0, position: of(100, 0, 0), view: shipView(3, 0, 100, 60, p) },
          { bodyId: 5, fleetId: 1, position: of(0, 200, 0), view: shipView(5, 1, 100, 60, p) },
        ],
        { center: of(0, 0, 0), radius: 5000 },
      );
    const a = planFleetMovement(mk(), 'veteran', PHYSICS);
    const b = planFleetMovement(mk(), 'veteran', PHYSICS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('coasts to ZERO deltaV when no enemies exist (edge case)', () => {
    const view = buildView(
      0,
      [
        { bodyId: 1, fleetId: 0, position: of(0, 0, 0), view: shipView(1, 0, 100, 60, p) },
      ],
      { center: of(0, 0, 0), radius: 5000 },
    );
    const plans = planFleetMovement(view, 'rookie', PHYSICS);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.deltaV).toEqual({ x: 0, y: 0, z: 0 });
  });
});

// ---- Sanity: the plans respect the per-ship deltaVPerTurn budget ---------

describe('planShipMovement — respects the per-ship deltaV budget', () => {
  const p = shipProfile('X');

  it('|deltaV| never exceeds the ship deltaVPerTurn (budget) for any tier', () => {
    for (const tier of ['rookie', 'veteran', 'ace'] as const) {
      const view = buildView(
        0,
        [
          { bodyId: 1, fleetId: 0, position: of(-100, 50, 0), view: shipView(1, 0, 100, 60, p) },
          { bodyId: 2, fleetId: 1, position: of(300, -80, 20), view: shipView(2, 1, 100, 60, p) },
        ],
        { center: of(0, 0, 0), radius: 5000 },
      );
      const self = view.bodies.find((b) => b.id === 1)!;
      const plan = planShipMovement(self, view, tier, PHYSICS, 80);
      expect(length(plan.deltaV)).toBeLessThanOrEqual(80 + 1e-9);
    }
  });
});

// Ensure imports we alias-reference stay referenced (silences unused-import
// warnings on future refactors of the fixture builders).
void distance;
void sub;
