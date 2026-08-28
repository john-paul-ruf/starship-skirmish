// M14 UI — Encyclopedia model tests (S04 checkpoint 1).
//
// Node-env only: `model.ts` imports types + pure constants, so tsc.node walks
// its transitive graph safely (no `.tsx` reachable). Every case here is a
// pure function invocation — no DOM, no fake timers.
//
// What we pin down here:
//   1. `viewFromPrefs` / `applyViewToPrefs` round-trip on the sticky axes and
//      ignore the session-scoped ones (search + needsRefitOnly).
//   2. `viewToListQuery` emits only the ListQuery fields that carry meaning —
//      the persist repo treats missing as "no filter on this axis".
//   3. `filterByText` matches name / chassisId / classId / tags case-
//      insensitively; empty search is a pass-through; multi-word / whitespace
//      trims cleanly.
//   4. Selection helpers (`toggleSelection`, `pruneSelection`,
//      `summariseSelectedCost`) hold the pure invariants the screen relies on.
//   5. `layoutSummary` renders the mock's `3W/2S/2M/1E/2X` shape.
//   6. `refitReceiptText` composes the §4.7 receipt string verbatim.
//   7. `collectAvailableTags` distinct + sorted.
//   8. `isViewFiltered` recognises every filter axis.

import { describe, expect, it } from 'vitest';

import { URL_TOKEN_BUDGET } from '../../../../src/io/index.js';
import type {
  IndexEntry,
  ListQuery,
  PrefsRecord,
} from '../../../../src/persist/index.js';
import {
  CLASS_LABEL,
  CLASS_ORDER,
  DEFAULT_VIEW,
  applyViewToPrefs,
  classIdFromString,
  collectAvailableTags,
  defaultDirectionFor,
  filterByText,
  isViewFiltered,
  layoutSummary,
  pruneSelection,
  refitReceiptText,
  shareTokenTooLong,
  shareUrlFor,
  summariseSelectedCost,
  toggleSelection,
  viewFromPrefs,
  viewToListQuery,
  type EncyclopediaView,
} from '../../../../src/ui/screens/encyclopedia/model.js';

// ---- Fixtures -------------------------------------------------------------

const entryOf = (partial: Partial<IndexEntry>): IndexEntry => ({
  id: partial.id ?? 'id-x',
  name: partial.name ?? 'Unnamed',
  nameKey: partial.nameKey ?? (partial.name ?? 'Unnamed').toLowerCase(),
  tags: partial.tags ?? [],
  chassisId: partial.chassisId ?? 'fig-wasp',
  classId: partial.classId ?? 'fighter',
  storedCost: partial.storedCost ?? 10,
  currentCost: partial.currentCost ?? 10,
  needsRefit: partial.needsRefit ?? false,
  pricedAtCatalogVersion: partial.pricedAtCatalogVersion ?? 1,
  schemaVersion: partial.schemaVersion ?? 1,
  catalogVersion: partial.catalogVersion ?? 1,
  createdAt: partial.createdAt ?? '2026-01-01T00:00:00.000Z',
  updatedAt: partial.updatedAt ?? '2026-01-01T00:00:00.000Z',
  bytes: partial.bytes ?? 200,
  status: partial.status ?? 'ok',
  ...(partial.failureReason !== undefined
    ? { failureReason: partial.failureReason }
    : {}),
});

const prefsOf = (partial: Partial<PrefsRecord>): PrefsRecord => ({
  reducedMotion: partial.reducedMotion ?? false,
  renderQuality: partial.renderQuality ?? 'medium',
  defaultBudget: partial.defaultBudget ?? null,
  encyclopediaSort: partial.encyclopediaSort ?? 'updatedAt',
  encyclopediaFilter: partial.encyclopediaFilter ?? { tags: [], classId: null },
});

// ---- Prefs round-trip -----------------------------------------------------

