// M16 App — the player + bot `Commander`s for a running match (S01 CP3).
//
// FR-17 "player and bot are one interface": both sides implement the sim's
// `Commander`. The bot side is a main-thread `HeuristicCommander` (D-BOT-MAIN-
// THREAD) whose planning is sync + pure. The player side is promise-backed: its
// `planMovement` / `planAttack` return promises the UI commit callbacks resolve,
// so the coordinator awaits the human exactly as it awaits a bot.
//
// Blind commit (FR-17 / §6.3): the coordinator builds a fresh `BlindMatchView`
// per commander per beat and hands it in. The player commander ACCEPTS that
// view — the moment it is built is the moment no other fleet's plan is
// reachable — but ignores it for planning, because the UI already holds the
// same view through the controller's `view` signal.

import type {
  AttackPlan,
  BlindMatchView,
  CombatConfig,
  Commander,
  MovementPlan,
  PhysicsConfig,
  SimFleet,
} from '../../sim/index.js';
import { HeuristicCommander, type BotTier } from '../../ai/index.js';

/**
 * A player `Commander` plus the two resolver handles the controller wires to
 * the UI commit callbacks. `resolveMovement(plans)` fulfils the promise
 * `planMovement` returned; same for attack. Resolving with no plan awaited is a
 * no-op (a stray commit), and a fulfilled promise cannot be resolved twice.
 */
export interface PlayerCommanderHandle {
  readonly commander: Commander;
  resolveMovement(plans: readonly MovementPlan[]): void;
  resolveAttack(plans: readonly AttackPlan[]): void;
}

/**
 * Build a promise-backed player commander for `fleetId`. Each `plan*` call
 * parks a resolver; the matching `resolve*` handle fulfils it. The returned
 * plans are copied (`.slice()`) so a caller mutating its array after commit
 * cannot reach into the resolved beat.
 */
export const makePlayerCommander = (fleetId: number): PlayerCommanderHandle => {
  let pendingMovement: ((plans: MovementPlan[]) => void) | null = null;
  let pendingAttack: ((plans: AttackPlan[]) => void) | null = null;

  const commander: Commander = {
    fleetId,
    planMovement(view: BlindMatchView): Promise<MovementPlan[]> {
      // Accepting `view` IS the blind-commit boundary; the UI plans against the
      // controller's `view` signal, so the commander ignores it here.
      void view;
      return new Promise<MovementPlan[]>((resolve) => {
        pendingMovement = resolve;
      });
    },
    planAttack(view: BlindMatchView): Promise<AttackPlan[]> {
      void view;
      return new Promise<AttackPlan[]>((resolve) => {
        pendingAttack = resolve;
      });
    },
  };

  const resolveMovement = (plans: readonly MovementPlan[]): void => {
    const resolve = pendingMovement;
    if (resolve === null) return; // no plan awaited — ignore a stray commit
    pendingMovement = null; // guard against double-resolve
    resolve(plans.slice());
  };

  const resolveAttack = (plans: readonly AttackPlan[]): void => {
    const resolve = pendingAttack;
    if (resolve === null) return;
    pendingAttack = null;
    resolve(plans.slice());
  };

  return { commander, resolveMovement, resolveAttack };
};

/**
 * Build one `HeuristicCommander` per bot fleet. `tiers[i]` pairs with
 * `fleets[i]` (setup order); `physics` + `combat` are match-static and injected
 * once (D-PHYSICS-INJECT). The commanders are sync + pure, so the controller
 * can await them alongside the player without special-casing either.
 */
export const makeBotCommanders = (
  fleets: readonly SimFleet[],
  tiers: readonly BotTier[],
  physics: PhysicsConfig,
  combat: CombatConfig,
): HeuristicCommander[] =>
  fleets.map((f, i) => new HeuristicCommander(f.fleetId, tiers[i]!, physics, combat));
