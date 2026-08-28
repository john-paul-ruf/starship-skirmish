// M16 App — the match controller (D-MATCH-CONTROLLER, S01 CP4).
//
// The load-bearing seam of the whole feature. The controller drives the sim's
// PURE beat resolvers (`runMovementBeat` / `runAttackBeat` / `applyTurnEnd` /
// `checkVictory`) MANUALLY — NOT `runTurn`/`runMatch` — so the UI can animate
// each resolve between blind-plan phases (the coordinator's single-await
// `runTurn` never surfaces the movement keyframes mid-turn). It owns:
//   • the phase state machine (`movement-plan → resolve → attack-plan → resolve
//     → complete`), exposed as signals;
//   • the manual beat loop, PACED by UI commits + animation-done callbacks;
//   • the two sim seams the UI may not import directly — `hitChanceFor`
//     (sim/rules) and `previewArc` (sim/physics).
//
// Blind commit (FR-17 / §6.3): each commander (player included) plans against a
// FRESH `makeBlindView(state, fleetId)`; the collected plans live ONLY as a
// `const` local inside `collect*Plans` / `driveTurn` — never on a signal, never
// on `MatchState`. There is nothing to leak because there is nothing to reach.

import { signal } from '@preact/signals';

import type { Route } from '../../ui/appContext.js';
import type { MatchController, MatchPhase } from '../../ui/matchContext.js';
import type { BotTier } from '../../ai/index.js';
import {
  applyTurnEnd,
  buildInitialState,
  checkVictory,
  distance,
  emptyTrace,
  hitChance,
  length,
  makeBlindView,
  outcomeOf,
  previewPath,
  runAttackBeat,
  runMovementBeat,
  withOutcome,
  withTurn,
  ZERO,
  type AttackBeatRecord,
  type AttackPlan,
  type BlindMatchView,
  type BodyId,
  type Commander,
  type HitChanceBreakdown,
  type MatchConfig,
  type MatchOutcome,
  type MatchState,
  type MovementBeatRecord,
  type MovementPlan,
  type ResolutionTrace,
  type Seed,
  type ShipCombat,
  type Vec3,
} from '../../sim/index.js';
// `WaypointBurn` is not re-exported from `sim/index.js` (S01 follow-up #2 —
// intentional, tracked for Forge); reach it through the `sim/physics` barrel,
// which `src/app/**` is free to import from. Type-only.
import type { WaypointBurn } from '../../sim/physics/index.js';
import { makeBotCommanders, makePlayerCommander } from './commanders.js';
import { mintSeed, PLAYER_FLEET_ID } from './config.js';

/**
 * The slice of `AppServices` the controller needs: route navigation for the
 * phase→route coupling. Kept minimal so the controller does not depend on the
 * whole services surface (which itself references `MatchController`).
 */
export interface MatchServices {
  navigate(to: Route): void;
}

const ZERO_BREAKDOWN: HitChanceBreakdown = {
  base: 0,
  rangeFactor: 0,
  velocityFactor: 0,
  evasionFactor: 0,
  final: 0,
};

/**
 * `SK-XXXX-XXXX-XXXX` seed label (§4.11) — three uint16 groups drawn from the
 * 64-bit seed. Deterministic and copy-pasteable; the post-match screen renders
 * it for the "replay this exact match" affordance.
 */
const formatSeedLabel = (seed: Seed): string => {
  const hex4 = (n: number): string =>
    (n & 0xffff).toString(16).toUpperCase().padStart(4, '0');
  return `SK-${hex4(seed.hi >>> 16)}-${hex4(seed.hi)}-${hex4(seed.lo >>> 16)}`;
};

/** Aggregate target evasion = base + active decoy bonus (mirrors the private
 *  `targetEvasion` in `sim/rules/attack.ts`, which `hitChanceFor` must match). */
const evasionWithDecoy = (target: ShipCombat, turn: number): number => {
  let evasion = target.ship.baseEvasion;
  if (target.decoyActiveUntilTurn >= turn) {
    for (let i = 0; i < target.decoyAlive.length; i += 1) {
      if (target.decoyAlive[i]!) {
        evasion += target.ship.decoys[i]!.evasionBonus;
        break;
      }
    }
  }
  return evasion;
};

