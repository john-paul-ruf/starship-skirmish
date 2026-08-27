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
import { pointCost } from '../../../domain/index.js';
import type { IndexEntry } from '../../../persist/index.js';
import { Button, Chip } from '../../components/index.js';

import {
  budgetStatus,
  draftAffordable,
  playerFleetCost,
  remainingPoints,
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
}

const chassisLabel = (catalog: Catalog, chassisId: string): string => {
  const chassis = catalog.chassis(chassisId);
  if (chassis === undefined) return chassisId.toUpperCase();
  return `${chassis.name.toUpperCase()} · ${chassis.classId.replace('-', ' ').toUpperCase()}`;
};

export function FleetDraft({ catalog, state, entries, onAddEntry, onRemove }: FleetDraftProps) {
  const cost = playerFleetCost(state, catalog);
  const remaining = remainingPoints(state, catalog);
  const status = budgetStatus(state, catalog);
  const over = status === 'over';

  return (
    <div class="skm-draft">
      {/* ---- SOURCE: the Encyclopedia ---- */}
      <section class="panel" data-testid="draft-source">
        <div class="panel-hd">
          <span class="t-h2">Your Encyclopedia</span>
          <span class="grow" />
          <Chip>{`${String(entries.length)} BUILDS`}</Chip>
        </div>
        <div class="panel-bd mono-xs" style="color:var(--cyan);border-bottom:1px solid var(--line)">
          DUPLICATES ALLOWED — field as many copies as the points permit.
        </div>
        {entries.length === 0 ? (
          <div class="panel-bd t-prose">
            No saved builds yet. Author one in the Shipyard — the Encyclopedia is the only draft source.
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