describe('viewFromPrefs / applyViewToPrefs — sticky axes only', () => {
  it('seeds the view from stored prefs (sort + classId + tags) with defaults elsewhere', () => {
    const prefs = prefsOf({
      encyclopediaSort: 'name',
      encyclopediaFilter: { tags: ['alpha', 'meta'], classId: 'cruiser' },
    });
    const view = viewFromPrefs(prefs);
    expect(view.sort).toBe('name');
    expect(view.direction).toBe('asc');
    expect(view.tags).toEqual(['alpha', 'meta']);
    expect(view.classId).toBe('cruiser');
    // Session-scoped axes stay defaulted.
    expect(view.search).toBe('');
    expect(view.needsRefitOnly).toBe(false);
  });

  it('coerces an unknown classId to null (defensive against a foreign prefs blob)', () => {
    const view = viewFromPrefs(
      prefsOf({ encyclopediaFilter: { tags: [], classId: 'battlestar' } }),
    );
    expect(view.classId).toBeNull();
  });

  it('applyViewToPrefs writes back sticky axes and leaves reducedMotion / renderQuality alone', () => {
    const prefs = prefsOf({
      reducedMotion: true,
      renderQuality: 'high',
      encyclopediaSort: 'updatedAt',
      encyclopediaFilter: { tags: [], classId: null },
    });
    const view: EncyclopediaView = {
      ...DEFAULT_VIEW,
      search: 'ignored',
      needsRefitOnly: true,
      tags: ['swarm'],
      classId: 'frigate',
      sort: 'currentCost',
      direction: 'asc',
    };
    const next = applyViewToPrefs(prefs, view);
    expect(next.encyclopediaSort).toBe('currentCost');
    expect(next.encyclopediaFilter).toEqual({ tags: ['swarm'], classId: 'frigate' });
    // Non-sticky axes not persisted.
    expect(next.reducedMotion).toBe(true);
    expect(next.renderQuality).toBe('high');
  });

  it('round-trip: viewFromPrefs(applyViewToPrefs(p, v)) matches v on sticky axes', () => {
    const view: EncyclopediaView = {
      ...DEFAULT_VIEW,
      tags: ['alpha'],
      classId: 'cruiser',
      sort: 'name',
      direction: 'asc',
    };
    const roundTripped = viewFromPrefs(applyViewToPrefs(prefsOf({}), view));
    expect(roundTripped.tags).toEqual(view.tags);
    expect(roundTripped.classId).toBe(view.classId);
    expect(roundTripped.sort).toBe(view.sort);
    expect(roundTripped.direction).toBe(view.direction);
  });

  it('defaultDirectionFor maps updatedAt → desc, others → asc', () => {
    expect(defaultDirectionFor('updatedAt')).toBe('desc');
    expect(defaultDirectionFor('name')).toBe('asc');
    expect(defaultDirectionFor('currentCost')).toBe('asc');
  });
});

// ---- viewToListQuery ------------------------------------------------------

describe('viewToListQuery — only meaningful axes are emitted', () => {
  it('default view lowers to sort + direction only', () => {
    const q = viewToListQuery(DEFAULT_VIEW);
    expect(q.sort).toBe('updatedAt');
    expect(q.direction).toBe('desc');
    // Absent axes are absent — the repo reads missing as "no filter".
    expect(q).not.toHaveProperty('tags');
    expect(q).not.toHaveProperty('classId');
    expect(q).not.toHaveProperty('needsRefit');
  });

  it('adds tags / classId only when they carry a value', () => {
    const view: EncyclopediaView = {
      ...DEFAULT_VIEW,
      tags: ['alpha', 'meta'],
      classId: 'cruiser',
      needsRefitOnly: true,
    };
    const q: ListQuery = viewToListQuery(view);
    expect(q.tags).toEqual(['alpha', 'meta']);
    expect(q.classId).toBe('cruiser');
    expect(q.needsRefit).toBe(true);
  });

  it('empty tag array does NOT emit a `tags` field (persist treats missing as no filter)', () => {
    const q = viewToListQuery({ ...DEFAULT_VIEW, tags: [] });
    expect(q).not.toHaveProperty('tags');
  });
});

// ---- filterByText ---------------------------------------------------------

