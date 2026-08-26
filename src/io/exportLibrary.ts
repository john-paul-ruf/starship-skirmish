// M07 IO — JSON library export (specs/database.md §6, architecture §8.2, FR-9).
//
// The archival, human-inspectable counterpart to the share token. Where the
// token trades character density for ordinals, the export uses STRING IDS —
// there is no character budget on an 8 MB JSON file, and both formats resolve
// through the same permanent-id guarantee (§6).
//
// PURE + DETERMINISTIC: `exportedAt` is caller-supplied; io does not read the
// wall clock (unit-testable, offline-safe, and repeatable — the same builds
// exported at the same timestamp produce byte-identical JSON, which the F5
// harness relies on).
//
// IDENTITY-STRIPPED PER §6: per-build fields are `BuildRecord` MINUS `id`,
// `createdAt`, `updatedAt` — all minted locally on import. Architecture §8.2's
// illustrative snippet includes `id` for readability; §6 is the more specific
// authority and says identity is local. We follow §6.

import type { Catalog } from '../catalog/index.js';
import type { Build } from '../domain/index.js';
import { CURRENT_SCHEMA_VERSION } from './migrate/migrations.js';

/**
 * One build inside a library export. Identity fields (`id`, `createdAt`,
 * `updatedAt`) are omitted — the receiver mints them on `applyImport`.
 * `storedCost` is preserved so the receiver can flag `needs-refit` (§3.3).
 */
export interface LibraryExportBuild {
  readonly name: string;
  readonly tags: readonly string[];
  readonly chassisId: string;
  readonly slots: readonly (string | null)[];
  readonly schemaVersion: number;
  readonly catalogVersion: number;
  readonly storedCost: number;
}

/** The archival envelope (§6). `format` is the discriminator — an import that reads a different string rejects the whole file. */
export interface LibraryExport {
  readonly format: 'starship-skirmish/library';
  readonly schemaVersion: number;
  readonly catalogVersion: number;
  /** ISO-8601, caller-supplied. Informational only — never trusted as a clock (§6). */
  readonly exportedAt: string;
  readonly builds: readonly LibraryExportBuild[];
}

/**
 * Build the archival envelope over `builds`. The caller filters (a
 * "selected subset" export is this same function with a pre-filtered list —
 * export does not do the filtering). Never throws. Never touches the wall
 * clock — `exportedAt` is caller-supplied.
 *
 * The `catalog` parameter is present for the envelope's `catalogVersion`
 * stamp; individual build records already carry their own `catalogVersion`
 * (a build authored under v1 stays labelled v1 forever, even if the local
 * catalog has since advanced).
 */
export const exportLibrary = (
  catalog: Catalog,
  builds: readonly Build[],
  exportedAt: string,
): LibraryExport => ({
  format: 'starship-skirmish/library',
  schemaVersion: CURRENT_SCHEMA_VERSION,
  catalogVersion: catalog.catalogVersion,
  exportedAt,
  builds: builds.map(
    (b): LibraryExportBuild => ({
      name: b.name,
      tags: b.tags,
      chassisId: b.chassisId,
      slots: b.slots,
      schemaVersion: b.schemaVersion,
      catalogVersion: b.catalogVersion,
      storedCost: b.storedCost,
    }),
  ),
});

/**
 * Render an export as pretty-printed JSON text — the on-disk form the user
 * downloads. Two-space indent so a human can diff two exports meaningfully.
 * `JSON.stringify` on the frozen envelope is deterministic under a fixed key
 * insertion order, so byte-identical inputs produce byte-identical outputs.
 */
export const exportToText = (exp: LibraryExport): string => JSON.stringify(exp, null, 2);
