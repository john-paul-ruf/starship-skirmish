// M14 UI — Skirmish Setup · fleet draft (S04 CP1).
//
// Left: the Encyclopedia as the draft SOURCE (every fit-legal build; §4.7 keeps
// needs-refit-but-legal builds draftable). Right: the drafted player fleet with
// a per-ship cost + remove, and the running total vs budget.
//
// §4.4 is a review gate rendered here VERBATIM: leftover points are wasted;
// under-budget CAN launch, over-budget CANNOT. Over-budget paints the total red;
// under-budget shows the leftover — both are legal to SEE, only over-budget
// blocks LAUNCH (the LaunchBar owns that gate). The screen computes no cost:
// every number flows from `domain` via the model.

import type { Catalog } from '../../../catalog/index.js';
import { pointCost, type Build } from '../../../domain/index.js';
import type { IndexEntry } from '../../../persist/index.js';
import { Button, Chip, Segmented } from '../../components/index.js';

import {
  budgetStatus,
  draftAffordable,
  playerFleetCost,
  remainingPoints,
  standardAffordable,
  type DraftSource,
  type SetupState,
} from './model.js';

/** The §4.4 statement, rendered verbatim (S04 CP1 review gate). */
export const WASTED_POINTS_STATEMENT =
  'Leftover points are wasted. There is no conversion to initiative, reserves, or rerolls.';

export interface FleetDraftProps {
  readonly catalog: Catalog;
  readonly state: SetupState;
  readonly entries: readonly IndexEntry[];
  readonly onAddEntry: (id: string) => void;
  readonly onRemove: (index: number) => void;
  /** Which pool the source panel is showing — MY FLEET (library) or STANDARD FLEET (prebuilt). */
  readonly source: DraftSource;
  readonly onSetSource: (source: DraftSource) => void;
  /** The prebuilt roster for the current budget (see `standardFleet` in model.ts). */
  readonly standardBuilds: readonly Build[];
  /** Draft one standard ship into the player fleet (`addToDraft`). */
  readonly onAddStandard: (build: Build) => void;
  /** Copy one standard ship into the Encyclopedia so it can be customised (fresh identity). */
  readonly onSaveStandard: (build: Build) => void;
}

const chassisLabel = (catalog: Catalog, chassisId: string): string => {
  const chassis = catalog.chassis(chassisId);
  if (chassis === undefined) return chassisId.toUpperCase();
  return `${chassis.name.toUpperCase()} · ${chassis.classId.replace('-', ' ').toUpperCase()}`;
};

