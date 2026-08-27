// M14 UI — Shipyard screen (S05).
//
// Screen #1, Flow 1. "The Shipyard is a spreadsheet that respects you"
// (design §0): three columns of dense tabular readouts, running total,
// delta indicators on every derived stat, the swap→read-delta→swap loop
// as tight as editing a spreadsheet cell.
//
// Owns the working `Build` and the "previous fit" snapshot for `Delta`; all
// legality/cost/derivation is delegated to `src/domain/**` via the local
// `./shipyard/model.ts` orchestration layer (per FR-3..6). D-IOC-SEAM: this
// screen reaches services via `useApp()` — it never imports `src/app`.
// D-PLACEHOLDER: the export name `Shipyard` is contracted; the barrel and
// the outlet in `App.tsx` are not re-edited.

import { useComputed, useSignal } from '@preact/signals';
import { useEffect, useMemo } from 'preact/hooks';

import { useApp } from '../appContext.js';
import type { ComponentDef, SlotType } from '../../catalog/index.js';
import type { Build } from '../../domain/index.js';
import { pointCost } from '../../domain/index.js';
import { Tabs } from '../components/index.js';

import { ChassisPicker } from './shipyard/ChassisPicker.js';
import { ComponentPicker } from './shipyard/ComponentPicker.js';
import { SlotBench } from './shipyard/SlotBench.js';
import {
  applySlot,
  buildLayout,
  chassisByClass,
  createFreshBuild,
  fitErrorLabel,
  slotLabels,
  snapshot,
  type FitSnapshot,
} from './shipyard/model.js';

// The share-token/build-record schema this UI writes at (io/migrate/migrations.ts
// owns the source of truth; at v1 the constant is 1). The model exposes
// `freshMeta(catalog, schemaVersion)` so the number is threaded from ONE
// call-site.
const AUTHORING_SCHEMA_VERSION = 1;

/** The left column's five slot-type tabs + a leading CHASSIS pane. */
type CatalogTab = 'chassis' | SlotType;

const CATALOG_TABS = [
  { id: 'chassis' as const, label: 'CHASSIS' },
  { id: 'weapon' as const, label: 'WEAPON' },
  { id: 'shield' as const, label: 'SHIELD' },
  { id: 'missile' as const, label: 'MISSILE' },
  { id: 'engine' as const, label: 'ENGINE' },
  { id: 'special' as const, label: 'SPECIAL' },
] as const;

