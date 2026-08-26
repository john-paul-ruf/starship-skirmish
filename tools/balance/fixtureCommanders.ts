// tools/balance/fixtureCommanders.ts — deterministic scripted Commanders
// for the S05 combat-determinism regression suite (FR-33 baseline).
//
// The determinism proof needs REPRODUCIBLE plans — so this file is pure
// arithmetic on (view, script) input. No wall clock, no Math.random. The
// scripts themselves come in two flavours, chosen per scenario:
//
//   • `scriptedCommander(fleetId, table)` — fixed per-turn plan table looked
//     up by `view.turn`. Use this when a scenario needs called shots or an
//     explicit weapon/target assignment that the pure-function commander
//     below cannot express.
//
//   • `simpleFireCommander(fleetId)` — pure function of the BlindMatchView:
//     coast (empty movement plans) and fire every alive weapon of every
//     own-fleet ship at the lowest-BodyId enemy. Because `view.ships` is
//     already sorted by BodyId (loop's makeBlindView contract, §7.3 rule 1),
//     the output is invariant under Map insertion-order shuffles — the
//     property `combatShuffle.test.ts` proves by construction.
//
//   • `simpleFireAndMissileCommander(fleetId)` — extends the above with
//     missile launches: every alive rack with ammo remaining launches one
//     missile per turn at the same lowest-BodyId enemy.
//
// These live in `tools/balance/` (not `src/`) because they are harness /
// test scaffolding, not shipping game code. F5's real AI (`HeuristicCommander`)
// replaces them for balance runs; S05's fixtures reuse them forever as a
// reproducibility baseline against which the F5 harness can prove itself.
//
// Purity: this file imports only from `src/sim/index.js` (the sim barrel).
// `purity-check.ts` bundles the transitive graph of `tools/balance/cli.ts`
// and asserts no `three`, `preact`, or `document` token appears — this file
// must stay bundle-clean for that check.

import type {
  AttackPlan,
  BlindMatchView,
  Commander,
  MovementPlan,
} from '../../src/sim/index.js';

/**
 * One turn's plans for a single fleet — what its `Commander` returns during
 * movement and attack collection. Movement + attack are separate so a script
 * can move without firing (or fire while coasting).
 */
export interface TurnScript {
  readonly movement: readonly MovementPlan[];
  readonly attack: readonly AttackPlan[];
}

/** Per-fleet script keyed by 1-based turn number (matches `view.turn`). */
export type FleetScript = ReadonlyMap<number, TurnScript>;

/**
 * Fixed-plan commander. Looks up `view.turn` in the script; returns empty
 * plans (coast + no attack) for any turn absent from the table. Deterministic
 * by construction — no closure state, no view inspection beyond `view.turn`,
 * no draws.
 *
 * `slice()` before returning defends against a caller mutating the returned
 * array; the coordinator itself never does, but future in-tree consumers may.
 */
export const scriptedCommander = (
  fleetId: number,
  script: FleetScript,
): Commander => ({
  fleetId,
  planMovement: (view: BlindMatchView): MovementPlan[] => {
    const t = script.get(view.turn);
    return t === undefined ? [] : t.movement.slice();
  },
  planAttack: (view: BlindMatchView): AttackPlan[] => {
    const t = script.get(view.turn);
    return t === undefined ? [] : t.attack.slice();
  },
});

/**
 * Convenience: build a `FleetScript` from an array indexed by `(turn - 1)`.
 * Missing entries mean coast + no-attack that turn.
 */
export const fleetScriptFromArray = (
  perTurn: readonly TurnScript[],
): FleetScript => {
  const m = new Map<number, TurnScript>();
  for (let i = 0; i < perTurn.length; i += 1) m.set(i + 1, perTurn[i]!);
  return m;
};

/**
 * "Coast and fire" commander — the workhorse for many-turn determinism
 * scenarios. Pure function of the view:
 *   • Movement: empty (every ship coasts under its current velocity).
 *   • Attack: every alive weapon of every own-fleet ship targets the
 *     lowest-BodyId enemy ship.
 *
 * Because `view.ships` is already sorted by BodyId (loop's blindView
 * contract, §7.3 rule 1), the output is invariant under Map insertion-order
 * shuffles — exactly the property `combatShuffle.test.ts` proves.
 */
export const simpleFireCommander = (fleetId: number): Commander => ({
  fleetId,
  planMovement: (): MovementPlan[] => [],
  planAttack: (view: BlindMatchView): AttackPlan[] => {
    // Iterate the pre-sorted view; first-non-own is the lowest-id enemy.
    let target: number | null = null;
    for (let i = 0; i < view.ships.length; i += 1) {
      const s = view.ships[i]!;
      if (s.fleetId !== fleetId) {
        target = s.bodyId;
        break;
      }
    }
    if (target === null) return [];
    const out: AttackPlan[] = [];
    for (let i = 0; i < view.ships.length; i += 1) {
      const s = view.ships[i]!;
      if (s.fleetId !== fleetId) continue;
      for (let wi = 0; wi < s.weaponAlive.length; wi += 1) {
        if (!s.weaponAlive[wi]!) continue;
        out.push({ shooterId: s.bodyId, targetId: target, weaponIndex: wi });
      }
    }
    return out;
  },
});

/**
 * "Coast, launch, fire" commander — extends `simpleFireCommander` with
 * missile launches. Every alive rack with ammo remaining launches one
 * missile per turn at the same lowest-BodyId enemy the weapons fire at.
 * Pure function of the view (same shuffle-invariance).
 */
export const simpleFireAndMissileCommander = (
  fleetId: number,
): Commander => ({
  fleetId,
  planMovement: (): MovementPlan[] => [],
  planAttack: (view: BlindMatchView): AttackPlan[] => {
    let target: number | null = null;
    for (let i = 0; i < view.ships.length; i += 1) {
      const s = view.ships[i]!;
      if (s.fleetId !== fleetId) {
        target = s.bodyId;
        break;
      }
    }
    if (target === null) return [];
    const out: AttackPlan[] = [];
    for (let i = 0; i < view.ships.length; i += 1) {
      const s = view.ships[i]!;
      if (s.fleetId !== fleetId) continue;
      for (let wi = 0; wi < s.weaponAlive.length; wi += 1) {
        if (!s.weaponAlive[wi]!) continue;
        out.push({ shooterId: s.bodyId, targetId: target, weaponIndex: wi });
      }
      for (let mi = 0; mi < s.missileAlive.length; mi += 1) {
        if (!s.missileAlive[mi]!) continue;
        if ((s.missileAmmo[mi] ?? 0) <= 0) continue;
        out.push({ shooterId: s.bodyId, targetId: target, missileIndex: mi });
      }
    }
    return out;
  },
});
