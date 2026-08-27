// M14 UI — Encyclopedia pure model (S04 checkpoint 1).
//
// Node-testable browse-view logic: the FilterBar's view state, its round trip
// with the sticky `PrefsRecord` axes (§3.8), its lowering to a persist
// `ListQuery`, the free-text search the repo does not do, and the small
// selection helpers the multi-select card grid + selection bar share.
//
// This file is deliberately `.ts` (no `.tsx`) and imports only types and pure
// constants — the tsconfig.node.json test build traverses transitive imports,
// so pulling a screen `.tsx` in would break unit typecheck (S02 handoff). All
// UI composition stays in the sibling `.tsx` files.

import type { ChassisClass, SlotType } from '../../../catalog/index.js';
import { SLOT_LETTER, SLOT_ORDER } from '../../components/index.js';
import type {
  IndexEntry,
  ListQuery,
  PrefsRecord,
  SortAxis,
  SortDirection,
} from '../../../persist/index.js';

// ---- View state -----------------------------------------------------------

/**
 * Everything the FilterBar drives, in one immutable shape. The repo owns the
 * tag / class / sort axes (`ListQuery`); text search is a local overlay because
 * `ListQuery` deliberately does not include one — it's a screen concern, not a
 * durable cache axis.
 *
 * `sort` is intentionally the persist `SortAxis` (three values: `updatedAt`,
 * `name`, `currentCost`) — those are the axes the browse cache holds sorted
 * order for (§4, Q10). The mock's fourth "CLASS" column would need either a
 * cache axis persist doesn't ship (outside lease) or a pure-JS sort past the
 * repo (loses O(0)); we keep to the three the cache supports and record the
 * omission in the handoff.
 */
export interface EncyclopediaView {
  readonly search: string;
  readonly tags: readonly string[];
  readonly classId: ChassisClass | null;
  readonly needsRefitOnly: boolean;
  readonly sort: SortAxis;
  readonly direction: SortDirection;
}

/** Fresh view state — matches the persist DEFAULT_PREFS axes byte-for-byte. */
export const DEFAULT_VIEW: EncyclopediaView = {
  search: '',
  tags: [],
  classId: null,
  needsRefitOnly: false,
  sort: 'updatedAt',
  direction: 'desc',
};

/**
 * Default sort direction per axis — `updatedAt` reads best newest-first;
 * `name` and `currentCost` read best ascending. Kept centralised so the
 * FilterBar and the prefs-hydrator can't drift.
 */
export const defaultDirectionFor = (axis: SortAxis): SortDirection =>
  axis === 'updatedAt' ? 'desc' : 'asc';

// ---- Prefs round-trip -----------------------------------------------------

const CHASSIS_CLASS_VALUES: readonly ChassisClass[] = [
  'fighter',
  'frigate',
  'cruiser',
  'mega-destroyer',
];

/** Coerce a stored prefs `classId` string into a `ChassisClass`; unknown → null. */
export const classIdFromString = (raw: string | null): ChassisClass | null => {
  if (raw === null) return null;
  for (const c of CHASSIS_CLASS_VALUES) if (c === raw) return c;
  return null;
};

/**
 * Seed a fresh `EncyclopediaView` from stored prefs (§3.8). Prefs never carry
 * the search text or the `needsRefit` filter — those are session-scoped, not
 * sticky across visits.
 */
export const viewFromPrefs = (prefs: PrefsRecord): EncyclopediaView => ({
  search: '',
  tags: prefs.encyclopediaFilter.tags,
  classId: classIdFromString(prefs.encyclopediaFilter.classId),
  needsRefitOnly: false,
  sort: prefs.encyclopediaSort,
  direction: defaultDirectionFor(prefs.encyclopediaSort),
});

/**
 * Fold the sticky axes of the view back into a `PrefsRecord` for `savePrefs`.
 * Search text and needsRefit are session-scoped and not persisted (§3.8).
 */
export const applyViewToPrefs = (prefs: PrefsRecord, view: EncyclopediaView): PrefsRecord => ({
  ...prefs,
  encyclopediaSort: view.sort,
  encyclopediaFilter: {
    tags: view.tags,
    classId: view.classId,
  },
});

// ---- Query lowering -------------------------------------------------------

/**
 * Lower the view into a persist `ListQuery`. Text search is intentionally
 * omitted — the repo cannot do it (Q7–Q10, §3.4). The screen applies text
 * search downstream in `filterByText`.
 *
 * Optional fields are only emitted when they carry meaning (undefined ≠ empty
 * array); persist honours "missing → no filter on that axis".
 */
export const viewToListQuery = (view: EncyclopediaView): ListQuery => {
  const query: {
    sort: SortAxis;
    direction: SortDirection;
    tags?: readonly string[];
    classId?: string;
    needsRefit?: boolean;
  } = {
    sort: view.sort,
    direction: view.direction,
  };
  if (view.tags.length > 0) query.tags = view.tags;
  if (view.classId !== null) query.classId = view.classId;
  if (view.needsRefitOnly) query.needsRefit = true;
  return query;
};

// ---- Text search ----------------------------------------------------------

/**
 * Free-text filter over already-sorted `list()` output. Case-insensitive
 * substring match on name, chassisId (raw permanent id), classId, and any tag.
 * Blank / whitespace-only search returns the input unchanged.
 *
 * Deliberately pure: no locale collation (`toLocaleLowerCase` differs across
 * engines and matters for determinism), no regex (untrusted user text). A
 * hand-rolled `indexOf` per axis is enough — the browse cache is small.
 */
