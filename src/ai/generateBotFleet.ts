// generateBotFleet — seeded, legal bot fleet assembly (M12, FR-31).
//
// Pure function of `(catalog, budget, tier, rngKey)` — same inputs ⇒ byte-
// identical `Build[]`. Every returned build is `validateFit`-legal (FR-4 /
// FR-31: "a bot could not build a ship the player couldn't build"),
// `Σ storedCost ≤ budget` (Decision 9 / FR-5 — under-budget is legal; leftover
// is wasted, there is no conversion field anywhere — Custom Rule 4), and the
// fleet is at most `tuning.match.fleetHullCap` ships long (FR-10, v1 = 20).
//
// The `tier` argument is a *variety* input only (D-TIER-FLEET in STATE.md /
// FR-29 / FR-30): swapping tiers redraws which legal fleet is built, never
// how strong the ships are. Every fleet is drawn from the ONE shared catalog
// at the same numeric budget; a bot cannot access ships or stats a player
// cannot. Tier mixes into the seed so different tiers see a different-but-
// equally-legal draw.
//
// This file lives inside `src/ai/**`, so the deterministic-core ban-list
// applies: every random draw goes through `mathx/rng` (`seedOf` / `hash` /
// `randInt`); no `Math.random`, no `Date`, no wall-clock, no npm imports.
//
// Identity fields on the returned Builds are SYNTHETIC — bot builds are never
// persisted, so the domain rule "identity is minted at the io/persist
// boundary" doesn't apply here. Instead the identity fields are minted
// DETERMINISTICALLY from `(budget, tier, rngKey, shipIndex)`:
//   • `id`             = `bot-{budget}-{tier}-{rngKey}-{shipIndex}` (stable — no UUID / no `Date`)
//   • `createdAt`      = `SYNTHETIC_TIMESTAMP` sentinel (never affects the sim; wall-clock banned here)
//   • `updatedAt`      = `SYNTHETIC_TIMESTAMP` sentinel
//   • `schemaVersion`  = 1                        (matches `io/migrate/migrations.CURRENT_SCHEMA_VERSION` today)
//   • `catalogVersion` = `catalog.catalogVersion` (source of truth on the catalog we drew from)
//   • `storedCost`     = `pointCost(catalog, build)` — the historical fact at this authoring instant (§3.3)
// The harness (S05) and `resolveFleet` (M05) re-run `validateFit` at the
// domain seam, so these synthetic ids never cross the persist boundary.

import type { Catalog, ChassisDef, ComponentDef } from '../catalog/index.js';
import {
  emptyBuild,
  pointCost,
  validateFit,
  withSlot,
  type Build,
  type BuildMeta,
} from '../domain/index.js';
import { hash, randInt, seedOf, type Seed } from '../sim/mathx/index.js';
import { BOT_TIERS, type BotTier } from './tiers.js';

// ---- Stream / sub-stream tags ---------------------------------------------
//
// A fixed uint32 stream root for every draw taken during bot-fleet
// construction — mirrors `createMatch.STREAM_PLACEMENT`. A distinct high-bit
// marker keeps bot-construction draws in their own coordinate corner of the
// RNG space so they cannot alias placement / planning / attack-time streams.
const STREAM_BOT_FLEET = 0xb07f1eef;

/** Sub-stream tag: chassis pick per ship. */
const SUB_CHASSIS = 0;
/** Sub-stream tag: slot fill per (ship, slot). */
const SUB_SLOT = 1;

// ---- Seed derivation ------------------------------------------------------

// Fixed base seed for mixing (`rngKey`, `tierIndex`) into the two halves of the
// per-fleet Seed. Mirrors `tools/balance/harnessScenarios.ts` — feeding an
// integer through `hash(BASE, ...)` twice (once per uint32 half of the Seed)
// uses the sim's own avalanche and inherits its frozen determinism story.
// Naive `seedOf(rngKey, ~rngKey ^ constant)` aliases across `rngKey` and
// `rngKey + 4` in the mixer.
const BOT_SEED_BASE = seedOf(0xa11ceb07, 0xf1eefbad);

/**
 * Derive a per-fleet `Seed` from `(rngKey, tier)`. `tier` is folded in as a
 * *variety* input only (D-TIER-FLEET) — never a stat / budget advantage. Two
 * different `rngKey`s at the same tier see different seeds; two different
 * tiers at the same `rngKey` see different seeds. Both properties keep the
 * draw honest.
 */
