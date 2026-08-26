// M05 Domain — point cost + breakdown (FR-5, specs/database.md §3.2).
//
// `pointCost` is the running total the Shipyard displays and the number
// `refitDiff` (S03) re-prices against. `pointBreakdown` returns the per-slot
// contribution S03 reuses for the diff-per-line UI.
//
// Explicitly ABSENT surface: no `leftoverPoints`, no `remaining`, no
// `pointsBanked`, no conversion of "unspent" points into anything. The Shipyard
// displays the spend; budget-vs-spend comparison is Skirmish setup's job
// (FR-10), not domain's. Absence is the enforcement (Decision 9 / FR-5).
//
// Ordering note: in the load pipeline (specs/database.md §7.2), pricing runs
// AFTER validation — resolving FKs before checking they resolve is what the
// pipeline order forbids. `pointCost` therefore may assume all ids in `slots`
// resolve, but under `noUncheckedIndexedAccess` we still handle the missing
// case defensively: it is a GUARD (a programming error path), not a feature.

import type { Catalog } from '../catalog/index.js';
import type { Build, PointBreakdown, PointBreakdownSlot } from './types.js';

/**
 * Chassis cost + sum of fitted component costs (FR-5).
 * Empty slots contribute `0`. Unknown ids contribute `0` and are silently
 * dropped — the pipeline never prices an unvalidated build, so this path is a
 * defensive guard against a caller bug, not a supported code path.
 */
export const pointCost = (catalog: Catalog, build: Build): number => {
  const chassis = catalog.chassis(build.chassisId);
  const chassisCost = chassis?.pointCost ?? 0;

  let sum = chassisCost;
  for (const componentId of build.slots) {
    if (componentId === null) continue;
    const component = catalog.component(componentId);
    if (component === undefined) continue;
    sum += component.pointCost;
  }
  return sum;
};

/**
 * Per-slot breakdown of the current cost. `total === pointCost(catalog, build)`
 * by construction — the two are the same computation, one keeps the per-slot
 * lines that S03's `refitDiff` reuses.
 */
export const pointBreakdown = (catalog: Catalog, build: Build): PointBreakdown => {
  const chassis = catalog.chassis(build.chassisId);
  const chassisCost = chassis?.pointCost ?? 0;

  const slotCosts: PointBreakdownSlot[] = [];
  let componentSum = 0;
  for (let index = 0; index < build.slots.length; index += 1) {
    const componentId = build.slots[index] ?? null;
    if (componentId === null) {
      slotCosts.push({ index, componentId: null, cost: 0 });
      continue;
    }
    const component = catalog.component(componentId);
    const cost = component?.pointCost ?? 0;
    componentSum += cost;
    slotCosts.push({ index, componentId, cost });
  }

  return {
    chassisCost,
    slotCosts,
    total: chassisCost + componentSum,
  };
};