describe('filterByText — case-insensitive across name, chassisId, classId, tags', () => {
  const entries: readonly IndexEntry[] = [
    entryOf({ id: 'a', name: 'THE WIDOWMAKER', chassisId: 'cru-meridian', classId: 'cruiser', tags: ['alpha'] }),
    entryOf({ id: 'b', name: 'MOTE', chassisId: 'fig-wasp', classId: 'fighter', tags: ['swarm'] }),
    entryOf({ id: 'c', name: 'PD WALL', chassisId: 'fri-harrier', classId: 'frigate', tags: [] }),
  ];

  it('empty / whitespace search returns the input unchanged', () => {
    expect(filterByText(entries, '')).toBe(entries);
    expect(filterByText(entries, '   ')).toBe(entries);
  });

  it('matches on the build name, case-insensitively', () => {
    const out = filterByText(entries, 'widow');
    expect(out.map((e) => e.id)).toEqual(['a']);
  });

  it('matches on the chassisId permanent id', () => {
    const out = filterByText(entries, 'HARRIER');
    expect(out.map((e) => e.id)).toEqual(['c']);
  });

  it('matches on classId', () => {
    const out = filterByText(entries, 'fighter');
    expect(out.map((e) => e.id)).toEqual(['b']);
  });

  it('matches on any tag', () => {
    const out = filterByText(entries, 'swarm');
    expect(out.map((e) => e.id)).toEqual(['b']);
  });

  it('no matches → empty', () => {
    expect(filterByText(entries, 'no-such-thing').length).toBe(0);
  });
});

// ---- Selection helpers ----------------------------------------------------

describe('toggleSelection / pruneSelection / summariseSelectedCost', () => {
  it('toggle appends first, removes on second call', () => {
    const s0 = [] as readonly string[];
    const s1 = toggleSelection(s0, 'a');
    expect(s1).toEqual(['a']);
    const s2 = toggleSelection(s1, 'b');
    expect(s2).toEqual(['a', 'b']);
    const s3 = toggleSelection(s2, 'a');
    expect(s3).toEqual(['b']);
  });

  it('toggle returns a fresh list (reference change) so signal consumers re-render', () => {
    const s0 = [] as readonly string[];
    const s1 = toggleSelection(s0, 'a');
    expect(s1).not.toBe(s0);
  });

  it('prune drops ids not present in the visible entry list, preserves order', () => {
    const visible = [entryOf({ id: 'a' }), entryOf({ id: 'c' })];
    expect(pruneSelection(['a', 'b', 'c'], visible)).toEqual(['a', 'c']);
  });

  it('prune returns the SAME array reference if nothing changed', () => {
    const sel: readonly string[] = ['a', 'c'];
    const visible = [entryOf({ id: 'a' }), entryOf({ id: 'c' })];
    expect(pruneSelection(sel, visible)).toBe(sel);
  });

  it('summariseSelectedCost totals only the selected entries', () => {
    const entries = [
      entryOf({ id: 'a', currentCost: 63 }),
      entryOf({ id: 'b', currentCost: 9 }),
      entryOf({ id: 'c', currentCost: 71 }),
    ];
    expect(summariseSelectedCost([], entries)).toBe(0);
    expect(summariseSelectedCost(['a', 'c'], entries)).toBe(63 + 71);
    expect(summariseSelectedCost(['no-such-id'], entries)).toBe(0);
  });
});

// ---- Layout summary + refit receipt --------------------------------------

describe('layoutSummary — mock’s W/S/M/E/X shape line', () => {
  it('cruiser layout renders as 3W/2S/2M/1E/1X', () => {
    const cruiser = [
      'weapon', 'weapon', 'weapon',
      'shield', 'shield',
      'missile', 'missile',
      'engine',
      'special',
    ] as const;
    expect(layoutSummary(cruiser)).toBe('3W/2S/2M/1E/1X');
  });

  it('fighter layout omits types the class has none of (no 0-count entries)', () => {
    const fighter = ['weapon', 'engine', 'special'] as const;
    expect(layoutSummary(fighter)).toBe('1W/1E/1X');
  });

  it('empty layout renders as the empty string', () => {
    expect(layoutSummary([])).toBe('');
  });
});

describe('refitReceiptText — design §4.7 verbatim', () => {
  it('renders the "Catalog vX → vY. Recalculated A → B PTS." string', () => {
    expect(refitReceiptText(5, 7, 148, 152)).toBe(
      'Catalog v5 → v7. Recalculated 148 → 152 PTS.',
    );
  });
});

// ---- collectAvailableTags + isViewFiltered -------------------------------

