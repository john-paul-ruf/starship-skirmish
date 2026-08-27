// HeuristicCommander — the M12 `Commander` implementation (F5).
//
// One class, three tier flavours (FR-30 / Custom Rule 4 — decision quality
// only, no stat modifier ever). Composes S03's movement planner and CP1+CP2's
// attack planner into the exact `Commander` interface `TurnCoordinator` +
// `resolveBeat` (M10) consume — so a bot commander is INDISTINGUISHABLE from a
// future player commander at the loop boundary (architecture §6.3, FR-17).
//
// Construction (D-PHYSICS-INJECT — STATE.md design decision):
//   `new HeuristicCommander(fleetId, tier, physicsConfig, combat?)`
// The `Commander.planMovement(view)` interface hands over only a
// `BlindMatchView`; boundary-safety in the movement planner needs
// `PhysicsConfig` (`previewPath` shares its integrator with `resolveMovement` —
// architecture §9). Physics config is match-static, so injecting it once at
// construction is the correct seam; a future player-UI commander will inject
// it the same way. `combat` is optional and only used by the ace tier's FR-29
// AoE friendly-fire check; when absent the check is a no-op (rookie / veteran
// path).
//
// Blind-commit (FR-17 / architecture §6.3): the commander reads ONLY the
// frozen `BlindMatchView`. There is no coordinator ref, no other fleet's
// plans reachable through the view — the view carries `bodies + ships + arena
// + turn + selfFleetId` and NOTHING ELSE (blindView.ts contract). No mutation
// of the view (`Object.freeze` on wrapper + slices; a stray sort in place
// would throw in strict mode).
//
// Determinism scope (`src/ai/**`): the commander itself holds no mutable
// per-turn state, no wall clock, no `Math.random`. `planMovement` /
// `planAttack` are pure functions of `(view, tier, physicsConfig, combat?)`,
// so identical inputs → byte-identical outputs (the S06 golden's premise).
//
// Return-type mapping: `Commander.planMovement` returns `MovementPlan[]` (or
// its Promise); `planFleetMovement` returns `readonly MovementPlan[]`. A
// `.slice()` copy converts and also defends against a future in-tree consumer
// mutating the return value in place (the coordinator itself never does).

import type { AttackPlan, CombatConfig, MovementPlan } from '../sim/types.js';
import type { BlindMatchView, Commander } from '../sim/loop/index.js';
import type { PhysicsConfig } from '../sim/physics/index.js';
import { TIER_CONFIG, type BotTier } from './tiers.js';
import { planFleetMovement } from './movementPlanner.js';
import { planFleetAttack } from './attackPlanner.js';

/**
 * A bot `Commander` for one fleet. Three tier flavours (`rookie` / `veteran` /
 * `ace`) differ only in decision quality — every stat, budget, and point cost
 * comes from the same shared catalog (FR-30 / Custom Rule 4). See file header
 * for the D-PHYSICS-INJECT construction rationale.
 *
 * `planMovement` delegates to `planFleetMovement(view, tier, physicsConfig)`
 * (S03). `planAttack` delegates to `planFleetAttack(view, fleetId,
 * TIER_CONFIG[tier], combat)` (this session, CP1+CP2). Both return SYNC —
 * the `Commander` interface accepts sync-or-Promise and the coordinator
 * awaits either.
 */
export class HeuristicCommander implements Commander {
  constructor(
    public readonly fleetId: number,
    private readonly tier: BotTier,
    private readonly physics: PhysicsConfig,
    private readonly combat?: CombatConfig,
  ) {}

  planMovement(view: BlindMatchView): MovementPlan[] {
    return planFleetMovement(view, this.tier, this.physics).slice();
  }

  planAttack(view: BlindMatchView): AttackPlan[] {
    return planFleetAttack(
      view,
      this.fleetId,
      TIER_CONFIG[this.tier],
      this.combat,
    ).slice();
  }
}
