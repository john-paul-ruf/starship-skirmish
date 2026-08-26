// M05 Domain — public types (architecture §4, specs/database.md §3.2 / §3.3).
//
// The durable `Build` struct — string-FK positional slots against the catalog.
// The `Result<T, E>` return convention used everywhere the boundary is untrusted
// (a caller may hand us a Build shape that fails validation — we return an error
// value, we do not throw). The `FitError` codes surface every legality gap for
// the Shipyard UI so a bad fit shows every problem at once (FR-4 / FR-5).
//
// The `DerivedStats` and `RefitDiff` shapes are DECLARED here so both this
// session (S02) and the next (S03) agree on the type without S03 having to edit
// this file. Their implementations live in S03 modules.
//
// Deliberately absent — the spec forbids them and the enforcement is absence:
//   * no `leftoverPoints` / `pointsBanked` / `conversionRate` on `Build` or
//     `PointBreakdown` (Decision 9 / FR-5 / specs/database.md §3.2)
//   * no `needsRefit` field on `Build` (derived on load, never stored — §3.3)
//   * no `currentCost` / `derivedStats` cached on `Build` (§3.2)

import type { SlotType } from '../catalog/index.js';

// ---- The core Result convention -------------------------------------------

/**
 * Discriminated Result — succeed with a value or fail with a typed error. Used
 * for every domain function that can be called with caller-constructed input
 * (e.g. `emptyBuild` given an unknown chassis id, `validateFit` given a fit
 * that doesn't match the layout). Domain never throws across its public API.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

// ---- The durable Build struct (specs/database.md §3.2) --------------------

/**
 * A player-authored ship design. String FKs into the catalog; slot layout is
 * positional against `catalog.slotLayout(catalog.chassis(chassisId).classId)`.
 *
 * `id`, `createdAt`, `updatedAt` are minted at the persist/io boundary — domain
 * treats them as opaque strings it carries through. `storedCost` is a
 * historical fact (§3.3): the cost the build had when it was authored, never
 * silently recomputed in place.
 */
export interface Build {
  /** UUIDv4 — local identity. Minted outside domain (persist/io). */
  readonly id: string;
  /** Display name, `1..48` after NFC-trim. Length is enforced by io/limits (F3). */
  readonly name: string;
  /** `≤ 8` unique kebab tags, sorted. Length enforced by io/limits (F3). */
  readonly tags: readonly string[];
  /** FK → catalog chassis id. */
  readonly chassisId: string;
  /**
   * Positional slots — `slots.length === slotLayout(classOf(chassisId)).length`
   * and each non-null entry is an FK to a component of the matching slot type.
   * `null` = empty slot, legal (FR-4).
   */
  readonly slots: readonly (string | null)[];
  /** Cost at authoring time (§3.3). Never silently rewritten. */
  readonly storedCost: number;
  readonly schemaVersion: number;
  readonly catalogVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Identity/version fields the caller (persist/io/UI) supplies when constructing
 * a fresh `Build`. Domain does not touch the wall clock, does not mint UUIDs,
 * and does not decide the schema/catalog version this Build claims — those come
 * from the boundary above (§3.2 / §3.3).
 */
export interface BuildMeta {
  readonly id: string;
  readonly schemaVersion: number;
  readonly catalogVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---- Derived-stats + refit-diff shapes (implemented in S03) ---------------

/**
 * S03 fills this in — FR-6 readout. Declared here so S02 files that carry it
 * through (types-only) agree with S03 on shape without a mutual edit.
 *
 * Planned fields (S03): `totalMass`, `maxHull`, `shieldCapacity`,
 * `shieldRegenPerTurn`, `deltaVPerTurn`, `effectiveAcceleration`,
 * `totalMissileAmmo`, `baseEvasion`, `perTurnHullRepair`,
 * `weapons: readonly SimWeaponReadout[]`.
 */
export interface DerivedStats {
  readonly _s03Placeholder?: never;
}

/**
 * S03 fills this in — `specs/database.md` §3.3 `needs-refit` diff. Declared
 * here so anyone importing the type-shape name from `types.ts` gets a stable
 * reference. Planned fields (S03): `oldTotal`, `newTotal`, `delta`,
 * `lines: per-slot current cost`.
 */
export interface RefitDiff {
  readonly _s03Placeholder?: never;
}

// ---- Point-cost breakdown (returned by pointBreakdown) --------------------

/**
 * The per-slot breakdown of a Build's current point cost against the catalog.
 * S03's `refitDiff` reuses the shape (per-slot old vs new). Deliberately does
 * NOT surface any leftover / conversion field (FR-5 / §3.2).
 */
export interface PointBreakdown {
  readonly chassisCost: number;
  readonly slotCosts: readonly PointBreakdownSlot[];
  readonly total: number;
}

export interface PointBreakdownSlot {
  readonly index: number;
  readonly componentId: string | null;
  /** Per-slot point cost. Empty slots contribute 0. */
  readonly cost: number;
}

// ---- FitError — the codes validateFit surfaces (FR-4) ---------------------

export type FitCode =
  | 'ERR_UNKNOWN_CHASSIS'
  | 'ERR_UNKNOWN_CLASS'
  | 'ERR_SLOT_COUNT'
  | 'ERR_UNKNOWN_COMPONENT'
  | 'ERR_SLOT_TYPE_MISMATCH';

/**
 * One violation. `slotIndex` and `id` are populated when they apply — the
 * Shipyard UI uses them to point at the exact slot (FR-4 / FR-5). `expected`
 * and `actual` on a slot-type mismatch tell the UI what would fit here.
 */
export interface FitError {
  readonly code: FitCode;
  readonly message: string;
  readonly slotIndex?: number;
  readonly id?: string;
  readonly expected?: SlotType;
  readonly actual?: SlotType;
}

/**
 * Domain-level error union. Currently a re-export of `FitError`; grows as
 * later modules add their own typed errors (S03 refit, F3 io, F4 sim wire).
 */
export type DomainError = FitError;

// ---- ValidatedBuild — the "priced/resolved" gate --------------------------

/**
 * Nominal wrapper marking a `Build` that has passed `validateFit` against the
 * current catalog. S03's `derivedStats` and `resolveFleet` require this, so
 * "priced/resolved an unvalidated build" is a compile-time error, not a
 * runtime hope. Light-weight by design (no re-shape of the underlying Build).
 */
export interface ValidatedBuild {
  readonly build: Build;
  readonly _validated: true;
}
