// M14 UI — Skirmish Setup model (S04).
//
// The pure logic layer of the Skirmish Setup screen. `SkirmishSetup.tsx` and
// its panel subtree own the signals + rendering; every derivation — budget
// selection, player-fleet cost roll-up, over/under classification, bot-spec
// list, launch gating, and the `startMatch` payload — lives HERE so it is
// exercised in the node-env unit tests (vitest is node-only per the feature's
// test-env reality; no DOM harness).
//
// THE SCREEN COMPUTES NOTHING (S04 review gate): cost + legality go through
// `domain` (`validateFit` / `pointCost`), bot fleets through `ai`
// (`generateBotFleet`), and the arena through `domain.resolveArena`. This file
// only gathers selections and forwards them — the same discipline that keeps
// player builds provably fair against bots (FR-31, both pass one `validateFit`).
//
// Author-note (tsconfig.node JSX trap, inherited from S05 shipyard/model.ts):
// this file stays `.ts` so unit tests importing it never pull a `.tsx` source
// through `tsc --noEmit -p tsconfig.node.json`. The panels under `./` are
// `.tsx`; tests must NOT import them.

import type { Catalog } from '../../../catalog/index.js';
import type { Build } from '../../../domain/index.js';
import { pointCost, resolveArena, validateFit } from '../../../domain/index.js';
import type { IndexEntry, LibraryRepo } from '../../../persist/index.js';
import { TIER_CONFIG, generateBotFleet, type BotTier } from '../../../ai/index.js';
import type { BotSpec, MatchSetup } from '../../matchContext.js';

// ---- Setup state ----------------------------------------------------------

/**
 * The whole editable state of the setup screen. `seed` is a DISPLAY-ONLY
 * preview value (§4.11) — the authoritative match seed is minted app-side by
 * `startMatch` (`crypto.getRandomValues` lives in `app/match`, arch §7.2), so
 * `MatchSetup` deliberately carries no seed field. Rerolling here refreshes the
 * preview label only; it is not the seed the sim runs on. See `formatSeedLabel`.
 */
export interface SetupState {
  readonly budget: number;
  /** Player fleet (fleetId 0). Duplicates allowed — Flow 2. */
  readonly playerBuilds: readonly Build[];
  /** One entry per opposition fleet (fleetId 1..N), in display order. */
  readonly bots: readonly BotSpec[];
  /** Preview seed value (48-bit); display only. */
  readonly seed: number;
}

/** Over/under/exact classification of a player draft against its budget. */
export type BudgetStatus = 'under' | 'exact' | 'over';

// ---- Construction ---------------------------------------------------------

/** The legal match budgets (`tuning.match.legalBudgets`, v1 = 25..150). */
export const legalBudgets = (catalog: Catalog): readonly number[] =>
  catalog.tuning.match.legalBudgets;

/**
 * The default budget the screen opens on — `100` when it is a legal budget
 * (the mock's default), else the first declared legal budget. A catalog with
 * no legal budgets is a lock violation caught upstream; we fall back to `0`
 * defensively so this pure helper never throws.
 */
export const defaultBudget = (catalog: Catalog): number => {
  const budgets = legalBudgets(catalog);
  if (budgets.includes(100)) return 100;
  return budgets[0] ?? 0;
};

/**
 * A fresh setup state: default budget, an empty player fleet, a single ROOKIE
 * opponent (the minimum, `tuning.match.minBots`), and the supplied preview
 * seed. The screen mints a real preview seed at first paint and passes it in.
 */
export const initialSetupState = (catalog: Catalog, seed = 0): SetupState => ({
  budget: defaultBudget(catalog),
  playerBuilds: [],
  bots: [{ tier: 'rookie', rngKey: 0 }],
  seed,
});

// ---- Budget + player-fleet roll-up ----------------------------------------

/**
 * The player fleet's live cost — `Σ pointCost(catalog, build)`. Priced through
 * domain against the CURRENT catalog, never summed from the stored historical
 * `storedCost` (§3.3): the screen computes no cost of its own.
 */
export const playerFleetCost = (state: SetupState, catalog: Catalog): number => {
  let total = 0;
  for (const build of state.playerBuilds) total += pointCost(catalog, build);
  return total;
};

