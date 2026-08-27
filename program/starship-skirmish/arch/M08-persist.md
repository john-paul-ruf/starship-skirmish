# M08 — Persist (`src/persist/`)

> Per-module architecture detail for M08, accreted per session under Jikijitsu.
> Full canonical contract in `specs/architecture.md` §4 + `specs/database.md` §3.
> The Encyclopedia's durability story: `localStorage` behind a `LibraryRepo`, an index that is a
> rebuildable cache over authoritative `:build:<id>` records.

<!-- SESSION-03 -->
## M08 Persist — public surface (created)

Path: `src/persist/`. Depends on: `domain`, `catalog`, `src/io/migrate/migrate.js`,
`src/io/limits.js`. Storage is INJECTED via a narrow `KeyValueStore` seam —
`src/persist/**` never touches a bare `localStorage` global (Vitest runs under
Node). Every write is degrade-aware: quota exhaustion at any setItem flips the
repo to in-memory session mode WITHOUT throwing across the boundary (FR-7,
§3.7). All parsers are TOTAL — `parsePrefsRecord` never returns null (§3.8
total-with-default), every other `parse*` returns `null` on JSON garbage so the
caller flags a `status:'failed'` index entry (§3.5 failure isolation).

### Barrel — `src/persist/index.ts`

```ts
export {
  openLibrary,                          // (catalog, { store?, durable?, now? }) → OpenedLibrary
  type LibraryRepo,                     // the app-facing repo
  type OpenedLibrary,                   // { repo, durable }
  type OpenLibraryOptions,
  type ListQuery,                       // { tags?, classId?, minCost?, maxCost?, needsRefit?, sort?, direction? }
  type HeadroomReport,                  // { usedBytes, remainingBytes, level }
  type PutResult,                       // { ok:true, entry, degraded? } | { ok:false, reason, degraded?, failureReason? }
  type RemoveResult,                    // { ok:true, removed, degraded? }
  type SortAxis, type SortDirection,
} from './LibraryRepo.js';

export {
  applyImport,                          // (repo, candidates, policy) → ImportReport
  mintUniqueName,                       // (base, isTaken, maxLength?) — collision-free suffixing
  type ImportCandidate,                 // { status:'valid', build:BuildDoc } | { status:'failed', reason, sourceIndex? }
  type ImportPolicy,                    // 'rename' | 'replace' | 'skip'
  type ImportOutcome,                   // discriminated: imported | renamed | skipped | replaced | failed
  type ImportReport,                    // { imported, renamed, replaced, skipped, failed, outcomes, degraded }
  type ImportFailureReason,
} from './applyImport.js';

export {
  DEFAULT_PREFS,
  type BuildDoc,                        // the durable Build shape (structurally = domain.Build; no needsRefit/currentCost)
  type IndexEntry,                      // browse cache row — carries denormalised classId + cached currentCost/needsRefit/pricedAtCatalogVersion
  type IndexEntryStatus,                // 'ok' | 'failed'
  type IndexRecord,                     // stored :index blob
  type MetaRecord,                      // stored :meta blob — first-run bookkeeping + lastExportAt
  type PrefsRecord,                     // stored :prefs blob — reducedMotion / renderQuality / sort / filter
} from './records.js';

export {
  CRITICAL_AT, WARN_AT, STORAGE_BUDGET_BYTES,   // 0.95, 0.80, imported from io/limits — persist owns the ratio only
  bytesOf,                                       // (k, v) → UTF-16 code units × 2 (§3.7)
  headroom, usageLevel, type UsageLevel,        // 'ok' | 'warn' | 'critical'
} from './quota.js';
```

### `LibraryRepo` — method list

| Method | Purpose | Query # |
|---|---|---|
| `list(query?)` | Browse the index without touching a `:build:` record | Q7–Q10, Q13–Q15 |
| `get(id)` | Open ONE build via `finishLoad(priceFresh:false)` — `null` on unknown/failed | Q11 |
| `put(build)` | Persist a Build. Record-first / index-second (§3.5); quota-aware | — |
| `remove(id)` | Delete a Build. Index-first / record-second (§3.5); confirmation-gated in UI | — |
| `headroom()` | `{ usedBytes, remainingBytes, level }` | Q15 |
| `usedBytes()` | Cached `Σ IndexEntry.bytes` | — |
| `entries()` | Every entry (incl. `status:'failed'`), deterministic order (id) | — |
| `entry(id)` | Single `IndexEntry` for badge painting | — |
| `findByNameKey(nameKey)` | O(1) import-collision check (§3.6) | Q12 |
| `isDurable()` | `false` after a session-mode degrade — UI banner signal | — |
| `lastExportAt()` | Meta timestamp for the recurring backup nudge | — |
| `markExported(at)` | Stamp `:meta.lastExportAt` after a successful export | — |
| `loadPrefs()` | TOTAL — corrupt/missing → `DEFAULT_PREFS` (§3.8) | — |
| `savePrefs(prefs)` | Fail-soft prefs write | — |

### Boot pipeline — `openLibrary` (§3.5)

1. `openStore(injected?)` → `{ store, durable }` (boot probe on ambient localStorage, otherwise memory fallback).
2. Load `:index`; missing / unparseable / entry-count-mismatch → `rebuildIndex` from `:build:<id>` records (self-heal; §3.5).
3. Re-price any entry where `pricedAtCatalogVersion !== catalog.catalogVersion` — one O(n) pass per catalog bump, then O(0) forever (§3.4).
4. Persist the fresh index if it changed (fail-soft — quota → degrade to memory).
5. Mint or load `:meta`; persist if freshly minted.
6. Build the in-memory §4 indexes (`byId`, `byTag`, `byNameKey`) and return `{ repo, durable }`.

Every write ordering fails toward the recoverable side (§3.5 "prefer orphan"):
`put` writes the record before the index; `remove` writes the index before the
record; `applyImport` writes each record before the (per-put) index update.

### Consumers (F7/F8, `src/app`)

- `openLibrary(catalog, { store, durable })` at boot — production wiring passes
  `{ store: localStorageStore(localStorage), durable: true }` via `src/persist/storageAdapter.ts`.
- `durable === false` → surface the session-mode banner (FR-7).
- `list` / `entry(id).needsRefit` / `entry(id).currentCost` for browse + refit badge (Q7–Q10, cached).
- `get(id)` for open/duplicate/compare (Q11 / Q16 / Q17).
- `put` for save / duplicate / needs-refit re-save.
- `remove` for delete-with-confirmation (F7/F8 gates the confirm; persist does the ordered delete).
- `markExported(now())` + `lastExportAt()` for the recurring backup nudge (FR-7 Decision 5).
- `applyImport(repo, io.importLibrary(text).candidates, policy)` for the import
  dialog — rename / replace / skip / cancel; chunk-across-frames loop is UI.

### Types the barrel intentionally does NOT expose

- `KeyValueStore`, `memoryStore`, `localStorageStore`, `openStore` — the storage
  seam. Import these directly from `src/persist/storageAdapter.js` only from
  tests and from the composition root (`src/app`). UI code never constructs a
  store.
- `parseBuildRecord` / `serializeBuild` / `parseIndexRecord` / etc. — internals
  of the repo. UI never hand-rolls records.
- `rebuildIndex` / `nameKeyOf` / `entryFromRecord` / `countBuildKeys` — persist
  internals. Tests reach in when they must; production code goes through the
  repo API.
