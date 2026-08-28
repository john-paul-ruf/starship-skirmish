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
  type MatchState,
  type MovementPlan,
} from '../../../../src/sim/index.js';
import { of } from '../../../../src/sim/mathx/vec3.js';
import type { Route } from '../../../../src/ui/appContext.js';
import { generateBotFleet } from '../../../../src/ai/index.js';
import { assembleMatchConfig, PLAYER_FLEET_ID } from '../../../../src/app/match/config.js';
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
// ---- Player-fleet elimination — DEFEAT at the app layer (S03 CP1) ---------
//
// The playtest bug: with ≥ 2 opposing fleets, `checkVictory` returns null
// (Custom Rule 5 — the sim's three-branch check has no "player wipe" branch
// when other fleets are still standing), so the player who lost their last
// ship was forced to spectate the surviving bots. The controller now checks
// player elimination at turn end and ends the match as DEFEAT (concede-
// symmetric) — Custom Rule 5 stays intact by construction because the sim's
// `checkVictory` is byte-untouched.
//
// The state signal is exposed as `ReadonlySignal<MatchState>`; the underlying
// `@preact/signals` handle is mutable (writes are a compile-time constraint,
// not a runtime one). We cast to inject a scripted `MatchState` at a specific
// beat boundary — cheaper than authoring commanders that reliably wipe a
// fleet in a single turn and equally load-bearing on the controller seam.
describe('createMatchController — player-fleet elimination ends the match', () => {
  /** Remove every ship (+ body + fleetOf entry) belonging to `fleetId`. */
  const wipeFleet = (s: MatchState, fleetId: number): MatchState => {
    const nextShips = new Map(s.ships);
    const nextBodies = new Map(s.bodies);
    const nextFleetOf = new Map(s.fleetOf);
    for (const [id, fid] of s.fleetOf) {
      if (fid === fleetId) {
        nextShips.delete(id);
        nextBodies.delete(id);
        nextFleetOf.delete(id);
      }
    }
    return { ...s, ships: nextShips, bodies: nextBodies, fleetOf: nextFleetOf };
  };

  it('turn-end: player wiped while two bot fleets survive → victory for the lowest enemy id', async () => {
    // Three-fleet setup: `checkVictory` on a player wipe returns null (≥ 2
    // standing) — the exact case the pre-S03 controller stranded the player on.
    const player = generateBotFleet(catalog, BUDGET, 'ace', 11);
    const config = assembleMatchConfig(
      catalog,
      catalog.tuning,
      BUDGET,
      seedOf(0xdead, 0xbeef),
      player,
      [
        { tier: 'veteran', rngKey: 0x101 },
        { tier: 'veteran', rngKey: 0x202 },
      ],
    );
    const { services, routes } = captureRoutes();
    const controller = createMatchController(services, config, ['veteran', 'veteran']);
    const stateSignal = controller.state as unknown as { value: MatchState };

    await flush();
    expect(controller.phase.value).toBe('movement-plan');

    controller.commitMovement([]);
    await flush();
    controller.resolveAnimationDone();
    await flush();
    expect(controller.phase.value).toBe('attack-plan');

    controller.commitAttack([]);
    await flush();
    expect(controller.phase.value).toBe('attack-resolve');

    // Inject a wiped-player state right before the turn-end sync block —
    // `applyTurnEnd` + `checkVictory` + fallback all read from this state.
    stateSignal.value = wipeFleet(stateSignal.value, PLAYER_FLEET_ID);

    controller.resolveAnimationDone();
    await flush();
    expect(controller.phase.value).toBe('complete');
    expect(routes.at(-1)).toEqual({ name: 'post-match' });
    // Lowest surviving enemy fleet is roster id 1 (bot fleets take 1..N).
    // `decidedTurn = state.turn - 1` after `applyTurnEnd` bumps the counter
    // from 1 → 2, so turn 1 is the decided turn.
    expect(controller.outcome.value).toEqual({
      kind: 'victory',
      fleetId: PLAYER_FLEET_ID + 1,
      turns: 1,
    });
    // Trace outcome is stamped for the post-match summary.
    expect(controller.trace.value.outcome).toEqual(controller.outcome.value);
  });

  it('movement-beat: player wiped by collision/boundary exit → finish immediately with an empty attack log', async () => {
    // Same three-fleet setup as the turn-end test, but the wipe happens
    // during the movement beat — the controller must not drag the player
    // through a dead attack phase. The recorded turn's `attack.log` is empty
    // because the shortcut runs `runAttackBeat(state, [])`.
    const player = generateBotFleet(catalog, BUDGET, 'ace', 33);
    const config = assembleMatchConfig(
      catalog,
      catalog.tuning,
      BUDGET,
      seedOf(0xf00d, 0xd00d),
      player,
      [
        { tier: 'veteran', rngKey: 0x404 },
        { tier: 'veteran', rngKey: 0x505 },
      ],
    );
    const { services, routes } = captureRoutes();
    const controller = createMatchController(services, config, ['veteran', 'veteran']);
    const stateSignal = controller.state as unknown as { value: MatchState };

    await flush();
    expect(controller.phase.value).toBe('movement-plan');

    controller.commitMovement([]);
    await flush();
    expect(controller.phase.value).toBe('movement-resolve');

    // Simulate the player's last ship dying during movement — inject BEFORE
    // the animation barrier resolves so the movement-beat exit branch fires.
    stateSignal.value = wipeFleet(stateSignal.value, PLAYER_FLEET_ID);

    controller.resolveAnimationDone();
    await flush();
    // No 'attack-plan' phase, no 'tactical-attack' route — the shortcut
    // steps straight from movement-resolve to complete.
    expect(controller.phase.value).toBe('complete');
    expect(routes.at(-1)).toEqual({ name: 'post-match' });
    expect(routes).not.toContainEqual({ name: 'tactical-attack' });

    // Turn 1 is decided (state.turn is still 1 — `applyTurnEnd` has NOT run).
    expect(controller.outcome.value).toEqual({
      kind: 'victory',
      fleetId: PLAYER_FLEET_ID + 1,
      turns: 1,
    });
    // A complete TurnRecord was stamped so PostMatch / combat log stay well-
    // formed; the attack half is an empty beat (no plans → no shots).
    expect(controller.trace.value.turns).toHaveLength(1);
    const stampedTurn = controller.trace.value.turns[0]!;
    expect(stampedTurn.turn).toBe(1);
    expect(stampedTurn.attack.log).toEqual([]);
    expect(stampedTurn.attack.destroyed).toEqual([]);
    expect(stampedTurn.attack.launchedMissileIds).toEqual([]);
    // Trace outcome is stamped for the post-match summary.
    expect(controller.trace.value.outcome).toEqual(controller.outcome.value);
  });

  it('turn-end: player and last enemy both wiped → mutual-destruction (existing three-branch case)', async () => {
    // Two-fleet setup: `checkVictory` on a total wipe already returns
    // `mutual-destruction`; the fallback must not stomp it. Regression guard
    // for Custom Rule 5's second branch.
    const player = generateBotFleet(catalog, BUDGET, 'ace', 22);
    const config = assembleMatchConfig(
      catalog,
      catalog.tuning,
      BUDGET,
      seedOf(0xcafe, 0xba5e),
      player,
      [{ tier: 'veteran', rngKey: 0x303 }],
    );
    const { services } = captureRoutes();
    const controller = createMatchController(services, config, ['veteran']);
    const stateSignal = controller.state as unknown as { value: MatchState };

    await flush();
    controller.commitMovement([]);
    await flush();
    controller.resolveAnimationDone();
    await flush();
    controller.commitAttack([]);
    await flush();
    expect(controller.phase.value).toBe('attack-resolve');

    // Wipe BOTH fleets — zero fleets standing → `checkVictory` returns
    // `mutual-destruction` (not `null`), so the fallback branch is skipped.
    let s = stateSignal.value;
    s = wipeFleet(s, PLAYER_FLEET_ID);
    s = wipeFleet(s, PLAYER_FLEET_ID + 1);
    stateSignal.value = s;

    controller.resolveAnimationDone();
    await flush();
    expect(controller.phase.value).toBe('complete');
    expect(controller.outcome.value?.kind).toBe('mutual-destruction');
    expect(controller.trace.value.outcome?.kind).toBe('mutual-destruction');
  });
});

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
