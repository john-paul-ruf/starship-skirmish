// victory — three-branch victory check (M10, FR-27 + Custom Rule 5).
//
// The FORGE-CONFIG custom rule is absolute: "No timer, no turn cap, no draw,
// no points tiebreak anywhere in the codebase." `checkVictory` therefore has
// exactly three outcomes, and this file has exactly one production function
// producing them:
//
//   • one fleet standing → { victory, fleetId }
//   • zero fleets standing → { mutual-destruction }
//   • more than one fleet → null (continue)
//
// A fleet is "standing" iff it has ≥ 1 surviving ship. Surviving = the ship is
// present in `state.ships`; the loop already removes destroyed ships from that
// map at end of beat, so this reduces to a fleet-membership tally.
//
// The turn on which victory was decided is written by the coordinator via
// `withOutcome(trace, { turns })` — the check returns just the discriminant
// plus fleetId (for a victory). See `turnCoordinator.ts`.

import type { MatchOutcome } from '../trace/index.js';
import type { MatchState } from './matchState.js';

/**
 * The exact outcome of the check, one of exactly two shapes, or `null` while
 * the match is still in progress. `turns` is stamped by the coordinator when
 * it constructs the final `MatchOutcome` for the trace.
 */
export type VictoryResult =
  | { readonly kind: 'victory'; readonly fleetId: number }
  | { readonly kind: 'mutual-destruction' }
  | null;

/**
 * FR-27 / Custom Rule 5 — exactly three branches.
 *
 * Iterates `state.fleetOf` sorted by ship id (deterministic per §7.3 rule 1),
 * tallies unique surviving fleet ids. Any fleet id that has ≥ 1 ship in the
 * current `ships` map counts as standing.
 */
export const checkVictory = (state: MatchState): VictoryResult => {
  const standingSet = new Set<number>();
  // Sort ids for deterministic iteration — the set itself doesn't depend on
  // order, but keeping iteration consistent with every other loop pass keeps
  // the whole state pipeline order-independent by construction.
  const ids = Array.from(state.ships.keys()).sort((a, b) => a - b);
  for (let i = 0; i < ids.length; i += 1) {
    const fid = state.fleetOf.get(ids[i]!);
    if (fid !== undefined) standingSet.add(fid);
  }
  const n = standingSet.size;
  if (n === 1) {
    // The single surviving fleet id.
    const fleetId = standingSet.values().next().value as number;
    return { kind: 'victory', fleetId };
  }
  if (n === 0) return { kind: 'mutual-destruction' };
  return null;
};

/**
 * Stamp a `MatchOutcome` from a `VictoryResult` plus the turn count. Two-line
 * helper the coordinator uses so the "add turns" mapping lives in one place.
 * `outcome === null` returns null (no outcome yet); otherwise it produces the
 * matching `MatchOutcome` variant with `turns` filled.
 */
export const outcomeOf = (
  outcome: VictoryResult,
  turns: number,
): MatchOutcome | null => {
  if (outcome === null) return null;
  if (outcome.kind === 'victory') {
    return { kind: 'victory', fleetId: outcome.fleetId, turns };
  }
  return { kind: 'mutual-destruction', turns };
};