export const filterByText = (
  entries: readonly IndexEntry[],
  search: string,
): readonly IndexEntry[] => {
  const q = search.trim().toLowerCase();
  if (q.length === 0) return entries;
  const out: IndexEntry[] = [];
  for (const entry of entries) {
    if (matchesText(entry, q)) out.push(entry);
  }
  return out;
};

const matchesText = (entry: IndexEntry, q: string): boolean => {
  if (entry.name.toLowerCase().includes(q)) return true;
  if (entry.chassisId.toLowerCase().includes(q)) return true;
  if (entry.classId.toLowerCase().includes(q)) return true;
  for (const tag of entry.tags) {
    if (tag.toLowerCase().includes(q)) return true;
  }
  return false;
};

// ---- Selection helpers ---------------------------------------------------

/**
 * Toggle an id inside the selection set. Returns a fresh list either way —
 * the `useSignal` consumer relies on reference change to re-render. Order is
 * append-on-first-select (predictable for the selection bar's summary line).
 */
export const toggleSelection = (
  selection: readonly string[],
  id: string,
): readonly string[] => {
  const idx = selection.indexOf(id);
  if (idx >= 0) {
    const next = [...selection];
    next.splice(idx, 1);
    return next;
  }
  return [...selection, id];
};

/**
 * Prune ids no longer present in the current entry set. The filter bar or a
 * removal can hide a previously selected build — the selection must not carry
 * ghost ids past the next commit.
 */
export const pruneSelection = (
  selection: readonly string[],
  entries: readonly IndexEntry[],
): readonly string[] => {
  if (selection.length === 0) return selection;
  const visible = new Set<string>();
  for (const e of entries) visible.add(e.id);
  const out: string[] = [];
  for (const id of selection) if (visible.has(id)) out.push(id);
  return out.length === selection.length ? selection : out;
};

/** Sum of `currentCost` across the currently-selected entries — the selbar summary. */
export const summariseSelectedCost = (
  selection: readonly string[],
  entries: readonly IndexEntry[],
): number => {
  if (selection.length === 0) return 0;
  const selected = new Set(selection);
  let total = 0;
  for (const e of entries) if (selected.has(e.id)) total += e.currentCost;
  return total;
};

// ---- Layout summary -------------------------------------------------------

/**
 * The mock's `3W/2S/2M/1E/2X` fit-shape line derived from a class layout.
 * Groups by `SLOT_ORDER` (identity components), skipping types the class does
 * not include (fighter has no missile bays, so it renders `1W/1E/1X`).
 *
 * IndexEntry does NOT carry a filled-count (persist §3.2 keeps only `storedCost`
 * / `currentCost` denorms, not per-slot fill). Rendering per-slot pip fill on
 * a card would force an O(N) record read past the cache — this shape line is
 * the honest browse-time readout; the DeleteModal (which already reads the
 * record) renders the truthful `SlotPips`.
 */
export const layoutSummary = (layout: readonly SlotType[]): string => {
  const counts: Record<SlotType, number> = {
    weapon: 0,
    shield: 0,
    missile: 0,
    engine: 0,
    special: 0,
  };
  for (const t of layout) counts[t] += 1;
  const parts: string[] = [];
  for (const t of SLOT_ORDER) {
    const c = counts[t];
    if (c > 0) parts.push(`${String(c)}${SLOT_LETTER[t]}`);
  }
  return parts.join('/');
};

// ---- Refit receipt --------------------------------------------------------

/**
 * The `⚠ NEEDS REFIT` receipt line the design mandates (§4.7). Text-only so
 * the derivation is pure — the BuildCard renders it inside a `.banner`.
 * The badge is a RECEIPT, not a lock: the caller never blocks any action on
 * `needsRefit`.
 */
export const refitReceiptText = (
  writtenAtCatalogVersion: number,
  currentCatalogVersion: number,
  oldTotal: number,
  newTotal: number,
): string =>
  `Catalog v${String(writtenAtCatalogVersion)} → v${String(currentCatalogVersion)}. ` +
  `Recalculated ${String(oldTotal)} → ${String(newTotal)} PTS.`;

// ---- Tag palette + filter status ------------------------------------------

/**
 * Enumerate the distinct tags across an entry list, sorted for stable UI.
 * Powers the FilterBar's tag chip row — the catalog never names tags
 * (FR-1 negative-space), so the palette is derived from live data.
 */
export const collectAvailableTags = (
  entries: readonly IndexEntry[],
): readonly string[] => {
  const seen = new Set<string>();
  for (const e of entries) {
    for (const t of e.tags) seen.add(t);
  }
  return [...seen].sort();
};

/** True if the view carries any filter (excluding sort axis). */
export const isViewFiltered = (view: EncyclopediaView): boolean =>
  view.search.trim().length > 0 ||
  view.tags.length > 0 ||
  view.classId !== null ||
  view.needsRefitOnly;

// ---- Class human names ---------------------------------------------------

/**
 * Map a `ChassisClass` id to its uppercase display label (matches the mock's
 * chip / t-label caps). Kept here so BuildCard + FilterBar single-source the
 * spelling; `catalog.classOf(id).name` is the underlying source of truth but
 * that requires a live catalog reference the FilterBar chip row doesn't need.
 */
export const CLASS_LABEL: Readonly<Record<ChassisClass, string>> = {
  fighter: 'FIGHTER',
  frigate: 'FRIGATE',
  cruiser: 'CRUISER',
  'mega-destroyer': 'MEGA DESTROYER',
};

/** All four class ids, in the fixed catalog display order (light → heavy). */
export const CLASS_ORDER: readonly ChassisClass[] = [
  'fighter',
  'frigate',
  'cruiser',
  'mega-destroyer',
];
