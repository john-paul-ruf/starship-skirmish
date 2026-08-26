// M08 Persist — LibraryRepo (specs/database.md §3 / §4 / §8, architecture §4).
//
// The Encyclopedia's durability seam. The N `:build:<uuid>` records are the
// source of truth; the `:index` blob is a rebuildable cache that Q7–Q10 and
// Q13–Q15 serve WITHOUT touching a `:build:` record (§3.4). One record read
// only on Q11 / Q16 / Q17, on explicit user action.
//
// The four load-bearing durability rules (§3, §10, FR-7):
//   1. Prefer an orphan to a dangle: `put` = record-first / index-second,
//      `remove` = index-first / record-second. Every write order fails toward
//      the recoverable side — an orphan record is invisible but rebuildable;
//      a dangling index entry is corruption the user sees.
//   2. `needsRefit` / `currentCost` live in the `IndexEntry`, never in a
//      `BuildRecord`. Cache key: `pricedAtCatalogVersion`.
//   3. Degrade never crash: `QuotaExceededError` at any write AND
//      `localStorage` unavailable both fall back to in-memory session mode
//      (FR-7). Unavailability is detected ONCE by a boot probe in
//      `storageAdapter.openStore`; quota is detected at each write.
//   4. The `starship-skirmish:` key prefix is non-negotiable (§3.1).
//
// Storage is INJECTED via `KeyValueStore` (`storageAdapter.ts`) so this file
// never touches a bare `localStorage` global — Vitest runs under Node.

import type { Catalog } from '../catalog/index.js';
import type { Build, RefitDiff } from '../domain/index.js';
import type { Loaded } from '../io/migrate/migrate.js';
import { finishLoad } from '../io/migrate/migrate.js';
import { INDEX_KEY, buildKey } from './keys.js';
import {
  bytesOf,
  headroom as headroomBytes,
  usageLevel,
  type UsageLevel,
} from './quota.js';
import {
  parseBuildRecord,
  parseIndexRecord,
  serializeBuild,
  serializeIndexRecord,
  type BuildDoc,
  type IndexEntry,
  type IndexRecord,
} from './records.js';
import {
  countBuildKeys,
  entryFromRecord,
  nameKeyOf,
} from './rebuildIndex.js';
import { rebuildIndex } from './rebuildIndex.js';
import { memoryStore, openStore, type KeyValueStore } from './storageAdapter.js';

// ---- Public surface -------------------------------------------------------

/** Sort axes the browse cache holds precomputed order for (§4, Q10). */
export type SortAxis = 'name' | 'updatedAt' | 'currentCost';

/** Direction on any sort axis. */
export type SortDirection = 'asc' | 'desc';

/**
 * The declarative browse query the UI passes to `list()`. Every field is
 * optional; missing → no filter on that axis. Multiple tags filter AND
 * (an entry must carry every tag). Cost bounds are inclusive.
 * Serves Q7–Q10 / Q13–Q15 without ever touching a `:build:` record (§3.4).
 */
export interface ListQuery {
  readonly tags?: readonly string[];
  readonly classId?: string;
  readonly minCost?: number;
  readonly maxCost?: number;
  readonly needsRefit?: boolean;
  readonly sort?: SortAxis;
  readonly direction?: SortDirection;
}

/**
 * Report from `headroom()` — used bytes, remaining bytes, and the UI band
 * (`ok` / `warn` / `critical`). Q15's shape.
 */
export interface HeadroomReport {
  readonly usedBytes: number;
  readonly remainingBytes: number;
  readonly level: UsageLevel;
}

/**
 * Result of a `put()` — success carries the freshly-cached `IndexEntry`;
 * failure carries a reason and (for quota exhaustion) a `degraded:true` flag
 * so the caller can surface the session-mode banner (FR-7). NEVER throws a
 * quota error past the boundary.
 */
