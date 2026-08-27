// M16 App — match controller loop locks (S01 CP4).
//
// Scripts a full turn against real commanders and asserts:
//   1. Phase transitions movement-plan → movement-resolve → attack-plan →
//      attack-resolve, paced by commit + resolveAnimationDone callbacks.
//   2. A one-fleet-standing state transitions to `complete` with a `victory`
//      outcome (Custom Rule 5 — three branches, no draw/timeout).
//   3. The controller navigates the phase→route coupling (move → post-match).
//   4. `hitChanceFor` equals a direct `sim/rules.hitChance` call on the same
//      inputs — the UI reads the published breakdown, never recomputes (§13.3).

import { describe, expect, it } from 'vitest';

import { loadCatalog } from '../../../../src/catalog/index.js';
import {
  distance,
  hitChance,
  length,
  previewPath,
  runMovementBeat,
  seedOf,
  type MovementPlan,
} from '../../../../src/sim/index.js';
import { of } from '../../../../src/sim/mathx/vec3.js';
import type { Route } from '../../../../src/ui/appContext.js';
import { generateBotFleet } from '../../../../src/ai/index.js';
import { assembleMatchConfig } from '../../../../src/app/match/config.js';
import { createMatchController } from '../../../../src/app/match/controller.js';

// A macrotask boundary flushes the driver's chained microtasks between steps.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const catalog = loadCatalog();
const BUDGET = catalog.tuning.match.legalBudgets[0]!;

const captureRoutes = () => {
  const routes: Route[] = [];
  return { services: { navigate: (to: Route) => routes.push(to) }, routes };
};

describe('createMatchController — one scripted turn to victory (single fleet)', () => {
  it('walks the phase machine and completes with a victory outcome', async () => {
    // A single fleet → after turn 1 exactly one fleet stands → victory(0).
    const player = generateBotFleet(catalog, BUDGET, 'ace', 7);
    const config = assembleMatchConfig(
      catalog,
      catalog.tuning,
      BUDGET,
      seedOf(0xabcd, 0x1234),
      player,
      [],
    );
    const { services, routes } = captureRoutes();
    const controller = createMatchController(services, config, []);

    await flush();
    expect(controller.phase.value).toBe('movement-plan');
    expect(routes.at(-1)).toEqual({ name: 'tactical-move' });

    controller.commitMovement([]);
    await flush();
    expect(controller.phase.value).toBe('movement-resolve');
    expect(controller.movementBeat.value).not.toBeNull();

    controller.resolveAnimationDone();
    await flush();
    expect(controller.phase.value).toBe('attack-plan');
    expect(routes.at(-1)).toEqual({ name: 'tactical-attack' });

    controller.commitAttack([]);
    await flush();
    expect(controller.phase.value).toBe('attack-resolve');
    expect(controller.attackBeat.value).not.toBeNull();

    controller.resolveAnimationDone();
    await flush();
    expect(controller.phase.value).toBe('complete');
    expect(controller.outcome.value?.kind).toBe('victory');
    expect(routes.at(-1)).toEqual({ name: 'post-match' });
    // The trace recorded exactly the one decided turn.
    expect(controller.trace.value.turns).toHaveLength(1);
    expect(controller.trace.value.outcome?.kind).toBe('victory');
  });
});