describe('collectAvailableTags — distinct, sorted, stable', () => {
  it('collapses duplicates across entries and sorts ascending', () => {
    const entries = [
      entryOf({ id: 'a', tags: ['meta', 'alpha'] }),
      entryOf({ id: 'b', tags: ['swarm', 'alpha'] }),
      entryOf({ id: 'c', tags: ['wip'] }),
    ];
    expect(collectAvailableTags(entries)).toEqual(['alpha', 'meta', 'swarm', 'wip']);
  });

  it('empty input → empty output', () => {
    expect(collectAvailableTags([])).toEqual([]);
  });
});

describe('isViewFiltered — recognises every filter axis', () => {
  it('DEFAULT_VIEW → false', () => {
    expect(isViewFiltered(DEFAULT_VIEW)).toBe(false);
  });

  it('non-blank search → true', () => {
    expect(isViewFiltered({ ...DEFAULT_VIEW, search: 'widow' })).toBe(true);
    // whitespace-only search is NOT a filter.
    expect(isViewFiltered({ ...DEFAULT_VIEW, search: '   ' })).toBe(false);
  });

  it('tags / classId / needsRefit each flip the flag independently', () => {
    expect(isViewFiltered({ ...DEFAULT_VIEW, tags: ['alpha'] })).toBe(true);
    expect(isViewFiltered({ ...DEFAULT_VIEW, classId: 'cruiser' })).toBe(true);
    expect(isViewFiltered({ ...DEFAULT_VIEW, needsRefitOnly: true })).toBe(true);
  });
});

// ---- Share URL helpers ----------------------------------------------------

describe('shareUrlFor / shareTokenTooLong — S05 outbound share helpers', () => {
  it('shareUrlFor composes `#/share?t=<token>` (matches serializeRoute)', () => {
    expect(shareUrlFor('Sabc')).toBe('#/share?t=Sabc');
  });

  it('shareUrlFor prepends the caller-supplied origin verbatim', () => {
    expect(shareUrlFor('Sabc', 'https://example.com')).toBe(
      'https://example.com#/share?t=Sabc',
    );
  });

  it('shareUrlFor percent-encodes a token needing it (router round-trip safe)', () => {
    // The base64url alphabet never emits '+' or '=', but exercise the encoder
    // guard against any exotic character surviving into a URL: what
    // parseHash consumes is decodeURIComponent's inverse of this.
    const token = 'A/B+C=';
    expect(shareUrlFor(token)).toBe(`#/share?t=${encodeURIComponent(token)}`);
    // Fresh percent-decode reproduces the token — proves the router
    // `#/share?t=<encoded>` shape round-trips its payload.
    const encoded = shareUrlFor(token).split('?t=')[1] ?? '';
    expect(decodeURIComponent(encoded)).toBe(token);
  });

  it('shareTokenTooLong flips exactly at the URL_TOKEN_BUDGET boundary', () => {
    const atCap = 'x'.repeat(URL_TOKEN_BUDGET);
    const overCap = 'x'.repeat(URL_TOKEN_BUDGET + 1);
    expect(shareTokenTooLong(atCap)).toBe(false);
    expect(shareTokenTooLong(overCap)).toBe(true);
    expect(shareTokenTooLong('')).toBe(false);
  });
});

// ---- Class metadata -------------------------------------------------------

describe('class metadata — CLASS_ORDER + CLASS_LABEL align with the catalog', () => {
  it('CLASS_ORDER lists the four ship classes light → heavy', () => {
    expect(CLASS_ORDER).toEqual(['fighter', 'frigate', 'cruiser', 'mega-destroyer']);
  });

  it('CLASS_LABEL renders each class as uppercase display copy', () => {
    expect(CLASS_LABEL.fighter).toBe('FIGHTER');
    expect(CLASS_LABEL['mega-destroyer']).toBe('MEGA DESTROYER');
  });

  it('classIdFromString accepts known ids, rejects everything else', () => {
    expect(classIdFromString('cruiser')).toBe('cruiser');
    expect(classIdFromString('mega-destroyer')).toBe('mega-destroyer');
    expect(classIdFromString('battlestar')).toBeNull();
    expect(classIdFromString(null)).toBeNull();
  });
});