export type PutResult =
  | { readonly ok: true; readonly entry: IndexEntry; readonly degraded?: true }
  | {
      readonly ok: false;
      readonly reason: 'ERR_QUOTA' | 'ERR_VALIDATION' | 'ERR_WRITE';
      readonly degraded?: true;
      readonly failureReason?: string;
    };

/**
 * Result of a `remove()` — always succeeds from the caller's perspective (the
 * in-memory index and the on-disk index are both cleared). `degraded:true`
 * surfaces if the store had to flip to session mode during the remove.
 */
export interface RemoveResult {
  readonly ok: true;
  readonly removed: boolean;
  readonly degraded?: true;
}

/**
 * The Encyclopedia's public surface. `list` / `headroom` never read a
 * `:build:` record; `get` reads ONE (Q11). `put`/`remove` honour §3.5's
 * record-first / index-first ordering.
 */
export interface LibraryRepo {
  /** Q7–Q10 / Q13–Q15 — filter/sort the cache without a record read. */
  list(query?: ListQuery): readonly IndexEntry[];
  /** Q11 — open one build. `null` on unknown id or a record that will not parse/validate. */
  get(id: string): Loaded | null;
  /** Persist a build. record-first / index-second (§3.5). Never throws quota past the boundary. */
  put(build: Build): PutResult;
  /**
   * Delete a build. index-first / record-second (§3.5). The UI is expected to
   * gate this behind a confirmation (F7/F8 — FR-7). Removing an unknown id
   * is a no-op that reports `removed: false`, never an error.
   */
  remove(id: string): RemoveResult;
  /** Q15 — storage headroom in bytes + the UI usage band. */
  headroom(): HeadroomReport;
  /** Sum of every `IndexEntry.bytes` — cheaper than `Σ bytesOf(k, v)`. */
  usedBytes(): number;
  /** Every entry in the index, including `status: 'failed'`. Order = deterministic (by id). */
  entries(): readonly IndexEntry[];
  /** Look up one entry (used by the UI to paint the `needs-refit` badge from cache). */
  entry(id: string): IndexEntry | undefined;
  /** Look up ids currently sharing this `nameKey` — O(1) import collision check (§3.6). */
  findByNameKey(nameKey: string): readonly string[];
  /** `true` while writes are still going to the durable store. Flips false after a session-mode degrade. */
  isDurable(): boolean;
}

/**
 * The result of opening the library — the repo the app talks to and a boolean
 * telling the UI whether writes survive a reload (FR-7 session-mode banner
 * paints on `durable === false`).
 */
export interface OpenedLibrary {
  readonly repo: LibraryRepo;
  readonly durable: boolean;
}

// ---- Options --------------------------------------------------------------

/**
 * Options to `openLibrary`. `store` (with its `durable` flag) is passed in for
 * tests + F7/F8 production wiring; when absent the boot probe in
 * `openStore()` decides. `now` is the clock the fresh index/meta records
 * stamp with — tests inject a stable string so a rebuild's serialised bytes
 * round-trip.
 */
export interface OpenLibraryOptions {
  readonly store?: KeyValueStore;
  readonly durable?: boolean;
  readonly now?: () => string;
}

// Default clock — a real ISO timestamp when no injection is provided.
const wallClock = (): string => new Date().toISOString();

// ---- In-memory §4 indexes --------------------------------------------------

interface InMemoryIndex {
  readonly byId: Map<string, IndexEntry>;
  readonly byTag: Map<string, Set<string>>;
  readonly byNameKey: Map<string, Set<string>>;
  all: IndexEntry[];
}

/** Rebuild the in-memory §4 indexes from a `readonly IndexEntry[]`. */
const indexFrom = (entries: readonly IndexEntry[]): InMemoryIndex => {
  const byId = new Map<string, IndexEntry>();
  const byTag = new Map<string, Set<string>>();
  const byNameKey = new Map<string, Set<string>>();
  for (const entry of entries) {
    byId.set(entry.id, entry);
    for (const tag of entry.tags) {
      let bucket = byTag.get(tag);
      if (bucket === undefined) {
        bucket = new Set();
        byTag.set(tag, bucket);
      }
      bucket.add(entry.id);
    }
    if (entry.nameKey.length > 0) {
      let bucket = byNameKey.get(entry.nameKey);
      if (bucket === undefined) {
        bucket = new Set();
        byNameKey.set(entry.nameKey, bucket);
      }
      bucket.add(entry.id);
    }
  }
  return { byId, byTag, byNameKey, all: [...entries] };
};

