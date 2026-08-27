// M14 UI — Tactical Movement roster (S05 CP1).
//
// The player fleet's ships as a plan checklist (§4.3 / FR-15): select-to-plot,
// per-ship status (PLANNED ✓ / COAST ✓ / ● UNPLANNED), and destroyed ships
// struck through and excluded from the gate. Status is TEXT, never color alone
// (design §1.1) — the boundary-exit ships also carry the `✕ EXIT` word.

import type { BodyId } from '../../../sim/index.js';
import type { PlanDraft, PlanStatus, RosterShip } from './model.js';

interface StatusChip {
  readonly text: string;
  readonly cls: string;
}

/** The per-ship status label + color class. Boundary-exit ships (§4.1) carry
 *  the `✕ EXIT` word so the hazard reads without color. */
const statusChip = (status: PlanStatus, exiting: boolean): StatusChip => {
  if (exiting) return { text: '✕ EXIT ARC', cls: 'c-red' };
  switch (status) {
    case 'planned':
      return { text: 'PLANNED ✓', cls: 'c-green' };
    case 'coast':
      return { text: 'COAST ✓', cls: 'c-cyan' };
    default:
      return { text: '● UNPLANNED', cls: 'c-amber' };
  }
};

export interface RosterProps {
  readonly rows: readonly RosterShip[];
  readonly drafts: ReadonlyMap<BodyId, PlanDraft>;
  readonly exitIds: ReadonlySet<BodyId>;
  readonly selectedId: BodyId | null;
  readonly onSelect: (bodyId: BodyId) => void;
}

export function Roster({ rows, drafts, exitIds, selectedId, onSelect }: RosterProps) {
  const planned = rows.filter((r) => r.alive && drafts.get(r.bodyId)?.status !== 'unplanned').length;
  const living = rows.filter((r) => r.alive).length;

  return (
    <aside class="tm-roster panel" aria-label="Fleet roster" data-testid="roster">
      <div class="tm-side-hd">
        <span class="t-label">Roster</span>
        <span class="grow" />
        <span class="mono-xs" data-testid="roster-live">
          {String(living)} LIVE · {String(rows.length - living)} LOST
        </span>
      </div>
      <div class="panel-in tm-roster-note">
        <div class="mono-xs">FULL INFORMATION — NO FOG OF WAR</div>
      </div>

      <div class="tm-roster-list">
        {rows.map((row) => {
          if (!row.alive) {
            return (
              <div
                key={row.bodyId}
                class="row-ship is-dead tm-row"
                data-testid="roster-row"
                data-ship-id={String(row.bodyId)}
              >
                <span class="row-name tm-row-dead">{row.name}</span>
                <span class="mono-xs c-dim">{row.chassisClass.toUpperCase()}</span>
                <span class="grow" />
                <span class="mono-xs c-red" style="letter-spacing:.14em">
                  ✕ DESTROYED
                </span>
              </div>
            );
          }
          const chip = statusChip(drafts.get(row.bodyId)?.status ?? 'unplanned', exitIds.has(row.bodyId));
          const isSel = selectedId === row.bodyId;
          return (
            <button
              key={row.bodyId}
              type="button"
              class={`row-ship tm-row${isSel ? ' is-selected' : ''}`}
              data-testid="roster-row"
              data-ship-id={String(row.bodyId)}
              aria-pressed={isSel}
              onClick={() => onSelect(row.bodyId)}
            >
              <span class="row-name">{row.name}</span>
              <span class="mono-xs c-dim">{row.chassisClass.toUpperCase()}</span>
              <span class="grow" />
              <span class={`mono-xs tm-row-status ${chip.cls}`} style="letter-spacing:.14em">
                {chip.text}
              </span>
            </button>
          );
        })}
      </div>

      <div class="panel-in tm-roster-gate mono-xs">
        <span class="c-hi" data-testid="roster-planned">
          {String(planned)}
        </span>
        /{String(living)} PLANNED OR COAST
      </div>
    </aside>
  );
}
