// M05 Domain — validateFit (FR-4, specs/database.md §3.2).
//
// The fit-legality gate. Every downstream that must not be handed a broken
// Build (S03 `derivedStats` / `resolveFleet`, F3 io load pipeline §7.2, F5 ai
// bot fleet construction FR-31) goes through here first. `ValidatedBuild` is
// the nominal receipt those consumers require, so "priced/resolved an
// unvalidated build" is a compile-time error, not a runtime hope.
//
// Collects ALL violations, not first-fail — the Shipyard surfaces every problem
// at once (FR-5: "Invalid fits are prevented at the point of interaction, not
// reported after the fact"; the multi-error list is how the UI paints every
// bad slot simultaneously).
//
// Ordered so a caller that gets ERR_UNKNOWN_CHASSIS or ERR_UNKNOWN_CLASS knows
// the chassis+layout are unresolvable — the per-slot checks would have nothing
// meaningful to say, so we return early there. Everything else is collected.
//
// Explicitly OUT OF SCOPE: name/tag length caps. Those are cross-format
// constraints living in `src/io/limits.ts` (F3) — the io/persist boundary is
// where they belong, not the fit gate.

import type { Catalog, SlotType } from '../catalog/index.js';
import type { Build, FitError, Result, ValidatedBuild } from './types.js';

const unknownChassis = (id: string): FitError => ({
  code: 'ERR_UNKNOWN_CHASSIS',
  id,
  message: `Unknown chassis id "${id}".`,
});

const unknownClass = (classId: string, chassisId: string): FitError => ({
  code: 'ERR_UNKNOWN_CLASS',
  id: classId,
  message: `Chassis "${chassisId}" declares class "${classId}" which is not in the catalog.`,
});

const slotCountMismatch = (actual: number, expected: number, chassisId: string): FitError => ({
  code: 'ERR_SLOT_COUNT',
  message: `Build for "${chassisId}" has ${actual} slot(s); the class layout has ${expected}.`,
});

const unknownComponent = (id: string, slotIndex: number): FitError => ({
  code: 'ERR_UNKNOWN_COMPONENT',
  id,
  slotIndex,
  message: `Unknown component id "${id}" at slot ${slotIndex}.`,
});

const slotTypeMismatch = (
  slotIndex: number,
  id: string,
  expected: SlotType,
  actual: SlotType,
): FitError => ({
  code: 'ERR_SLOT_TYPE_MISMATCH',
  id,
  slotIndex,
  expected,
  actual,
  message: `Component "${id}" is a ${actual} but slot ${slotIndex} is a ${expected}.`,
});

/**
 * Fit-only legality gate for a Build against the current catalog (FR-4).
 * Collects every violation. Returns a `ValidatedBuild` on success — the
 * nominal receipt S03's `derivedStats` / `resolveFleet` require.
 *
 * Rules enforced (specs/database.md §3.2):
 *   1. `chassisId` resolves and its `classId` is in the catalog.
 *   2. `slots.length === slotLayout(classId).length`.
 *   3. For each slot: `null` is legal; a string must resolve AND its
 *      `slotType` must equal the layout type at that index.
 *
 * Not enforced here (deliberately): name/tag caps (F3 `io/limits.ts`),
 * uniqueness of tag entries (F3), NFC normalisation (F3).
 */
export const validateFit = (
  catalog: Catalog,
  build: Build,
): Result<ValidatedBuild, readonly FitError[]> => {
  const errors: FitError[] = [];

  const chassis = catalog.chassis(build.chassisId);
  if (chassis === undefined) {
    // No chassis → no layout → per-slot checks are meaningless. Return only this.
    return { ok: false, error: [unknownChassis(build.chassisId)] };
  }

  const layout = catalog.slotLayout(chassis.classId);
  if (layout === undefined) {
    return { ok: false, error: [unknownClass(chassis.classId, chassis.id)] };
  }

  if (build.slots.length !== layout.length) {
    errors.push(slotCountMismatch(build.slots.length, layout.length, chassis.id));
  }

  // Check every slot in the OVERLAPPING region between the fit and the layout.
  // A slot-count mismatch is already reported; extra fit slots are folded into
  // that error rather than getting their own per-index message (the UI shows
  // "wrong number of slots" once, not once per surplus).
  const overlap = Math.min(build.slots.length, layout.length);
  for (let i = 0; i < overlap; i += 1) {
    const componentId = build.slots[i] ?? null;
    const expected = layout[i];
    if (componentId === null || expected === undefined) continue;
    const component = catalog.component(componentId);
    if (component === undefined) {
      errors.push(unknownComponent(componentId, i));
      continue;
    }
    if (component.slotType !== expected) {
      errors.push(slotTypeMismatch(i, componentId, expected, component.slotType));
    }
  }

  if (errors.length > 0) return { ok: false, error: errors };
  return { ok: true, value: { build, _validated: true } };
};