export function Shipyard() {
  const { catalog, route } = useApp();

  const groups = useMemo(() => chassisByClass(catalog), [catalog]);

  // ---- Working build (the whole editable state) ---------------------------

  const workingBuild = useSignal<Build | null>(null);
  const selectedBay = useSignal<number | null>(null);
  const catalogTab = useSignal<CatalogTab>('chassis');

  // Route-arriving buildId is not yet wired (edit-existing lands in CP4).
  const currentRoute = route.value;
  const routeBuildId =
    currentRoute.name === 'shipyard' ? currentRoute.buildId : undefined;

  useEffect(() => {
    if (routeBuildId === undefined) return;
    // Edit-existing path lands in CP4.
  }, [routeBuildId]);

  const pickChassis = (chassisId: string, chassisName: string) => {
    const result = createFreshBuild(
      catalog,
      chassisId,
      `NEW ${chassisName.toUpperCase()}`,
      AUTHORING_SCHEMA_VERSION,
    );
    if (result.ok) {
      workingBuild.value = result.value;
      selectedBay.value = null;
      // After chassis pick, stay on the catalog tab so the player sees their
      // chosen chassis highlighted; the tab will auto-switch on bay select.
      catalogTab.value = 'chassis';
    }
  };

  /** Auto-switch the catalog tab to match the selected bay's slot type. */
  const selectBay = (index: number) => {
    selectedBay.value = index;
    const b = workingBuild.value;
    if (b === null) return;
    const layout = buildLayout(catalog, b);
    const type = layout[index];
    if (type !== undefined) catalogTab.value = type;
  };

  const clearBay = (index: number) => {
    const b = workingBuild.value;
    if (b === null) return;
    workingBuild.value = applySlot(b, index, null);
  };

  const pickComponent = (component: ComponentDef) => {
    const b = workingBuild.value;
    const bay = selectedBay.value;
    if (b === null || bay === null) return;
    // Guard against a type/bay mismatch — the picker disables non-matches at
    // input time, but if the tab was switched via keyboard we validate here.
    const layout = buildLayout(catalog, b);
    if (layout[bay] !== component.slotType) return;
    workingBuild.value = applySlot(b, bay, component.id);
  };

  // ---- Fit snapshot (derived) --------------------------------------------

  const snap = useComputed<FitSnapshot | null>(() => {
    const b = workingBuild.value;
    if (b === null) return null;
    return snapshot(catalog, b);
  });

  return (
    <div
      class="yard"
      data-testid="screen-shipyard"
      style="display:grid;grid-template-columns:300px minmax(0,1fr) 340px;gap:1px;background:var(--line);min-height:100%"
    >
      {/* ============================================ LEFT: CATALOG BROWSER */}
      <section
        class="col"
        aria-label="Catalog browser"
        style="background:var(--void);min-height:0;display:flex;flex-direction:column"
      >
        <div
          style="padding:8px 12px;border-bottom:1px solid var(--line);background:var(--panel);display:flex;align-items:center;gap:8px"
        >
          <span class="t-h2">CATALOG</span>
          <span class="grow" />
          <span class="mono-xs">
            {selectedBay.value === null
              ? 'PICK A BAY TO FIT'
              : `BAY #${String(selectedBay.value + 1)} · ${catalogTab.value.toUpperCase()}`}
          </span>
        </div>
        <div style="background:var(--panel);overflow-x:auto">
          <Tabs
            tabs={CATALOG_TABS}
            activeId={catalogTab.value}
            onChange={(id) => {
              catalogTab.value = id;
            }}
            aria-label="Slot type"
          />
        </div>
        <div class="col-scroll" style="overflow-y:auto;overflow-x:hidden;flex:1 1 auto;min-height:0">
          {catalogTab.value === 'chassis' ? (
            <ChassisPicker
              groups={groups}
              selectedId={workingBuild.value?.chassisId ?? ''}
              onPick={(chassis) => pickChassis(chassis.id, chassis.name)}
            />
          ) : workingBuild.value !== null ? (
            <ComponentPicker
              catalog={catalog}
              build={workingBuild.value}
              slotType={catalogTab.value}
              targetBay={selectedBay.value}
              onPick={pickComponent}
            />
          ) : (
            <p class="mono-xs c-dim" style="padding:16px">
              PICK A CHASSIS FIRST — COMPONENT PICKER WAKES UP AFTER A HULL IS
              ON THE BENCH.
            </p>
          )}
        </div>
      </section>

      {/* ============================================ CENTER: FITTING BENCH */}
      <section
        class="col"
        aria-label="Fitting bench"
        style="background:var(--void);min-height:0;display:flex;flex-direction:column"
      >
        {workingBuild.value === null ? (
          <FittingBenchEmpty />
        ) : (
          <FittingBenchLoaded
            build={workingBuild.value}
            snap={snap.value}
            selectedBay={selectedBay.value}
            onSelectBay={selectBay}
            onClearBay={clearBay}
          />
        )}
      </section>

      {/* ============================================ RIGHT: LEDGER + DERIVED */}
      <section
        class="col"
        aria-label="Point ledger and derived stats"
        style="background:var(--void);min-height:0;display:flex;flex-direction:column"
      >
        <div
          class="ledger"
          style="background:var(--panel);border-bottom:1px solid var(--line);padding:10px 14px"
        >
          <div style="display:flex;align-items:baseline;justify-content:space-between">
            <span class="t-label">POINT TOTAL</span>
            <span class="mono-xs c-dim">FR-5</span>
          </div>
          <div style="display:flex;align-items:flex-end;gap:8px;margin-top:4px">
            <span
              class="t-num-xl c-cyan"
              data-testid="shipyard-point-total"
              style="text-shadow:0 0 18px rgba(34,227,255,.45)"
            >
              {snap.value === null ? '—' : String(snap.value.cost)}
            </span>
            <span class="t-h2" style="padding-bottom:3px">PTS</span>
          </div>
          <ValidationBadge snap={snap.value} />
          <p class="mono-xs" style="margin:9px 0 0;line-height:1.5;color:var(--ink-dim)">
            <span class="c-amber">!</span> LEFTOVER POINTS ARE WASTED — THERE IS NO CONVERSION.
          </p>
        </div>
        <div class="col-scroll" style="overflow-y:auto;overflow-x:hidden;flex:1 1 auto;min-height:0;padding:12px 14px">
          <ValidationPanel snap={snap.value} />
          <p class="mono-xs c-dim" data-testid="shipyard-ledger-placeholder" style="margin-top:10px">
            DERIVED READOUT LANDS IN CP3.
          </p>
        </div>
      </section>
    </div>
  );
}

