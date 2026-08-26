// prototypes/gate2/blindView.ts — the blind projection the Gate 2 bot plans against
// (disposable prototype for FR-32 / architecture §12).
//
// This mirrors, in miniature, the structural guarantee `sim/loop` will provide in F4
// (architecture §6.2, §6.3): the view the planner receives contains **bodies + arena
// and NOTHING ELSE**. There is no `pendingPlans` field, no `opponentPlan` field, no
// back-reference to the coordinator, no getter that could reach one. Blind commit is
// enforced by absence, not by policy — nothing to leak because nothing to reach.
//
// The real M10 will freeze a per-beat projection of `MatchState`; this prototype's
// factory does the same via `Object.freeze` so a stray mutation would throw in strict
// mode (which our runtime is in — TypeScript modules are strict by spec).
//
// Disposable: F5's real `HeuristicCommander` will receive the real `BlindMatchView`
// (M10) that is a strict superset of this shape. No consumer of this file survives.

import type { Arena, Body } from '../../src/sim/types.js';

/**
 * Bodies + arena, frozen. What a bot planner is allowed to see for a beat.
 *
 * The absence of a `plans` / `pendingPlans` / `commander` field IS the FR-17 blind-
 * commit contract at prototype scope. Do not add one; if you find yourself wanting
 * one, the planner is trying to cheat.
 */
export interface BlindView {
  readonly arena: Arena;
  readonly bodies: readonly Body[];
}

/**
 * Build a blind view from a body snapshot + arena. The returned object is frozen so
 * the planner cannot mutate its inputs mid-plan (a defence against a subtle bug where
 * a candidate-search accidentally trashes the shared view). Body records themselves
 * were frozen by `resolveMovement`'s two-phase commit; freezing the wrapper closes
 * the last mutation path.
 *
 * The `bodies` array is copied so a later mutation of the caller's array cannot leak
 * into a view a planner is still holding. Cheap — bodies never exceeds ~60 (FR-15).
 */
export const makeBlindView = (bodies: readonly Body[], arena: Arena): BlindView =>
  Object.freeze({ arena, bodies: Object.freeze(bodies.slice()) });
