// turnCoordinator — the async layer that awaits Commanders + enforces blind
// commit (M10, FR-17 + architecture §6.3).
//
// This file's ONE job: collect movement plans from every Commander, feed them
// to the pure movement resolver, collect attack plans against post-movement
// positions, feed them to the pure attack resolver, tick shield regen, and
// check victory. The pure beat resolvers do the combat; the coordinator does
// the orchestration.
//
// The load-bearing structural guarantee (§6.3):
//   collected plans live only as a LOCAL const inside runTurn()
// There is no field on `MatchState` for a pending plan; there is no field on
// `BlindMatchView` for another fleet's plan. When a commander is asked for its
// plans, it sees a view containing ZERO pending plans — not because we hid
// them, but because they DO NOT EXIST until the local `Promise.all` resolves.
// A misbehaving commander cannot reach into the coordinator; the coordinator
// isn't inside its call graph.
//
// A player commander's promise resolves when the UI commit fires; a bot
// commander's promise resolves synchronously or from a worker. The coordinator
// treats them identically — that IS FR-17.

import type { AttackPlan, MovementPlan } from '../types.js';
import type { BlindMatchView } from './blindView.js';
import { makeBlindView } from './blindView.js';
import type { Commander } from './commander.js';
import type { Match, MatchState } from './matchState.js';
import { applyTurnEnd, runAttackBeat, runMovementBeat } from './resolveBeat.js';
import type {
  AttackBeatRecord,
  MatchOutcome,
  MovementBeatRecord,
  ResolutionTrace,
} from '../trace/index.js';
import { emptyTrace, withOutcome, withTurn } from '../trace/index.js';
import { checkVictory, outcomeOf } from './victory.js';

/** One completed turn: the state after it, the beat records, and (if the
 *  turn ended the match) a `MatchOutcome`. */
export interface TurnResult {
  readonly state: MatchState;
  readonly movement: MovementBeatRecord;
  readonly attack: AttackBeatRecord;
  readonly outcome: MatchOutcome | null;
}

/**
 * Ask every commander for its movement plans against a fresh blind view.
 * Awaits every commander in parallel — this is where a slow player commander
 * waits on the UI commit; a bot commander resolves immediately or from a
 * worker. Returns the flat plan set (per-commander order preserved; the
 * resolver sorts internally by `bodyId` so order across commanders does not
 * affect the outcome — see §7.3 rule 2 in resolveMovement).
 *
 * A commander's plan is OPAQUE here (feature `finite-thrust-movement`,
 * SESSION-02). A finite-thrust plan (D-ADDITIVE-PLAN — `MovementPlan.segments`
 * present) rides through unchanged; the coordinator never normalizes,
 * expands, or strips a plan. This is the load-bearing "no coordinator
 * reshapes plans" property S02's tests lock in.
 */
const collectMovementPlans = async (
  state: MatchState,
  commanders: readonly Commander[],
): Promise<MovementPlan[]> => {
  const per = await Promise.all(
    commanders.map((c) => {
      const view: BlindMatchView = makeBlindView(state, c.fleetId);
      // ▲ FR-17: every commander sees a view with NO plans field. The moment
      //   this Promise-array is awaited is the moment "blind commit" is over.
      return c.planMovement(view);
    }),
  );
  const out: MovementPlan[] = [];
  for (let i = 0; i < per.length; i += 1) {
    const arr = per[i]!;
    for (let j = 0; j < arr.length; j += 1) out.push(arr[j]!);
  }
  return out;
};

const collectAttackPlans = async (
  state: MatchState,
  commanders: readonly Commander[],
): Promise<AttackPlan[]> => {
  const per = await Promise.all(
    commanders.map((c) => c.planAttack(makeBlindView(state, c.fleetId))),
  );
  const out: AttackPlan[] = [];
  for (let i = 0; i < per.length; i += 1) {
    const arr = per[i]!;
    for (let j = 0; j < arr.length; j += 1) out.push(arr[j]!);
  }
  return out;
};

/**
 * Run one whole turn: movement beat → attack beat → shield regen → turn
 * increment → victory check. Pure aside from awaiting the commanders.
 *
 * Every collected plan set is a LOCAL const in this function — the loop's
 * blind-commit invariant is exactly this. Neither `state` nor any downstream
 * view carries a pending plan into a commander's world.
 */
export const runTurn = async (
  state: MatchState,
  commanders: readonly Commander[],
): Promise<TurnResult> => {
  // ── Movement beat ────────────────────────────────────────────────────────
  const movementPlans = await collectMovementPlans(state, commanders);
  const mv = runMovementBeat(state, movementPlans);

  // ── Attack beat (post-movement positions, FR-20) ────────────────────────
  const attackPlans = await collectAttackPlans(mv.state, commanders);
  const at = runAttackBeat(mv.state, attackPlans);

  // ── End of turn: shield regen (Ruling E) + turn++ ────────────────────────
  const stateAfterTurn = applyTurnEnd(at.state);

  // ── Victory check — exactly three branches (Custom Rule 5) ──────────────
  const outcome = outcomeOf(checkVictory(stateAfterTurn), stateAfterTurn.turn - 1);

  return {
    state: stateAfterTurn,
    movement: mv.record,
    attack: at.record,
    outcome,
  };
};

/**
 * Convenience: run a whole match to conclusion. Loops `runTurn` until the
 * outcome is set. Threads the `ResolutionTrace` incrementally so callers can
 * inspect the record if they want to.
 *
 * `maxTurnsGuard` is a TEST-ONLY SAFETY VALVE — a thrown error to stop a
 * runaway test. It is EXPLICITLY NOT A GAME RULE (FR-27 / Custom Rule 5 —
 * no turn cap exists in the game). Defaults to `undefined` = disabled in
 * real play. If you find yourself relying on it in non-test code, the loop
 * has a bug; fix the loop, not the guard.
 */
export interface RunMatchResult {
  readonly state: MatchState;
  readonly trace: ResolutionTrace;
  readonly outcome: MatchOutcome;
}

export const runMatch = async (
  initial: MatchState,
  commanders: readonly Commander[],
  maxTurnsGuard?: number,
): Promise<RunMatchResult> => {
  let state = initial;
  let trace = emptyTrace(initial.seed.hi, initial.seed.lo);
  let outcome: MatchOutcome | null = null;
  let turnsElapsed = 0;
  while (outcome === null) {
    turnsElapsed += 1;
    if (maxTurnsGuard !== undefined && turnsElapsed > maxTurnsGuard) {
      // Test/harness safety valve — not a game rule. See fn-level comment.
      throw new Error(
        `runMatch: exceeded maxTurnsGuard=${maxTurnsGuard} (test-only guard; not a game rule per FR-27).`,
      );
    }
    const turn = await runTurn(state, commanders);
    // Record the completed turn's data on the trace. `state.turn - 1` is the
    // turn number that just ended (applyTurnEnd bumped it).
    trace = withTurn(trace, {
      turn: turn.state.turn - 1,
      movement: turn.movement,
      attack: turn.attack,
    });
    state = turn.state;
    outcome = turn.outcome;
  }
  trace = withOutcome(trace, outcome);
  return { state, trace, outcome };
};

/**
 * Bind a `Match` handle to an async `runTurn` closure. Mutates the handle's
 * `state` field with the post-turn state so `match.state` always names the
 * current match state. Convenience for the app / harness — pure callers can
 * just call the free `runTurn` above.
 */
export const advanceMatch = async (
  match: Match,
  commanders: readonly Commander[],
): Promise<TurnResult> => {
  const result = await runTurn(match.state, commanders);
  match.state = result.state;
  return result;
};
