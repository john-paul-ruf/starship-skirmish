// M08 Persist — durable record shapes + guarded parsers (specs/database.md §3.2 / §3.4 / §3.8).
//
// The shapes here mirror the spec sections verbatim, INCLUDING the deliberately
// absent fields (§3.2 forbids `needsRefit` / `currentCost` / `leftoverPoints`
// on the record; caching lives in `IndexEntry` only). If a field creeps in
// here, the boolean is a lie the moment the catalog re-tunes.
//
// The `parse*` functions are TOTAL and NEVER THROW. On any failure they return
// `null` (or, for `PrefsRecord`, the default record — corrupt prefs must never
// block boot, §3.8). The caller (rebuildIndex / openLibrary) turns a `null`
// build record into an `IndexEntry` with `status: 'failed'` (§3.5 failure
// isolation): one bad record never destroys the rest of the Encyclopedia.

import type { Build } from '../domain/index.js';

// ---- BuildRecord — the durable unit (§3.2) --------------------------------

/**
 * A stored build (§3.2). Structurally identical to `Build` from domain: id +
 * name + tags + chassisId + slots + storedCost + schema/catalog versions +
 * timestamps. Deliberately no `needsRefit` / `currentCost` / `derivedStats` /
 * `leftoverPoints` / `ownerId` (§3.2). Full FK / slot-type / caps validation
 * happens through `src/io/migrate/migrate.ts` on read — this file only decides
 * "is this even a plausibly-shaped object" so a JSON-corrupt entry can be
 * flagged rather than crashing boot.
 */
export type BuildRecord = Build;

// ---- IndexEntry / IndexRecord — the browse cache (§3.4) -------------------

/** Two-state cache line for a stored build — one bad record never taints the rest (§3.5). */
export type IndexEntryStatus = 'ok' | 'failed';

/**
 * One row of the browse cache (§3.4). `classId`, `currentCost`, `needsRefit`
 * are DELIBERATE DENORMALISATIONS — the index is a rebuildable cache over
 * records that are themselves the source of truth (§3.5), and NFR-Performance
 * names 500-build responsiveness explicitly. Staleness is fully contained by
 * `pricedAtCatalogVersion`: a bump triggers exactly one O(n) re-price, then
 * O(0) forever until the next bump.
 *
 * `status: 'failed'` entries carry only what could be salvaged (id + bytes +
 * reason) — the rest of the shape is zero/empty. The UI surfaces them per
 * FR-2's failure-isolation contract; they are NOT deleted.
 */
export interface IndexEntry {
  readonly id: string;
  readonly name: string;
  /** `name` lowercased + whitespace-collapsed — O(1) import collision key (§3.6). */
  readonly nameKey: string;
  readonly tags: readonly string[];
  readonly chassisId: string;
  /** Denormalised from the catalog to serve Q9 without a record read. */
  readonly classId: string;
  readonly storedCost: number;
  /** Cached re-price against `pricedAtCatalogVersion`. Not on the record (§3.2). */
  readonly currentCost: number;
  /** Cached; valid only while `pricedAtCatalogVersion === catalog.catalogVersion` (§3.3). */
  readonly needsRefit: boolean;
  /** Cache key for the two fields above (§3.4). */
  readonly pricedAtCatalogVersion: number;
  readonly schemaVersion: number;
  readonly catalogVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** `bytesOf(key, value)` from quota.ts, cached for Q15 (§3.7). */
  readonly bytes: number;
  readonly status: IndexEntryStatus;
  /** Populated for `status: 'failed'` — the reason the record wouldn't parse or validate. */
  readonly failureReason?: string;
}

/** The stored `:index` blob (§3.4). Entries sorted deterministically by id. */
export interface IndexRecord {
  readonly schemaVersion: number;
  readonly updatedAt: string;
  readonly entries: readonly IndexEntry[];
}

// ---- MetaRecord — first-run bookkeeping (§3.8) ----------------------------

/**
 * `:meta` singleton (§3.8). `lastExportAt` drives the recurring backup nudge
 * (FR-7, Decision 5); `backupNudgeDismissedAt` re-arms after an interval. The
 * `usedBytes` field is a CACHED total — the authoritative value is the sum of
 * `IndexEntry.bytes`; this exists so an already-mounted repo can answer
 * headroom without walking the store.
 */
export interface MetaRecord {
  readonly schemaVersion: number;
  readonly catalogVersion: number;
  readonly createdAt: string;
  readonly lastExportAt: string | null;
  readonly backupNudgeDismissedAt: string | null;
  readonly usedBytes: number;
}

