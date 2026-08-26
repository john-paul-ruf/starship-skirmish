// M07 IO — JSON library import (specs/database.md §6, architecture §8.2, FR-9).
//
// PARSE + VALIDATE ONLY — NEVER WRITES (§10 note 7). io does not know the
// library; the collision-aware IMPORTED/RENAMED/SKIPPED result and the actual
// storage write are `persist.applyImport`'s job, and the rename/replace/cancel
// dialog + chunk-across-frames loop are F7/F8 UI. This module produces a
// PARSE-LEVEL report: per-entry `valid` (with a priced `Build` + refit) or
// `failed` (with a human reason).
//
// HARD CAPS PRECEDE EVERY ALLOCATION (§10 note 7):
//   * `FILE_MAX_BYTES` is checked BEFORE `JSON.parse` (a hostile 500 MB file
//     never reaches the parser)
//   * `BUILDS_MAX` is checked BEFORE per-build iteration (a foreign
//     `builds.length` is never taken as a loop bound)
//   * per-build validation runs through S01's `migrate`, which owns the
//     shape → version → chain → validate → re-price pipeline (§7.2)
//
// Partial validity is normal, not exceptional (FR-9). One bad build never
// fails the file — it becomes one `failed` entry in the report.

import type { Catalog } from '../catalog/index.js';
import type { BuildMeta, RefitDiff, Result, Build } from '../domain/index.js';
import { BUILDS_MAX, FILE_MAX_BYTES } from './limits.js';
import { migrate } from './migrate/migrate.js';
import { CURRENT_SCHEMA_VERSION } from './migrate/migrations.js';

// ---- Error surface -------------------------------------------------------

/** File-level rejections. Whole-file failures — the receiver reports the code and the user re-tries. */
export type ImportFileCode =
  | 'ERR_FILE_TOO_LARGE'
  | 'ERR_BAD_JSON'
  | 'ERR_BAD_FORMAT'
  | 'ERR_FUTURE_SCHEMA'
  | 'ERR_FUTURE_CATALOG'
  | 'ERR_TOO_MANY_BUILDS'
  | 'ERR_BUILDS_NOT_ARRAY';

export interface ImportFileError {
  readonly code: ImportFileCode;
  readonly message: string;
}

/**
 * One parse-level report entry. `status === 'valid'` implies `build` + `refit`
 * are populated (persist will mint identity on `applyImport`). `status ===
 * 'failed'` implies `reason` is populated. `index` is the entry's original
 * position in the source file — the UI's report references it verbatim.
 */
export interface ImportCandidate {
  readonly index: number;
  readonly status: 'valid' | 'failed';
  readonly build?: Build;
  readonly refit?: RefitDiff | null;
  readonly reason?: string;
}

export interface ImportParseReport {
  readonly schemaVersion: number;
  readonly catalogVersion: number;
  readonly candidates: readonly ImportCandidate[];
}

// ---- Internal helpers -----------------------------------------------------

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Placeholder metadata used when calling `migrate` for a single import entry.
 * `migrate` synthesises the priced `Build`; the identity fields (`id`,
 * `createdAt`, `updatedAt`) are left empty — persist mints them on
 * `applyImport`. `schemaVersion` / `catalogVersion` are seeded from CURRENT
 * because the entry's own values will be re-stamped through the migration
 * chain regardless (§7.2).
 */
const importMeta = (): BuildMeta => ({
  id: '',
  schemaVersion: CURRENT_SCHEMA_VERSION,
  catalogVersion: CURRENT_SCHEMA_VERSION, // deliberately placeholder; migrate ignores this
  createdAt: '',
  updatedAt: '',
});

/**
 * Attach a `schemaVersion` to a per-build doc that omits one. Each per-build
 * doc in a §8.2 export carries its own `schemaVersion` (a mixed-version file
 * is legal — one build authored under v3 sits alongside another authored
 * under v4 in the same export). If a build entry OMITS `schemaVersion`, fall
 * back to the file's envelope version — a v1-only file that skipped the
 * per-build field for brevity is still valid.
 */
const withEnvelopeSchemaFallback = (
  entry: Readonly<Record<string, unknown>>,
  envelopeSchemaVersion: number,
): Readonly<Record<string, unknown>> => {
  if (typeof entry['schemaVersion'] === 'number') return entry;
  return { ...entry, schemaVersion: envelopeSchemaVersion };
};

// ---- The public parse gate ----------------------------------------------

/**
 * Parse + validate a JSON export file. Returns:
 *   * `Result.err(ImportFileError)` for whole-file failures (over cap, bad
 *     JSON, wrong `format`, future version, non-array `builds`, over-count).
 *   * `Result.ok(ImportParseReport)` when the envelope is legal, with
 *     per-entry `valid` (Build + refit) or `failed` (reason). Partial
 *     validity is normal (FR-9).
 *
 * NEVER WRITES. NEVER MUTATES CALLER STATE. The write step and the
 * IMPORTED/RENAMED/SKIPPED collision policy are `persist.applyImport`'s job.
 */
