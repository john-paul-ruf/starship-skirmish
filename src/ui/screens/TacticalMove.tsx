// M14 UI — Tactical Movement screen (S05 body; SESSION-03 rewires to the
// shared all-fleets roster + ship inspector — camera focus, marks-interval,
// and the flown trail land in later checkpoints).
//
// The blind arc-plotting screen — the tension engine (design §4.1–§4.3). For
// each living player ship the player plots a thrust arc (numeric bearing / pitch
// / magnitude, Δv clamped to budget) against a live ghost that CANNOT lie (it
// draws `sim/physics.previewPath` through `controller.previewArc`, D-PREVIEW-
// SEAM — `ui` never value-imports `sim/physics`); commits per-ship as PLANNED
// or COAST; the fleet commit gate (§4.3) blocks until every living player ship
// is decided; COMMIT resolves the player's movement promise → the controller
// resolves + hands back the beat to animate → attack. Opponent plans are NOT
// observable — the blind view has no plans field (structural, FR-17).
//
// SESSION-03 CP1:
//   • Roster is the shared FleetRoster (S02) fed by `groupByFleet(view.ships,
//     playerFleetId)` — ALL fleets, no fog (FR-15). Selecting a bot ship shows
//     the inspector; NO plan form and NO opponent plan surface (FR-17 stays
//     intact — the plotter renders only when the selection is a living player
//     ship, else a read-only "opponent ship — view only" note).
//   • Ship inspector (S02) sits above the plotter in the right column.
//   • The plan-status badge is now the FleetRoster `annotate` slot fed by the
//     model's `planBadgeFor` — LIVING PLAYER rows only, exactly the previous
//     PLANNED ✓ / COAST ✓ / ● UNPLANNED (or ✕ EXIT ARC) vocabulary.
//
// D-PLACEHOLDER: the `TacticalMove` export name + `data-testid="screen-tactical-
// move"` root are contracted — the screens barrel + `App.tsx` outlet import
// them and MUST NOT be re-edited. CONCEDE lives in the S01 shell match-chrome;
// this screen never renders one.

import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';

import { useApp } from '../appContext.js';
import { useMatch } from '../matchContext.js';
import { FleetRoster, ShipInspector, groupByFleet } from '../components/roster/index.js';

