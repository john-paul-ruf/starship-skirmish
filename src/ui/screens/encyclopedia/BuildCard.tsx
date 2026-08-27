// M14 UI — Encyclopedia BuildCard (S04 checkpoint 1; actions wired in CP2).
//
// One IndexEntry → one card. Renders every axis the browse cache carries
// cheaply (name / class / cost / tags / status), and the `needs-refit` badge
// keyed on the IndexEntry cache (§3.3, §3.4). The fit line uses the class
// layout shape derived from the catalog (`layoutSummary`) rather than SlotPips
// because per-slot fill is NOT in the IndexEntry (§3.2 — that would need an
// O(N) record read on browse). SlotPips lives in the DeleteModal, which
// already reads the record; the never-color-alone contract holds because
// class + cost carry their own explicit text.
//
// FR-2 failure isolation (§3.5): `status: 'failed'` rows render as a distinct
// panel-in row — never hidden, never silently deletable. The card exposes only
// safe actions (view + duplicate + export) for a failed entry; delete stays
// available but the modal's messaging surfaces the reason.
//
// XSS (§4.9): every user-authored string (`name`, tag, chassis id) renders as
// a text node; `dangerouslySetInnerHTML` is lint-banned repo-wide.
//
// SKIRMISH action (§S04 spec): the "▲ FIELD" affordance from the mock is
// rendered but DISABLED with a title — the Setup screen belongs to the next
// feature. `Route` currently has no variant we could point at without lease
// creep; the disabled state keeps the design intent visible.

import type { Catalog, ChassisClass } from '../../../catalog/index.js';
import type { IndexEntry } from '../../../persist/index.js';
import { Checkbox, Chip, type ChipTone } from '../../components/index.js';

import { CLASS_LABEL, layoutSummary, refitReceiptText } from './model.js';

export interface BuildCardProps {
  readonly entry: IndexEntry;
  readonly catalog: Catalog;
  readonly selected: boolean;
  readonly onToggleSelect: (id: string) => void;
  readonly onOpen: (id: string) => void;
  readonly onDuplicate: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onExport: (id: string) => void;
  readonly onRefit: (id: string) => void;
  readonly onKeepAsIs: (id: string) => void;
  /**
   * Session-scoped: user chose KEEP AS IS this visit. The receipt banner
   * collapses to a compact meta line; the amber left border on the card
   * stays (design §4.7 — the badge is a receipt, not a lock).
   */
  readonly refitDismissed: boolean;
}

