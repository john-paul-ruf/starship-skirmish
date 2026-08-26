// M05 Domain — public surface (architecture §4).
//
// Everything downstream needs from domain to build/validate/price/derive/refit/
// resolve a Build. Downstream (io, persist, ai, ui) imports from THIS barrel;
// individual files stay internal.
//
// SHAPE NOTE: this file DELIBERATELY re-exports S02's `./types.js` selectively
// (not `export *`) because `DerivedStats` / `RefitDiff` are declared as
// `{_s03Placeholder?: never}` stubs there — the REAL shapes live in
// `./derivedStats.ts` / `./refitDiff.ts` and are exported below. A blanket
// `export * from './types.js'` would name-collide with those real declarations;
// listing S02's public types explicitly is the intentional filter.

// ---- S02 types (excluding S03 placeholders) --------------------------------
export type {
  Result,
  Build,
  BuildMeta,
  PointBreakdown,
  PointBreakdownSlot,
  FitCode,
  FitError,
  DomainError,
  ValidatedBuild,
} from './types.js';

// ---- S02 functions ---------------------------------------------------------
export { emptyBuild, withSlot, slotTypesFor } from './build.js';
export { pointCost, pointBreakdown } from './pointCost.js';
export { validateFit } from './validateFit.js';

// ---- S03 derive/refit/resolve — real shapes + functions --------------------
export type { DerivedStats, SimWeaponReadout } from './derivedStats.js';
export { derivedStats } from './derivedStats.js';
export type { RefitDiff, RefitDiffLine } from './refitDiff.js';
export { refitDiff, needsRefit } from './refitDiff.js';
export {
  resolveShip,
  resolveFleet,
  resolveArena,
  physicsConfigFromTuning,
} from './resolveFleet.js';