import { ArcPlotter } from './tacticalMove/ArcPlotter.js';
import { CameraHud } from './tacticalMove/CameraHud.js';
import { CommitBar } from './tacticalMove/CommitBar.js';
import { Viewport, type GhostArc, type ViewportHandle } from './tacticalMove/Viewport.js';
import {
  deltaVMag,
  fleetGateStatus,
  initialDraft,
  planBadgeFor,
  playerRosterRows,
  plotArc,
  setCoast,
  toDeltaV,
  toMovementPlans,
  type PlanDraft,
  type RosterShip,
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
  const viewportRef = useRef<ViewportHandle | null>(null);

  const isPlan = phase === 'movement-plan';
  const playerRows: RosterShip[] = view === null ? [] : playerRosterRows(view, match.playerFleetId);

  // (Re)initialize the drafts + selection whenever a new plan turn begins.
  // Engine-dead ships start on COAST (initialDraft); every other living ship
  // starts UNPLANNED and must be decided before the gate opens. Selection
  // defaults to the first living player ship so the plotter has a target on
  // entry (roster clicks can then move selection to any fleet).
  useEffect(() => {
    if (view === null) return;
    if (planTurn.current === view.turn) return;
    planTurn.current = view.turn;
    const next = new Map<BodyId, PlanDraft>();
    let first: BodyId | null = null;
    for (const row of playerRows) {
      next.set(row.bodyId, initialDraft(row));
      if (first === null) first = row.bodyId;
    }
    drafts.value = next;
    selected.value = first;
  }, [view === null ? -1 : view.turn]);

  // ---- Derivations ---------------------------------------------------------
  const budgetById = new Map<BodyId, number>();
  for (const row of playerRows) budgetById.set(row.bodyId, row.budget);
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

  // Selected ship — may be ANY fleet (FR-15). The plotter shows only when the
  // selection is a living player ship; a bot ship shows the inspector only and
  // reads a "view only" note in the plot column (FR-17 stays intact: no plan
  // form for opponents).
  const selId = selected.value;
  const selPlayerRow = selId === null ? null : (playerRows.find((r) => r.bodyId === selId) ?? null);
  const selDraft = selId === null ? null : (drafts.value.get(selId) ?? null);
  const selBody: Body | null =
    view === null || selId === null ? null : (view.bodies.find((b) => b.id === selId) ?? null);
  const selVelocity: Vec3 | null = selBody === null ? null : selBody.velocity;
  const selShipView = view === null || selId === null
    ? null
    : (view.ships.find((s) => s.bodyId === selId) ?? null);

  let ghostArc: GhostArc | null = null;
  let ghostKey = 'none';
  if (isPlan && selPlayerRow !== null && selDraft !== null && selId !== null) {
    const preview = match.previewArc(selId, toDeltaV(selDraft, selPlayerRow.budget));
    ghostArc = {
      positions: preview.positions,
      endsOutsideArena: preview.endsOutsideArena,
      deltaVMag: deltaVMag(selDraft, selPlayerRow.budget),
      beatSeconds: state.physics.dt,
      hullRadius: selBody === null ? selPlayerRow.budget : selBody.radius,
    };
    ghostKey = `${String(selId)}:${selDraft.status}:${Math.round(selDraft.bearing)}:${Math.round(
      selDraft.pitch,
    )}:${Math.round(selDraft.magnitude)}:${String(view === null ? 0 : view.turn)}`;
  }

  const doomedNames = playerRows.filter((r) => exitIds.has(r.bodyId)).map((r) => r.name);

  // Shared all-fleets roster groups (FR-15) — no fog, player fleet first.
  const groups = view === null ? [] : groupByFleet(view.ships, match.playerFleetId);

  // Live position lookup for the render camera's focus source (S01 seams). Reads
  // from `state.bodies` so `F` tracks the currently-selected ship without a
  // `three` value import — `focusSourceFor` accepts a `Vec3`-like.
  const positionOf = (id: BodyId): Vec3 | null => {
    const body = state.bodies.get(id);
    return body === undefined ? null : body.position;
  };

  // ---- Handlers ------------------------------------------------------------
  const selectShip = (id: BodyId): void => {
    selected.value = id;
    // Slide the orbit camera onto the newly-selected ship (roster click ↔ pick).
    viewportRef.current?.focusSelected();
  };

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
        {/* ---- LEFT: shared all-fleets roster (plan) / resolving notice ---- */}
        {isPlan ? (
          <FleetRoster
            groups={groups}
            selectedId={selId}
            onSelect={selectShip}
            annotate={(entry) => {
              const badge = planBadgeFor(entry, {
                drafts: drafts.value,
                exitIds,
                playerFleetId: match.playerFleetId,
              });
              if (badge === null) return null;
              return (
                <span
                  class={`mono-xs ${badge.cls}`}
                  data-testid="plan-badge"
                  data-plan-status={badge.text}
                  style="letter-spacing:.14em"
                >
                  {badge.text}
                </span>
              );
            }}
            aria-label="Fleet roster · movement"
          />
        ) : (
          <aside class="tm-roster panel tm-resolving-side" aria-label="Fleet roster">
            <div class="tm-side-hd">
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
            selectedId={selId}
            positionOf={positionOf}
            onPick={selectShip}
            handleRef={viewportRef}
            onResolveDone={() => match.resolveAnimationDone()}
          />
          <CameraHud
            canFocus={selId !== null}
            onReset={() => viewportRef.current?.resetView()}
            onFocus={() => viewportRef.current?.focusSelected()}
          />
        </main>

        {/* ---- RIGHT: ship inspector + arc plotter + commit dock ---- */}
        <aside class="tm-plan panel" aria-label="Movement plan">
          <div class="tm-plan-body">
            <ShipInspector ship={selShipView} velocity={selVelocity} />

            {isPlan ? (
              selPlayerRow !== null && selDraft !== null ? (
                <ArcPlotter
                  ship={selPlayerRow}
                  draft={selDraft}
                  velocity={selVelocity}
                  exiting={selId !== null && exitIds.has(selId)}
                  onPlot={(patch) => editSelected((d) => plotArc(d, patch))}
                  onCoast={() => editSelected(setCoast)}
                />
              ) : (
                <section class="tm-plotter panel-bd" data-testid="arc-plotter-readonly">
                  <div class="t-label">Opponent Ship</div>
                  <p class="t-prose">
                    View only — opponent plans are not observable until resolution (§4.2).
                  </p>
                </section>
              )
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

  .tm-layout { display: grid; grid-template-columns: 300px minmax(0, 1fr) 360px;
               gap: var(--s3); padding: var(--s3); flex: 1 1 auto; min-height: 0; align-items: stretch; }

  .tm-roster, .tm-plan { display: flex; flex-direction: column; min-height: 0; }
  .tm-side-hd { display: flex; align-items: center; gap: var(--s2); padding: var(--s2) var(--s3);
                border-bottom: 1px solid var(--line);
                background: linear-gradient(180deg, rgba(34,227,255,.05), transparent); }
  .tm-resolving-side { padding: 0; }

  .tm-stage { position: relative; display: flex; min-width: 0; min-height: 0; overflow: hidden;
              padding: 0; }
  .tm-viewport { position: relative; flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; }
  .tm-canvas { display: block; width: 100%; height: 100%; }
  .tm-viewport-degraded { flex-direction: column; gap: var(--s2); padding: var(--s5);
                          align-items: flex-start; justify-content: center; }
  .tm-skip { position: absolute; right: var(--s3); top: var(--s3); z-index: 4; }
  .tm-cam-hud { position: absolute; left: var(--s3); bottom: var(--s3); z-index: 4;
                display: flex; flex-direction: column; gap: 4px;
                background: rgba(9,15,25,.72); border: 1px solid var(--line);
                border-radius: var(--r-sm); padding: 6px var(--s2); pointer-events: auto; }
  .tm-cam-hud-buttons { display: inline-flex; gap: 4px; flex-wrap: wrap; }
  .tm-cam-hud-hint { letter-spacing: .1em; }

  .tm-plan-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden;
                  display: flex; flex-direction: column; gap: var(--s3); padding: var(--s3); }

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