/**
 * Build a `MatchController` around an assembled `MatchConfig`. `botTiers[i]`
 * pairs with the i-th bot fleet (roster order); the player is roster
 * `PLAYER_FLEET_ID`. The loop starts immediately (navigating into the movement
 * screen), then waits on the UI's commit + animation-done callbacks.
 */
export const createMatchController = (
  services: MatchServices,
  initialConfig: MatchConfig,
  botTiers: readonly BotTier[],
): MatchController => {
  const playerFleetId = PLAYER_FLEET_ID;

  // Mutable across `rematch`: the seed (and thus placement) may change; the
  // fleets never do.
  let config = initialConfig;

  // ---- Observable state ---------------------------------------------------
  const state = signal<MatchState>(buildInitialState(config));
  const phase = signal<MatchPhase>('movement-plan');
  const turn = signal<number>(state.value.turn);
  const view = signal<BlindMatchView | null>(null);
  const movementBeat = signal<MovementBeatRecord | null>(null);
  const attackBeat = signal<AttackBeatRecord | null>(null);
  const outcome = signal<MatchOutcome | null>(null);
  const trace = signal<ResolutionTrace>(emptyTrace(config.seed.hi, config.seed.lo));

  // ---- Commanders ---------------------------------------------------------
  // Bots are pure + stateless, so a single construction survives rematch. The
  // player handle is promise-backed and rebuilt per launch (fresh resolvers).
  const botFleets = config.fleets.filter((f) => f.fleetId !== playerFleetId);
  const bots = makeBotCommanders(botFleets, botTiers, config.physics, config.combat);
  let player = makePlayerCommander(playerFleetId);
  let commanders: Commander[] = [player.commander, ...bots];

  // ---- Loop control -------------------------------------------------------
  let finished = false;
  let animationResolve: (() => void) | null = null;
  const animationBarrier = (): Promise<void> =>
    new Promise<void>((resolve) => {
      animationResolve = resolve;
    });

  // ---- Player-fleet elimination (S03 — D-DEFEAT-APP-LAYER) ---------------
  // A player-fleet wipe is DEFEAT at the app layer (concede-symmetric), NOT
  // via `checkVictory` — Custom Rule 5 keeps the sim's victory check three-
  // branch. The fallback fires when `checkVictory` says "continue" (≥ 2 bot
  // fleets standing) but the player has no ships; without it, the player
  // would be forced to watch the surviving bots finish the match.
  //
  // Nominal victor for a player wipe = the lowest-id surviving enemy fleet
  // (mirrors `victory.ts`'s standing tally); zero surviving enemies collapses
  // to `mutual-destruction`. The renderer maps `victory { fleetId != player }`
  // to the DEFEAT headline on the post-match screen.

  /** True when no ship in `s.ships` belongs to the player fleet. */
  const playerEliminated = (s: MatchState): boolean => {
    for (const id of s.ships.keys()) {
      if (s.fleetOf.get(id) === playerFleetId) return false;
    }
    return true;
  };

  /** The lowest-id surviving enemy fleet (the nominal victor for a player wipe). */
  const survivingEnemyFleet = (s: MatchState): number | null => {
    const enemies: number[] = [];
    for (const id of s.ships.keys()) {
      const fid = s.fleetOf.get(id);
      if (fid !== undefined && fid !== playerFleetId && !enemies.includes(fid)) {
        enemies.push(fid);
      }
    }
    enemies.sort((a, b) => a - b);
    return enemies[0] ?? null;
  };

  /** The outcome to record when the player is eliminated. Victory for the
   *  lowest surviving enemy fleet, or mutual-destruction if none stand. */
  const defeatOutcome = (decidedTurn: number): MatchOutcome => {
    const enemy = survivingEnemyFleet(state.value);
    return enemy !== null
      ? { kind: 'victory', fleetId: enemy, turns: decidedTurn }
      : { kind: 'mutual-destruction', turns: decidedTurn };
  };

  // BLIND COMMIT lives here: each commander plans against a FRESH view; the
  // returned plans exist only as the local the caller `await`s.
  const collectMovementPlans = async (s: MatchState): Promise<MovementPlan[]> => {
    const per = await Promise.all(
      commanders.map((c) => c.planMovement(makeBlindView(s, c.fleetId))),
    );
    return per.flat();
  };
  const collectAttackPlans = async (s: MatchState): Promise<AttackPlan[]> => {
    const per = await Promise.all(
      commanders.map((c) => c.planAttack(makeBlindView(s, c.fleetId))),
    );
    return per.flat();
  };

  const driveTurn = async (): Promise<void> => {
    // ── MOVEMENT PLAN — expose player view; wait for commitMovement ──────────
    view.value = makeBlindView(state.value, playerFleetId);
    phase.value = 'movement-plan';
    services.navigate({ name: 'tactical-move' });
    const movementPlans = await collectMovementPlans(state.value);
    if (finished) return;
    const mv = runMovementBeat(state.value, movementPlans);
    state.value = mv.state;
    movementBeat.value = mv.record;
    view.value = null;
    phase.value = 'movement-resolve';
    await animationBarrier();
    if (finished) return;

    // ── ATTACK PLAN — post-movement positions (FR-20) ───────────────────────
    view.value = makeBlindView(state.value, playerFleetId);
    phase.value = 'attack-plan';
    services.navigate({ name: 'tactical-attack' });
    const attackPlans = await collectAttackPlans(state.value);
    if (finished) return;
    const at = runAttackBeat(state.value, attackPlans);
    state.value = at.state;
    attackBeat.value = at.record;
    view.value = null;
    phase.value = 'attack-resolve';
    await animationBarrier();
    if (finished) return;

    // ── TURN END + victory (Custom Rule 5 — three branches only) ────────────
    // `checkVictory` remains three-branch; the app-layer fallback below fires
    // ONLY when the sim says "continue" but the player has been wiped (a case
    // Custom Rule 5 cannot express because it would need a fourth branch).
    state.value = applyTurnEnd(state.value);
    const decidedTurn = state.value.turn - 1;
    trace.value = withTurn(trace.value, {
      turn: decidedTurn,
      movement: mv.record,
      attack: at.record,
    });
    let outc = outcomeOf(checkVictory(state.value), decidedTurn);
    if (outc === null && playerEliminated(state.value)) {
      outc = defeatOutcome(decidedTurn);
    }
    if (outc !== null) {
      finished = true;
      outcome.value = outc;
      trace.value = withOutcome(trace.value, outc);
      phase.value = 'complete';
      services.navigate({ name: 'post-match' });
      return;
    }
    turn.value = state.value.turn;
    void driveTurn(); // next turn
  };

  const launch = (): void => {
    player = makePlayerCommander(playerFleetId);
    commanders = [player.commander, ...bots];
    finished = false;
    animationResolve = null;
    // Defer the first turn one microtask so the caller (`startMatch`) can set
    // `activeMatch = controller` BEFORE the loop's first `navigate` reaches the
    // outlet — otherwise the shell would see the `tactical-move` route with a
    // still-null `activeMatch` and bounce back to setup. `driveTurn` itself is
    // async, but its synchronous prefix (the first navigate) would otherwise
    // run during `createMatchController`, before the controller is returned.
    queueMicrotask(() => {
      void driveTurn();
    });
  };

  // ---- UI-facing methods --------------------------------------------------
  const commitMovement = (plans: readonly MovementPlan[]): void => {
    if (finished) return;
    player.resolveMovement(plans);
  };
  const commitAttack = (plans: readonly AttackPlan[]): void => {
    if (finished) return;
    player.resolveAttack(plans);
  };
  const resolveAnimationDone = (): void => {
    const resolve = animationResolve;
    if (resolve === null) return;
    animationResolve = null;
    resolve();
  };

  const hitChanceFor = (
    shooterId: BodyId,
    targetId: BodyId,
    weaponIndex: number,
  ): HitChanceBreakdown => {
    const s = state.value;
    const shooter = s.ships.get(shooterId);
    const target = s.ships.get(targetId);
    const shooterBody = s.bodies.get(shooterId);
    const targetBody = s.bodies.get(targetId);
    if (
      shooter === undefined ||
      target === undefined ||
      shooterBody === undefined ||
      targetBody === undefined
    ) {
      return ZERO_BREAKDOWN;
    }
    const weapon = shooter.ship.weapons[weaponIndex];
    if (weapon === undefined) return ZERO_BREAKDOWN;
    const range = distance(shooterBody.position, targetBody.position);
    const targetSpeed = length(targetBody.velocity);
    const evasion = evasionWithDecoy(target, s.turn);
    return hitChance(weapon, range, targetSpeed, evasion);
  };

  const previewArc = (
    bodyId: BodyId,
    arc: Vec3 | { readonly segments: readonly WaypointBurn[] },
  ): {
    readonly positions: readonly Vec3[];
    readonly endsOutsideArena: boolean;
    readonly markPositions?: readonly Vec3[];
  } => {
    const s = state.value;
    const body = s.bodies.get(bodyId);
    if (body === undefined) return { positions: [], endsOutsideArena: false };
    // Discriminate on the presence of `segments` — a `Vec3` never carries it,
    // so `'segments' in arc` is a total, cheap check. Impulsive → today's
    // `{ bodyId, deltaV }` shape (byte-identical, D-ADDITIVE-PLAN). Finite
    // thrust → segments + `deltaV = ZERO`; when `segments` are present the
    // resolver IGNORES `deltaV` (see `sim/types.ts::MovementPlan`), but a
    // zero fallback keeps the record shape stable for consumers that read it.
    const plan: MovementPlan =
      'segments' in arc
        ? { bodyId, deltaV: ZERO, segments: arc.segments }
        : { bodyId, deltaV: arc };
    const preview = previewPath(body, plan, s.physics);
    // Surface `markPositions` unconditionally (empty array for impulsive plans,
    // segment-boundary marks for finite-thrust) — the seam signature makes it
    // optional so callers that only need `positions`/`endsOutsideArena` are
    // unaffected. The S05 waypoint UI reads it directly to place per-waypoint
    // marks on the TRUE curved arc (D-SHARED-SCHEDULE).
    return {
      positions: preview.positions,
      endsOutsideArena: preview.endsOutsideArena,
      markPositions: preview.markPositions,
    };
  };

  const concede = (): void => {
    if (finished) return;
    finished = true;
    // Immediate loss (Ruling D, Flow 6): the opponent fleet takes the win.
    const enemy = config.fleets.find((f) => f.fleetId !== playerFleetId);
    const turns = state.value.turn;
    const outc: MatchOutcome =
      enemy !== undefined
        ? { kind: 'victory', fleetId: enemy.fleetId, turns }
        : { kind: 'mutual-destruction', turns };
    outcome.value = outc;
    trace.value = withOutcome(trace.value, outc);
    view.value = null;
    phase.value = 'complete';
    services.navigate({ name: 'post-match' });
  };

  const rematch = (opts: { readonly newSeed: boolean }): void => {
    // newSeed=false replays the SAME seed identically (§4.11); newSeed mints a
    // fresh one — same fleets, new placement + rolls.
    const nextSeed = opts.newSeed ? mintSeed() : config.seed;
    config = { ...config, seed: nextSeed };
    state.value = buildInitialState(config);
    turn.value = state.value.turn;
    view.value = null;
    movementBeat.value = null;
    attackBeat.value = null;
    outcome.value = null;
    trace.value = emptyTrace(nextSeed.hi, nextSeed.lo);
    launch();
  };

  // The §4.11 label of the seed this controller was created with. A plain
  // string per the contract; a `newSeed` rematch swaps the running seed but not
  // this label (documented in the S01 followUp).
  const seedLabel = formatSeedLabel(initialConfig.seed);

  // Kick off the first turn — navigates into the movement screen, then waits.
  launch();

  return {
    view,
    phase,
    turn,
    movementBeat,
    attackBeat,
    state,
    outcome,
    trace,
    seedLabel,
    playerFleetId,
    // The rosters every fleet started with (names/buildIds for post-match
    // fates). `initialConfig` never changes — `rematch` swaps only the seed.
    initialFleets: initialConfig.fleets,
    commitMovement,
    commitAttack,
    resolveAnimationDone,
    hitChanceFor,
    previewArc,
    concede,
    rematch,
  };
};
