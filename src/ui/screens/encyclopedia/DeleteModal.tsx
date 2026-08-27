// M14 UI — Encyclopedia DeleteModal (S04 checkpoint 2).
//
// The ONE destructive confirm in the whole app (§4.8). Delete is the only
// action behind a modal, and the modal exists so the user can EXPORT FIRST
// before losing something that lives in this browser and nowhere else.
//
// Contract:
//   - `role='alertdialog'` (design §4.8 destructive gate).
//   - CANCEL and DELETE render as the LAST two focusable children so the
//     component-level focus trap parks the ring on them — Tab lands on CANCEL
//     first (safer default), Shift+Tab from CANCEL wraps to DELETE.
//   - Body renders build name + class layout shape + tags as text nodes (§4.9
//     — user-authored strings never as markup).
//   - The "export first" affordance calls `onExport` if provided (CP3 wires
//     the real path). When absent, the button is disabled but still visible so
//     the design nudge stays intact.
//   - `Modal` (components/overlays.ts) owns the scrim, Esc, focus-trap; this
//     module composes only the panel content + footer buttons.

import type { Catalog, ChassisClass } from '../../../catalog/index.js';
import type { IndexEntry } from '../../../persist/index.js';
import { Chip, Modal } from '../../components/index.js';

import { CLASS_LABEL, layoutSummary } from './model.js';

export interface DeleteModalProps {
  readonly entry: IndexEntry;
  readonly catalog: Catalog;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  /** Optional — CP3 wires this to `exportLibrary` + download. Absent → disabled. */
  readonly onExport?: () => void;
}

export function DeleteModal({
  entry,
  catalog,
  onCancel,
  onConfirm,
  onExport,
}: DeleteModalProps) {
  const chassis = catalog.chassis(entry.chassisId);
  const chassisName = chassis?.name ?? entry.chassisId;
  const classLabel = CLASS_LABEL[entry.classId as ChassisClass] ?? entry.classId;
  const layout = catalog.slotLayout(entry.classId as ChassisClass);
  const shape = layout !== undefined ? layoutSummary(layout) : '—';
  const displayName = entry.name.length > 0 ? entry.name : '(UNNAMED BUILD)';

  return (
    <Modal
      title={`DELETE '${displayName}'?`}
      role="alertdialog"
      onClose={onCancel}
      aria-describedby="del-desc"
      footer={
        <div class="enc-modal-ft">
          <span class="mono-xs">ESC OR CANCEL LEAVES EVERYTHING UNCHANGED.</span>
          <div class="grow" />
          <button
            type="button"
            class="btn btn-ghost"
            onClick={onCancel}
            data-testid="delete-cancel"
          >
            CANCEL
          </button>
          <button
            type="button"
            class="btn btn-danger"
            onClick={onConfirm}
            data-testid="delete-confirm"
          >
            🗑 DELETE
          </button>
        </div>
      }
    >
      <div class="stack-lg" data-testid="delete-modal">
        <p class="t-prose" id="del-desc" style="margin:0">
          This is the only destructive action in the app and it cannot be undone.
          There is no server-side copy, no trash, and no version history — this
          build exists in your browser and nowhere else.
        </p>

        <div class="panel-in enc-modal-preview">
          <div class="enc-card-name">{displayName}</div>
          <div class="mono-xs">
            {`${chassisName.toUpperCase()} · ${classLabel} · ${shape} · ${String(entry.currentCost)} PTS`}
          </div>
          <div class="mono-xs c-dim">
            {`SCHEMA v${String(entry.schemaVersion)} · CATALOG v${String(
              entry.catalogVersion,
            )} · MOD ${entry.updatedAt.slice(0, 10)}`}
          </div>
          {entry.tags.length > 0 ? (
            <div class="enc-tag-row" style="margin-top:6px">
              {entry.tags.map((tag) => (
                <Chip key={tag}>{tag}</Chip>
              ))}
            </div>
          ) : (
            <div class="mono-xs c-dim" style="margin-top:6px">
              NO TAGS
            </div>
          )}
        </div>

        <div class="banner">
          <span class="c-amber" aria-hidden="true">
            ⚠
          </span>
          <div class="grow">
            <div class="c-hi" style="font-weight:700;letter-spacing:.08em">
              Consider exporting first.
            </div>
            <div class="t-meta">
              A one-build JSON re-imports cleanly on any future catalog version.
            </div>
          </div>
          <button
            type="button"
            class="btn btn-sm btn-warn"
            onClick={onExport ?? (() => undefined)}
            disabled={onExport === undefined || undefined}
            title={
              onExport === undefined
                ? 'Export arrives in checkpoint 3 of this session.'
                : 'Export this build to JSON before deleting.'
            }
            data-testid="delete-export-first"
          >
            ⭱ EXPORT THIS BUILD
          </button>
        </div>
      </div>
    </Modal>
  );
}
