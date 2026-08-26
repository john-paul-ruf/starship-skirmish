// commander — the FR-17 "player and bot are the same interface" contract (M10).
//
// A `Commander` is asked twice per turn — once for a movement plan set, once
// for an attack plan set — against a frozen `BlindMatchView` (no other fleet's
// plans visible, by construction). Everything downstream is symmetric: a player
// commander's promise resolves when the UI commit fires; a bot commander's
// promise resolves from a synchronous decision or a worker message. The turn
// coordinator does not care which — that's what makes "a future networked
// opponent is just another Commander" a property of the codebase.
//
// This file defines the SHAPE only. The player-side commander lives in `ui/`
// (a later feature); the bot-side commander lives in `ai/` (F5). The sim's
// only requirement is that the commander returns plans in finite time and
// does not mutate the view it was handed.

import type { AttackPlan, MovementPlan } from '../types.js';
import type { BlindMatchView } from './blindView.js';

/**
 * The single interface both a human-driven UI commit and an AI worker
 * implement. The two async plan methods are separate because plans are
 * collected in two beats (movement, then attack against post-movement
 * positions — FR-20).
 *
 * Return sync or via `Promise` — the coordinator awaits either. Returning a
 * plan for a body that is not this fleet's (or a body that no longer exists)
 * is not enforced here; the pure beat resolvers (`resolveBeat.ts`) drop
 * plans for missing / mis-owned bodies silently. This keeps the interface
 * itself thin and the enforcement in the layer that has the state to check
 * against.
 */
export interface Commander {
  readonly fleetId: number;
  planMovement(view: BlindMatchView): MovementPlan[] | Promise<MovementPlan[]>;
  planAttack(view: BlindMatchView): AttackPlan[] | Promise<AttackPlan[]>;
}