export const importLibrary = (
  catalog: Catalog,
  fileText: string,
): Result<ImportParseReport, ImportFileError> => {
  // Cap 1 — byte length BEFORE JSON.parse.
  const byteLen = new TextEncoder().encode(fileText).length;
  if (byteLen > FILE_MAX_BYTES) {
    return {
      ok: false,
      error: {
        code: 'ERR_FILE_TOO_LARGE',
        message: `File is ${byteLen} bytes; max ${FILE_MAX_BYTES}.`,
      },
    };
  }

  // Cap 2 — JSON.parse in a guard (a hostile file might be well-formed as
  // bytes but not as JSON).
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileText);
  } catch (e) {
    return {
      ok: false,
      error: {
        code: 'ERR_BAD_JSON',
        message: `File is not valid JSON: ${(e as Error).message}.`,
      },
    };
  }

  // Cap 3 — envelope shape + format string.
  if (!isPlainObject(parsed)) {
    return { ok: false, error: { code: 'ERR_BAD_FORMAT', message: 'Envelope must be a JSON object.' } };
  }
  if (parsed['format'] !== 'starship-skirmish/library') {
    return {
      ok: false,
      error: {
        code: 'ERR_BAD_FORMAT',
        message: `Envelope format is "${String(parsed['format'])}"; expected "starship-skirmish/library".`,
      },
    };
  }

  // Cap 4 — envelope versions.
  const envelopeSchemaVersion = parsed['schemaVersion'];
  if (typeof envelopeSchemaVersion !== 'number' || !Number.isFinite(envelopeSchemaVersion)) {
    return {
      ok: false,
      error: {
        code: 'ERR_FUTURE_SCHEMA',
        message: 'Envelope is missing a numeric `schemaVersion` field.',
      },
    };
  }
  if (envelopeSchemaVersion < 1 || envelopeSchemaVersion > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: {
        code: 'ERR_FUTURE_SCHEMA',
        message: `Envelope schemaVersion ${envelopeSchemaVersion} is outside 1..${CURRENT_SCHEMA_VERSION}.`,
      },
    };
  }

  const envelopeCatalogVersion = parsed['catalogVersion'];
  if (typeof envelopeCatalogVersion !== 'number' || !Number.isFinite(envelopeCatalogVersion)) {
    return {
      ok: false,
      error: {
        code: 'ERR_FUTURE_CATALOG',
        message: 'Envelope is missing a numeric `catalogVersion` field.',
      },
    };
  }
  if (envelopeCatalogVersion < 1 || envelopeCatalogVersion > catalog.catalogVersion) {
    return {
      ok: false,
      error: {
        code: 'ERR_FUTURE_CATALOG',
        message: `Envelope catalogVersion ${envelopeCatalogVersion} is outside 1..${catalog.catalogVersion}.`,
      },
    };
  }

  // Cap 5 — builds must be an array.
  const rawBuilds = parsed['builds'];
  if (!Array.isArray(rawBuilds)) {
    return {
      ok: false,
      error: {
        code: 'ERR_BUILDS_NOT_ARRAY',
        message: `Envelope \`builds\` must be an array (got ${typeof rawBuilds}).`,
      },
    };
  }

  // Cap 6 — build count BEFORE per-build iteration. A foreign `builds.length`
  // is never taken as a loop bound past BUILDS_MAX.
  if (rawBuilds.length > BUILDS_MAX) {
    return {
      ok: false,
      error: {
        code: 'ERR_TOO_MANY_BUILDS',
        message: `Envelope has ${rawBuilds.length} builds; max ${BUILDS_MAX}.`,
      },
    };
  }

  // Per-build validation. `migrate` owns the shape → version → chain →
  // validate → re-price pipeline; we surface its result as one report entry.
  const candidates: ImportCandidate[] = [];
  for (let i = 0; i < rawBuilds.length; i += 1) {
    const rawEntry = rawBuilds[i];
    if (!isPlainObject(rawEntry)) {
      candidates.push({
        index: i,
        status: 'failed',
        reason: `Build at index ${i} is not a JSON object (got ${typeof rawEntry}).`,
      });
      continue;
    }
    const doc = withEnvelopeSchemaFallback(rawEntry, envelopeSchemaVersion);
    const loaded = migrate(catalog, doc, importMeta());
    if (!loaded.ok) {
      // Aggregate ValidateError[] into one human reason; migrate's own guard
      // codes (ERR_NOT_OBJECT, ERR_NO_SCHEMA_VERSION, ERR_FUTURE_SCHEMA)
      // surface as single-line messages.
      const detail = loaded.error.errors
        ? loaded.error.errors.map((e) => e.message).join(' ')
        : loaded.error.message;
      candidates.push({
        index: i,
        status: 'failed',
        reason: `Build at index ${i}: ${detail}`,
      });
      continue;
    }
    candidates.push({
      index: i,
      status: 'valid',
      build: loaded.value.build,
      refit: loaded.value.refit,
    });
  }

  return {
    ok: true,
    value: {
      schemaVersion: envelopeSchemaVersion,
      catalogVersion: envelopeCatalogVersion,
      candidates,
    },
  };
};
