// M07 IO — the §7.2 load-pipeline runner (specs/database.md §7.1 / §7.2 / §10 note 1,
// architecture §4 `src/io/`, §8.3, FR-2).
//
// `migrations.ts` is the append-only REGISTRY of schema transforms. This file is
// the RUNNER the registry's own header names: it composes the chain with the
// shape guard, the version gate, the io validation gate, and the re-price step
// into a single pipeline three call sites share.
//
//   ┌ raw artifact ───────────────────────────────────────────────────────┐
//   │  shape guard         (is this an object with a numeric schemaVersion?) │
//   │  version gate        (future ⇒ ERR_FUTURE_SCHEMA, fail closed, no write) │
//   │  migration chain     (v_doc → CURRENT_SCHEMA_VERSION, one step at a time) │
//   │  validate            (io/validate.ts — fit + name/tag caps + NFC)     │
//   │  RE-PRICE            (domain.pointCost against the CURRENT catalog)    │
//   │  cost ≠ storedCost ? flag needs-refit + refitDiff (in memory only)     │
//   └ Result<Loaded> ─────────────────────────────────────────────────────┘
//
// `finishLoad` is the validate+re-price TAIL, shared by three callers:
//   * S02 `decodeShareToken`  → priceFresh: true   (a token carries no cost)
//   * S02 `importLibrary`     → priceFresh: false  (JSON docs carry storedCost)
//   * S03 `LibraryRepo.get()` → priceFresh: false  (records carry storedCost)
//
// `migrate` is the full pipeline for docs that arrive as `unknown` JSON/records.
// The share-token codec (S02) assembles a doc from ordinals and passes it into
// `finishLoad` directly, skipping the version gate (the token's version was
// already read before decoding).
//
// CONTRACT: everything returns `Result`; nothing throws across io's boundary;
// nothing mutates caller state; nothing writes (§10 note 7).

import type { Catalog } from '../../catalog/index.js';
import type { Build, BuildMeta, RefitDiff, Result } from '../../domain/index.js';
import { pointCost, refitDiff } from '../../domain/index.js';
import { validateCandidate, type ValidateError } from '../validate.js';
import { CURRENT_SCHEMA_VERSION, migrations, type MigratableDoc } from './migrations.js';

// ---- Public shapes -------------------------------------------------------

/**
 * A successfully-loaded artifact. `refit` non-null ⇒ needs-refit (old total,
 * new total, per-slot current costs — §3.3, design §4.7). The UI paints the
 * badge from a non-null `refit`; persist stores the boolean in the index (not
 * on the record — §3.3).
 */
export interface Loaded {
  readonly build: Build;
  readonly refit: RefitDiff | null;
}

/**
 * The codes migrate can surface. The shape-guard / version-gate codes are
 * unique to this module; validate codes are re-exposed through the `errors`
 * field on the aggregate error object so callers can render them uniformly.
 */
export type MigrateCode =
  | 'ERR_NOT_OBJECT'
  | 'ERR_NO_SCHEMA_VERSION'
  | 'ERR_FUTURE_SCHEMA'
  | 'ERR_VALIDATION';

/**
 * One aggregate error. `errors` is populated when `code === 'ERR_VALIDATION'`
 * (io's validation gate returned a list); the shape/version guards produce a
 * single-line error with `errors: undefined`.
 */
export interface MigrateError {
  readonly code: MigrateCode;
  readonly message: string;
  readonly errors?: readonly ValidateError[];
}

// ---- Internal guards -----------------------------------------------------

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// ---- finishLoad — the §7.2 validate + re-price tail ----------------------

/**
 * The tail of the §7.2 pipeline: validate the (possibly-migrated) doc against
 * the current catalog, then re-price. THREE callers share this seam — the
 * share-token decoder (S02), the JSON importer (S02), and the persist
 * record-load (S03) — so its signature is the load-pipeline contract.
 *
 * `priceFresh: true`  → set `build.storedCost := pointCost(build)` and return
 *                       `refit: null`. Correct for share tokens: the token
 *                       format (§8.1) has no cost field, so a decoded build
 *                       must be priced at TODAY's catalog. "Needs-refit" does
 *                       not apply — you pay current prices for a link.
 * `priceFresh: false` → compute `refitDiff` against the doc's own storedCost.
 *                       Non-null iff the total drifted (`newTotal ≠ oldTotal`).
 *                       Correct for JSON exports and library records, which
 *                       both carry a historical `storedCost` (§3.3).
 *
 * NEVER writes. NEVER throws. Returns `Result<Loaded, ValidateError[]>`.
 */
