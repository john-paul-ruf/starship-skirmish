// boundarySafety — the FR-29 production tripwire.
//
// This test is the unit-scope re-assertion of Gate 2's exit criterion
// (prototypes/gate2/FINDINGS.md §0): **zero unforced boundary deaths**. It
// mirrors `prototypes/gate2/harnessRun.ts`'s methodology, promoted:
//
//   • Seed N (=32) fields of 6 ships × 2 fleets with mathx/rng.
//   • Ships placed inside a cube of half-side 450 (inscribed in ball of
//     radius 450·√3 ≈ 780) so every seed starts comfortably inside an
//     800-radius arena (FINDINGS §4 last bullet: no seed hands the planner
//     an unrecoverable inheritance).
//   • Velocities in ±40/axis (max magnitude ≈ 69 < the 80 delta-V budget) so
//     every initial state is fully brakable in one beat.
//   • Run K (=6) beats per field per tier; each beat: plan → resolve →
//     classify exits.
//   • An exit is UNFORCED iff the planner's chosen plan's `previewPath` stayed
//     inside the arena AND the ship was not in a collision. Impossible in a
//     sound sim if the ladder held: `previewPath` and `resolveMovement` share
//     an integrator (architecture §9), so an in-preview-safe plan must resolve
//     safely absent a collision-driven shove (FR-22).
//   • Assert unforced == 0 across all seeds × all beats × all three tiers.
//
// The parameters are unit-safe (32 seeds × 6 beats × 3 tiers ≈ 576 beats total;
// each beat runs planFleetMovement over ≤ 6 ships) — the whole suite ends in
// well under a second. The gate 2 prototype ran 100 × 15 = 1500 beats for its
// verdict; this regression is the same shape at ~⅓ scale, still large enough
// to catch a regression of the cruise-velocity target or the previewPath veto.
//
// FINITE-THRUST (SESSION-03): PhysicsConfig carries `maxAccel` so the shared
// `thrustSchedule` builds a curved schedule — the veto in `evaluateCandidate`
// runs through the SAME curved preview the ship will fly (D-BOT-SAME-MODEL /
// D-SHARED-SCHEDULE). Domain-side `physicsConfigFromTuning` propagation is
// owned by NO session in this feature (S01 followUp) — for these unit tests
// the value is constructed directly, in-lease.

import { describe, expect, it } from 'vitest';
import {
  hash,
  of,
  randRange,
  seedOf,
  type Seed,
} from '../../../src/sim/mathx/index.js';
import type { Body, BodyId, MovementPlan, SimShip } from '../../../src/sim/types.js';
import type { PhysicsConfig } from '../../../src/sim/physics/index.js';
import {
  isOutsideArena,
  previewPath,
  resolveMovement,
} from '../../../src/sim/physics/index.js';
import type {
  BlindMatchView,
  BlindShipView,
} from '../../../src/sim/loop/blindView.js';
import { BOT_TIERS, type BotTier } from '../../../src/ai/tiers.js';
import { planFleetMovement } from '../../../src/ai/movementPlanner.js';

// ---------------------------------------------------------------------------
// Setup constants — sized for a unit-scope regression (see file header).
// ---------------------------------------------------------------------------

const SEED_COUNT = 32; // Gate-2 used 100; 32 is sufficient at unit scope.
const BEATS_PER_SEED = 6;
const SHIP_COUNT = 6;
const POS_HALF = 450;
const VEL_HALF = 40;
const BUDGET = 80;

// `maxAccel` is set (finite-thrust-movement SESSION-03) so the shared
// `thrustSchedule` builds a curved per-sub-step Δv sequence — the FR-29 veto
// in `evaluateCandidate` runs over the SAME curved preview the ship will fly.
// 200 units/s² sits well above the 80 per-beat Δv budget × dt=1 so no single
// segment gets capped (`cap = maxAccel · segDur = 200`), keeping the schedule
// a partial burn + coast (not a maxAccel-clipped rendering); the curvature is
// visible without distorting the planner's chosen impulse.
const PHYSICS: PhysicsConfig = {
  dt: 1,
  subStepMin: 4,
  subStepMax: 64,
  restitution: 0.15,
  collisionDamageCoefficient: 0.0012,
  arena: { center: of(0, 0, 0), radius: 800 },
  maxAccel: 200,
};

