// M14 UI — Ship Encyclopedia screen (S04).
//
// Screen #2 (design §3, flows 2/4/5). Library home: browse, filter, duplicate,
// export, and the ONLY destructive confirm in the whole app (§4.8 delete
// modal). Every read lands through `LibraryRepo` — this screen holds no
// catalog / physics logic, only view state (§S04 spec).
//
// D-IOC-SEAM: services flow in via `useApp()` from `src/ui/appContext.js`;
// `src/app` is unreachable from here (ESLint APP_IMPORT_PATTERN).
//
// D-PLACEHOLDER: this file REPLACES the S03 placeholder body. The `Encyclopedia`
// export name is contracted — the screens barrel + `App.tsx` outlet already
// import it and MUST NOT be re-edited.
//
// XSS (§4.9): every user-authored string (name, tag) is rendered as a text
// node via JSX; `dangerouslySetInnerHTML` is lint-banned repo-wide.

import { useComputed, useSignal } from '@preact/signals';
import { useEffect, useMemo } from 'preact/hooks';

import { useApp } from '../appContext.js';
import { Button, Chip, Meter, type MeterFill } from '../components/index.js';

import { BuildCard } from './encyclopedia/BuildCard.js';
import { DeleteModal } from './encyclopedia/DeleteModal.js';
import { FilterBar } from './encyclopedia/FilterBar.js';
import {
  collectAvailableTags,
  duplicateIdentity,
  filterByText,
  pruneSelection,
  summariseSelectedCost,
  toggleSelection,
  viewFromPrefs,
  viewToListQuery,
  applyViewToPrefs,
  type EncyclopediaView,
} from './encyclopedia/model.js';
import { mintUniqueName, STORAGE_BUDGET_BYTES, type UsageLevel } from '../../persist/index.js';

// Warn / critical are UI-band ratios (§3.7). The absolute values live in
// `persist/quota.ts`; we recompute them locally for a MeterNotch position
// only — the band the UI paints comes from `headroom().level`.
const WARN_RATIO = 0.8;
const CRITICAL_RATIO = 0.95;