export const deriveFleetSeed = (rngKey: number, tier: BotTier): Seed => {
  const tierIndex = BOT_TIERS.indexOf(tier);
  return seedOf(
    hash(BOT_SEED_BASE, rngKey >>> 0, tierIndex >>> 0, 0xa),
    hash(BOT_SEED_BASE, rngKey >>> 0, tierIndex >>> 0, 0xb),
  );
};

// ---- Primitives (seeded selection) ----------------------------------------

/**
 * Seeded chassis pick, filtered by budget. Iterates `catalog.allChassis()`
 * (ordinal-sorted — deterministic enumeration) and picks by uniform index
 * among those whose `pointCost ≤ remainingBudget`. Returns `null` if nothing
 * fits — the caller uses that as the fleet-complete signal.
 */
export const pickChassis = (
  catalog: Catalog,
  seed: Seed,
  shipIndex: number,
  remainingBudget: number,
): ChassisDef | null => {
  const affordable: ChassisDef[] = [];
  for (const chassis of catalog.allChassis()) {
    if (chassis.pointCost <= remainingBudget) affordable.push(chassis);
  }
  if (affordable.length === 0) return null;
  const idx = randInt(
    seed,
    0,
    affordable.length,
    STREAM_BOT_FLEET,
    SUB_CHASSIS,
    shipIndex,
  );
  return affordable[idx] ?? null;
};

/**
 * Assemble slot fills for one ship, seededly, within `remainingBudget`. Each
 * slot offers `null` (empty is legal — FR-4) plus every
 * `componentsForSlot(type)` that still fits the running per-ship spend. Draws
 * use `(STREAM_BOT_FLEET, SUB_SLOT, shipIndex, slotIndex)` so ship *i*'s draws
 * never alias ship *j*'s.
 *
 * Returned array has the same length as the chassis's slot layout; each entry
 * is either a component id or `null` for empty.
 */
export const fillSlots = (
  catalog: Catalog,
  chassis: ChassisDef,
  seed: Seed,
  shipIndex: number,
  remainingBudget: number,
): (string | null)[] => {
  const layout = catalog.slotLayout(chassis.classId) ?? [];
  const slots: (string | null)[] = [];
  let remaining = remainingBudget;
  for (let slotIndex = 0; slotIndex < layout.length; slotIndex += 1) {
    const slotType = layout[slotIndex]!;
    // `null` at position 0 keeps the empty-slot option a first-class candidate
    // — every legal slot fit includes leaving the slot empty (FR-4).
    const candidates: (ComponentDef | null)[] = [null];
    for (const component of catalog.componentsForSlot(slotType)) {
      if (component.pointCost <= remaining) candidates.push(component);
    }
    const pickIdx = randInt(
      seed,
      0,
      candidates.length,
      STREAM_BOT_FLEET,
      SUB_SLOT,
      shipIndex,
      slotIndex,
    );
    const picked = candidates[pickIdx] ?? null;
    if (picked === null) {
      slots.push(null);
    } else {
      slots.push(picked.id);
      remaining -= picked.pointCost;
    }
  }
  return slots;
};

/**
 * Assemble one legal, priced ship inside `remainingBudget`. Returns the
 * priced `Build` (its `storedCost` = current `pointCost` — the historical
 * fact at this authoring instant, §3.3) and the cost the caller should
 * subtract from the fleet budget. Returns `null` iff no chassis fits — the
 * fleet-complete signal.
 *
 * The returned Build is guaranteed to pass `validateFit` — it is constructed
 * strictly from the catalog's own `slotLayout` / `componentsForSlot` output,
 * so a validation failure would signal a catalog-lock invariant break rather
 * than a bot decision; we surface that as `null` defensively.
 */
export const buildOneShip = (
  catalog: Catalog,
  seed: Seed,
  shipIndex: number,
  remainingBudget: number,
  meta: BuildMeta,
): { build: Build; cost: number } | null => {
  const chassis = pickChassis(catalog, seed, shipIndex, remainingBudget);
  if (chassis === null) return null;

  const empty = emptyBuild(catalog, chassis.id, `Bot ${chassis.name}`, meta);
  // Defensive: a chassis we just read out of the catalog must resolve.
  if (!empty.ok) return null;

  const perShipRemaining = remainingBudget - chassis.pointCost;
  const slots = fillSlots(catalog, chassis, seed, shipIndex, perShipRemaining);

  let build = empty.value;
  for (let i = 0; i < slots.length; i += 1) {
    const componentId = slots[i] ?? null;
    if (componentId !== null) build = withSlot(build, i, componentId);
  }

  const cost = pointCost(catalog, build);
  const priced: Build = { ...build, storedCost: cost };

  const validated = validateFit(catalog, priced);
  if (!validated.ok) return null;
  return { build: priced, cost };
};
