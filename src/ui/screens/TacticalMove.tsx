// M14 UI — Tactical Movement screen (S05 body over the S01 placeholder).
//
// The blind arc-plotting screen — the tension engine (design §4.1–§4.3). For
// each living player ship the player plots a thrust arc (numeric bearing / pitch
// / magnitude, Δv clamped to budget) against a live ghost that CANNOT lie (it
// draws `sim/physics.previewPath` through `controller.previewArc`, D-PREVIEW-
// SEAM — `ui` never value-imports `sim/physics`); commits per-ship as PLANNED
// or COAST; the fleet commit gate (§4.3) blocks until every living ship is
// decided; COMMIT resolves the player's movement promise → the controller
// resolves + hands back the beat to animate → attack. Opponent plans are NOT
// observable — the blind view has no plans field (structural, FR-17).
//
// D-PLACEHOLDER: this REPLACES the S01 placeholder body. The `TacticalMove`
// export name + `data-testid="screen-tactical-move"` root are contracted — the
// screens barrel + `App.tsx` outlet import them and MUST NOT be re-edited.
// CONCEDE lives in the S01 shell match-chrome; this screen never renders one.

import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';

import { useMatch } from '../matchContext.js';

import { Roster } from './tacticalMove/Roster.js';
import {
  fleetGateStatus,
  initialDraft,
  playerRoster,
  type PlanDraft,
} from './tacticalMove/model.js';
import type { BodyId } from '../../sim/index.js';

export function TacticalMove() {
  const match = useMatch();
  const view = match.view.value;
  const phase = match.phase.value;

  const drafts = useSignal<Map<BodyId, PlanDraft>>(new Map());
  const selected = useSignal<BodyId | null>(null);
  const planTurn = useRef<number | null>(null);

  const rows = view === null ? [] : playerRoster(match.initialFleets, view, match.playerFleetId);

  // (Re)initialize the drafts + selection whenever a new plan turn begins.
  // Engine-dead ships start on COAST (initialDraft); every other living ship
  // starts UNPLANNED and must be decided before the gate opens.
  useEffect(() => {
    if (view === null) return;
    if (planTurn.current === view.turn) return;
    planTurn.current = view.turn;
    const next = new Map<BodyId, PlanDraft>();
    let first: BodyId | null = null;
    for (const row of rows) {
      if (!row.alive) continue;
      next.set(row.bodyId, initialDraft(row));
      if (first === null) first = row.bodyId;
    }
    drafts.value = next;
    selected.value = first;
  }, [view === null ? -1 : view.turn]);

  const gate = fleetGateStatus([...drafts.value.values()]);

  return (
    <section class="tm-shell" data-testid="screen-tactical-move">
      <TacticalMoveStyles />

      {phase === 'movement-resolve' ? (
        <div class="tm-resolving panel" data-testid="tm-resolving">
          <div class="t-h2 c-cyan">RESOLVING MOVEMENT…</div>
          <p class="t-prose">The committed beat is animating — plans are locked for this beat.</p>
        </div>
      ) : (
        <div class="tm-layout">
          <Roster
            rows={rows}
            drafts={drafts.value}
            exitIds={EMPTY_EXIT}
            selectedId={selected.value}
            onSelect={(id) => {
              selected.value = id;
            }}
          />

          <main class="tm-stage panel" aria-label="Tactical display · movement plan">
            <div class="tm-stage-note mono-xs c-dim">TACTICAL VIEWPORT</div>
          </main>

          <aside class="tm-plan panel" aria-label="Movement plan">
            <div class="tm-plan-body" />

            <div class="tm-commit-dock panel-ft" data-testid="commit-dock">
              <div class="tm-gate mono-xs" data-testid="commit-gate">
                COMMIT MOVEMENT · <span class="c-hi">{String(gate.plannedCount)}</span>/
                {String(gate.total)} PLANNED
              </div>
              <div class="tm-blind-contract mono-xs">
                <span class="tm-no-timer" data-testid="no-timer">
                  <span class="tm-no-timer-dot" aria-hidden="true" />
                  NO TIMER
                </span>
                <span class="tm-blind-line" data-testid="blind-commit">
                  OPPONENT PLANS ARE NOT OBSERVABLE UNTIL RESOLUTION.
                </span>
              </div>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}

const EMPTY_EXIT: ReadonlySet<BodyId> = new Set<BodyId>();

// ---- Page-scoped styles ---------------------------------------------------
//
// Page-local composition only — never a token redefinition, never a new palette,
// never `!important`. Mirrors the Skirmish/Encyclopedia single scoped <style>
// so the design-token single-source (mocks/console.css) stays intact.

const TM_STYLES = `
  .tm-shell { display: flex; flex-direction: column; height: 100%; min-height: 0; }

  .tm-layout { display: grid; grid-template-columns: 280px minmax(0, 1fr) 340px;
               gap: var(--s3); padding: var(--s3); flex: 1 1 auto; min-height: 0; align-items: stretch; }

  .tm-roster, .tm-plan { display: flex; flex-direction: column; min-height: 0; }
  .tm-roster-note { border: 0; border-bottom: 1px solid var(--line); padding: 5px var(--s3); }
  .tm-roster-list { overflow-y: auto; overflow-x: hidden; flex: 1 1 auto; min-height: 0; }
  .tm-roster-gate { border: 0; border-top: 1px solid var(--line-hot); padding: 6px var(--s3);
                    letter-spacing: .12em; }

  .tm-row { display: flex; align-items: center; gap: 6px; width: 100%; }
  .tm-row-status { flex: none; }
  .tm-row-dead { text-decoration: line-through; color: var(--ink-dim); }

  .tm-stage { position: relative; display: flex; min-width: 0; min-height: 0; overflow: hidden; }
  .tm-stage-note { position: absolute; left: var(--s3); top: var(--s2); letter-spacing: .16em;
                   pointer-events: none; }

  .tm-plan-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; }

  .tm-commit-dock { border-top: 1px solid var(--line-hot); background: var(--panel);
                    padding: var(--s3); display: flex; flex-direction: column; gap: var(--s2); }
  .tm-gate { text-align: center; letter-spacing: .12em; }
  .tm-blind-contract { display: flex; flex-direction: column; gap: 3px; text-align: center;
                       line-height: 1.7; }
  .tm-no-timer { display: inline-flex; align-items: center; justify-content: center; gap: 5px;
                 letter-spacing: .16em; color: var(--ink-dim); }
  .tm-no-timer-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ink-ghost);
                     display: inline-block; }
  .tm-blind-line { opacity: .72; letter-spacing: .1em; }

  .tm-resolving { margin: var(--s3); padding: var(--s5); display: flex; flex-direction: column;
                  gap: var(--s2); align-items: center; text-align: center; }
`;

function TacticalMoveStyles() {
  return <style>{TM_STYLES}</style>;
}
