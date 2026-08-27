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
import type { Build, DerivedStats, RefitDiff } from '../../domain/index.js';
import { pointCost } from '../../domain/index.js';
import { Tabs } from '../components/index.js';

import { ChassisPicker } from './shipyard/ChassisPicker.js';
import { ComponentPicker } from './shipyard/ComponentPicker.js';
import { LedgerPanel } from './shipyard/LedgerPanel.js';
import { SaveBar } from './shipyard/SaveBar.js';
import { SlotBench } from './shipyard/SlotBench.js';
import { StatsPanel } from './shipyard/StatsPanel.js';
import {
  applySlot,
  buildLayout,
  buildShareLink,
  chassisByClass,
  createFreshBuild,
  fitErrorLabel,
  prepareSave,
  slotLabels,
  snapshot,
  statsDelta,
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
  const { catalog, route, repo, navigate, toast } = useApp();

  const groups = useMemo(() => chassisByClass(catalog), [catalog]);

  // ---- Working build (the whole editable state) ---------------------------

  const workingBuild = useSignal<Build | null>(null);
  const selectedBay = useSignal<number | null>(null);
  const catalogTab = useSignal<CatalogTab>('chassis');
  /** The previous fit's derived stats — the `Delta` primitive's `from`. */
  const previousStats = useSignal<DerivedStats | null>(null);
  /** Optional player-set reference budget; not a save gate (§4.4 corollary). */
  const budget = useSignal<number | null>(null);
  /** Editable name draft — kept separate from `Build.name` so save-time NFC
   * normalisation is the single point that stamps the name into the record. */
  const nameDraft = useSignal<string>('');
  /** Working tag list under edit. Committed to Build only at save time. */
  const tagsDraft = useSignal<readonly string[]>([]);
  const tagDraft = useSignal<string>('');
  /** Refit receipt on edit-existing entry (design §4.7). */
  const refitReceipt = useSignal<RefitDiff | null>(null);

  // Route-arriving buildId → edit an existing build. Loading is idempotent
  // per buildId (StrictMode-safe): we skip if the working build already
  // matches the requested id.
  const currentRoute = route.value;
  const routeBuildId =
    currentRoute.name === 'shipyard' ? currentRoute.buildId : undefined;

  useEffect(() => {
    if (routeBuildId === undefined) return;
    if (workingBuild.value?.id === routeBuildId) return;
    const loaded = repo.get(routeBuildId);
    if (loaded === null) {
      toast(`BUILD ${routeBuildId.slice(0, 8)} NOT FOUND`, 'warn');
      return;
    }
    workingBuild.value = loaded.build;
    nameDraft.value = loaded.build.name;
    tagsDraft.value = [...loaded.build.tags];
    tagDraft.value = '';
    previousStats.value = null;
    refitReceipt.value = loaded.refit;
    selectedBay.value = null;
    catalogTab.value = 'chassis';
    // signals never change identity — the effect only re-runs on routeBuildId
  }, [routeBuildId]);

  const pickChassis = (chassisId: string, chassisName: string) => {
    const defaultName = `NEW ${chassisName.toUpperCase()}`;
    const result = createFreshBuild(
      catalog,
      chassisId,
      defaultName,
      AUTHORING_SCHEMA_VERSION,
    );
    if (result.ok) {
      // Snapshot the outgoing build's stats as "previous" so the first fit's
      // Delta reads meaningfully (chassis→chassis switch shows Δ vs old ship).
      const prev = workingBuild.value;
      previousStats.value =
        prev === null ? null : (snapshot(catalog, prev).stats ?? null);
      workingBuild.value = result.value;
      nameDraft.value = defaultName;
      tagsDraft.value = [];
      tagDraft.value = '';
      refitReceipt.value = null;
      selectedBay.value = null;
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

  /** Snapshot the OUTGOING fit's stats before every mutation — the `Delta.from`. */
  const snapshotPrevious = (b: Build) => {
    previousStats.value = snapshot(catalog, b).stats ?? null;
  };

  const clearBay = (index: number) => {
    const b = workingBuild.value;
    if (b === null) return;
    snapshotPrevious(b);
    workingBuild.value = applySlot(b, index, null);
  };

  const pickComponent = (component: ComponentDef) => {
    const b = workingBuild.value;
    const bay = selectedBay.value;
    if (b === null || bay === null) return;
    const layout = buildLayout(catalog, b);
    if (layout[bay] !== component.slotType) return;
    snapshotPrevious(b);
    workingBuild.value = applySlot(b, bay, component.id);
  };

  // ---- Fit snapshot (derived) --------------------------------------------

  const snap = useComputed<FitSnapshot | null>(() => {
    const b = workingBuild.value;
    if (b === null) return null;
    return snapshot(catalog, b);
  });

  // ---- Save / share ------------------------------------------------------

  /** Add the current tag draft to the list — dedupes on save (io.normalizeTags). */
  const addTag = () => {
    const trimmed = tagDraft.value.trim();
    if (trimmed.length === 0) return;
    const next = tagsDraft.value.includes(trimmed)
      ? tagsDraft.value
      : [...tagsDraft.value, trimmed];
    tagsDraft.value = next;
    tagDraft.value = '';
  };

  const removeTag = (tag: string) => {
    tagsDraft.value = tagsDraft.value.filter((t) => t !== tag);
  };

  const saveCandidate = useComputed(() => {
    const b = workingBuild.value;
    if (b === null) return null;
    return prepareSave(catalog, b, nameDraft.value, tagsDraft.value);
  });

  const doSave = () => {
    const candidate = saveCandidate.value;
    if (candidate === null || candidate.build === null) return;
    const result = repo.put(candidate.build);
    if (!result.ok) {
      if (result.reason === 'ERR_QUOTA') {
        toast('STORAGE FULL — SAVE FAILED', 'danger');
        return;
      }
      toast(`SAVE FAILED · ${result.reason}`, 'danger');
      return;
    }
    if (result.degraded === true) {
      toast('SAVED IN SESSION MODE — STORAGE DEGRADED', 'warn');
    } else {
      toast(`SAVED · ${candidate.build.name}`);
    }
    // The build we just wrote is now the current working state — reflect the
    // storedCost/updatedAt bump so a subsequent share encodes today's cost.
    workingBuild.value = candidate.build;
    refitReceipt.value = null;
    navigate({ name: 'encyclopedia' });
  };

  const doShare = () => {
    const candidate = saveCandidate.value;
    if (candidate === null || candidate.build === null) return;
    const loc = (globalThis as { location?: Location }).location;
    const origin = loc?.origin ?? '';
    const pathname = loc?.pathname ?? '/';
    const link = buildShareLink(catalog, candidate.build, origin, pathname);
    if (!link.ok) {
      toast(`SHARE FAILED · ${link.error.code}`, 'danger');
      return;
    }
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    const clipboard = nav?.clipboard;
    if (clipboard === undefined) {
      toast('CLIPBOARD UNAVAILABLE — LINK NOT COPIED', 'warn');
      return;
    }
    void clipboard.writeText(link.value.url).then(
      () => {
        const msg = link.value.longUrl
          ? 'SHARE LINK COPIED · LONG URL'
          : 'SHARE LINK COPIED';
        toast(msg);
      },
      () => {
        toast('CLIPBOARD DENIED — LINK NOT COPIED', 'warn');
      },
    );
  };

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
            refit={refitReceipt.value}
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
        <LedgerPanel
          snap={snap.value}
          chassisCost={chassisCost(catalog, workingBuild.value)}
          componentCount={componentCount(workingBuild.value)}
          emptySlotCount={emptySlotCount(workingBuild.value)}
          budget={budget.value}
          onBudgetChange={(v) => {
            budget.value = v;
          }}
        />
        <div class="col-scroll" style="overflow-y:auto;overflow-x:hidden;flex:1 1 auto;min-height:0;padding:12px 14px">
          <ValidationPanel snap={snap.value} />
          <StatsPanel
            stats={snap.value?.stats ?? null}
            delta={statsDelta(previousStats.value, snap.value?.stats ?? null)}
          />
          {workingBuild.value !== null ? (
            <SaveBar
              name={nameDraft.value}
              tags={tagsDraft.value}
              tagDraft={tagDraft.value}
              canSave={saveCandidate.value?.build !== null && saveCandidate.value !== null}
              errors={
                saveCandidate.value?.nameErrors ?? []
              }
              onNameChange={(v) => {
                nameDraft.value = v;
              }}
              onTagDraftChange={(v) => {
                tagDraft.value = v;
              }}
              onAddTag={addTag}
              onRemoveTag={removeTag}
              onSave={doSave}
              onShare={doShare}
            />
          ) : null}
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
  refit: RefitDiff | null;
  onSelectBay: (index: number) => void;
  onClearBay: (index: number) => void;
}) {
  const { build, snap, selectedBay, refit, onSelectBay, onClearBay } = props;
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
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
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
      {refit !== null ? <RefitReceipt refit={refit} labels={labels} /> : null}
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
 * Design §4.7 — `needs-refit` is informative, not punitive. Show what
 * changed and by how much; keep the build viewable + editable. The RE-FIT
 * flow is: user swaps components, save recomputes storedCost.
 */
function RefitReceipt(props: { refit: RefitDiff; labels: readonly string[] }) {
  const { refit, labels } = props;
  const changedLines = refit.lines.filter(
    (line) => line.componentId !== null,
  );
  return (
    <div
      class="banner banner-warn"
      style="margin:8px 16px;padding:10px 14px;background:rgba(255,176,32,.08);border:1px solid rgba(255,176,32,.35);border-radius:var(--r);display:flex;gap:10px"
      data-testid="shipyard-refit-receipt"
    >
      <span class="c-amber" style="font-weight:700;font-size:14px" aria-hidden="true">
        ⚠
      </span>
      <span>
        <span class="t-h2 c-amber" style="font-size:11px">
          NEEDS REFIT · CATALOG DRIFT
        </span>
        <span class="t-prose" style="display:block;color:var(--ink)">
          Recalculated {refit.oldTotal} → {refit.newTotal} PTS{' '}
          <span
            class={refit.delta > 0 ? 'c-amber' : refit.delta < 0 ? 'c-green' : 'c-dim'}
            style="font-weight:700"
          >
            ({refit.delta > 0 ? '+' : ''}
            {refit.delta} pt)
          </span>
        </span>
        <span class="mono-xs c-dim" style="display:block;margin-top:4px">
          Per-slot current cost:{' '}
          {changedLines
            .map(
              (line) =>
                `${labels[line.index] ?? '?'}=${line.currentCost}pt`,
            )
            .join(' · ')}
        </span>
        <span class="mono-xs" style="display:block;margin-top:4px">
          RE-FIT NOW · SAVE to bank today&apos;s cost. Under-budget is legal (§4.4).
        </span>
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

function chassisCost(
  catalog: ReturnType<typeof useApp>['catalog'],
  build: Build | null,
): number {
  if (build === null) return 0;
  return catalog.chassis(build.chassisId)?.pointCost ?? 0;
}

function componentCount(build: Build | null): number {
  if (build === null) return 0;
  return build.slots.reduce<number>((n, s) => (s !== null ? n + 1 : n), 0);
}

function emptySlotCount(build: Build | null): number {
  if (build === null) return 0;
  return build.slots.reduce<number>((n, s) => (s === null ? n + 1 : n), 0);
}