describe('createMatchController — hitChanceFor matches sim/rules.hitChance', () => {
  it('returns the published breakdown for the same inputs', () => {
    const player = generateBotFleet(catalog, BUDGET, 'ace', 2);
    const config = assembleMatchConfig(
      catalog,
      catalog.tuning,
      BUDGET,
      seedOf(0x5555, 0x6666),
      player,
      [{ tier: 'veteran', rngKey: 99 }],
    );
    const { services } = captureRoutes();
    const controller = createMatchController(services, config, ['veteran']);

    const s = controller.state.value;
    // Find any ship with a weapon (shooter) and any other ship (target).
    const shipIds = Array.from(s.ships.keys()).sort((a, b) => a - b);
    const shooterId = shipIds.find((id) => s.ships.get(id)!.ship.weapons.length > 0);
    expect(shooterId).toBeDefined();
    const targetId = shipIds.find((id) => id !== shooterId);
    expect(targetId).toBeDefined();

    const shooter = s.ships.get(shooterId!)!;
    const target = s.ships.get(targetId!)!;
    const shooterBody = s.bodies.get(shooterId!)!;
    const targetBody = s.bodies.get(targetId!)!;

    // Replicate the private targetEvasion (base + active decoy; none active at t1).
    let evasion = target.ship.baseEvasion;
    if (target.decoyActiveUntilTurn >= s.turn) {
      for (let i = 0; i < target.decoyAlive.length; i += 1) {
        if (target.decoyAlive[i]!) {
          evasion += target.ship.decoys[i]!.evasionBonus;
          break;
        }
      }
    }
    const expected = hitChance(
      shooter.ship.weapons[0]!,
      distance(shooterBody.position, targetBody.position),
      length(targetBody.velocity),
      evasion,
    );

    expect(controller.hitChanceFor(shooterId!, targetId!, 0)).toEqual(expected);
  });
});

// ---- previewArc — the segmented-arc seam (`finite-thrust-movement` S04) ----
//
// The controller is the ONE integrator seam between `ui` and `sim/physics`
// (D-PREVIEW-SEAM); a segmented arc has to travel through it byte-identically
// or the "preview must not lie" invariant (§9) is broken end to end. Two
// checks:
//   1. Impulsive form (`Vec3`) — regression guard: the pre-SESSION-04 shape
//      still works, and the returned positions match a direct `previewPath`
//      call on the same inputs.
//   2. Segmented form (`{ segments }`) — the new path: the controller builds
//      the finite-thrust `MovementPlan` (`deltaV = ZERO`, `segments = arc.segments`)
//      and forwards it to `previewPath`, surfacing both `positions` (curved when
//      `state.physics.maxAccel` is set) and `markPositions` (the per-waypoint
//      boundaries the S05 UI ruler reads).
describe('createMatchController — previewArc accepts a segmented arc (D-SHARED-SCHEDULE)', () => {
  const setupSingleFleet = () => {
    const player = generateBotFleet(catalog, BUDGET, 'ace', 42);
    const config = assembleMatchConfig(
      catalog,
      catalog.tuning,
      BUDGET,
      seedOf(0x1111, 0x2222),
      player,
      [],
    );
    const { services } = captureRoutes();
    const controller = createMatchController(services, config, []);
    const s = controller.state.value;
    // Pick a stable ship body id and take the corresponding Body snapshot.
    const shipId = Array.from(s.ships.keys()).sort((a, b) => a - b)[0]!;
    const body = s.bodies.get(shipId)!;
    return { controller, body, shipId, physics: s.physics };
  };

  it('impulsive Vec3 arc returns positions matching direct previewPath (regression)', () => {
    const { controller, body, shipId, physics } = setupSingleFleet();
    const deltaV = of(3, 0, 0);
    const seam = controller.previewArc(shipId, deltaV);
    const direct = previewPath(body, { bodyId: shipId, deltaV }, physics);
    expect(seam.positions).toEqual(direct.positions);
    expect(seam.endsOutsideArena).toBe(direct.endsOutsideArena);
    // Impulsive plans have no waypoint marks — `markPositions` is either
    // absent from the seam return (optional key) or an empty array; both are
    // legal shapes, so accept either without asserting a specific value.
    expect(seam.markPositions ?? []).toEqual([]);
  });

  it('two-segment arc returns curved positions matching direct previewPath', () => {
    const { controller, body, shipId, physics } = setupSingleFleet();
    const segments = [{ deltaV: of(0, 3, 0) }, { deltaV: of(0, 0, 2) }] as const;
    const seam = controller.previewArc(shipId, { segments });
    // The controller must build the SAME MovementPlan the resolver sees for a
    // segmented arc (`deltaV = ZERO`, `segments` forwarded verbatim); the
    // "preview must not lie" invariant then guarantees seam.positions === direct.
    const equivalentPlan: MovementPlan = {
      bodyId: shipId,
      deltaV: of(0, 0, 0),
      segments,
    };
    const direct = previewPath(body, equivalentPlan, physics);
    expect(seam.positions).toEqual(direct.positions);
    expect(seam.endsOutsideArena).toBe(direct.endsOutsideArena);
    expect(seam.markPositions).toEqual(direct.markPositions);
    // markPositions has segments.length + 1 boundaries (start + end of every
    // segment) — the S05 UI ruler reads this length to place per-waypoint
    // marks. Empty result would silently break the UI, so lock the shape.
    expect(seam.markPositions).toHaveLength(segments.length + 1);
  });

  it('an unknown bodyId returns an empty preview (no crash on stale UI selection)', () => {
    const { controller } = setupSingleFleet();
    const seam = controller.previewArc(999999, { segments: [{ deltaV: of(1, 0, 0) }] });
    expect(seam.positions).toEqual([]);
    expect(seam.endsOutsideArena).toBe(false);
  });
});