// ---- Sub-views ------------------------------------------------------------

function FittingBenchEmpty() {
  return (
    <div class="panel-bd stack" style="padding:24px" data-testid="shipyard-bench-empty">
      <div class="t-h1">PICK A CHASSIS</div>
      <p class="t-prose c-dim">
        The Shipyard is a spreadsheet that respects you. Choose a chassis on
        the left; the fitting bench and derived readouts will populate.
      </p>
    </div>
  );
}

function FittingBenchLoaded(props: {
  build: Build;
  snap: FitSnapshot | null;
  selectedBay: number | null;
  onSelectBay: (index: number) => void;
  onClearBay: (index: number) => void;
}) {
  const { build, snap, selectedBay, onSelectBay, onClearBay } = props;
  const { catalog } = useApp();
  const layout = buildLayout(catalog, build);
  const labels = slotLabels(layout);
  const chassis = catalog.chassis(build.chassisId);
  const chassisName = chassis?.name.toUpperCase() ?? build.chassisId.toUpperCase();
  const chassisClass = chassis?.classId.toUpperCase() ?? '';
  const componentCount = build.slots.reduce<number>(
    (n, s) => (s !== null ? n + 1 : n),
    0,
  );

  return (
    <>
      <div style="padding:10px 16px;border-bottom:1px solid var(--line);background:var(--panel)">
        <div style="display:flex;align-items:center;gap:10px">
          <label class="sr-only" for="shipyard-buildName">Build name</label>
          <input
            id="shipyard-buildName"
            class="field"
            style="height:36px;font-size:16px;font-weight:700;letter-spacing:0.10em;text-transform:uppercase"
            value={build.name}
            spellcheck={false}
            data-testid="shipyard-name-input"
            readOnly
          />
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:7px;flex-wrap:wrap">
          <span class="mono-xs">
            <span class="c-amber">◆ {chassisName}</span> · {chassisClass} ·{' '}
            <span class="c-dim">{build.chassisId}</span>
          </span>
          <span class="grow" />
          <span class="mono-xs c-dim" data-testid="shipyard-build-id">
            {build.id.slice(0, 12)}
          </span>
        </div>
      </div>
      <div class="col-scroll" style="overflow-y:auto;overflow-x:hidden;flex:1 1 auto;min-height:0;padding:12px 16px">
        <div style="display:flex;align-items:baseline;gap:10px">
          <span class="t-h2">SLOT BAYS</span>
          <span class="mono-xs">
            {chassisClass ? `${chassisClass} LAYOUT` : ''} · PUBLISHED PER CLASS,
            NOT PER CHASSIS
          </span>
          <span class="grow" />
          <span class="mono-xs">
            {componentCount} of {build.slots.length} FITTED · COMPONENT SUBTOTAL{' '}
            <span class="c-amber" style="font-weight:700" data-testid="shipyard-component-subtotal">
              {snap === null ? 0 : componentsSubtotal(snap.build, catalog)}
            </span>
            <span class="c-dim"> pt</span>
          </span>
        </div>
        <SlotBench
          catalog={catalog}
          build={build}
          layout={layout}
          labels={labels}
          selectedBay={selectedBay}
          onSelectBay={onSelectBay}
          onClearBay={onClearBay}
        />
        <p
          class="banner banner-info"
          style="margin-top:14px;display:flex;gap:10px;padding:10px 14px;background:rgba(34,227,255,.06);border:1px solid rgba(34,227,255,.2);border-radius:var(--r)"
        >
          <span class="c-cyan" style="font-weight:700;font-size:14px" aria-hidden="true">
            ⓘ
          </span>
          <span>
            <span class="t-h2" style="font-size:11px">EMPTY SLOTS ARE LEGAL.</span>
            <span class="t-prose" style="display:block;color:var(--ink)">
              An under-fitted ship is a valid, cheaper ship (FR-4).
            </span>
          </span>
        </p>
      </div>
    </>
  );
}