/** Budget minus live fleet cost. Negative ⇒ over budget. */
export const remainingPoints = (state: SetupState, catalog: Catalog): number =>
  state.budget - playerFleetCost(state, catalog);

/** Over/under/exact classification (§4.4). Only `over` blocks launch. */
export const budgetStatus = (state: SetupState, catalog: Catalog): BudgetStatus => {
  const remaining = remainingPoints(state, catalog);
  if (remaining < 0) return 'over';
  if (remaining === 0) return 'exact';
  return 'under';
};

// ---- Draft operations (immutable) -----------------------------------------

/**
 * Select a budget. Illegal budgets are ignored (the segmented control only
 * offers legal ones; this guards a programmatic call). Changing the budget
 * does NOT touch the player fleet — the screen re-rolls bots + arena off the
 * new budget in its own render.
 */
export const setBudget = (state: SetupState, catalog: Catalog, budget: number): SetupState =>
  legalBudgets(catalog).includes(budget) ? { ...state, budget } : state;

/** Append a build to the player fleet (duplicates allowed — Flow 2). */
export const addToDraft = (state: SetupState, build: Build): SetupState => ({
  ...state,
  playerBuilds: [...state.playerBuilds, build],
});

/** Remove the build at `index`. Out-of-range index is a no-op. */
export const removeFromDraft = (state: SetupState, index: number): SetupState => {
  if (index < 0 || index >= state.playerBuilds.length) return state;
  const next = state.playerBuilds.filter((_, i) => i !== index);
  return { ...state, playerBuilds: next };
};

/** Duplicate the build at `index` (a second copy of the same design). No-op if out of range. */
export const duplicateInDraft = (state: SetupState, index: number): SetupState => {
  const build = state.playerBuilds[index];
  if (build === undefined) return state;
  const next = [...state.playerBuilds];
  next.splice(index + 1, 0, build);
  return { ...state, playerBuilds: next };
};

/**
 * Encyclopedia builds eligible to draft: every index entry whose CURRENT fit is
 * legal (`status === 'ok'` ⇒ the record passed the validate pipeline). A
 * `needs-refit` build whose current cost is legal is still draftable (§4.7); a
 * `failed` entry (unparseable / illegal fit) is not. Ordered highest-cost-first
 * to mirror the mock's points sort. Budget affordability is a PER-ROW affordance
 * (see `draftAffordable`), not an eligibility filter — over-budget builds still
 * appear, greyed, exactly as the mock shows.
 */