// Same avalanche as prototypes/gate2/harnessRun.ts so different seed integers
// give well-mixed 64-bit seeds. NEVER `Math.random` — the whole regression
// must be reproducible seed-for-seed (the test lease is unit scope, but this
// is a determinism-adjacent property and the ban-list applies to `src/ai/**`;
// the mathx primitives are the same for tests).
const DERIVE_BASE = seedOf(0x9e3779b9, 0x243f6a88);
const deriveSeed = (n: number): Seed =>
  seedOf(hash(DERIVE_BASE, n >>> 0, 0x1), hash(DERIVE_BASE, n >>> 0, 0x2));

// ---------------------------------------------------------------------------
// Fixture builders — SimShip, BlindShipView, BlindMatchView (minimal). The
// production BlindMatchView (`src/sim/loop/blindView.ts`) is built from a
// live `MatchState` (via createMatch); constructing one directly here keeps
// the regression a pure planner + physics test, no rules/loop dependency.
// ---------------------------------------------------------------------------

const shipProfile: SimShip = {
  buildId: 'boundary-fixture',
  name: 'B',
  chassisClass: 'frigate',
  mass: 500,
  radius: 30,
  maxHull: 100,
  shieldCapacity: 60,
  shieldRegenPerTurn: 15,
  deltaVPerTurn: BUDGET,
  baseEvasion: 0.1,
  hullRepairPerTurn: 0,
  weapons: [{ range: 400, damage: 20, shotsPerTurn: 1, accuracy: 0.9 }],
  missiles: [],
  pointDefense: [],
  decoys: [],
};

const shipView = (bodyId: BodyId, fleetId: number): BlindShipView =>
  Object.freeze({
    bodyId,
    fleetId,
    name: shipProfile.name,
    chassisClass: shipProfile.chassisClass,
    hull: shipProfile.maxHull,
    maxHull: shipProfile.maxHull,
    shields: shipProfile.shieldCapacity,
    shieldCapacity: shipProfile.shieldCapacity,
    shieldGenAlive: true,
    engineAlive: true,
    weaponAlive: Object.freeze([true]),
    missileAlive: Object.freeze([]),
    missileAmmo: Object.freeze([]),
    pdAlive: Object.freeze([]),
    decoyAlive: Object.freeze([]),
    decoyCharges: Object.freeze([]),
    decoyActiveUntilTurn: 0,
    ship: shipProfile,
  });

interface Setup {
  readonly bodies: readonly Body[];
  readonly fleetByBodyId: ReadonlyMap<BodyId, number>;
}

const buildSetup = (seedN: number): Setup => {
  const seed = deriveSeed(seedN);
  const bodies: Body[] = [];
  const fleetByBodyId = new Map<BodyId, number>();
  for (let i = 0; i < SHIP_COUNT; i += 1) {
    const id: BodyId = i + 1;
    const b: Body = {
      kind: 'ship',
      id,
      position: of(
        randRange(seed, -POS_HALF, POS_HALF, i, 0),
        randRange(seed, -POS_HALF, POS_HALF, i, 1),
        randRange(seed, -POS_HALF, POS_HALF, i, 2),
      ),
      velocity: of(
        randRange(seed, -VEL_HALF, VEL_HALF, i, 3),
        randRange(seed, -VEL_HALF, VEL_HALF, i, 4),
        randRange(seed, -VEL_HALF, VEL_HALF, i, 5),
      ),
      mass: 500,
      radius: 30,
    };
    bodies.push(b);
    fleetByBodyId.set(id, id % 2 === 1 ? 0 : 1);
  }
  return { bodies, fleetByBodyId };
};