export function FleetDraft({
  catalog,
  state,
  entries,
  onAddEntry,
  onRemove,
  source,
  onSetSource,
  standardBuilds,
  onAddStandard,
  onSaveStandard,
}: FleetDraftProps) {
  const cost = playerFleetCost(state, catalog);
  const remaining = remainingPoints(state, catalog);
  const status = budgetStatus(state, catalog);
  const over = status === 'over';
  const showingLibrary = source === 'library';
  const countChip = showingLibrary
    ? `${String(entries.length)} BUILDS`
    : `${String(standardBuilds.length)} STANDARD`;

  return (
    <div class="skm-draft">
      {/* ---- SOURCE: Encyclopedia (MY FLEET) or prebuilt (STANDARD FLEET) ---- */}
      <section class="panel" data-testid="draft-source">
        <div class="panel-hd">
          <span class="t-h2">{showingLibrary ? 'Your Encyclopedia' : 'Standard Fleet'}</span>
          <span class="grow" />
          <Chip>{countChip}</Chip>
        </div>
        <div class="panel-bd" data-testid="draft-source-toggle">
          <Segmented
            aria-label="Draft source"
            value={source}
            options={[
              { value: 'library', label: 'MY FLEET' },
              { value: 'standard', label: 'STANDARD FLEET' },
            ]}
            onChange={(v) => {
              onSetSource(v as DraftSource);
            }}
          />
        </div>
        <div class="panel-bd mono-xs" style="color:var(--cyan);border-bottom:1px solid var(--line)">
          {showingLibrary
            ? 'DUPLICATES ALLOWED — field as many copies as the points permit.'
            : 'PREBUILT ROSTER — ＋ Add drafts a copy; ⭳ Save copies it to your Encyclopedia to edit.'}
        </div>
        {showingLibrary ? (
          entries.length === 0 ? (
            <div class="panel-bd t-prose">
              No saved builds yet. Author one in the Shipyard, or switch to STANDARD FLEET to draft a prebuilt ship.
            </div>
          ) : (
            <div class="skm-source-list">
              {entries.map((entry) => {
                const fits = draftAffordable(entry, state, catalog);
                return (
                  <div class="row" key={entry.id} style="align-items:flex-start">
                    <span class="grow">
                      <span class="skm-row-name">{entry.name.length > 0 ? entry.name : '(unnamed)'}</span>
                      <span class="mono-xs" style="display:block">
                        {chassisLabel(catalog, entry.chassisId)}
                      </span>
                      {entry.needsRefit ? (
                        <span class="mono-xs" style="display:block;color:var(--amber)">
                          ⚠ NEEDS REFIT · CURRENT COST FITS · DRAFTABLE
                        </span>
                      ) : null}
                    </span>
                    <span style="text-align:right;flex:none">
                      <span class="t-num" style="display:block">
                        {String(entry.currentCost)}
                      </span>
                      <Button
                        size="sm"
                        disabled={!fits}
                        onClick={() => {
                          onAddEntry(entry.id);
                        }}
                        aria-label={`Add ${entry.name} to your fleet`}
                      >
                        ＋ Add
                      </Button>
                      <span
                        class="mono-xs"
                        style={`display:block;margin-top:4px${fits ? '' : ';color:var(--amber)'}`}
                      >
                        {fits
                          ? `COSTS ${String(entry.currentCost)} · ${String(Math.max(0, remaining))} LEFT`
                          : `NEEDS ${String(entry.currentCost)} · ONLY ${String(Math.max(0, remaining))} LEFT`}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          )
        ) : standardBuilds.length === 0 ? (
          <div class="panel-bd t-prose">
            No standard ships fit this budget. Raise the budget to see a roster.
          </div>
        ) : (
          <div class="skm-source-list">
            {standardBuilds.map((build, index) => {
              const shipCost = pointCost(catalog, build);
              const fits = standardAffordable(build, state, catalog);
              const displayName = build.name.length > 0 ? build.name : '(unnamed)';
              return (
                <div
                  class="row"
                  key={`${build.id}-${String(index)}`}
                  style="align-items:flex-start"
                  data-testid="standard-row"
                >
                  <span class="grow">
                    <span class="skm-row-name">{displayName}</span>
                    <span class="mono-xs" style="display:block">
                      {chassisLabel(catalog, build.chassisId)}
                    </span>
                  </span>
                  <span style="text-align:right;flex:none">
                    <span class="t-num" style="display:block">
                      {String(shipCost)}
                    </span>
                    <Button
                      size="sm"
                      disabled={!fits}
                      onClick={() => {
                        onAddStandard(build);
                      }}
                      aria-label={`Add ${displayName} to your fleet`}
                    >
                      ＋ Add
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        onSaveStandard(build);
                      }}
                      aria-label={`Save ${displayName} to your Encyclopedia`}
                    >
                      ⭳ Save
                    </Button>
                    <span
                      class="mono-xs"
                      style={`display:block;margin-top:4px${fits ? '' : ';color:var(--amber)'}`}
                    >
                      {fits
                        ? `COSTS ${String(shipCost)} · ${String(Math.max(0, remaining))} LEFT`
                        : `NEEDS ${String(shipCost)} · ONLY ${String(Math.max(0, remaining))} LEFT`}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---- DRAFTED: the player fleet ---- */}
      <section class="panel" data-testid="draft-fleet">
        <div class="panel-hd">
          <span class="t-h2">Your Fleet</span>
          <span class="grow" />
          <Chip tone="cyan">{`${String(state.playerBuilds.length)} HULLS · ${String(cost)} PTS`}</Chip>
        </div>

        {state.playerBuilds.length === 0 ? (
          <div class="panel-bd t-prose">
            Empty fleet. Add at least one ship from your Encyclopedia to launch.
          </div>
        ) : (
          <div class="skm-fleet-list">
            {state.playerBuilds.map((build, index) => (
              <div class="row" key={`${build.id}-${String(index)}`}>
                <span class="grow">
                  <span class="skm-row-name">{build.name.length > 0 ? build.name : '(unnamed)'}</span>
                  <span class="mono-xs" style="display:block">
                    {chassisLabel(catalog, build.chassisId)}
                  </span>
                </span>
                <span class="t-num" style="flex:none;min-width:34px;text-align:right">
                  {String(pointCost(catalog, build))}
                </span>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    onRemove(index);
                  }}
                  aria-label={`Remove ${build.name} from your fleet`}
                >
                  ✕
                </Button>
              </div>
            ))}
          </div>
        )}

        <div class="panel-ft skm-total-row">
          <span class="t-label">Draft Total</span>
          <span class="grow" />
          <span
            class={`t-num${over ? ' c-red' : ''}`}
            data-testid="draft-total"
          >
            {String(cost)}
          </span>
          <span class="mono-xs">{`/ ${String(state.budget)} PTS`}</span>
        </div>

        <div class={`banner ${over ? 'banner-danger' : 'banner-info'}`} data-testid="budget-note">
          <span aria-hidden="true" class={over ? 'c-red' : 'c-cyan'}>
            {over ? '⚠' : '◈'}
          </span>
          <div>
            <div class="skm-budget-headline">
              {over
                ? `OVER BUDGET BY ${String(-remaining)} — REMOVE POINTS TO LAUNCH.`
                : status === 'exact'
                  ? 'FULLY SPENT — EVERY POINT IS ON THE FIELD.'
                  : `UNDER BUDGET — ${String(remaining)} POINTS UNSPENT. UNDER-BUDGET FLEETS CAN LAUNCH.`}
            </div>
            <div class="mono-xs" style="margin-top:2px">
              {WASTED_POINTS_STATEMENT}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