export function Encyclopedia() {
  const services = useApp();
  const { catalog, repo, navigate } = services;

  // View state — seed from prefs at first paint. `viewFromPrefs` never touches
  // search or needsRefit (§3.8 — session-scoped axes).
  const view = useSignal<EncyclopediaView>(viewFromPrefs(repo.loadPrefs()));
  const selection = useSignal<readonly string[]>([]);
  const pendingDeleteId = useSignal<string | null>(null);
  // A tick to force re-materialisation of `repo.list(query)` after mutations
  // land (delete, duplicate). Every mutation site bumps this after its repo
  // call — the repo is not a signal, so the screen needs a change trigger.
  const refreshTick = useSignal(0);

  const listQuery = useComputed(() => {
    // Read the tick so the compute invalidates after every repo mutation.
    void refreshTick.value;
    return viewToListQuery(view.value);
  });

  // Full unfiltered browse (used for the tag palette + count summaries).
  const allEntries = useComputed(() => {
    void refreshTick.value;
    return repo.entries();
  });

  // Filtered + sorted through the repo, then narrowed by local text search.
  const visibleEntries = useComputed(() => {
    void refreshTick.value;
    return filterByText(repo.list(listQuery.value), view.value.search);
  });

  const availableTags = useComputed(() => collectAvailableTags(allEntries.value));

  const headroom = useComputed(() => {
    void refreshTick.value;
    return repo.headroom();
  });

  // Prune stale ids in the selection whenever the visible set narrows.
  useEffect(() => {
    const next = pruneSelection(selection.value, visibleEntries.value);
    if (next !== selection.value) selection.value = next;
  }, [selection, visibleEntries]);

  // Persist sticky axes (tags/classId/sort) whenever the view changes. The
  // effect fires post-render so a rapid multi-toggle collapses to one write.
  useEffect(() => {
    const currentPrefs = repo.loadPrefs();
    const next = applyViewToPrefs(currentPrefs, view.value);
    // Only write if a sticky axis actually changed — savePrefs is best-effort
    // but still a JSON.stringify + setItem per call.
    if (
      next.encyclopediaSort !== currentPrefs.encyclopediaSort ||
      next.encyclopediaFilter.classId !== currentPrefs.encyclopediaFilter.classId ||
      !arraysEqual(next.encyclopediaFilter.tags, currentPrefs.encyclopediaFilter.tags)
    ) {
      repo.savePrefs(next);
    }
  }, [repo, view.value]);

  const onSelectToggle = (id: string) => {
    selection.value = toggleSelection(selection.value, id);
  };

  const onOpen = (id: string) => {
    navigate({ name: 'shipyard', buildId: id });
  };

  const onDuplicate = (id: string) => {
    const source = repo.get(id);
    if (source === null) {
      services.toast('This build cannot be duplicated.', 'warn');
      return;
    }
    // Fresh browser identity + timestamps. crypto.randomUUID is UUIDv4-shaped
    // and available in every evergreen engine; the repo does not care about
    // the exact format so long as it's unique. Timestamps are ISO to align
    // with `wallClock` (persist/LibraryRepo.ts).
    const freshId = crypto.randomUUID();
    const freshTs = new Date().toISOString();
    const identity = duplicateIdentity(
      source.build.name,
      freshId,
      freshTs,
      (nk) => repo.findByNameKey(nk).length > 0,
      mintUniqueName,
    );
    const result = repo.put({
      ...source.build,
      id: identity.id,
      name: identity.name,
      createdAt: identity.createdAt,
      updatedAt: identity.updatedAt,
    });
    if (result.ok) {
      services.toast(`Duplicated as “${identity.name}”.`);
      refreshTick.value += 1;
    } else {
      services.toast(`Duplicate failed (${result.reason}).`, 'danger');
    }
  };

  const onDelete = (id: string) => {
    pendingDeleteId.value = id;
  };

  const onConfirmDelete = () => {
    const id = pendingDeleteId.value;
    if (id === null) return;
    const entry = repo.entry(id);
    const removed = repo.remove(id);
    pendingDeleteId.value = null;
    if (removed.removed) {
      services.toast(
        `Deleted “${entry?.name.length ? entry.name : '(unnamed build)'}”.`,
        'warn',
      );
      refreshTick.value += 1;
    }
  };

  const pendingDelete =
    pendingDeleteId.value !== null ? repo.entry(pendingDeleteId.value) ?? null : null;

  const totalCount = allEntries.value.length;
  const shownCount = visibleEntries.value.length;
  const selCount = selection.value.length;
  const selCost = summariseSelectedCost(selection.value, allEntries.value);

  return (
    <div class="enc-wrap" data-testid="screen-encyclopedia">
      <EncyclopediaStyles />

      <div class="enc-header">
        <h1 class="t-h1">SHIP ENCYCLOPEDIA</h1>
        <Chip data-testid="enc-total">{`${String(totalCount)} BUILDS`}</Chip>
        <Chip tone="cyan">{`CATALOG v${String(catalog.catalogVersion)}`}</Chip>
        <div class="grow" />
        <Button
          variant="primary"
          onClick={() => {
            navigate({ name: 'shipyard' });
          }}
          class="enc-new-build"
        >
          ＋ NEW BUILD
        </Button>
        <Button
          onClick={() => {
            navigate({ name: 'share' });
          }}
        >
          🔗 SHARE / IMPORT
        </Button>
      </div>

      <StorageRail
        used={headroom.value.usedBytes}
        remaining={headroom.value.remainingBytes}
        level={headroom.value.level}
        totalCount={totalCount}
        lastExportAt={repo.lastExportAt()}
      />

      <FilterBar
        view={view.value}
        onChange={(next) => {
          view.value = next;
        }}
        availableTags={availableTags.value}
        totalCount={totalCount}
        shownCount={shownCount}
      />

      {selCount > 0 ? (
        <SelectionBar
          count={selCount}
          totalCost={selCost}
          onClear={() => {
            selection.value = [];
          }}
        />
      ) : null}

      {visibleEntries.value.length === 0 ? (
        <EmptyState totalCount={totalCount} />
      ) : (
        <div class="enc-grid-builds" data-testid="build-grid">
          {visibleEntries.value.map((entry) => (
            <BuildCard
              key={entry.id}
              entry={entry}
              catalog={catalog}
              selected={selection.value.includes(entry.id)}
              onToggleSelect={onSelectToggle}
              onOpen={onOpen}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}

      {pendingDelete !== null ? (
        <DeleteModal
          entry={pendingDelete}
          catalog={catalog}
          onCancel={() => {
            pendingDeleteId.value = null;
          }}
          onConfirm={onConfirmDelete}
        />
      ) : null}
    </div>
  );
}

// ---- Storage rail ---------------------------------------------------------

interface StorageRailProps {
  readonly used: number;
  readonly remaining: number;
  readonly level: UsageLevel;
  readonly totalCount: number;
  readonly lastExportAt: string | null;
}

const MB = 1024 * 1024;

const kbLabel = (bytes: number): string => {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / MB).toFixed(2)} MB`;
};

const LEVEL_META: Readonly<
  Record<
    UsageLevel,
    {
      readonly chipTone: 'green' | 'amber' | 'red';
      readonly meterFill: MeterFill;
      readonly label: string;
    }
  >
> = {
  ok: { chipTone: 'green', meterFill: 'shield', label: '◉ OK' },
  warn: { chipTone: 'amber', meterFill: 'dv', label: '⚠ WARN' },
  critical: { chipTone: 'red', meterFill: 'hot', label: '⚠ CRITICAL' },
};

function StorageRail({ used, remaining, level, totalCount, lastExportAt }: StorageRailProps) {
  const meta = LEVEL_META[level];
  const notches = useMemo(
    () => [STORAGE_BUDGET_BYTES * WARN_RATIO, STORAGE_BUDGET_BYTES * CRITICAL_RATIO],
    [],
  );
  const avgBytes = totalCount > 0 ? Math.round(used / totalCount) : 0;
  return (
    <section class="enc-storage-grid">
      <section class="panel ticks" data-testid="storage-headroom">
        <div class="panel-hd">
          <span class="t-label">STORAGE HEADROOM</span>
          <div class="grow" />
          <Chip tone={meta.chipTone}>{meta.label}</Chip>
        </div>
        <div class="panel-bd stack">
          <div class="enc-storage-baseline">
            <span class="t-num">{kbLabel(used)}</span>
            <span class="mono-xs">
              {`/ ~${(STORAGE_BUDGET_BYTES / MB).toFixed(0)} MB LOCALSTORAGE`}
            </span>
          </div>
          <Meter
            value={used}
            max={STORAGE_BUDGET_BYTES}
            fill={meta.meterFill}
            notches={notches}
            aria-label={`${kbLabel(used)} used of ~${(STORAGE_BUDGET_BYTES / MB).toFixed(0)} MB`}
          />
          <div class="stat">
            <span class="stat-k">REMAINING</span>
            <span class="stat-v">{kbLabel(remaining)}</span>
          </div>
          <div class="stat">
            <span class="stat-k">AVG BUILD SIZE</span>
            <span class="stat-v">{totalCount === 0 ? '—' : kbLabel(avgBytes)}</span>
          </div>
          <div class="stat">
            <span class="stat-k">WARN AT</span>
            <span class="stat-v c-amber">80% · 4.0 MB</span>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-hd">
          <span class="t-label">LIBRARY</span>
          <div class="grow" />
          <span class="mono-xs" data-testid="last-export-at">
            {lastExportAt !== null
              ? `LAST EXPORT ${lastExportAt.slice(0, 10)}`
              : 'NEVER EXPORTED'}
          </span>
        </div>
        <div class="panel-bd">
          <div class="enc-lib-grid">
            <SummaryTile label="TOTAL" value={totalCount} />
          </div>
        </div>
        <div class="panel-ft mono-xs">
          BROWSE CACHE IS O(0) REPRICE — INDEX ENTRIES CARRY `currentCost` AND `needsRefit` KEYED
          ON `pricedAtCatalogVersion` (§3.4).
        </div>
      </section>
    </section>
  );
}

interface SummaryTileProps {
  readonly label: string;
  readonly value: number;
}

function SummaryTile({ label, value }: SummaryTileProps) {
  return (
    <div>
      <div class="t-label">{label}</div>
      <div class="t-num-xl">{String(value)}</div>
    </div>
  );
}

// ---- Selection bar --------------------------------------------------------

interface SelectionBarProps {
  readonly count: number;
  readonly totalCost: number;
  readonly onClear: () => void;
}

function SelectionBar({ count, totalCost, onClear }: SelectionBarProps) {
  return (
    <div class="enc-selbar" data-testid="selection-bar">
      <strong class="c-hi">{`${String(count)} SELECTED`}</strong>
      <span class="mono-xs">{`${String(totalCost)} PTS COMBINED`}</span>
      <div class="grow" />
      <Button size="sm" variant="ghost" onClick={onClear}>
        CLEAR SELECTION
      </Button>
    </div>
  );
}

// ---- Empty state ---------------------------------------------------------

interface EmptyStateProps {
  readonly totalCount: number;
}

function EmptyState({ totalCount }: EmptyStateProps) {
  return (
    <section class="panel enc-empty" data-testid="empty-state">
      <div class="panel-bd stack">
        <p class="t-prose">
          {totalCount === 0
            ? 'No builds yet. Head over to the Shipyard to author your first one — the encyclopedia will fill in as you save.'
            : 'Nothing matches your filters. Loosen a chip or clear the search to see more.'}
        </p>
      </div>
    </section>
  );
}

// ---- Utility --------------------------------------------------------------

const arraysEqual = (a: readonly string[], b: readonly string[]): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

// ---- Page-scoped styles ---------------------------------------------------
//
// The mocks/console.css companion stylesheet (S01) owns the design-system
// tokens and shared component classes. Encyclopedia-specific layout classes
// (`.enc-*`) are page-local composition — they never redefine a token, they
// never mint a new palette, they never take a `!important`. Following mock
// discipline: page-local composition only, keeping the S01 stylesheet-count
// contract intact (5 files, single import site in `main.tsx`).

const ENC_STYLES = `
  .enc-wrap { max-width: 1680px; margin: 0 auto; padding: var(--s5) var(--s5) var(--s8);
              display: flex; flex-direction: column; gap: var(--s4); }
  .enc-header { display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap; }
  .enc-header .t-h1 { margin: 0; }

  .enc-storage-grid { display: grid; grid-template-columns: 340px 1fr; gap: var(--s3);
                      align-items: stretch; }
  .enc-storage-baseline { display: flex; align-items: baseline; justify-content: space-between; }
  .enc-lib-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: var(--s3); }

  .enc-filterbar { display: flex; flex-wrap: wrap; gap: var(--s3); align-items: center; }
  .enc-filter-group { display: flex; align-items: center; gap: 5px; }
  .enc-search { width: 260px; }
  .enc-tagbar { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }

  .enc-selbar { display: flex; align-items: center; gap: var(--s3);
                padding: var(--s2) var(--s3);
                background: rgba(34,227,255,.08);
                border: 1px solid rgba(34,227,255,.35);
                border-left: 3px solid var(--cyan);
                border-radius: var(--r); }

  .enc-grid-builds { display: grid;
                     grid-template-columns: repeat(auto-fill, minmax(372px, 1fr));
                     gap: var(--s3); align-items: start; }

  .enc-card { display: flex; flex-direction: column; }
  .enc-card.is-refit { border-left: 3px solid var(--amber); }
  .enc-card.is-failed { border-left: 3px solid var(--red); opacity: .92; }
  .enc-card.is-sel { border-color: var(--cyan); box-shadow: var(--glow-2); }

  .enc-card-hd { display: flex; gap: var(--s2); align-items: flex-start;
                 padding: var(--s3) var(--s3) var(--s2); }
  .enc-card-check { margin-top: 3px; }
  .enc-card-name { font-size: 14px; font-weight: 700; letter-spacing: .1em;
                   text-transform: uppercase; color: var(--ink-hi); line-height: 1.2; }
  .enc-card-cost { text-align: right; line-height: 1; }
  .enc-card-bd { padding: var(--s2) var(--s3); }
  .enc-card-ft { padding: var(--s2) var(--s3);
                 border-top: 1px solid rgba(30,44,60,.55);
                 display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; }

  .enc-tag-row { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }

  .enc-card-acts { display: flex; gap: 4px; flex-wrap: wrap;
                   padding: var(--s2) var(--s3);
                   border-top: 1px solid rgba(30,44,60,.55);
                   background: var(--panel-in, transparent); }

  .enc-empty { padding: var(--s3); }

  .enc-modal-preview { padding: var(--s3); display: flex; flex-direction: column; gap: 4px; }
  .enc-modal-ft { display: flex; align-items: center; gap: var(--s2); width: 100%; }
`;

function EncyclopediaStyles() {
  // A single scoped <style> node keeps the S01 stylesheet contract intact
  // (5 CSS files, one import site). Rendered as a text child so it never
  // triggers the repo-wide `dangerouslySetInnerHTML` lint ban.
  return <style>{ENC_STYLES}</style>;
}