/** Insert or replace an entry in-place, maintaining every §4 index. Returns the previous entry (if any). */
const upsertEntry = (mem: InMemoryIndex, entry: IndexEntry): IndexEntry | undefined => {
  const prev = mem.byId.get(entry.id);
  if (prev !== undefined) removeEntryFromIndexes(mem, prev);

  mem.byId.set(entry.id, entry);
  for (const tag of entry.tags) {
    let bucket = mem.byTag.get(tag);
    if (bucket === undefined) {
      bucket = new Set();
      mem.byTag.set(tag, bucket);
    }
    bucket.add(entry.id);
  }
  if (entry.nameKey.length > 0) {
    let bucket = mem.byNameKey.get(entry.nameKey);
    if (bucket === undefined) {
      bucket = new Set();
      mem.byNameKey.set(entry.nameKey, bucket);
    }
    bucket.add(entry.id);
  }

  if (prev !== undefined) {
    const idx = mem.all.findIndex((e) => e.id === entry.id);
    if (idx >= 0) mem.all[idx] = entry;
    else mem.all.push(entry);
  } else {
    mem.all.push(entry);
  }
  mem.all.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return prev;
};

/** Remove an entry from every §4 index. Returns the entry that was there (or undefined). */
const removeEntry = (mem: InMemoryIndex, id: string): IndexEntry | undefined => {
  const entry = mem.byId.get(id);
  if (entry === undefined) return undefined;
  removeEntryFromIndexes(mem, entry);
  mem.byId.delete(id);
  const idx = mem.all.findIndex((e) => e.id === id);
  if (idx >= 0) mem.all.splice(idx, 1);
  return entry;
};

const removeEntryFromIndexes = (mem: InMemoryIndex, entry: IndexEntry): void => {
  for (const tag of entry.tags) {
    const bucket = mem.byTag.get(tag);
    if (bucket !== undefined) {
      bucket.delete(entry.id);
      if (bucket.size === 0) mem.byTag.delete(tag);
    }
  }
  if (entry.nameKey.length > 0) {
    const bucket = mem.byNameKey.get(entry.nameKey);
    if (bucket !== undefined) {
      bucket.delete(entry.id);
      if (bucket.size === 0) mem.byNameKey.delete(entry.nameKey);
    }
  }
};

// ---- Filtering / sorting --------------------------------------------------

const compareEntries = (axis: SortAxis, dir: SortDirection) => {
  const mult = dir === 'desc' ? -1 : 1;
  return (a: IndexEntry, b: IndexEntry): number => {
    let cmp = 0;
    switch (axis) {
      case 'name':
        cmp = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        break;
      case 'updatedAt':
        cmp = a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0;
        break;
      case 'currentCost':
        cmp = a.currentCost - b.currentCost;
        break;
    }
    // Stable tiebreak on id so the sort is deterministic.
    if (cmp === 0) cmp = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    return cmp * mult;
  };
};

const filterEntries = (
  all: readonly IndexEntry[],
  byTag: Map<string, Set<string>>,
  query: ListQuery,
): IndexEntry[] => {
  // Tag AND filter — intersect the per-tag id sets, then materialise entries.
  let ids: Set<string> | null = null;
  if (query.tags !== undefined && query.tags.length > 0) {
    for (const tag of query.tags) {
      const bucket = byTag.get(tag) ?? new Set<string>();
      if (ids === null) {
        ids = new Set(bucket);
      } else {
        for (const id of ids) if (!bucket.has(id)) ids.delete(id);
      }
      if (ids.size === 0) return [];
    }
  }

  const out: IndexEntry[] = [];
  for (const entry of all) {
    if (ids !== null && !ids.has(entry.id)) continue;
    if (query.classId !== undefined && entry.classId !== query.classId) continue;
    if (query.minCost !== undefined && entry.currentCost < query.minCost) continue;
    if (query.maxCost !== undefined && entry.currentCost > query.maxCost) continue;
    if (query.needsRefit !== undefined && entry.needsRefit !== query.needsRefit) continue;
    out.push(entry);
  }
  return out;
};

