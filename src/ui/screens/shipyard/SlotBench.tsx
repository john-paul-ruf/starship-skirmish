// M14 UI — Shipyard slot bench (S05, CP1).
//
// The CENTER column's fitting bench — one `.bay` per layout slot, grouped by
// slot type (weapons together, shields together, …). Each bay shows its
// positional label (W1/W2/W3…), its fitted component (or "— EMPTY BAY —"
// for legal empties, FR-4), the component's cost, and a clear-bay button.
//
// Stateless: the parent owns the working Build and the selected-bay signal;
// this component just fires callbacks.

import type {
  Catalog,
  ComponentDef,
  SlotType,
} from '../../../catalog/index.js';
import type { Build } from '../../../domain/index.js';
import { SLOT_ORDER, SlotTag } from '../../components/index.js';

interface SlotBenchProps {
  readonly catalog: Catalog;
  readonly build: Build;
  readonly layout: readonly SlotType[];
  readonly labels: readonly string[];
  readonly selectedBay: number | null;
  readonly onSelectBay: (index: number) => void;
  readonly onClearBay: (index: number) => void;
}

interface BayInfo {
  readonly index: number;
  readonly label: string;
  readonly type: SlotType;
  readonly component: ComponentDef | undefined;
}

/** Sub-headline for each type-group. `3W · 8 pt · 3 FITTED` shape. */
function groupSummary(
  type: SlotType,
  bays: readonly BayInfo[],
): string {
  let cost = 0;
  let filled = 0;
  for (const b of bays) {
    if (b.component !== undefined) {
      cost += b.component.pointCost;
      filled += 1;
    }
  }
  return `${String(filled)} of ${String(bays.length)} FITTED · ${String(cost)} pt`;
}

const GROUP_TITLE: Record<SlotType, string> = {
  weapon: 'WEAPON BAYS',
  shield: 'SHIELD BAYS',
  missile: 'MISSILE BAYS',
  engine: 'ENGINE BAYS',
  special: 'SPECIAL BAYS',
};

function OneBay(props: {
  bay: BayInfo;
  selected: boolean;
  onSelect: () => void;
  onClear: () => void;
}) {
  const { bay, selected, onSelect, onClear } = props;
  const filled = bay.component !== undefined;
  const cls = filled
    ? selected
      ? 'bay is-filled is-selected'
      : 'bay is-filled'
    : selected
      ? 'bay is-empty is-selected'
      : 'bay is-empty';
  return (
    <div
      class={cls}
      data-testid={`shipyard-bay-${bay.label}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          onSelect();
        }
      }}
    >
      <SlotTag type={bay.type} />
      <span class="mono-xs" style="width:22px">
        {bay.label}
      </span>
      <span class="bay-name">
        {filled ? (
          <>
            {bay.component!.name.toUpperCase()}
            <span class="mono-xs" style="display:block">
              {bay.component!.id}
            </span>
          </>
        ) : (
          <>
            — EMPTY BAY —
            <span class="mono-xs" style="display:block;font-style:normal">
              LEGAL &amp; CHEAPER · SELECT TO FIT A {bay.type.toUpperCase()}
            </span>
          </>
        )}
      </span>
      <span class="bay-cost">
        {filled ? bay.component!.pointCost : 0}
        <span class="mono-xs c-dim">pt</span>
      </span>
      {filled ? (
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          aria-label={`Clear bay ${bay.label}`}
          data-testid={`shipyard-bay-${bay.label}-clear`}
          onClick={(ev) => {
            ev.stopPropagation();
            onClear();
          }}
        >
          ✕
        </button>
      ) : (
        <span aria-hidden="true" class="mono-xs c-dim" style="width:22px;text-align:center">
          ·
        </span>
      )}
    </div>
  );
}

export function SlotBench(props: SlotBenchProps) {
  const {
    catalog,
    build,
    layout,
    labels,
    selectedBay,
    onSelectBay,
    onClearBay,
  } = props;

  const bays: BayInfo[] = [];
  for (let i = 0; i < layout.length; i += 1) {
    const type = layout[i];
    const label = labels[i];
    if (type === undefined || label === undefined) continue;
    const componentId = build.slots[i] ?? null;
    const component =
      componentId === null ? undefined : catalog.component(componentId);
    bays.push({ index: i, label, type, component });
  }

  const groups: Record<SlotType, BayInfo[]> = {
    weapon: [],
    shield: [],
    missile: [],
    engine: [],
    special: [],
  };
  for (const bay of bays) groups[bay.type].push(bay);

  return (
    <div data-testid="shipyard-slot-bench">
      {SLOT_ORDER.map((type) => {
        const groupBays = groups[type];
        if (groupBays.length === 0) return null;
        return (
          <div
            key={type}
            style="margin-top:12px"
            data-testid={`shipyard-bay-group-${type}`}
          >
            <div style="display:flex;align-items:baseline;justify-content:space-between">
              <span class="t-label">
                {GROUP_TITLE[type]} · {groupBays.length}
              </span>
              <span class="mono-xs">{groupSummary(type, groupBays)}</span>
            </div>
            <div class="stack" style="margin-top:5px">
              {groupBays.map((bay) => (
                <OneBay
                  key={bay.label}
                  bay={bay}
                  selected={selectedBay === bay.index}
                  onSelect={() => onSelectBay(bay.index)}
                  onClear={() => onClearBay(bay.index)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
