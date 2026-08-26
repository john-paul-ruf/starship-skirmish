// M07 IO — validate a foreign build doc (specs/database.md §3.2 / §7.2 / §10,
// architecture §4 `src/io/`, §10). The io half of the fit gate: domain's
// `validateFit` catches "does this build make sense against the catalog?", and
// this module catches "does this doc's name/tags obey the cross-format caps?"
// plus "did we defensively coerce every field of a HOSTILE doc?"
//
// CONTRACT (architecture §4 §10, specs/database.md §10 note 7):
//   * every public function returns `Result`; nothing throws across io's boundary
//   * nothing mutates caller state; no globals, no clock, no storage
//   * HARD CAPS PRECEDE EVERY ALLOCATION — no length taken from a foreign doc
//     without a prior cap; the slots array is clamped to the chassis' layout
//     length before any per-slot work
//   * collects EVERY violation (FR-5: the Shipyard paints every bad field at
//     once), never first-fail
//
// This module is used by:
//   * S02's `importLibrary` (a JSON per-build validation gate)
//   * S01's own `migrate.finishLoad` (the §7.2 validate + re-price tail — every
//     load path goes through here)
//
// Deliberately out of scope: id-minting (io does not invent identity), pricing
// (domain owns cost; this module wraps `validateFit` only), collision policy
// (persist's `applyImport` owns rename/replace/cancel).

import type { Catalog } from '../catalog/index.js';
import type { Build, BuildMeta, FitError, Result, ValidatedBuild } from '../domain/index.js';
import { validateFit } from '../domain/index.js';
import { NAME_MAX, NAME_MIN, TAG_MAX, TAG_MIN, TAGS_MAX } from './limits.js';

// ---- Error surface --------------------------------------------------------

/**
 * The set of things that can be wrong with a foreign doc. Domain's `FitCode`
 * covers the fit-legality half (unknown chassis/component, slot count, slot
 * type). This union adds io's own name/tag failures — a superset the UI can
 * paint uniformly with `FitError`.
 */
export type ValidateCode =
  | FitError['code']
  | 'ERR_NAME_EMPTY'
  | 'ERR_NAME_TOO_LONG'
  | 'ERR_TOO_MANY_TAGS'
  | 'ERR_TAG_EMPTY'
  | 'ERR_TAG_TOO_LONG'
  | 'ERR_TAG_NOT_KEBAB'
  | 'ERR_TAG_DUPLICATE';

/**
 * One violation. `slotIndex` / `id` / `expected` / `actual` are carried
 * through from `FitError` verbatim (this module's codes are a superset of
 * domain's, so structurally re-using the fields keeps the UI's error panel
 * one shape).
 */
export interface ValidateError {
  readonly code: ValidateCode;
  readonly message: string;
  readonly slotIndex?: number;
  readonly tagIndex?: number;
  readonly id?: string;
  readonly expected?: string;
  readonly actual?: string;
}

// ---- Name / tag normalisation --------------------------------------------

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * NFC-normalise + trim a foreign name value. Length checks live in
 * `validateCandidate` so both codes (`ERR_NAME_EMPTY`, `ERR_NAME_TOO_LONG`)
 * emit against the SAME normalised form the Build ends up carrying.
 */
export const normalizeName = (raw: unknown): string =>
  String(raw ?? '')
    .normalize('NFC')
    .trim();

/**
 * NFC-trim + dedupe + sort + kebab-check tag entries. Returns the CLEANED
 * list (safe to drop straight into a Build) alongside the violations
 * discovered — `validateCandidate` merges the two into the aggregate report so
 * the UI sees every bad tag at once (FR-5). The count cap is applied here so a
 * 10⁶-length foreign array cannot force a 10⁶-iteration loop before the check.
 */
export const normalizeTags = (
  raw: unknown,
): { readonly tags: readonly string[]; readonly errors: readonly ValidateError[] } => {
  const errors: ValidateError[] = [];
  if (raw === undefined || raw === null) return { tags: [], errors };
  if (!Array.isArray(raw)) {
    // A non-array `tags` field is a malformed doc; treat as empty and report.
    return {
      tags: [],
      errors: [
        {
          code: 'ERR_TOO_MANY_TAGS',
          message: `tags must be an array (got ${typeof raw}).`,
        },
      ],
    };
  }

  // CAP BEFORE ALLOCATION: iterate only the first TAGS_MAX + 1 entries so a
  // hostile 10⁶-length array cannot force 10⁶ NFC normalisations. The extra
  // one entry is what triggers ERR_TOO_MANY_TAGS.
  const scanLimit = Math.min(raw.length, TAGS_MAX + 1);
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (let i = 0; i < scanLimit; i += 1) {
    const entry = raw[i];
    const normalised = String(entry ?? '').normalize('NFC').trim();
    if (normalised.length < TAG_MIN) {
      errors.push({
        code: 'ERR_TAG_EMPTY',
        tagIndex: i,
        message: `Tag at index ${i} is empty after trim.`,
      });
      continue;
    }
    if (normalised.length > TAG_MAX) {
      errors.push({
        code: 'ERR_TAG_TOO_LONG',
        tagIndex: i,
        message: `Tag at index ${i} is ${normalised.length} chars; max ${TAG_MAX}.`,
      });
      continue;
    }
    if (!KEBAB.test(normalised)) {
      errors.push({
        code: 'ERR_TAG_NOT_KEBAB',
        tagIndex: i,
        message: `Tag "${normalised}" is not lowercase kebab-case.`,
      });
      continue;
    }
    if (seen.has(normalised)) {
      errors.push({
        code: 'ERR_TAG_DUPLICATE',
        tagIndex: i,
        message: `Duplicate tag "${normalised}".`,
      });
      continue;
    }
    seen.add(normalised);
    cleaned.push(normalised);
  }

  if (raw.length > TAGS_MAX) {
    errors.push({
      code: 'ERR_TOO_MANY_TAGS',
      message: `tags has ${raw.length} entries; max ${TAGS_MAX}.`,
    });
  }

  cleaned.sort();
  return { tags: cleaned, errors };
};

