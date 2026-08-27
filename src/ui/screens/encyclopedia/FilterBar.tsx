// M14 UI — Encyclopedia FilterBar (S04 checkpoint 1).
//
// The single control the browse-view state flows through. Consumes the current
// `EncyclopediaView` + a callback to replace it; owns no state of its own so
// the parent screen can seed from prefs and persist changes uniformly.
//
// Design: `mocks/encyclopedia.html` filter bar (search field + sort segmented
// + class chip row + tag chip row + needs-refit chip). Class labels come from
// `model.CLASS_LABEL`; tag chips come from the input `availableTags` list the
// screen derives (never a hard-coded palette — the catalog does not name tags).

import { useMemo } from 'preact/hooks';

import type { ChassisClass } from '../../../catalog/index.js';
import type { SortAxis } from '../../../persist/index.js';
import {
  Field,
  Segmented,
  type SegmentedOption,
} from '../../components/index.js';

import {
  CLASS_LABEL,
  CLASS_ORDER,
  defaultDirectionFor,
  type EncyclopediaView,
} from './model.js';

const SORT_OPTIONS: readonly SegmentedOption<SortAxis>[] = [
  { value: 'updatedAt', label: 'RECENT' },
  { value: 'name', label: 'NAME' },
  { value: 'currentCost', label: 'POINTS' },
];

export interface FilterBarProps {
  readonly view: EncyclopediaView;
  readonly onChange: (next: EncyclopediaView) => void;
  /**
   * The tag palette the FilterBar surfaces as toggleable chips. Derived by the
   * screen from `repo.entries()` — the catalog does not name tags (FR-1
   * negative-space invariant). Empty → the tag row hides.
   */
  readonly availableTags: readonly string[];
  /** Total unfiltered build count (`repo.entries().length`). Rendered in the meta line. */
  readonly totalCount: number;
  /** Current post-filter count (`filterByText(list(query))`) — the "SHOWING N OF M" summary. */
  readonly shownCount: number;
}

export function FilterBar({
  view,
  onChange,
  availableTags,
  totalCount,
  shownCount,
}: FilterBarProps) {
  const activeTags = useMemo(() => new Set(view.tags), [view.tags]);

  const setSort = (sort: SortAxis) => {
    // Direction resets to the axis's natural default on axis change so RECENT
    // always reads newest-first and NAME/POINTS ascending — matches the mock.
    onChange({ ...view, sort, direction: defaultDirectionFor(sort) });
  };

  const toggleClass = (id: ChassisClass) => {
    onChange({ ...view, classId: view.classId === id ? null : id });
  };

  const toggleTag = (tag: string) => {
    const next = activeTags.has(tag)
      ? view.tags.filter((t) => t !== tag)
      : [...view.tags, tag];
    onChange({ ...view, tags: next });
  };

  const toggleNeedsRefit = () => {
    onChange({ ...view, needsRefitOnly: !view.needsRefitOnly });
  };

  return (
    <section class="panel" data-testid="filter-bar">
      <div class="panel-bd enc-filterbar">
        <label class="sr-only" for="enc-search">
          Search builds
        </label>
        <Field
          id="enc-search"
          type="search"
          value={view.search}
          onInput={(e) => {
            const target = e.currentTarget;
            onChange({ ...view, search: target.value });
          }}
          placeholder="SEARCH NAME, CHASSIS, TAG…"
          class="enc-search"
        />

        <div class="enc-filter-group">
          <span class="t-label">SORT</span>
          <Segmented<SortAxis>
            aria-label="Sort builds"
            options={SORT_OPTIONS}
            value={view.sort}
            onChange={setSort}
          />
        </div>

        <div class="enc-filter-group">
          <span class="t-label">CLASS</span>
          <button
            type="button"
            class="chip chip-btn"
            aria-pressed={view.classId === null}
            onClick={() => {
              onChange({ ...view, classId: null });
            }}
          >
            ALL
          </button>
          {CLASS_ORDER.map((id) => (
            <button
              type="button"
              key={id}
              class="chip chip-btn"
              aria-pressed={view.classId === id}
              onClick={() => {
                toggleClass(id);
              }}
              data-class-id={id}
            >
              {CLASS_LABEL[id]}
            </button>
          ))}
        </div>

        <div class="enc-filter-group">
          <button
            type="button"
            class="chip chip-btn"
            aria-pressed={view.needsRefitOnly}
            onClick={toggleNeedsRefit}
            title="Show only builds whose stored cost differs from the current catalog."
            data-testid="filter-needs-refit"
          >
            ⚠ NEEDS REFIT
          </button>
        </div>
      </div>

      {availableTags.length > 0 ? (
        <div class="panel-ft enc-tagbar">
          <span class="t-label">TAGS</span>
          {availableTags.map((tag) => (
            <button
              type="button"
              key={tag}
              class="chip chip-btn"
              aria-pressed={activeTags.has(tag)}
              onClick={() => {
                toggleTag(tag);
              }}
              data-tag={tag}
            >
              {tag}
            </button>
          ))}
          <div class="grow" />
          <span class="mono-xs">
            SHOWING {String(shownCount)} OF {String(totalCount)}
          </span>
        </div>
      ) : (
        <div class="panel-ft enc-tagbar">
          <span class="mono-xs c-dim">
            {totalCount === 0
              ? 'NO BUILDS YET — CREATE ONE FROM SHIPYARD'
              : `SHOWING ${String(shownCount)} OF ${String(totalCount)}`}
          </span>
        </div>
      )}
    </section>
  );
}

