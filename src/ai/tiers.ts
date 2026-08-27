// tiers — bot difficulty vocabulary (M12 root; FR-30, D-TIER-KNOBS).
//
// Difficulty is decision QUALITY only. FR-30 forbids tiers from changing any ship
// stat, budget, or point cost — "No such field exists" (Custom Rule 4, the
// negative-space invariant). This file is the single place that encodes what a
// tier *does*, so every downstream consumer (fleet generator, movement planner,
// attack planner, HeuristicCommander) reads the same knob table and stays honest
// by construction.
//
// Sources:
//   • specs/design.md §4.10 — the player-visible tier table.
//   • prototypes/gate2/FINDINGS.md §2 — the tier → movement mapping surfaced by
//     Gate 2 (the load-bearing FR-29 verdict).
//
// This is a leaf module: it imports nothing. Everything in `src/ai/**` reads it;
// it reads nothing back. Runtime knob NUMERICS live as module consts marked
// `PROMOTION SEAM` — legitimate future `tuning.json` fields — but they stay out of
// the catalog schema today (Custom Rule 4 forbids adding stat/tier fields there,
// mirroring how Gate 2 kept `DEFAULT_PLANNER_CONFIG` as a module const).

/**
 * The three difficulty tiers, by name. Order in `BOT_TIERS` IS the canonical
 * strength ordinal — rookie < veteran < ace.
 */
export type BotTier = 'rookie' | 'veteran' | 'ace';

/**
 * Canonical difficulty order — index IS the strength ordinal. Iterate this,
 * never `Object.keys(TIER_CONFIG)` (the determinism scope requires stable
 * iteration; a static array is the stable primitive).
 */
export const BOT_TIERS: readonly BotTier[] = ['rookie', 'veteran', 'ace'] as const;

/**
 * Which candidate ladder the movement planner evaluates for boundary safety
 * (prototypes/gate2/FINDINGS.md §1b, §2). Not a stat — a decision policy.
 *
 *   • `baseline-veto`       — rookie: baseline arc only; if its `previewPath`
 *     exits, coast (rank-3). No recovery ladder. Intentional flavour: rookie is
 *     bad at recovering from a bad setup.
 *   • `full-7`              — veteran: the full 7-candidate ladder from Gate 2,
 *     unchanged.
 *   • `full-7-wall-capped`  — ace: full 7 PLUS cruise speed capped by wall
 *     distance (Gate-2 §2 ace).
 */
export type CandidateLadder = 'baseline-veto' | 'full-7' | 'full-7-wall-capped';

/**
 * Target-selection policy (design.md §4.10). Not a stat — a decision policy.
 *
 *   • `nearest`          — rookie: nearest enemy ship, `BodyId` tiebreak
 *     (FINDINGS §1c).
 *   • `threat-weighted`  — veteran: nearest, biased against high-HP targets.
 *   • `threat-map`       — ace: DPS proxy × survivability × angle-to-fire.
 */
export type TargetingPolicy = 'nearest' | 'threat-weighted' | 'threat-map';

/**
 * The tier's decision-quality knob set. Every field is a *decision-policy* knob;
 * there is no ship-stat, budget, or point-cost field here at any level. The
 * negative-space invariant (FR-30 / Custom Rule 4) forbids adding one, and a
 * unit test asserts that structurally.
 */
export interface TierConfig {
  /** Lookahead depth in beats — rookie 1, veteran 2, ace 3 (design.md §4.10). */
  readonly planningHorizon: 1 | 2 | 3;
  /**
   * Post-plan cruise speed as a fraction of the SHIP'S OWN `deltaVPerTurn` budget
   * (Gate-2 §1a — target a cruise VELOCITY, not an impulse; the load-bearing
   * FR-29 fix). Must be strictly `< 1` so one beat of brake can always fully halt
   * the ship — this is the brakeable-in-one-beat invariant.
   */
  readonly cruiseSpeedFraction: number;
  /** Which candidate ladder movement planning evaluates (Gate-2 §1b, §2). */
  readonly candidateLadder: CandidateLadder;
  /** Target-selection policy (design.md §4.10). */
  readonly targeting: TargetingPolicy;
  /**
   * FR-25 break-shields → kill-generator called-shot sequence. rookie `false`,
   * veteran and ace `true`.
   */
  readonly enableCalledShots: boolean;
  /**
   * FR-29 acceptance criterion "bots account for their own AoE friendly fire"
   * on missile assignment. ace only.
   */
  readonly enableAoeFriendlyFireCheck: boolean;
  /**
   * Gate-2 §2 ace: cruise speed capped by wall distance + predictive intercept
   * lead on target selection. ace only.
   */
  readonly enablePredictiveIntercept: boolean;
}

// PROMOTION SEAM — the tier NUMERICS. Each rests on Gate-2 §2 (cruise fractions)
// and design.md §4.10 (planning horizon) and could migrate to `tuning.json`
// later; for now they stay as module consts (Custom Rule 4 forbids adding tier
// fields to the catalog schema today).
const ROOKIE_CRUISE_SPEED_FRACTION = 0.5; //   Gate-2 §2 rookie: ≤ ½ budget.
const VETERAN_CRUISE_SPEED_FRACTION = 0.66; // Gate-2 §2 veteran: ~⅔ budget.
const ACE_CRUISE_SPEED_FRACTION = 0.85; //     Gate-2 §2 ace: closer to budget, still `< 1` (brakeable in one beat).

/**
 * The tier table. Single source of truth for what each difficulty CHANGES
 * (never how strong its ships are). Read via `TIER_CONFIG[tier]`; downstream
 * code must not synthesize alternate tables.
 */
export const TIER_CONFIG: Readonly<Record<BotTier, TierConfig>> = {
  rookie: {
    planningHorizon: 1,
    cruiseSpeedFraction: ROOKIE_CRUISE_SPEED_FRACTION,
    candidateLadder: 'baseline-veto',
    targeting: 'nearest',
    enableCalledShots: false,
    enableAoeFriendlyFireCheck: false,
    enablePredictiveIntercept: false,
  },
  veteran: {
    planningHorizon: 2,
    cruiseSpeedFraction: VETERAN_CRUISE_SPEED_FRACTION,
    candidateLadder: 'full-7',
    targeting: 'threat-weighted',
    enableCalledShots: true,
    enableAoeFriendlyFireCheck: false,
    enablePredictiveIntercept: false,
  },
  ace: {
    planningHorizon: 3,
    cruiseSpeedFraction: ACE_CRUISE_SPEED_FRACTION,
    candidateLadder: 'full-7-wall-capped',
    targeting: 'threat-map',
    enableCalledShots: true,
    enableAoeFriendlyFireCheck: true,
    enablePredictiveIntercept: true,
  },
} as const;