// ---- PrefsRecord — non-critical UI prefs (§3.8) ---------------------------

/**
 * `:prefs` singleton (§3.8). A corrupt blob is SILENTLY RESET to defaults and
 * never surfaced — see `parsePrefsRecord` (total-with-default). The reduced-
 * motion field earns its persistence per NFR-Accessibility: a setting that
 * does not survive a reload isn't a setting.
 */
export interface PrefsRecord {
  readonly reducedMotion: boolean;
  readonly renderQuality: 'low' | 'medium' | 'high';
  readonly defaultBudget: number | null;
  readonly encyclopediaSort: 'updatedAt' | 'name' | 'currentCost';
  readonly encyclopediaFilter: {
    readonly tags: readonly string[];
    readonly classId: string | null;
  };
}

/** The default `PrefsRecord` — used verbatim when the stored blob is missing or corrupt (§3.8). */
export const DEFAULT_PREFS: PrefsRecord = {
  reducedMotion: false,
  renderQuality: 'medium',
  defaultBudget: null,
  encyclopediaSort: 'updatedAt',
  encyclopediaFilter: { tags: [], classId: null },
};

// ---- Guarded parsers — TOTAL, never throw ---------------------------------

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * `JSON.parse` behind a guard. Any parse error → `null` (never throws). Used
 * by every `parse*` in this module.
 */
const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

/**
 * Parse a stored `:build:<id>` value into a plausibly-shaped `BuildRecord`.
 * Returns `null` on JSON-parse failure OR when the top-level shape is not a
 * plain object with the two identity fields (`id`, `chassisId`) present as
 * strings — those are the fields even the migration chain will not synthesise.
 * Deep FK / slot-type / caps validation runs downstream through
 * `src/io/migrate/migrate.ts`; this is only the "is this even a build record?"
 * gate for the failure-isolation flag.
 */
export const parseBuildRecord = (raw: string): BuildRecord | null => {
  const doc = parseJson(raw);
  if (!isPlainObject(doc)) return null;
  if (typeof doc['id'] !== 'string') return null;
  if (typeof doc['chassisId'] !== 'string') return null;
  // Trust the doc to `migrate()` from here — it defensively coerces every
  // remaining field and folds each violation into ERR_VALIDATION.
  return doc as unknown as BuildRecord;
};

/** Serialise a `BuildRecord` for storage. Pure `JSON.stringify` — no surprises. */
export const serializeBuild = (record: BuildRecord): string =>
  JSON.stringify(record);

/**
 * Parse the stored `:index` blob. Returns `null` on JSON failure, non-object,
 * or when the required fields are absent / wrong-typed. A `null` here triggers
 * rebuild-from-records (§3.5) — the index is a cache, the records are the DB.
 * Individual entries pass through a structural guard; a garbage entry is
 * dropped from the returned list (never crashes, never blocks boot).
 */
export const parseIndexRecord = (raw: string): IndexRecord | null => {
  const doc = parseJson(raw);
  if (!isPlainObject(doc)) return null;
  const schemaVersion = doc['schemaVersion'];
  const updatedAt = doc['updatedAt'];
  const entries = doc['entries'];
  if (typeof schemaVersion !== 'number' || !Number.isFinite(schemaVersion)) return null;
  if (typeof updatedAt !== 'string') return null;
  if (!Array.isArray(entries)) return null;

  const cleaned: IndexEntry[] = [];
  for (const raw of entries) {
    const entry = coerceIndexEntry(raw);
    if (entry !== null) cleaned.push(entry);
  }
  return { schemaVersion, updatedAt, entries: cleaned };
};

/** Serialise an `IndexRecord` for storage. */
export const serializeIndexRecord = (record: IndexRecord): string =>
  JSON.stringify(record);

/**
 * Best-effort coercion of one raw entry to an `IndexEntry`. Anything malformed
 * (missing id, wrong types) returns `null` so the enclosing `parseIndexRecord`
 * drops it — rebuild will re-derive from the actual `:build:<id>` record.
 */
