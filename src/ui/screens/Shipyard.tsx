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
import type { Build } from '../../domain/index.js';
import { pointCost } from '../../domain/index.js';

import { ChassisPicker } from './shipyard/ChassisPicker.js';
import { SlotBench } from './shipyard/SlotBench.js';
import {
  buildLayout,
  chassisByClass,
  createFreshBuild,
  slotLabels,
  snapshot,
  type FitSnapshot,
} from './shipyard/model.js';

// The share-token/build-record schema this UI writes at (io/migrate/migrations.ts
// owns the source of truth; at v1 the constant is 1). The model exposes
// `freshMeta(catalog, schemaVersion)` so the number is threaded from ONE
// call-site.
const AUTHORING_SCHEMA_VERSION = 1;

export function Shipyard() {
  const { catalog, route } = useApp();

  const groups = useMemo(() => chassisByClass(catalog), [catalog]);

  // ---- Working build (the whole editable state) ---------------------------

  const workingBuild = useSignal<Build | null>(null);
  const selectedBay = useSignal<number | null>(null);

  // Route-arriving buildId is not yet wired (edit-existing lands in CP4). CP1
  // handles the fresh path only — reading the field early keeps a placeholder
  // useEffect symmetric with the CP4 hook shape.
  const currentRoute = route.value;
  const routeBuildId =
    currentRoute.name === 'shipyard' ? currentRoute.buildId : undefined;

  useEffect(() => {
    if (routeBuildId === undefined) {
      // Fresh path — the user picks a chassis to seed the build. Nothing to do
      // eagerly; keep any current draft in place.
      return;
    }
    // Edit-existing path lands in CP4. CP1 does not load the repo.
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
    }
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
          <span class="mono-xs">CHASSIS</span>
        </div>
        <div class="col-scroll" style="overflow-y:auto;overflow-x:hidden;flex:1 1 auto;min-height:0">
          <ChassisPicker
            groups={groups}
            selectedId={workingBuild.value?.chassisId ?? ''}
            onPick={(chassis) => pickChassis(chassis.id, chassis.name)}
          />
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
            onSelectBay={(i) => {
              selectedBay.value = i;
            }}
            onClearBay={() => {
              // Wired in CP2 with withSlot(build, i, null).
            }}
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
          <p class="mono-xs" style="margin:9px 0 0;line-height:1.5;color:var(--ink-dim)">
            <span class="c-amber">!</span> LEFTOVER POINTS ARE WASTED — THERE IS NO CONVERSION.
          </p>
        </div>
        <div class="col-scroll" style="overflow-y:auto;overflow-x:hidden;flex:1 1 auto;min-height:0;padding:12px 14px">
          <p class="mono-xs c-dim" data-testid="shipyard-ledger-placeholder">
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

  return (
    <>
      <div
        style="padding:10px 16px;border-bottom:1px solid var(--line);background:var(--panel)"
      >
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
            COMPONENT SUBTOTAL{' '}
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