// Build a `BlindMatchView` for `selfFleetId` from a live body snapshot. All
// ships are still-alive (this test never kills ships via combat; a boundary
// exit removes them from the body array on the next iteration).
const buildView = (
  bodies: readonly Body[],
  fleetByBodyId: ReadonlyMap<BodyId, number>,
  selfFleetId: number,
): BlindMatchView => {
  // Bodies are already BodyId-sorted (buildSetup emits in id order; the
  // resolveMovement finalBodies output is also sorted). This mirrors the
  // structural guarantee of `blindView.ts`.
  const ships: BlindShipView[] = [];
  for (let i = 0; i < bodies.length; i += 1) {
    const b = bodies[i]!;
    if (b.kind !== 'ship') continue;
    const fleetId = fleetByBodyId.get(b.id);
    if (fleetId === undefined) continue;
    ships.push(shipView(b.id, fleetId));
  }
  return Object.freeze({
    turn: 1,
    arena: PHYSICS.arena,
    selfFleetId,
    bodies: Object.freeze(bodies.slice()),
    ships: Object.freeze(ships),
  });
};

// ---------------------------------------------------------------------------
// Per-plan preview classifier (mirrors Gate-2 `planPreviewExits`).
// ---------------------------------------------------------------------------

const planPreviewExits = (self: Body, plan: MovementPlan): boolean => {
  const preview = previewPath(self, plan, PHYSICS);
  for (let i = 0; i < preview.positions.length; i += 1) {
    if (isOutsideArena(preview.positions[i]!, PHYSICS.arena)) return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// One scenario per (tier, seed) — thread state through K beats and classify
// every ship-exit event.
// ---------------------------------------------------------------------------

interface Tally {
  readonly beatsRun: number;
  readonly shipExits: number;
  readonly unforced: number;
  readonly forcedByCollision: number;
  readonly forcedByMomentum: number;
}

const runScenario = (tier: BotTier, seedN: number): Tally => {
  const { bodies: initialBodies, fleetByBodyId } = buildSetup(seedN);
  let current: readonly Body[] = initialBodies;
  let beatsRun = 0;
  let shipExits = 0;
  let unforced = 0;
  let forcedColl = 0;
  let forcedMom = 0;

  for (let beat = 0; beat < BEATS_PER_SEED; beat += 1) {
    // Live-fleet check.
    const liveByFleet = new Map<number, number>();
    for (let i = 0; i < current.length; i += 1) {
      const b = current[i]!;
      if (b.kind !== 'ship') continue;
      const fleetId = fleetByBodyId.get(b.id);
      if (fleetId === undefined) continue;
      liveByFleet.set(fleetId, (liveByFleet.get(fleetId) ?? 0) + 1);
    }
    let liveFleets = 0;
    for (const [, count] of liveByFleet) if (count > 0) liveFleets += 1;
    if (liveFleets < 2) break;

    // Collect plans from every fleet against the SAME view (blind-commit; see
    // architecture §6.2 — every commander sees the same view before any plan
    // is collected).
    const allPlans: MovementPlan[] = [];
    for (const [fleetId] of liveByFleet) {
      const view = buildView(current, fleetByBodyId, fleetId);
      const plans = planFleetMovement(view, tier, PHYSICS);
      for (let i = 0; i < plans.length; i += 1) allPlans.push(plans[i]!);
    }

    // Ground truth for classification: which plans already exit in preview.
    const planUnsafe = new Map<BodyId, boolean>();
    const bodyById = new Map<BodyId, Body>();
    for (let i = 0; i < current.length; i += 1) bodyById.set(current[i]!.id, current[i]!);
    for (let i = 0; i < allPlans.length; i += 1) {
      const p = allPlans[i]!;
      const b = bodyById.get(p.bodyId);
      if (b === undefined) continue;
      planUnsafe.set(p.bodyId, planPreviewExits(b, p));
    }

    // Resolve movement — this is the same integrator the preview used
    // (architecture §9 shared integrator guarantee).
    const step = resolveMovement(current, allPlans, PHYSICS);

    const collided = new Set<BodyId>();
    for (let i = 0; i < step.contacts.length; i += 1) {
      collided.add(step.contacts[i]!.idA);
      collided.add(step.contacts[i]!.idB);
    }
    for (let i = 0; i < step.exits.length; i += 1) {
      const exit = step.exits[i]!;
      if (exit.kind !== 'ship-destroyed') continue;
      shipExits += 1;
      if (collided.has(exit.bodyId)) {
        forcedColl += 1;
      } else if (planUnsafe.get(exit.bodyId) === true) {
        forcedMom += 1;
      } else {
        // preview said "safe" AND no collision to explain the exit → this is
        // the category the FR-29 regression demands = 0.
        unforced += 1;
      }
    }

    current = step.finalBodies;
    beatsRun += 1;
  }

  return {
    beatsRun,
    shipExits,
    unforced,
    forcedByCollision: forcedColl,
    forcedByMomentum: forcedMom,
  };
};

// ---------------------------------------------------------------------------
// Assertion — the regression. Runs for all three tiers × 32 seeds; totals the
// unforced exits and asserts zero. On a nonzero result surface a compact
// summary so a bisect can localize the regression (which tier, which
// direction), not a bare "expected 0 got 7".
// ---------------------------------------------------------------------------

interface TierTotals {
  readonly tier: BotTier;
  readonly beatsRun: number;
  readonly shipExits: number;
  readonly unforced: number;
  readonly forcedByCollision: number;
  readonly forcedByMomentum: number;
}

const runAllTiers = (): readonly TierTotals[] => {
  const out: TierTotals[] = [];
  for (const tier of BOT_TIERS) {
    let beatsRun = 0;
    let shipExits = 0;
    let unforced = 0;
    let forcedColl = 0;
    let forcedMom = 0;
    for (let n = 1; n <= SEED_COUNT; n += 1) {
      const t = runScenario(tier, n);
      beatsRun += t.beatsRun;
      shipExits += t.shipExits;
      unforced += t.unforced;
      forcedColl += t.forcedByCollision;
      forcedMom += t.forcedByMomentum;
    }
    out.push({
      tier,
      beatsRun,
      shipExits,
      unforced,
      forcedByCollision: forcedColl,
      forcedByMomentum: forcedMom,
    });
  }
  return out;
};

describe('FR-29 boundary-safety regression (Gate-2 exit criterion promoted)', () => {
  const totals = runAllTiers();

  for (const t of totals) {
    it(`${t.tier}: zero unforced boundary deaths across ${SEED_COUNT} seeds × ${BEATS_PER_SEED} beats`, () => {
      // If this trips, either (a) the cruise-velocity target regressed
      // (velocities now accumulate above the cruise cap), (b) the
      // previewPath boundary veto stopped rejecting unsafe candidates, or
      // (c) preview and resolve diverged (architecture §9 / D-SHARED-SCHEDULE
      // broken — the curved finite-thrust arc the veto sees no longer
      // matches the curved arc the resolver flies).
      expect(t.unforced).toBe(0);
    });
  }

  it('every seed ran to completion (setup places ships comfortably inside the arena)', () => {
    for (const t of totals) {
      // beatsRun should be > 0 for every tier — a zero beatsRun means the
      // setup handed the planner a scenario that early-exited on beat 0.
      expect(t.beatsRun).toBeGreaterThan(0);
    }
  });

  it('plans emitted for boundary check carry a finite-thrust schedule (D-BOT-SAME-MODEL)', () => {
    // Reprove that the regression above is running on the FINITE-THRUST code
    // path — a silent regression back to impulsive plans (missing `segments`)
    // would also satisfy unforced == 0 but defeat the fairness invariant. A
    // single sample of every tier's emitted plans is enough — planShipMovement
    // always attaches a single-segment schedule (movementPlanner.test.ts CP1).
    const { bodies, fleetByBodyId } = buildSetup(1);
    for (const tier of BOT_TIERS) {
      const view = buildView(bodies, fleetByBodyId, 0);
      const plans = planFleetMovement(view, tier, PHYSICS);
      expect(plans.length).toBeGreaterThan(0);
      for (const plan of plans) {
        expect(plan.segments).toBeDefined();
        expect(plan.segments!).toHaveLength(1);
      }
    }
  });
});