// ---- commitMovement carries segments through to the beat -------------------
//
// SESSION-02 proved `runMovementBeat` forwards `MovementPlan.segments`
// OPAQUELY (the beat never reads them); this test locks in that the
// controller's `commitMovement` → collectMovementPlans → runMovementBeat
// chain preserves that opacity. If a future refactor accidentally normalised
// or stripped segments in `commitMovement`, `collectMovementPlans`, or the
// player commander's `resolveMovement`, the ship's post-movement position
// would diverge from a direct `runMovementBeat(s0, [segmentedPlan])` call.
//
// Blind commit (FR-17 / §6.3) stays intact by CONSTRUCTION: the plans are a
// `const` local inside `driveTurn`; they never touch a signal, `MatchState`,
// or `BlindMatchView`. This test doesn't need to re-prove that invariant
// (it's structural, not runtime), only that the seam does not divert the
// segmented plan on the way to the resolver.
describe('createMatchController — commitMovement carries segments to runMovementBeat', () => {
  it('a segmented player plan drives the ship to the finite-thrust position', async () => {
    const player = generateBotFleet(catalog, BUDGET, 'ace', 13);
    const config = assembleMatchConfig(
      catalog,
      catalog.tuning,
      BUDGET,
      seedOf(0x0d0d, 0x0e0e),
      player,
      [],
    );
    const { services } = captureRoutes();
    const controller = createMatchController(services, config, []);
    await flush();
    expect(controller.phase.value).toBe('movement-plan');

    // Snapshot pre-beat state — commitMovement resolves the player promise;
    // the controller then runs `runMovementBeat(state.value, plans)` where
    // `state.value` is still this snapshot (nothing else has mutated it).
    const s0 = controller.state.value;
    const shipId = Array.from(s0.ships.keys()).sort((a, b) => a - b)[0]!;
    const segments = [{ deltaV: of(0, 4, 0) }, { deltaV: of(2, 0, 0) }] as const;
    const segmentedPlan: MovementPlan = {
      bodyId: shipId,
      deltaV: of(0, 0, 0),
      segments,
    };

    controller.commitMovement([segmentedPlan]);
    await flush();
    expect(controller.phase.value).toBe('movement-resolve');

    // The controller must have driven `runMovementBeat` with the SAME plan
    // (segments preserved, not stripped). Compare final ship position against
    // a direct call on the pre-beat snapshot — deterministic and byte-stable.
    const direct = runMovementBeat(s0, [segmentedPlan]);
    const directPos = direct.state.bodies.get(shipId)!.position;
    const drivenPos = controller.state.value.bodies.get(shipId)!.position;
    expect(drivenPos).toEqual(directPos);

    // The recorded MovementBeatRecord must be the SAME record `runMovementBeat`
    // would have produced — same sub-step count, same terminal keyframe. If
    // commitMovement or the player commander normalised the plan (e.g.
    // dropped segments), sub-step derivation would diverge and this would
    // fail loudly (S02's tripwire property, restated at the seam).
    const record = controller.movementBeat.value!;
    expect(record.subStepCount).toBe(direct.record.subStepCount);
    const lastKeyframe = record.keyframes[record.keyframes.length - 1]!;
    const directLast = direct.record.keyframes[direct.record.keyframes.length - 1]!;
    expect(lastKeyframe).toEqual(directLast);
  });
});