export function BuildCard({
  entry,
  catalog,
  selected,
  onToggleSelect,
  onOpen,
  onDuplicate,
  onDelete,
  onExport,
  onRefit,
  onKeepAsIs,
  refitDismissed,
}: BuildCardProps) {
  const failed = entry.status === 'failed';
  const chassis = catalog.chassis(entry.chassisId);
  const chassisName = chassis?.name ?? entry.chassisId;
  const classLabel = CLASS_LABEL[entry.classId as ChassisClass] ?? entry.classId;
  const layout = catalog.slotLayout(entry.classId as ChassisClass);
  const shape = layout !== undefined ? layoutSummary(layout) : '—';
  const bays = layout?.length ?? 0;

  const cardClass = [
    'panel',
    'enc-card',
    selected ? 'is-sel' : '',
    entry.needsRefit ? 'is-refit' : '',
    failed ? 'is-failed' : '',
  ]
    .filter((s) => s.length > 0)
    .join(' ');

  return (
    <article
      class={cardClass}
      data-testid="build-card"
      data-build-id={entry.id}
      data-status={entry.status}
    >
      <div class="enc-card-hd">
        <Checkbox
          checked={selected}
          onChange={() => {
            onToggleSelect(entry.id);
          }}
          aria-label={`Select ${entry.name || entry.id}`}
          class="enc-card-check"
        />
        <div class="grow">
          <div class="enc-card-name">{entry.name || '(UNNAMED BUILD)'}</div>
          <div class="mono-xs">
            {`${chassisName.toUpperCase()} · ${classLabel} · ${shape}${
              bays > 0 ? ` · ${String(bays)} BAYS` : ''
            }`}
          </div>
        </div>
        <div class="enc-card-cost">
          <div class={`t-num-xl ${entry.needsRefit ? 'c-amber' : ''}`}>
            {String(entry.currentCost)}
          </div>
          <div class="t-label">PTS</div>
        </div>
      </div>

      <div class="enc-card-bd stack">
        {entry.needsRefit && !failed ? (
          <div>
            <Chip tone="amber">⚠ NEEDS REFIT</Chip>{' '}
            <Chip>{`WAS ${String(entry.storedCost)} PTS`}</Chip>{' '}
            <Chip>{`WRITTEN v${String(entry.catalogVersion)}`}</Chip>
          </div>
        ) : null}

        {failed ? (
          <div class="banner banner-danger">
            <span class="c-red" aria-hidden="true">
              ⚠
            </span>
            <div class="grow">
              <div class="c-hi" style="font-weight:700;letter-spacing:.08em">
                THIS BUILD FAILED TO LOAD.
              </div>
              <div class="mono-xs">
                {`Reason: ${entry.failureReason ?? 'ERR_UNKNOWN'}. Other builds are unaffected (FR-2).`}
              </div>
            </div>
          </div>
        ) : entry.needsRefit && !refitDismissed ? (
          <div class="banner enc-refit-banner" data-testid="refit-banner">
            <span class="c-amber" aria-hidden="true">
              ⚠
            </span>
            <div class="grow">
              <div class="mono-xs c-hi" data-testid="refit-receipt">
                {refitReceiptText(
                  entry.catalogVersion,
                  entry.pricedAtCatalogVersion,
                  entry.storedCost,
                  entry.currentCost,
                )}
              </div>
              <div class="enc-refit-acts">
                <button
                  type="button"
                  class="btn btn-sm btn-warn"
                  onClick={() => {
                    onRefit(entry.id);
                  }}
                  data-testid="refit-refit"
                  title="Open in the Shipyard so the new totals take effect."
                >
                  ⟳ RE-FIT
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  onClick={() => {
                    onKeepAsIs(entry.id);
                  }}
                  data-testid="refit-keep"
                  title="Dismiss until the next visit — the badge remains a receipt, not a lock."
                >
                  KEEP AS IS
                </button>
              </div>
            </div>
          </div>
        ) : entry.needsRefit && refitDismissed ? (
          <div class="mono-xs c-amber" data-testid="refit-receipt">
            {refitReceiptText(
              entry.catalogVersion,
              entry.pricedAtCatalogVersion,
              entry.storedCost,
              entry.currentCost,
            )}
          </div>
        ) : null}

        {entry.tags.length > 0 ? (
          <div class="enc-tag-row">
            {entry.tags.map((tag, i) => (
              <Chip key={tag} tone={tagTone(i)}>
                {tag}
              </Chip>
            ))}
          </div>
        ) : (
          <span class="mono-xs c-dim">NO TAGS</span>
        )}
      </div>

      <div class="enc-card-ft">
        <span class="mono-xs c-dim">{`MOD ${formatModifiedAt(entry.updatedAt)}`}</span>
        <div class="grow" />
        {failed ? (
          <Chip tone="red">FAILED</Chip>
        ) : entry.needsRefit ? (
          <Chip tone="amber">NEEDS REFIT</Chip>
        ) : (
          <Chip tone="green">OK</Chip>
        )}
      </div>

      <div class="enc-card-acts" data-testid="card-actions">
        <button
          type="button"
          class="btn btn-sm"
          disabled
          title="Skirmish arrives with the tactical feature."
          data-testid="card-skirmish"
        >
          ▲ FIELD
        </button>
        <button
          type="button"
          class="btn btn-sm"
          disabled={failed || undefined}
          onClick={() => {
            onOpen(entry.id);
          }}
          title={failed ? 'Failed builds cannot be opened.' : 'Open in the Shipyard.'}
          data-testid="card-open"
        >
          ✎ EDIT
        </button>
        <button
          type="button"
          class="btn btn-sm"
          disabled={failed || undefined}
          onClick={() => {
            onDuplicate(entry.id);
          }}
          title={failed ? 'Failed builds cannot be duplicated.' : 'Duplicate this build.'}
          data-testid="card-duplicate"
        >
          ⧉ DUPLICATE
        </button>
        <button
          type="button"
          class="btn btn-sm"
          disabled={failed || undefined}
          onClick={() => {
            onExport(entry.id);
          }}
          title={failed ? 'Failed builds cannot be exported.' : 'Download as JSON.'}
          data-testid="card-export"
        >
          ⭱ EXPORT
        </button>
        <div class="grow" />
        <button
          type="button"
          class="btn btn-sm btn-danger"
          onClick={() => {
            onDelete(entry.id);
          }}
          data-testid="card-delete"
        >
          🗑 DELETE
        </button>
      </div>
    </article>
  );
}

/**
 * Very small tone-rotation so the first tag reads as the "primary" (cyan) and
 * the rest are neutral, matching the mock. Purely visual; carries no semantic
 * meaning — the tag TEXT is the accessible name.
 */
const tagTone = (index: number): ChipTone => (index === 0 ? 'cyan' : 'neutral');

/**
 * Trim an ISO-8601 timestamp to `YYYY-MM-DD` for the compact card footer.
 * Non-ISO / empty strings fall back to the raw value — the browse cache is
 * defensive about `updatedAt` (`stringField('updatedAt')` in records.ts coerces
 * missing values to `''`), so we mirror that fault-tolerance here.
 */
const formatModifiedAt = (isoLike: string): string => {
  if (isoLike.length === 0) return '—';
  const t = isoLike.indexOf('T');
  return t > 0 ? isoLike.slice(0, t) : isoLike;
};