// ---- Defensive coercion (foreign doc → Build candidate) -------------------

/**
 * Absolute ceiling on the slot-array length the coercer will ever allocate.
 * The largest legal class layout at v1 is 12 (mega-destroyer); a 256 ceiling
 * leaves generous room for future class growth while capping a hostile
 * `slots: Array(1_000_000)` doc BEFORE any per-slot work (§10 note 7). Any
 * doc with more slots than a legal layout will still surface `ERR_SLOT_COUNT`
 * through the fit gate.
 */
const HARD_SLOT_CEILING = 256;

/**
 * Foreign doc → a `Build` candidate. **Defensive by construction:** every
 * field is read via a type guard, every array is capped before iteration,
 * no length is trusted (§10 note 7). `meta` (id + versions + timestamps) is
 * MINTED BY THE CALLER — coerce does not invent identity.
 *
 * The `slots` array preserves the doc's own length (capped at
 * `HARD_SLOT_CEILING`) so `validateFit` can surface `ERR_SLOT_COUNT` when it
 * disagrees with the chassis' layout. Non-string entries become `null` (a
 * legal empty slot); validation flags the mismatch, coercion does not.
 */
export const coerceCandidate = (
  _catalog: Catalog,
  doc: Readonly<Record<string, unknown>>,
  meta: BuildMeta,
): Build => {
  const chassisId = typeof doc['chassisId'] === 'string' ? (doc['chassisId'] as string) : '';

  // CAP BEFORE ALLOCATION: never touch more than HARD_SLOT_CEILING entries.
  const rawSlots = doc['slots'];
  const rawSlotsLength = Array.isArray(rawSlots) ? rawSlots.length : 0;
  const cappedLength = Math.min(rawSlotsLength, HARD_SLOT_CEILING);
  const slots: (string | null)[] = new Array(cappedLength).fill(null);
  if (Array.isArray(rawSlots)) {
    for (let i = 0; i < cappedLength; i += 1) {
      const entry = rawSlots[i];
      slots[i] = typeof entry === 'string' ? entry : null;
    }
  }

  const rawStoredCost = doc['storedCost'];
  const storedCost =
    typeof rawStoredCost === 'number' && Number.isFinite(rawStoredCost) ? rawStoredCost : 0;

  return {
    id: meta.id,
    name: normalizeName(doc['name']),
    tags: [],
    chassisId,
    slots,
    storedCost,
    schemaVersion: meta.schemaVersion,
    catalogVersion: meta.catalogVersion,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
};

// ---- The public validation gate ------------------------------------------

/**
 * The io validation gate. Coerces a foreign doc into a `Build` candidate,
 * applies name/tag caps (io's own concerns) + NFC normalisation, then runs
 * domain's `validateFit` (fit legality). Collects ALL violations — the
 * Shipyard paints every bad field at once (FR-5).
 *
 * On success returns a `ValidatedBuild` whose wrapped `Build` carries the
 * NORMALISED name and tags (so the persistence layer stores the cleaned
 * form, not the raw foreign input).
 */
export const validateCandidate = (
  catalog: Catalog,
  doc: Readonly<Record<string, unknown>>,
  meta: BuildMeta,
): Result<ValidatedBuild, readonly ValidateError[]> => {
  const errors: ValidateError[] = [];

  // Name — normalise once, check length against the normalised form.
  const name = normalizeName(doc['name']);
  if (name.length < NAME_MIN) {
    errors.push({
      code: 'ERR_NAME_EMPTY',
      message: `name must be at least ${NAME_MIN} char after NFC-trim.`,
    });
  } else if (name.length > NAME_MAX) {
    errors.push({
      code: 'ERR_NAME_TOO_LONG',
      message: `name is ${name.length} chars after NFC-trim; max ${NAME_MAX}.`,
    });
  }

  // Tags — normalise + cap + dedupe. `errors` is merged; `tags` is the cleaned list.
  const { tags, errors: tagErrors } = normalizeTags(doc['tags']);
  for (const e of tagErrors) errors.push(e);

  // Build the normalised candidate the Build/receipt will actually carry.
  const rawBuild = coerceCandidate(catalog, doc, meta);
  const build: Build = { ...rawBuild, name, tags };

  // Fold in domain's fit gate (FR-4). `validateFit` returns readonly FitError[]
  // whose codes are a subset of `ValidateCode` — we re-emit them verbatim.
  const fit = validateFit(catalog, build);
  if (!fit.ok) {
    for (const e of fit.error) {
      errors.push({
        code: e.code,
        message: e.message,
        ...(e.slotIndex !== undefined ? { slotIndex: e.slotIndex } : {}),
        ...(e.id !== undefined ? { id: e.id } : {}),
        ...(e.expected !== undefined ? { expected: e.expected } : {}),
        ...(e.actual !== undefined ? { actual: e.actual } : {}),
      });
    }
  }

  if (errors.length > 0) return { ok: false, error: errors };

  // On success we know fit.ok === true; construct the receipt with our
  // normalised Build (not fit.value.build, which was pre-normalisation).
  return { ok: true, value: { build, _validated: true } };
};