const coerceIndexEntry = (raw: unknown): IndexEntry | null => {
  if (!isPlainObject(raw)) return null;
  const id = raw['id'];
  if (typeof id !== 'string' || id.length === 0) return null;

  const status = raw['status'] === 'failed' ? 'failed' : 'ok';
  const stringField = (key: string): string => {
    const v = raw[key];
    return typeof v === 'string' ? v : '';
  };
  const numberField = (key: string, fallback = 0): number => {
    const v = raw[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  };
  const booleanField = (key: string): boolean => raw[key] === true;
  const stringArray = (key: string): readonly string[] => {
    const v = raw[key];
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const s of v) {
      if (typeof s === 'string') out.push(s);
    }
    return out;
  };

  const failureReason = raw['failureReason'];
  return {
    id,
    name: stringField('name'),
    nameKey: stringField('nameKey'),
    tags: stringArray('tags'),
    chassisId: stringField('chassisId'),
    classId: stringField('classId'),
    storedCost: numberField('storedCost'),
    currentCost: numberField('currentCost'),
    needsRefit: booleanField('needsRefit'),
    pricedAtCatalogVersion: numberField('pricedAtCatalogVersion'),
    schemaVersion: numberField('schemaVersion'),
    catalogVersion: numberField('catalogVersion'),
    createdAt: stringField('createdAt'),
    updatedAt: stringField('updatedAt'),
    bytes: numberField('bytes'),
    status,
    ...(typeof failureReason === 'string' ? { failureReason } : {}),
  };
};

/**
 * Parse the stored `:meta` blob. Returns `null` on JSON failure or non-object
 * — the caller mints a fresh `MetaRecord` in that case. Field-level defensive
 * coercion so a corrupt individual field (`usedBytes: "many"`) doesn't crash.
 */
export const parseMetaRecord = (raw: string): MetaRecord | null => {
  const doc = parseJson(raw);
  if (!isPlainObject(doc)) return null;

  const schemaVersion = doc['schemaVersion'];
  const catalogVersion = doc['catalogVersion'];
  const createdAt = doc['createdAt'];
  if (typeof schemaVersion !== 'number' || !Number.isFinite(schemaVersion)) return null;
  if (typeof catalogVersion !== 'number' || !Number.isFinite(catalogVersion)) return null;
  if (typeof createdAt !== 'string') return null;

  const lastExportAt = doc['lastExportAt'];
  const backupNudgeDismissedAt = doc['backupNudgeDismissedAt'];
  const usedBytes = doc['usedBytes'];

  return {
    schemaVersion,
    catalogVersion,
    createdAt,
    lastExportAt: typeof lastExportAt === 'string' ? lastExportAt : null,
    backupNudgeDismissedAt:
      typeof backupNudgeDismissedAt === 'string' ? backupNudgeDismissedAt : null,
    usedBytes: typeof usedBytes === 'number' && Number.isFinite(usedBytes) ? usedBytes : 0,
  };
};

/** Serialise a `MetaRecord` for storage. */
export const serializeMetaRecord = (record: MetaRecord): string => JSON.stringify(record);

/**
 * Parse `:prefs` — TOTAL-WITH-DEFAULT (§3.8). Any failure quietly falls back
 * to `DEFAULT_PREFS`. `parsePrefsRecord` NEVER returns `null` and NEVER
 * throws: a corrupt prefs blob is not an error the user should see.
 */
export const parsePrefsRecord = (raw: string): PrefsRecord => {
  const doc = parseJson(raw);
  if (!isPlainObject(doc)) return DEFAULT_PREFS;

  const renderQualityRaw = doc['renderQuality'];
  const renderQuality: PrefsRecord['renderQuality'] =
    renderQualityRaw === 'low' || renderQualityRaw === 'medium' || renderQualityRaw === 'high'
      ? renderQualityRaw
      : DEFAULT_PREFS.renderQuality;

  const sortRaw = doc['encyclopediaSort'];
  const encyclopediaSort: PrefsRecord['encyclopediaSort'] =
    sortRaw === 'updatedAt' || sortRaw === 'name' || sortRaw === 'currentCost'
      ? sortRaw
      : DEFAULT_PREFS.encyclopediaSort;

  const defaultBudgetRaw = doc['defaultBudget'];
  const defaultBudget =
    typeof defaultBudgetRaw === 'number' && Number.isFinite(defaultBudgetRaw)
      ? defaultBudgetRaw
      : null;

  const filterRaw = doc['encyclopediaFilter'];
  const filter = isPlainObject(filterRaw) ? filterRaw : {};
  const tagsRaw = filter['tags'];
  const tags: readonly string[] = Array.isArray(tagsRaw)
    ? tagsRaw.filter((t): t is string => typeof t === 'string')
    : [];
  const classIdRaw = filter['classId'];
  const classId = typeof classIdRaw === 'string' ? classIdRaw : null;

  return {
    reducedMotion: doc['reducedMotion'] === true,
    renderQuality,
    defaultBudget,
    encyclopediaSort,
    encyclopediaFilter: { tags, classId },
  };
};

/** Serialise a `PrefsRecord` for storage. */
export const serializePrefsRecord = (record: PrefsRecord): string => JSON.stringify(record);