export const eligibleForDraft = (repo: LibraryRepo): readonly IndexEntry[] =>
  repo
    .entries()
    .filter((e) => e.status === 'ok')
    .slice()
    .sort((a, b) => b.currentCost - a.currentCost || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

/** Whether a source build fits the remaining budget (drives the +Add affordance). */
export const draftAffordable = (
  entry: IndexEntry,
  state: SetupState,
  catalog: Catalog,
): boolean => entry.currentCost <= remainingPoints(state, catalog);

// ---- Standard Fleet (draft source) ----------------------------------------
//
// A prebuilt roster the player can draft from — the answer to "an empty
// Encyclopedia leaves the player with nothing to field". The fleet is
// GENERATED (not a curated data file) by feeding a FIXED `rngKey` into
// `generateBotFleet`: legal by construction (FR-4 / FR-31), budget-scaled for
// free, and identical across visits (so the player picks from a consistent
// roster). No new catalog data, no ordinal-lock surface, no bot stat edge —
// the SAME `generateBotFleet` bots use (Custom Rule 4 / FR-30).
//
// Save-to-Encyclopedia (SkirmishSetup) mints a fresh identity so the copy is
// independently editable — see the screen's `onSaveStandard`.

/** Which pool the draft source panel is showing. */
export type DraftSource = 'library' | 'standard';

/**
 * A stable, prebuilt "standard fleet" for the current budget. Generated (not a
 * curated data file) so it is legal by construction (FR-31) and budget-scaled
 * for free. The key is FIXED, so the same budget always yields the same ships —
 * the player picks from a consistent roster across visits.
 */
const STANDARD_FLEET_KEY = 0x5741; // stable; any fixed value — do NOT derive from time/random
export const standardFleet = (catalog: Catalog, budget: number): readonly Build[] =>
  generateBotFleet(catalog, budget, 'veteran', STANDARD_FLEET_KEY);

/** Whether a standard-fleet build fits the remaining budget (drives ＋ Add). */
export const standardAffordable = (
  build: Build,
  state: SetupState,
  catalog: Catalog,
): boolean => pointCost(catalog, build) <= remainingPoints(state, catalog);

// ---- Opposition -----------------------------------------------------------

/** Add one opponent (clamped to `tuning.match.maxBots`). New bots start ROOKIE. */
export const addBot = (state: SetupState, catalog: Catalog): SetupState => {
  if (state.bots.length >= catalog.tuning.match.maxBots) return state;
  const rngKey = nextRngKey(state.bots);
  return { ...state, bots: [...state.bots, { tier: 'rookie', rngKey }] };
};

/** Remove the last opponent (clamped to `tuning.match.minBots`). */
export const removeBot = (state: SetupState, catalog: Catalog): SetupState => {
  if (state.bots.length <= catalog.tuning.match.minBots) return state;
  return { ...state, bots: state.bots.slice(0, -1) };
};

/**
 * Grow or shrink the opponent list to `count` (clamped to `[minBots, maxBots]`),
 * appending ROOKIE opponents or dropping trailing ones. Existing opponents keep
 * their tier + `rngKey` — the segmented count control never re-rolls the fleets
 * it leaves in place.
 */
export const setBotCount = (state: SetupState, catalog: Catalog, count: number): SetupState => {
  const { minBots, maxBots } = catalog.tuning.match;
  const target = Math.max(minBots, Math.min(maxBots, Math.trunc(count)));
  let next = state;
  while (next.bots.length < target) next = addBot(next, catalog);
  while (next.bots.length > target) next = removeBot(next, catalog);
  return next;
};

/** Set opponent `index`'s difficulty tier. No-op if out of range. */
export const setBotTier = (state: SetupState, index: number, tier: BotTier): SetupState => {
  const spec = state.bots[index];
  if (spec === undefined) return state;
  const next = [...state.bots];
  next[index] = { tier: spec.tier === tier ? spec.tier : tier, rngKey: spec.rngKey };
  return { ...state, bots: next };
};

/** Reroll opponent `index`'s fleet by bumping its `rngKey` (redraws a new legal fleet). */
export const rerollBot = (state: SetupState, index: number): SetupState => {
  const spec = state.bots[index];
  if (spec === undefined) return state;
  const next = [...state.bots];
  next[index] = { tier: spec.tier, rngKey: spec.rngKey + 1 };
  return { ...state, bots: next };
};

/** A fresh `rngKey` that does not collide with any current opponent's. */
const nextRngKey = (bots: readonly BotSpec[]): number => {
  let max = -1;
  for (const b of bots) if (b.rngKey > max) max = b.rngKey;
  return max + 1;
};

// ---- Tier brief (§4.10 — decision quality ONLY) ---------------------------
//
// The player-facing "what this tier changes" line. The horizon count is sourced
// from `TIER_CONFIG[tier].planningHorizon` so it cannot drift from the engine's
// actual lookahead; the targeting + behaviour phrases are the §4.10 wording
// verbatim. EVERY phrase is decision-quality — never a stat, point discount, or
// exclusive hull (Custom Rule 4 / FR-30; those fields do not exist to render).

const TIER_PHRASES: Readonly<Record<BotTier, { readonly targeting: string; readonly behaviour: string }>> = {
  rookie: { targeting: 'NEAREST-TARGET PRIORITY', behaviour: 'NO EVASION MODELLING' },
  veteran: {
    targeting: 'THREAT-WEIGHTED TARGETING',
    behaviour: 'BREAKS SHIELDS THEN KILLS THE GENERATOR',
  },
  ace: { targeting: 'PREDICTIVE INTERCEPTS', behaviour: 'WILLING TO OVERBURN AND TO RAM' },
};

/**
 * The §4.10 tier line, e.g. `2-TURN HORIZON · THREAT-WEIGHTED TARGETING ·
 * BREAKS SHIELDS THEN KILLS THE GENERATOR`. Horizon is read from `TIER_CONFIG`;
 * the rest is authored §4.10 wording. Unit tests assert the exact strings.
 */
export const tierBrief = (tier: BotTier): string => {
  const { planningHorizon } = TIER_CONFIG[tier];
  const { targeting, behaviour } = TIER_PHRASES[tier];
  return `${String(planningHorizon)}-TURN HORIZON · ${targeting} · ${behaviour}`;
};

// ---- Arena readout --------------------------------------------------------

export interface ArenaReadout {
  readonly radius: number;
  readonly fleetCount: number;
}

/**
 * Arena radius (from budget, via `domain.resolveArena` — Ruling C) plus the
 * number of fleets on the field (player + bots). The screen renders no arena
 * math of its own.
 */
export const arenaReadout = (state: SetupState, catalog: Catalog): ArenaReadout => ({
  radius: resolveArena(catalog.tuning, state.budget).radius,
  fleetCount: state.bots.length + 1,
});

// ---- Seed label (§4.11) ---------------------------------------------------

/**
 * Format a 48-bit preview seed as the `SK-XXXX-XXXX-XXXX` label the mock shows.
 * Pure — the random 48-bit value is minted by the screen (`crypto`) and passed
 * in, so this stays unit-testable in the node env.
 */
export const formatSeedLabel = (seed: number): string => {
  const clamped = Math.abs(Math.trunc(seed)) % 0x1000000000000;
  const hex = clamped.toString(16).toUpperCase().padStart(12, '0').slice(-12);
  return `SK-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
};

/** Set the preview seed (reroll). */
export const setSeed = (state: SetupState, seed: number): SetupState => ({ ...state, seed });

// ---- Launch gating (§4.4 corollary, §4.3) ---------------------------------

/** Whether every player build passes `validateFit` against the current catalog. */
export const allPlayerBuildsLegal = (state: SetupState, catalog: Catalog): boolean =>
  state.playerBuilds.every((b) => validateFit(catalog, b).ok);

/** Whether the opponent count is inside `[minBots, maxBots]`. */
export const botCountLegal = (state: SetupState, catalog: Catalog): boolean => {
  const { minBots, maxBots } = catalog.tuning.match;
  return state.bots.length >= minBots && state.bots.length <= maxBots;
};

/**
 * The §4.4 corollary gate: LAUNCH is enabled iff there is at least one player
 * ship, every player build is legal, the fleet is not over budget (under-budget
 * CAN launch — leftover points are wasted, §4.4), and the opponent count is
 * legal. `launchBlockReason` gives the single reason a disabled LAUNCH shows.
 */
export const canLaunch = (state: SetupState, catalog: Catalog): boolean =>
  state.playerBuilds.length >= 1 &&
  allPlayerBuildsLegal(state, catalog) &&
  budgetStatus(state, catalog) !== 'over' &&
  botCountLegal(state, catalog);

/**
 * The reason a disabled LAUNCH renders about itself (design §4.3 — a disabled
 * button that does not explain itself is a bug). `null` when launch is enabled.
 * Order mirrors the gate: ship count → legality → budget → opponents.
 */
export const launchBlockReason = (state: SetupState, catalog: Catalog): string | null => {
  if (state.playerBuilds.length < 1) return 'ADD AT LEAST ONE SHIP';
  if (!allPlayerBuildsLegal(state, catalog)) return 'A DRAFTED SHIP IS NO LONGER LEGAL';
  if (budgetStatus(state, catalog) === 'over') {
    const over = -remainingPoints(state, catalog);
    return `OVER BUDGET (+${String(over)})`;
  }
  if (!botCountLegal(state, catalog)) {
    const { minBots, maxBots } = catalog.tuning.match;
    return `NEED ${String(minBots)}–${String(maxBots)} OPPONENTS`;
  }
  return null;
};

// ---- startMatch payload ---------------------------------------------------

/**
 * Assemble the `MatchSetup` the screen hands `services.startMatch` at LAUNCH.
 * High-level by design (matchContext.ts): the app side mints the seed,
 * validates + resolves the player builds, and generates + resolves the bots.
 */
export const toMatchSetup = (state: SetupState): MatchSetup => ({
  budget: state.budget,
  playerBuilds: state.playerBuilds,
  botSpecs: state.bots,
});
