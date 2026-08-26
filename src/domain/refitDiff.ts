// M05 Domain — refitDiff (FR-2 Ruling A, specs/database.md §3.3, specs/design.md §4.7).
//
// "Needs-refit" is COMPUTED, never stored (§3.3). A build carries a historical
// `storedCost` (§3.3 — the cost when it was authored); on load, the persist
// layer re-prices it against the CURRENT catalog and flags mismatches for the
// UI's `needs-refit` badge. This module is that computation.
//
// PRESENTATION CONTRACT (design §4.7): the UI shows "was N, now M, here's where
// your points live now". Because historical per-component prices are not stored
// (§3.3 keeps only the total `storedCost`), the per-slot `lines` carry CURRENT
// cost — the delta is total-vs-total, not line-vs-line.
//
// The boolean helper `needsRefit(build) = refitDiff(build) !== null` is
// COMPUTED, never persisted. The persist layer (F3) caches it in the encyclopedia
// index keyed by `pricedAtCatalogVersion`; it never lives on the Build record.
// Do NOT add a `needsRefit` field to `Build`.
//
// SHAPE DECISION: `RefitDiff` is declared HERE, not in ./types.ts. The barrel
// re-exports this declaration (types.ts is S02's lease and holds a placeholder
// stub only; see STATE.md Design Decisions).

import type { Catalog } from '../catalog/index.js';
import type { Build } from './types.js';
import { pointBreakdown, pointCost } from './pointCost.js';

/** One row of the refit breakdown — per slot, current cost against the current catalog. */
export interface RefitDiffLine {
  readonly index: number;
  readonly componentId: string | null;
  /** Cost this slot contributes NOW (historical per-slot prices are not stored — §3.3). */
  readonly currentCost: number;
}

/**
 * The refit summary the UI needs (§4.7). Returned by `refitDiff` when the
 * historical `storedCost` no longer matches current pricing; `null` otherwise.
 */
export interface RefitDiff {
  /** `build.storedCost` — the historical fact from when this build was authored. */
  readonly oldTotal: number;
  /** `pointCost(catalog, build)` against the CURRENT catalog. */
  readonly newTotal: number;
  /** `newTotal - oldTotal`. Positive → build now costs more; negative → less. */
  readonly delta: number;
  /** Per-slot current-cost lines the UI paints under "here's where your points are now". */
  readonly lines: readonly RefitDiffLine[];
}

/**
 * Re-price a Build against the current catalog and return the diff, or `null`
 * if the total is unchanged. Takes a raw `Build` (not `ValidatedBuild`) because
 * the load pipeline (§7.2) may need to surface a refit badge for a build that
 * still needs validation-repair — the badge is orthogonal to fit legality.
 *
 * The `lines` reuse `pointBreakdown` (S02) so `RefitDiffLine` structurally
 * matches `PointBreakdownSlot` at the position level, just re-labelled to make
 * the "these are CURRENT prices, not historical" intent explicit in the UI.
 */
export const refitDiff = (catalog: Catalog, build: Build): RefitDiff | null => {
  const newTotal = pointCost(catalog, build);
  if (newTotal === build.storedCost) return null;

  const breakdown = pointBreakdown(catalog, build);
  const lines: RefitDiffLine[] = breakdown.slotCosts.map((slot) => ({
    index: slot.index,
    componentId: slot.componentId,
    currentCost: slot.cost,
  }));

  return {
    oldTotal: build.storedCost,
    newTotal,
    delta: newTotal - build.storedCost,
    lines,
  };
};

/**
 * Convenience predicate — `true` when the build's stored cost no longer matches
 * the current catalog pricing. Computed every call; never cached on the Build.
 */
export const needsRefit = (catalog: Catalog, build: Build): boolean =>
  refitDiff(catalog, build) !== null;
