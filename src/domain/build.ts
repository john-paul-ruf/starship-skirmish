// M05 Domain — Build constructors (specs/database.md §3.2).
//
// Pure, immutable builders that shape a `Build` against the catalog's frozen
// per-class slot layout. These helpers do NOT decide legality — that is
// `validateFit`'s job. `emptyBuild` refuses an unknown chassis (any other
// chassis lookup downstream would silently break); `withSlot` guards against
// out-of-bounds index (which would be a caller bug the UI must catch, not a
// fit-legality question).

import type { Catalog, ChassisDef, SlotType } from '../catalog/index.js';
import type { Build, BuildMeta, FitError, Result } from './types.js';

// Function declaration (not an arrow) so TypeScript control-flow narrows past
// the guard — see the S01 handoff note. Only used for genuine caller bugs
// (out-of-range slot index); legality errors go through Result<_, FitError>.
function fail(message: string): never {
  throw new RangeError(message);
}

const unknownChassis = (id: string): FitError => ({
  code: 'ERR_UNKNOWN_CHASSIS',
  id,
  message: `Unknown chassis id "${id}".`,
});

const unknownClass = (chassis: ChassisDef): FitError => ({
  code: 'ERR_UNKNOWN_CLASS',
  id: chassis.classId,
  message: `Chassis "${chassis.id}" declares class "${chassis.classId}" which is not in the catalog.`,
});

/**
 * Build an all-empty Build for the given chassis. Slot count comes from the
 * catalog's frozen class layout (`slotLayout(classId)`, FR-3); every slot is
 * `null` (empty is legal — FR-4). `storedCost` seeds to `pointCost(empty)` =
 * chassis cost only, which is the correct historical fact at this instant.
 *
 * Returns `ERR_UNKNOWN_CHASSIS` if the id doesn't resolve, or `ERR_UNKNOWN_CLASS`
 * if the chassis's declared class isn't in the catalog (a lock invariant
 * should prevent this, but domain validates defensively — the catalog is
 * trusted, not proven trustworthy at every call site).
 */
export const emptyBuild = (
  catalog: Catalog,
  chassisId: string,
  name: string,
  meta: BuildMeta,
  tags: readonly string[] = [],
): Result<Build, FitError> => {
  const chassis = catalog.chassis(chassisId);
  if (chassis === undefined) return { ok: false, error: unknownChassis(chassisId) };

  const layout = catalog.slotLayout(chassis.classId);
  if (layout === undefined) return { ok: false, error: unknownClass(chassis) };

  const slots: readonly (string | null)[] = Object.freeze(
    Array.from({ length: layout.length }, () => null),
  );

  const build: Build = {
    id: meta.id,
    name,
    tags: Object.freeze([...tags]),
    chassisId: chassis.id,
    slots,
    // Chassis-only cost — storedCost is the historical fact at authoring (§3.3).
    storedCost: chassis.pointCost,
    schemaVersion: meta.schemaVersion,
    catalogVersion: meta.catalogVersion,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };

  return { ok: true, value: build };
};

/**
 * Immutable slot set. Returns a new `Build` with slot `index` replaced. This
 * setter deliberately does NOT enforce slot-type legality — that is
 * `validateFit`'s job (a silent-reject setter would hide a UI bug the fitter
 * must surface). It DOES guard `index` against `slots.length` because an
 * out-of-range write is a caller bug, not a fit-legality question.
 *
 * `pointCost` is not recomputed here — `storedCost` is a historical fact
 * (§3.3), and current cost is derived on demand.
 */
export const withSlot = (
  build: Build,
  index: number,
  componentId: string | null,
): Build => {
  if (!Number.isInteger(index) || index < 0 || index >= build.slots.length) {
    fail(
      `withSlot: index ${index} out of range for chassis "${build.chassisId}" (slots.length = ${build.slots.length}).`,
    );
  }

  const next = build.slots.slice();
  next[index] = componentId;

  return {
    ...build,
    slots: Object.freeze(next),
  };
};

/**
 * Convenience: the frozen slot-type layout for this build's chassis class.
 * Used by the Shipyard UI's slot-picker (to filter fittable components) and
 * by `validateFit` (to compare per-slot component type against the layout).
 * Returns an empty array if the chassis or class isn't in the catalog — a
 * defensive fallback; the real error is surfaced by `validateFit`.
 */
export const slotTypesFor = (
  catalog: Catalog,
  build: Build,
): readonly SlotType[] => {
  const chassis = catalog.chassis(build.chassisId);
  if (chassis === undefined) return [];
  return catalog.slotLayout(chassis.classId) ?? [];
};