/**
 * ✓ VALID FIT / ✕ N ISSUES — the single-line fit-legality chip. Sits under
 * the point total so a swap that breaks the fit is visible without scrolling.
 */
function ValidationBadge(props: { snap: FitSnapshot | null }) {
  const { snap } = props;
  if (snap === null) {
    return (
      <div style="margin-top:8px">
        <span class="chip" data-testid="shipyard-validation-badge">
          NO BUILD
        </span>
      </div>
    );
  }
  if (snap.errors.length === 0) {
    return (
      <div style="margin-top:8px">
        <span
          class="chip chip-green"
          data-testid="shipyard-validation-badge"
        >
          ✓ VALID FIT
        </span>
      </div>
    );
  }
  return (
    <div style="margin-top:8px">
      <span
        class="chip chip-red"
        data-testid="shipyard-validation-badge"
      >
        ✕ {snap.errors.length} ISSUE{snap.errors.length === 1 ? '' : 'S'}
      </span>
    </div>
  );
}

/**
 * Full FitError list — every violation at once (FR-4). SlotBench rows already
 * carry the bay id in their `data-testid`; this panel names the same ids in
 * text so the UI reads them out for keyboard/screen-reader users.
 */
function ValidationPanel(props: { snap: FitSnapshot | null }) {
  const { snap } = props;
  if (snap === null || snap.errors.length === 0) return null;
  const { catalog } = useApp();
  const layout = buildLayout(catalog, snap.build);
  const labels = slotLabels(layout);
  return (
    <div
      class="panel"
      style="border:1px solid rgba(255,46,99,.35);background:rgba(255,46,99,.05)"
      data-testid="shipyard-validation-panel"
    >
      <div class="panel-hd">
        <span class="t-h2 c-red">FIT ISSUES</span>
        <span class="grow" />
        <span class="mono-xs">EVERY PROBLEM AT ONCE · FR-4</span>
      </div>
      <div class="panel-bd stack">
        {snap.errors.map((error, i) => (
          <div
            key={`${error.code}-${i}`}
            class="mono-xs"
            style="color:var(--ink);line-height:1.5"
            data-testid={`shipyard-fit-error-${error.code}`}
          >
            <span class="c-red">▸</span> {fitErrorLabel(error, labels)}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Chassis-only-vs-total breakdown surfaces the components subtotal alongside
 * the sticky point total. `snapshot.cost - chassis.pointCost` avoids
 * re-summing per-slot costs.
 */
function componentsSubtotal(
  build: Build,
  catalog: ReturnType<typeof useApp>['catalog'],
): number {
  const chassis = catalog.chassis(build.chassisId);
  const chassisCost = chassis?.pointCost ?? 0;
  return pointCost(catalog, build) - chassisCost;
}