// ---- Quota detection ------------------------------------------------------

/**
 * The Web Storage spec pins the error name at `'QuotaExceededError'`; some
 * older engines used the DOM code `22`. We recognise both to be lenient
 * cross-engine — the point is to reliably distinguish "you're out of space"
 * from "you passed a garbage key".
 */
const isQuotaError = (e: unknown): boolean => {
  if (e === null || typeof e !== 'object') return false;
  const name = (e as { name?: unknown }).name;
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  const code = (e as { code?: unknown }).code;
  return code === 22 || code === 1014;
};

// ---- Boot -----------------------------------------------------------------

/**
 * Load the stored index and — if the stored count disagrees with the number
 * of `:build:` records — rebuild it.
 */
const loadIndex = (
  catalog: Catalog,
  store: KeyValueStore,
  now: () => string,
): { record: IndexRecord; healed: boolean } => {
  const raw = store.getItem(INDEX_KEY);
  const parsed = raw !== null ? parseIndexRecord(raw) : null;

  const buildKeyCount = countBuildKeys(store);
  if (parsed === null) {
    return { record: rebuildIndex(catalog, store, now), healed: raw !== null || buildKeyCount > 0 };
  }
  if (parsed.entries.length !== buildKeyCount) {
    return { record: rebuildIndex(catalog, store, now), healed: true };
  }
  return { record: parsed, healed: false };
};

/**
 * Re-price every entry whose `pricedAtCatalogVersion !== catalog.catalogVersion`.
 * O(n) exactly once per catalog bump (§3.4). Records that fail to parse or
 * validate are re-stamped as `status:'failed'` — the entry is retained
 * (isolation), not deleted.
 */
const reprice = (
  catalog: Catalog,
  store: KeyValueStore,
  entries: readonly IndexEntry[],
): { entries: IndexEntry[]; changed: boolean } => {
  let changed = false;
  const out: IndexEntry[] = [];
  for (const entry of entries) {
    if (entry.pricedAtCatalogVersion === catalog.catalogVersion && entry.status === 'ok') {
      out.push(entry);
      continue;
    }
    const raw = store.getItem(buildKey(entry.id));
    if (raw === null) {
      changed = true;
      out.push({
        ...entry,
        status: 'failed',
        failureReason: 'ERR_MISSING',
        pricedAtCatalogVersion: catalog.catalogVersion,
      });
      continue;
    }
    const bytes = bytesOf(buildKey(entry.id), raw);
    const parsed = parseBuildRecord(raw);
    if (parsed === null) {
      changed = true;
      out.push({
        ...entry,
        bytes,
        status: 'failed',
        failureReason: 'ERR_PARSE',
        pricedAtCatalogVersion: catalog.catalogVersion,
      });
      continue;
    }
    const reComputed = entryFromRecord(catalog, entry.id, parsed, bytes);
    changed = true;
    out.push(reComputed);
  }
  return { entries: out, changed };
};

// ---- openLibrary -----------------------------------------------------------

/**
 * Open the Encyclopedia. Boot pipeline (§3.5):
 *   1. Feature-detect / accept the injected store.
 *   2. Load `:index`; missing / unparseable / count-mismatch → rebuild.
 *   3. Re-price entries whose cache key ≠ current catalog version.
 *   4. Persist the resulting index if it changed (fail-soft — a write failure
 *      surfaces at first `put`, boot still returns a usable repo).
 *   5. Build in-memory §4 indexes and return the repo.
 *
 * NEVER throws across its boundary. `durable === false` in the return means
 * the app must show the session-mode banner (FR-7).
 */
