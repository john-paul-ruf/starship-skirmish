// M08 Persist — public surface (architecture §4, specs/database.md §3 / §8).
//
// Everything downstream (F7/F8 Encyclopedia UI, `src/app` composition root)
// imports from this barrel. Individual files stay internal so a later
// refactor of the storage seam (adapter swap, migration to IndexedDB per
// architecture open question §5) doesn't ripple across consumers.
//
// What the barrel INTENTIONALLY does NOT expose:
//   * `KeyValueStore`, `memoryStore`, `localStorageStore` — these are the
//     `storageAdapter.ts` seam. F7/F8 does NOT construct stores; production
//     wiring lives in `src/app`. Tests import them directly if needed.
//   * `parseBuildRecord` / `serializeBuild` and friends — these are internals
//     of the repo. UI consumers should never hand-roll records.
//   * `rebuildIndex` / `nameKeyOf` — persist-internal helpers.

export {
  openLibrary,
  type LibraryRepo,
  type OpenedLibrary,
  type OpenLibraryOptions,
  type ListQuery,
  type HeadroomReport,
  type PutResult,
  type RemoveResult,
  type SortAxis,
  type SortDirection,
} from './LibraryRepo.js';

export {
  applyImport,
  mintUniqueName,
  type ImportCandidate,
  type ImportPolicy,
  type ImportOutcome,
  type ImportReport,
  type ImportFailureReason,
} from './applyImport.js';

export {
  DEFAULT_PREFS,
  type BuildDoc,
  type IndexEntry,
  type IndexEntryStatus,
  type IndexRecord,
  type MetaRecord,
  type PrefsRecord,
} from './records.js';

export {
  CRITICAL_AT,
  STORAGE_BUDGET_BYTES,
  WARN_AT,
  bytesOf,
  headroom,
  usageLevel,
  type UsageLevel,
} from './quota.js';