export const finishLoad = (
  catalog: Catalog,
  doc: MigratableDoc,
  meta: BuildMeta,
  opts: { readonly priceFresh: boolean },
): Result<Loaded, readonly ValidateError[]> => {
  const validated = validateCandidate(catalog, doc, meta);
  if (!validated.ok) return { ok: false, error: validated.error };

  const build = validated.value.build;
  if (opts.priceFresh) {
    // A share token carries no cost. Stamp storedCost := current, refit null.
    const priced: Build = { ...build, storedCost: pointCost(catalog, build) };
    return { ok: true, value: { build: priced, refit: null } };
  }
  // Docs/records carry a historical storedCost. Non-null refit ⇒ needs-refit.
  return { ok: true, value: { build, refit: refitDiff(catalog, build) } };
};

// ---- migrate — the full §7.2 pipeline for JSON docs / records ------------

/**
 * Shape guard → version gate → migration chain → `finishLoad(priceFresh:false)`.
 * `raw` is `unknown` — treat every field as hostile.
 *
 * Failure modes (all fail-closed, no state mutation, no throw across boundary):
 *   * non-object / null / array           → ERR_NOT_OBJECT
 *   * missing / non-numeric schemaVersion → ERR_NO_SCHEMA_VERSION
 *   * schemaVersion > CURRENT             → ERR_FUTURE_SCHEMA (never guess a future shape)
 *   * validation errors                   → ERR_VALIDATION with `errors: ValidateError[]`
 *
 * The migration chain is empty at v1 — the loop must still be correct so the
 * first appended migration (v1 → v2) Just Works (specs/database.md §7.1
 * "v1 ships an empty chain, and the machinery still exists").
 */
export const migrate = (
  catalog: Catalog,
  raw: unknown,
  meta: BuildMeta,
): Result<Loaded, MigrateError> => {
  // 1. Shape guard.
  if (!isPlainObject(raw)) {
    return {
      ok: false,
      error: { code: 'ERR_NOT_OBJECT', message: `Artifact must be a plain object (got ${raw === null ? 'null' : typeof raw}).` },
    };
  }

  // 2. Version gate — require a numeric schemaVersion.
  const versionField = raw['schemaVersion'];
  if (typeof versionField !== 'number' || !Number.isFinite(versionField)) {
    return {
      ok: false,
      error: {
        code: 'ERR_NO_SCHEMA_VERSION',
        message: 'Artifact is missing a numeric `schemaVersion` field.',
      },
    };
  }
  if (versionField > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: {
        code: 'ERR_FUTURE_SCHEMA',
        message: `Artifact schemaVersion ${versionField} is newer than this build (current ${CURRENT_SCHEMA_VERSION}). Refusing to guess a future shape.`,
      },
    };
  }

  // 3. Migration chain. Apply each step whose `from === current`, ascending,
  // until we reach CURRENT_SCHEMA_VERSION. Empty chain at v1 → this loop is a
  // no-op; still correct when the first migration appends.
  let doc: MigratableDoc = raw;
  let current = versionField;
  while (current < CURRENT_SCHEMA_VERSION) {
    const step = migrations.find((m) => m.from === current);
    if (step === undefined) {
      // Chain gap — shouldn't happen because assertChainIsWellFormed runs at
      // CI time. Fail closed rather than loop forever.
      return {
        ok: false,
        error: {
          code: 'ERR_NO_SCHEMA_VERSION',
          message: `Migration chain has no step from schemaVersion ${current}.`,
        },
      };
    }
    doc = step.up(doc);
    current = step.to;
  }

  // 4. Validate + re-price. Docs/records carry storedCost — priceFresh: false.
  const loaded = finishLoad(catalog, doc, meta, { priceFresh: false });
  if (!loaded.ok) {
    return {
      ok: false,
      error: {
        code: 'ERR_VALIDATION',
        message: `Artifact failed validation with ${loaded.error.length} error(s).`,
        errors: loaded.error,
      },
    };
  }
  return { ok: true, value: loaded.value };
};
