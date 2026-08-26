// M08 Persist — self-heal by rebuilding the browse cache from the source of truth
// (specs/database.md §3.4 / §3.5, FR-2 failure isolation).
//
// The `:index` blob is a cache. The N `:build:<uuid>` records are the database.
// Rebuild enumerates every `:build:` key, runs each through the same load
// pipeline `LibraryRepo.get` uses (`src/io/migrate/migrate.ts`), and stamps an
// `IndexEntry` per outcome:
//
//   * plain-JSON garbage / non-object                 → status:'failed', 'ERR_PARSE'
//   * parseable but fails validation (FK / caps)      → status:'failed', migrate error code
//   * valid                                           → status:'ok', full re-price cache
//
// FAILURE ISOLATION is load-bearing (§3.5, FR-2): one bad record NEVER blocks
// or destroys the rest of the Encyclopedia. A `status:'failed'` entry is
// retained in the index so the UI can surface it; only an explicit `remove()`
// deletes anything.
//
// Deterministic output: entries sorted by id. Callers that need a UI-visible
// order re-sort per axis; the on-disk order stays stable so a `git diff` on a
// serialised index round-trips.

import type { Catalog } from '../catalog/index.js';
import type { BuildMeta } from '../domain/index.js';
import { pointCost } from '../domain/index.js';
import { migrate } from '../io/migrate/migrate.js';
import { BUILD_PREFIX, parseBuildKey } from './keys.js';
import { bytesOf } from './quota.js';
import { parseBuildRecord, type IndexEntry, type IndexRecord } from './records.js';
import type { KeyValueStore } from './storageAdapter.js';

// ---- nameKey — the O(1) import-collision key (§3.6) -----------------------

/**
 * NFC-normalise, lowercase, and collapse whitespace so `"Wasp  Alpha"` and
 * `" wasp alpha "` compare equal on import. `nameKey` is DELIBERATELY NOT a
 * unique constraint (§3.6) — this is the collision hash, not the enforcement.
 */
export const nameKeyOf = (name: string): string =>
  name.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

// ---- Meta scaffold for the load pipeline ----------------------------------

/**
 * `migrate()` requires a `BuildMeta` for identity + version stamping. On a
 * rebuild pass the record's OWN id/timestamps are the historical truth, so we
 * plumb them through unchanged; if the record is corrupt (parseBuildRecord
 * returned null) rebuild does not call migrate at all.
 */
const metaFromRecord = (
  id: string,
  createdAt: unknown,
  updatedAt: unknown,
  schemaVersion: unknown,
  catalogVersion: unknown,
  fallbackCatalogVersion: number,
): BuildMeta => ({
  id,
  schemaVersion: typeof schemaVersion === 'number' && Number.isFinite(schemaVersion) ? schemaVersion : 1,
  catalogVersion:
    typeof catalogVersion === 'number' && Number.isFinite(catalogVersion)
      ? catalogVersion
      : fallbackCatalogVersion,
  createdAt: typeof createdAt === 'string' ? createdAt : '',
  updatedAt: typeof updatedAt === 'string' ? updatedAt : '',
});

/** An `IndexEntry` for a record that could not be salvaged — id + bytes only. */
const failedEntry = (id: string, bytes: number, reason: string): IndexEntry => ({
  id,
  name: '',
  nameKey: '',
  tags: [],
  chassisId: '',
  classId: '',
  storedCost: 0,
  currentCost: 0,
  needsRefit: false,
  pricedAtCatalogVersion: 0,
  schemaVersion: 0,
  catalogVersion: 0,
  createdAt: '',
  updatedAt: '',
  bytes,
  status: 'failed',
  failureReason: reason,
});

// ---- Rebuild --------------------------------------------------------------

/**
 * Rebuild the `IndexRecord` from every `:build:<uuid>` in `store`. Runs when
 * `:index` is missing, unparseable, or when its entry count disagrees with
 * the key count (§3.5). Never throws; never writes.
 *
 * `now` is the caller-supplied timestamp for the record's `updatedAt` — kept
 * out-of-parameters-to-Date so tests can inject a stable clock (§3.7 boot
 * probe + rebuild tests use the same seam).
 */
export const rebuildIndex = (
  catalog: Catalog,
  store: KeyValueStore,
  now: () => string,
): IndexRecord => {
  const entries: IndexEntry[] = [];
  for (const key of store.keys()) {
    const id = parseBuildKey(key);
    if (id === null) continue;

    const raw = store.getItem(key);
    if (raw === null) continue; // Concurrent remove between keys() and getItem()

    const bytes = bytesOf(key, raw);
    const parsed = parseBuildRecord(raw);
    if (parsed === null) {
      entries.push(failedEntry(id, bytes, 'ERR_PARSE'));
      continue;
    }

    entries.push(entryFromRecord(catalog, id, parsed, bytes));
  }

  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    schemaVersion: 1,
    updatedAt: now(),
    entries,
  };
};

/**
 * Compose one `IndexEntry` for a build record that at least passed the JSON /
 * shape guard in `parseBuildRecord`. Full FK / caps validation runs through
 * `migrate()`; a validation failure → `status:'failed'` (retained, isolated).
 */
export const entryFromRecord = (
  catalog: Catalog,
  id: string,
  raw: Readonly<Record<string, unknown>>,
  bytes: number,
): IndexEntry => {
  const meta = metaFromRecord(
    id,
    raw['createdAt'],
    raw['updatedAt'],
    raw['schemaVersion'],
    raw['catalogVersion'],
    catalog.catalogVersion,
  );
  const loaded = migrate(catalog, raw, meta);
  if (!loaded.ok) {
    return failedEntry(id, bytes, loaded.error.code);
  }

  const { build, refit } = loaded.value;
  const chassis = catalog.chassis(build.chassisId);
  const classId = chassis?.classId ?? '';
  const currentCost = refit !== null ? refit.newTotal : pointCost(catalog, build);
  const nameKey = nameKeyOf(build.name);

  return {
    id: build.id,
    name: build.name,
    nameKey,
    tags: build.tags,
    chassisId: build.chassisId,
    classId,
    storedCost: build.storedCost,
    currentCost,
    needsRefit: refit !== null,
    pricedAtCatalogVersion: catalog.catalogVersion,
    schemaVersion: build.schemaVersion,
    catalogVersion: build.catalogVersion,
    createdAt: build.createdAt,
    updatedAt: build.updatedAt,
    bytes,
    status: 'ok',
  };
};

/**
 * Count storage keys that look like `:build:<id>` — cheap check the boot path
 * uses to detect "the loaded index has fewer entries than the store has
 * records" (an orphan situation §3.5 tells us to rebuild through).
 */
export const countBuildKeys = (store: KeyValueStore): number => {
  let n = 0;
  for (const key of store.keys()) {
    if (key.startsWith(BUILD_PREFIX)) n += 1;
  }
  return n;
};
