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
    state.value = applyTurnEnd(state.value);
    const decidedTurn = state.value.turn - 1;
    trace.value = withTurn(trace.value, {
      turn: decidedTurn,
      movement: mv.record,
      attack: at.record,
    });
    const outc = outcomeOf(checkVictory(state.value), decidedTurn);
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
    deltaV: Vec3,
  ): { readonly positions: readonly Vec3[]; readonly endsOutsideArena: boolean } => {
    const s = state.value;
    const body = s.bodies.get(bodyId);
    if (body === undefined) return { positions: [], endsOutsideArena: false };
    const preview = previewPath(body, { bodyId, deltaV }, s.physics);
    return { positions: preview.positions, endsOutsideArena: preview.endsOutsideArena };
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
