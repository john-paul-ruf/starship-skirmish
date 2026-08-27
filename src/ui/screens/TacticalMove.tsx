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

import { useApp } from '../appContext.js';
import { useMatch } from '../matchContext.js';

import { ArcPlotter } from './tacticalMove/ArcPlotter.js';
import { CommitBar } from './tacticalMove/CommitBar.js';
import { Roster } from './tacticalMove/Roster.js';
import { Viewport, type GhostArc } from './tacticalMove/Viewport.js';
import {
  deltaVMag,
  fleetGateStatus,
  initialDraft,
  playerRoster,
  plotArc,
  setCoast,
  toDeltaV,
  toMovementPlans,
  type PlanDraft,
} from './tacticalMove/model.js';
import type { Body, BodyId, Vec3 } from '../../sim/index.js';

export function TacticalMove() {
  const match = useMatch();
  const services = useApp();
  const view = match.view.value;
  const phase = match.phase.value;
  const state = match.state.value;

  const drafts = useSignal<Map<BodyId, PlanDraft>>(new Map());
  const selected = useSignal<BodyId | null>(null);
  const planTurn = useRef<number | null>(null);

  const isPlan = phase === 'movement-plan';
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

  // ---- Derivations ---------------------------------------------------------
  const budgetById = new Map<BodyId, number>();
  for (const row of rows) if (row.alive) budgetById.set(row.bodyId, row.budget);
  const budgetOf = (id: BodyId): number => budgetById.get(id) ?? 0;

  const draftList = [...drafts.value.values()];
  const gate = fleetGateStatus(draftList);

  // Boundary-exit detection (§4.1) — the ghost cannot lie, so exit truth comes
  // straight from the sim integrator via `previewArc` for EVERY plotted arc.
  const exitIds = new Set<BodyId>();
  if (isPlan) {
    for (const d of draftList) {
      if (match.previewArc(d.bodyId, toDeltaV(d, budgetOf(d.bodyId))).endsOutsideArena) {
        exitIds.add(d.bodyId);
      }
    }
  }

  // Selected ship → its live ghost arc + velocity readout.
  const selId = selected.value;
  const selRow = selId === null ? null : (rows.find((r) => r.bodyId === selId && r.alive) ?? null);
  const selDraft = selId === null ? null : (drafts.value.get(selId) ?? null);
  const selBody: Body | null =
    view === null || selId === null ? null : (view.bodies.find((b) => b.id === selId) ?? null);
  const selVelocity: Vec3 | null = selBody === null ? null : selBody.velocity;

  let ghostArc: GhostArc | null = null;
  let ghostKey = 'none';
  if (isPlan && selRow !== null && selDraft !== null && selId !== null) {
    const preview = match.previewArc(selId, toDeltaV(selDraft, selRow.budget));
    ghostArc = {
      positions: preview.positions,
      endsOutsideArena: preview.endsOutsideArena,
      deltaVMag: deltaVMag(selDraft, selRow.budget),
      beatSeconds: state.physics.dt,
      hullRadius: selBody === null ? selRow.budget : selBody.radius,
    };
    ghostKey = `${String(selId)}:${selDraft.status}:${Math.round(selDraft.bearing)}:${Math.round(
      selDraft.pitch,
    )}:${Math.round(selDraft.magnitude)}:${String(view === null ? 0 : view.turn)}`;
  }

  const doomedNames = rows.filter((r) => r.alive && exitIds.has(r.bodyId)).map((r) => r.name);

  // ---- Handlers ------------------------------------------------------------
  const editSelected = (fn: (d: PlanDraft) => PlanDraft): void => {
    if (selId === null) return;
    const current = drafts.value.get(selId);
    if (current === undefined) return;
    const next = new Map(drafts.value);
    next.set(selId, fn(current));
    drafts.value = next;
  };

  // COMMIT (§4.3): assemble the blind plans and resolve the player's movement
  // promise. The controller collects plans against a fresh blind view (the
  // player view carries no opponent plan), resolves the beat, and enters
  // 'movement-resolve' with the beat to animate. Every arc is budget-clamped in
  // `toMovementPlans` — over-spend cannot reach the plan (§4.4).
  const onCommit = (): void => {
    match.commitMovement(toMovementPlans(draftList, budgetOf));
  };

  return (
    <section class="tm-shell" data-testid="screen-tactical-move">
      <TacticalMoveStyles />

      <div class="tm-layout">
        {/* ---- LEFT: roster (plan) / resolving notice ---- */}
        {isPlan ? (
          <Roster
            rows={rows}
            drafts={drafts.value}
            exitIds={exitIds}
            selectedId={selId}
            onSelect={(id) => {
              selected.value = id;
            }}
          />
        ) : (
          <aside class="tm-roster panel tm-resolving-side" aria-label="Fleet roster">
            <div class="side-hd">
              <span class="t-label">Roster</span>
            </div>
            <div class="mono-xs c-dim" style="padding:var(--s3)">
              MOVEMENT RESOLVING — PLANS LOCKED
            </div>
          </aside>
        )}

        {/* ---- CENTER: the tactical viewport (persists across plan↔resolve) ---- */}
        <main class="tm-stage panel" aria-label="Tactical display · movement">
          <Viewport
            state={state}
            arenaRadius={state.arena.radius}
            ghostArc={ghostArc}
            ghostKey={ghostKey}
            movementBeat={phase === 'movement-resolve' ? match.movementBeat.value : null}
            reducedMotion={services.reducedMotion.value}
            onResolveDone={() => match.resolveAnimationDone()}
          />
        </main>

        {/* ---- RIGHT: arc plotter + commit dock ---- */}
        <aside class="tm-plan panel" aria-label="Movement plan">
          <div class="tm-plan-body">
            {isPlan ? (
              <ArcPlotter
                ship={selRow}
                draft={selDraft}
                velocity={selVelocity}
                exiting={selId !== null && exitIds.has(selId)}
                onPlot={(patch) => editSelected((d) => plotArc(d, patch))}
                onCoast={() => editSelected(setCoast)}
              />
            ) : (
              <div class="tm-plotter panel-bd">
                <div class="t-label c-cyan">RESOLVING MOVEMENT…</div>
                <p class="t-prose">
                  The committed beat is animating — plans are locked for this beat.
                </p>
              </div>
            )}
          </div>

          {isPlan ? (
            <CommitBar
              gate={gate}
              hostile={exitIds.size > 0}
              doomedNames={doomedNames}
              onCommit={onCommit}
            />
          ) : null}
        </aside>
      </div>
    </section>
  );
}

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

  .tm-stage { position: relative; display: flex; min-width: 0; min-height: 0; overflow: hidden;
              padding: 0; }
  .tm-viewport { position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; }
  .tm-canvas { display: block; width: 100%; height: 100%; }
  .tm-viewport-degraded { flex-direction: column; gap: var(--s2); padding: var(--s5);
                          align-items: flex-start; justify-content: center; }
  .tm-skip { position: absolute; right: var(--s3); top: var(--s3); z-index: 4; }

  .tm-plan-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; }

  .tm-plotter { display: flex; flex-direction: column; gap: var(--s3); }
  .tm-plotter-hd { display: flex; align-items: baseline; gap: var(--s2); }
  .tm-engine-dead { border-left: 2px solid var(--amber); padding: 4px var(--s2);
                    background: rgba(255,176,32,.07); letter-spacing: .1em; }
  .tm-budget, .tm-velocity, .tm-mag { display: flex; flex-direction: column; gap: 5px; }
  .tm-budget-row { display: flex; align-items: baseline; }
  .tm-hint { color: var(--ink-dim); line-height: 1.5; }
  .tm-arc-inputs { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s2); }
  .tm-input { display: flex; flex-direction: column; gap: 3px; }
  .tm-input .stat-k { display: block; }
  .tm-num { width: 100%; }

  .tm-range { -webkit-appearance: none; appearance: none; width: 100%; height: 20px;
              background: transparent; cursor: pointer; }
  .tm-range::-webkit-slider-runnable-track { height: 6px; background: var(--panel-in);
              border: 1px solid var(--line); border-radius: var(--r-sm); }
  .tm-range::-webkit-slider-thumb { -webkit-appearance: none; width: 10px; height: 18px;
              margin-top: -7px; background: var(--cyan); border: 0; border-radius: var(--r-sm); }
  .tm-range::-moz-range-track { height: 6px; background: var(--panel-in); border: 1px solid var(--line); }
  .tm-range::-moz-range-thumb { width: 10px; height: 18px; background: var(--cyan); border: 0;
              border-radius: var(--r-sm); }
  .tm-range:disabled { cursor: not-allowed; opacity: .5; }
  .tm-range-scale { display: flex; justify-content: space-between; }
  .tm-coast-btn { align-self: flex-start; }

  .tm-exit-callout { border: 1px solid var(--red); border-left: 3px solid var(--red);
                     border-radius: var(--r); padding: var(--s2) var(--s3);
                     background: rgba(24,3,11,.6); display: flex; flex-direction: column; gap: 3px; }
  .tm-exit-headline { font-size: 12px; font-weight: 700; letter-spacing: .06em; color: #FFD7E1; }

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
`;

function TacticalMoveStyles() {
  return <style>{TM_STYLES}</style>;
}