export const openLibrary = (
  catalog: Catalog,
  opts: OpenLibraryOptions = {},
): OpenedLibrary => {
  const opened =
    opts.store !== undefined
      ? { store: opts.store, durable: opts.durable ?? false }
      : openStore();

  const now = opts.now ?? wallClock;

  // Mutable state — a quota failure at any write flips `currentStore` to a
  // fresh memory store (§3.7 degrade, FR-7). `currentDurable` mirrors that.
  let currentStore: KeyValueStore = opened.store;
  let currentDurable = opened.durable;

  const { record: loaded, healed } = loadIndex(catalog, currentStore, now);
  const { entries: repriced, changed: repricedChanged } = reprice(
    catalog,
    currentStore,
    loaded.entries,
  );

  const initialIndex: IndexRecord = repriced === loaded.entries && !healed
    ? loaded
    : { schemaVersion: 1, updatedAt: now(), entries: repriced };

  if (healed || repricedChanged) {
    // Fail-soft: a quota failure on the boot index write means the store is
    // full BEFORE we even try a user-facing put. Degrade now.
    if (!trySetItem(currentStore, INDEX_KEY, serializeIndexRecord(initialIndex))) {
      const fresh = copyToMemory(currentStore);
      currentStore = fresh;
      currentDurable = false;
      trySetItem(currentStore, INDEX_KEY, serializeIndexRecord(initialIndex));
    }
  }

  const mem = indexFrom(initialIndex.entries);

  // ---- private helpers over the mutable state ----------------------------

  const persistIndex = (): { ok: boolean; degraded: boolean } => {
    const record: IndexRecord = { schemaVersion: 1, updatedAt: now(), entries: mem.all };
    const raw = serializeIndexRecord(record);
    if (trySetItem(currentStore, INDEX_KEY, raw)) return { ok: true, degraded: false };
    // First write failed; try degrading and retrying once.
    const fresh = copyToMemory(currentStore);
    currentStore = fresh;
    currentDurable = false;
    return { ok: trySetItem(currentStore, INDEX_KEY, raw), degraded: true };
  };

  // ---- put ---------------------------------------------------------------

  const put = (build: Build): PutResult => {
    // Stamp meta: updatedAt always fresh; createdAt preserved if present.
    const nowStamp = now();
    const record: BuildDoc = {
      ...build,
      createdAt: build.createdAt !== '' ? build.createdAt : nowStamp,
      updatedAt: nowStamp,
    };
    const key = buildKey(record.id);
    const value = serializeBuild(record);

    // Step 1 — record first (§3.5). QuotaError → degrade + retry once.
    let degraded = false;
    if (!trySetItem(currentStore, key, value)) {
      const fresh = copyToMemory(currentStore);
      currentStore = fresh;
      currentDurable = false;
      degraded = true;
      if (!trySetItem(currentStore, key, value)) {
        return { ok: false, reason: 'ERR_QUOTA', degraded: true };
      }
    }

    // Step 2 — compute the fresh entry (runs the full migrate pipeline so a
    // caller-broken Build is caught here rather than corrupting the index).
    const bytes = bytesOf(key, value);
    const entry = entryFromRecord(
      catalog,
      record.id,
      record as unknown as Readonly<Record<string, unknown>>,
      bytes,
    );
    if (entry.status === 'failed') {
      // The record IS on disk (§3.5 "prefer orphan"). Retain it as a failed
      // entry so it surfaces in the UI; the caller sees ERR_VALIDATION.
      upsertEntry(mem, entry);
      const idxResult = persistIndex();
      if (idxResult.degraded) degraded = true;
      return {
        ok: false,
        reason: 'ERR_VALIDATION',
        ...(entry.failureReason !== undefined ? { failureReason: entry.failureReason } : {}),
        ...(degraded ? { degraded: true as const } : {}),
      };
    }

    upsertEntry(mem, entry);
    const idxResult = persistIndex();
    if (idxResult.degraded) degraded = true;

    return degraded ? { ok: true, entry, degraded: true } : { ok: true, entry };
  };

  // ---- remove -----------------------------------------------------------

  const remove = (id: string): RemoveResult => {
    const existing = mem.byId.get(id);
    if (existing === undefined) return { ok: true, removed: false };

    // Step 1 — index first (§3.5). Remove in-memory, then persist.
    removeEntry(mem, id);
    let degraded = false;
    const idxResult = persistIndex();
    if (idxResult.degraded) degraded = true;

    // Step 2 — delete the record. removeItem shouldn't fail; if it does,
    // we tolerate — the entry is already gone from the index (§3.5 preferred
    // orphan direction: even here we prefer an orphan record over a dangle).
    try {
      currentStore.removeItem(buildKey(id));
    } catch {
      // Ignore — the index no longer references it.
    }

    return degraded ? { ok: true, removed: true, degraded: true } : { ok: true, removed: true };
  };

  const repo: LibraryRepo = {
    list(query = {}) {
      const filtered = filterEntries(mem.all, mem.byTag, query);
      const axis = query.sort ?? 'updatedAt';
      const direction = query.direction ?? (axis === 'updatedAt' ? 'desc' : 'asc');
      filtered.sort(compareEntries(axis, direction));
      return filtered;
    },
    get(id) {
      const entry = mem.byId.get(id);
      if (entry === undefined) return null;
      if (entry.status === 'failed') return null;
      const raw = currentStore.getItem(buildKey(id));
      if (raw === null) return null;
      const parsed = parseBuildRecord(raw);
      if (parsed === null) return null;
      const meta = {
        id,
        schemaVersion: entry.schemaVersion,
        catalogVersion: entry.catalogVersion,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      };
      const loaded = finishLoad(catalog, parsed, meta, { priceFresh: false });
      if (!loaded.ok) return null;
      return loaded.value;
    },
    put,
    remove,
    headroom() {
      let used = 0;
      for (const entry of mem.all) used += entry.bytes;
      return { usedBytes: used, remainingBytes: headroomBytes(used), level: usageLevel(used) };
    },
    usedBytes() {
      let used = 0;
      for (const entry of mem.all) used += entry.bytes;
      return used;
    },
    entries() {
      return mem.all;
    },
    entry(id) {
      return mem.byId.get(id);
    },
    findByNameKey(nameKey) {
      const bucket = mem.byNameKey.get(nameKey);
      return bucket === undefined ? [] : [...bucket];
    },
    isDurable() {
      return currentDurable;
    },
  };

  return { repo, durable: currentDurable };
};

// ---- Low-level store helpers ----------------------------------------------

/** `setItem` behind a `try` — returns `false` on ANY throw. Quota is the only expected class. */
const trySetItem = (store: KeyValueStore, key: string, value: string): boolean => {
  try {
    store.setItem(key, value);
    return true;
  } catch (e) {
    if (isQuotaError(e)) return false;
    // A non-quota error is a bug in the store impl; still swallow — we must
    // NEVER throw a storage error past the persist boundary (FR-7).
    return false;
  }
};

/**
 * Snapshot every key/value from `src` into a fresh `memoryStore()`. The
 * copy is best-effort — if a specific key can't be written (unlikely on an
 * uncapped memory store), we drop it rather than propagate. Called at the
 * moment we detect quota exhaustion so the app keeps working with its
 * existing data.
 */
const copyToMemory = (src: KeyValueStore): KeyValueStore => {
  const fallback = memoryStore();
  for (const key of src.keys()) {
    const value = src.getItem(key);
    if (value !== null) {
      try {
        fallback.setItem(key, value);
      } catch {
        // ignore
      }
    }
  }
  return fallback;
};

// Re-export helpers a caller might want alongside the repo API.
export { nameKeyOf };
export type { RefitDiff };
