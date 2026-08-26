// trace — the `ResolutionTrace` record the loop hands the renderer (architecture §6.2, §9).
//
// "Simulate fully, then animate the trace." The sim computes everything a turn will
// produce BEFORE the first frame paints; the trace is the recording. The renderer
// (M13, a later feature) imports `sim` types ONLY and plays back what's here — skip
// jumps to the final keyframe, replay re-runs the same trace. That is why the shapes
// below are pure data with no function fields and no back-references to `MatchState`:
// there is nothing the renderer could reach for that would let it mutate sim state.
//
// This file DEFINES those shapes and the three pure builders (`emptyTrace`, `withTurn`,
// `withOutcome`). The rules layer (S02) produces the events; the loop (S04) composes
// the per-beat records and calls these builders — this module owns the container, not
// the resolution logic. Every builder returns a frozen record; determinism ban-list
// applies (no wall clock, no `Math.random`, no transcendentals).

import type { BodyId, DestructionEvent, CombatLogEntry, Body } from '../types.js';
import type { StepContact } from '../physics/index.js';

/**
 * Everything a movement beat produced — physics motion + the combat consequences the
 * rules layer derived from it (contact damage, missile detonations, boundary exits,
 * plus any hazards silently removed by boundary crossing).
 *
 * `keyframes` and `contacts` are the physics `StepResult` fields verbatim — the
 * renderer plays back the keyframes and can draw a marker at each contact point.
 * `log` records the combat events that fell out of those contacts; `destroyed` lists
 * the in-arena deaths (which drive AoE + debris on the NEXT movement beat, S02);
 * `removedHazardIds` lists hazards that left the arena silently (FR-26) — the renderer
 * needs the ids to fade them out even though they never generated a log entry.
 */
export interface MovementBeatRecord {
  readonly subStepCount: number;
  readonly keyframes: readonly (readonly Body[])[];
  readonly contacts: readonly StepContact[];
  readonly log: readonly CombatLogEntry[];
  readonly destroyed: readonly DestructionEvent[];
  readonly removedHazardIds: readonly BodyId[];
}

/**
 * Everything an attack beat produced (FR-20/FR-21). Snapshot resolution — every entry
 * in `log` records one shot against a PRE-DAMAGE snapshot, then damage applies in one
 * pass. `launchedMissileIds` names the missiles that entered the field this beat so
 * the next movement beat integrates them.
 *
 * There is no `keyframes` field here: attacks resolve instantaneously; the renderer's
 * attack-beat playback is driven by the log entries, not by physics keyframes.
 */
export interface AttackBeatRecord {
  readonly log: readonly CombatLogEntry[];
  readonly destroyed: readonly DestructionEvent[];
  readonly launchedMissileIds: readonly BodyId[];
}

/** One turn = movement beat + attack beat, in that order (architecture §6.2). */
export interface TurnRecord {
  readonly turn: number;
  readonly movement: MovementBeatRecord;
  readonly attack: AttackBeatRecord;
}

/**
 * Final outcome of a match — FR-27's three-branch victory check produces exactly one of
 * these (or `null` while the match is still in progress). The `turns` field records
 * the turn on which victory was decided so the post-match screen can summarise it.
 *
 * There is no `draw`, no `turn-cap`, no `points-tiebreak` variant — Custom Rule 5
 * forbids that anywhere in the codebase. The loop's `checkVictory` will produce
 * `victory | mutual-destruction | null(continue)` and nothing else.
 */
export type MatchOutcome =
  | { readonly kind: 'victory'; readonly fleetId: number; readonly turns: number }
  | { readonly kind: 'mutual-destruction'; readonly turns: number };

/**
 * The trace the loop (S04) hands the renderer. `turns` is append-only across a match;
 * a single-beat playback slices one `TurnRecord` out. `outcome` is `null` while in
 * progress and set once at victory.
 *
 * `seedHi`/`seedLo` are plain uint32s (not `import Seed from mathx`) — keeps this
 * module's import surface to `sim/types` + `sim/physics/index` (types only) and lets
 * anyone who already has a `Seed` pass `seed.hi, seed.lo` at the boundary. Recorded
 * so any trace can be replayed by (seed, plans) per FR-12.
 */
export interface ResolutionTrace {
  readonly seedHi: number;
  readonly seedLo: number;
  readonly turns: readonly TurnRecord[];
  readonly outcome: MatchOutcome | null;
}

// ---- Pure builders ----------------------------------------------------------
// Each returns a frozen new record; input records are unchanged. `Object.freeze` is
// shallow — nested arrays passed in by the caller are frozen at the outermost level
// only (turns[] here). Callers who construct `TurnRecord`/`MovementBeatRecord`/
// `AttackBeatRecord` are responsible for freezing their own nested arrays if they
// want deep immutability; the renderer contract only cares that top-level fields on
// the trace cannot be reassigned.

/** A fresh trace at the start of a match. `outcome` is `null` until victory. */
export const emptyTrace = (seedHi: number, seedLo: number): ResolutionTrace =>
  Object.freeze({
    seedHi: seedHi >>> 0,
    seedLo: seedLo >>> 0,
    turns: Object.freeze([]),
    outcome: null,
  });

/**
 * Append one turn to the trace. Input trace is unchanged; the returned trace has a
 * fresh frozen turns array with `turn` at the end. Ordering is caller-provided (the
 * loop pushes turns in ascending turn number); this builder never reorders.
 */
export const withTurn = (
  trace: ResolutionTrace,
  turn: TurnRecord,
): ResolutionTrace =>
  Object.freeze({
    seedHi: trace.seedHi,
    seedLo: trace.seedLo,
    turns: Object.freeze([...trace.turns, turn]),
    outcome: trace.outcome,
  });

/**
 * Set the terminal outcome of a match. Called once by the loop's `checkVictory` at
 * the turn where the last surviving fleet is decided; overwriting a non-null outcome
 * is a caller bug (the loop should stop after `checkVictory` produces a result).
 */
export const withOutcome = (
  trace: ResolutionTrace,
  outcome: MatchOutcome,
): ResolutionTrace =>
  Object.freeze({
    seedHi: trace.seedHi,
    seedLo: trace.seedLo,
    turns: trace.turns,
    outcome,
  });
