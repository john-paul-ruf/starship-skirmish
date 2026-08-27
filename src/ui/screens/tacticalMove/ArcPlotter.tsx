// M14 UI — Tactical Movement arc plotter (S05 CP2; SESSION-05 finite-thrust
// CP1 rewires the form to the ACTIVE waypoint of a segmented draft, CP2 adds
// the waypoint selector).
//
// Numeric-primary arc entry (Gate 1 §2): bearing / pitch as `<input
// type="number">`, magnitude as a slider clamped to the per-segment cap
// (`min(shipBudget, maxAccel·sliceSeconds)`, computed parent-side by the
// model's `perSegmentCap`). Every input drives the live ghost (the parent
// recomputes `controller.previewArc` and repaints the Viewport). A COAST
// toggle spends no Δv (keeps momentum).
//
// The form binds to `draft.waypoints[draft.activeIndex]` — SESSION-05 CP1
// pins `activeIndex` to 0 (single-waypoint UX, behaviorally the pre-CP1 arc),
// CP2 adds the per-waypoint selector alongside so the user picks which
// waypoint to edit.
//
// Boundary-exit third channel (§4.1): when the plotted arc leaves the arena the
// plotter renders the TEXT callout naming the ship — the render layer supplies
// the other two channels (red ghost line + ✕ EXIT sprite). All three fire
// together; none is dropped.

import { Button, Field, Meter } from '../../components/index.js';
import { length } from '../../../sim/mathx/index.js';
import type { Vec3 } from '../../../sim/index.js';
import { clampMag, type PlanDraft, type RosterShip, type WaypointDraft } from './model.js';

export interface ArcPlotterProps {
  readonly ship: RosterShip | null;
  readonly draft: PlanDraft | null;
  /** Total Δv this draft flies across every waypoint — the meter readout. */
  readonly totalSpent: number;
  /** Per-segment magnitude cap for the ACTIVE waypoint's slider (SESSION-05). */
  readonly magnitudeMax: number;
  /** Current velocity of the selected body (Newtonian carry-over), for the readout. */
  readonly velocity: Vec3 | null;
  /** True when the plotted arc ends outside the arena (§4.1). */
  readonly exiting: boolean;
  readonly onPlot: (patch: { bearing?: number; pitch?: number; magnitude?: number }) => void;
  readonly onCoast: () => void;
}

const round = (n: number): string => String(Math.round(n));

const activeWaypoint = (draft: PlanDraft): WaypointDraft | null => {
  const idx = draft.activeIndex;
  return draft.waypoints[idx] ?? draft.waypoints[0] ?? null;
};

export function ArcPlotter({
  ship,
  draft,
  totalSpent,
  magnitudeMax,
  velocity,
  exiting,
  onPlot,
  onCoast,
}: ArcPlotterProps) {
  if (ship === null || draft === null) {
    return (
      <section class="tm-plotter panel-bd" data-testid="arc-plotter">
        <div class="t-label">Plot Thrust Arc</div>
        <p class="t-prose">Select a ship from the roster to plot its thrust arc.</p>
      </section>
    );
  }

  const active = activeWaypoint(draft);
  const budget = ship.budget;
  const coasting = draft.status === 'coast';
  const speed = velocity === null ? 0 : length(velocity);
  const activeMag = active === null ? 0 : clampMag(active.magnitude, magnitudeMax);

  const parse = (raw: string): number => (raw.trim() === '' ? 0 : Number(raw));

  return (
    <section class="tm-plotter panel-bd" data-testid="arc-plotter">
      <div class="tm-plotter-hd">
        <span class="t-h2">{ship.name}</span>
        <span class="mono-xs c-dim">{ship.chassisClass.toUpperCase()}</span>
      </div>

      {!ship.engineAlive ? (
        <div class="tm-engine-dead mono-xs c-amber" data-testid="engine-dead">
          ENGINE DESTROYED — ZERO Δv · COASTS AUTOMATICALLY
        </div>
      ) : null}

      {/* ---- Δv budget ---- */}
      <div class="tm-budget">
        <div class="tm-budget-row">
          <span class="t-label">Delta-V Budget</span>
          <span class="grow" />
          <span class="mono-xs">
            SPENT <span class="c-hi">{round(totalSpent)}</span> / {round(budget)}
          </span>
        </div>
        <Meter
          value={totalSpent}
          max={budget}
          fill="dv"
          aria-label={`Delta-V spent ${round(totalSpent)} of ${round(budget)}`}
        />
        <p class="tm-hint mono-xs">
          <span class="c-amber">NO FREE STOP</span> — deceleration spends Δv like any maneuver.
          Budget cannot be exceeded.
        </p>
      </div>

      {/* ---- current velocity ---- */}
      <div class="tm-velocity">
        <div class="t-label">Current Velocity</div>
        <div class="mono-xs">
          VEL <span class="c-cyan">{round(speed)}</span> ·{' '}
          {velocity === null
            ? '—'
            : `VX ${round(velocity.x)} · VY ${round(velocity.y)} · VZ ${round(velocity.z)}`}
        </div>
      </div>

      {/* ---- arc inputs (bind to the ACTIVE waypoint) ---- */}
      <div class="tm-arc-inputs">
        <label class="tm-input">
          <span class="stat-k">Bearing °</span>
          <Field
            type="number"
            value={round(active === null ? 0 : active.bearing)}
            disabled={!ship.engineAlive}
            aria-label="Bearing in degrees, 0 to 360"
            class="tm-num"
            onInput={(e) => onPlot({ bearing: parse((e.currentTarget as HTMLInputElement).value) })}
          />
        </label>
        <label class="tm-input">
          <span class="stat-k">Pitch °</span>
          <Field
            type="number"
            value={round(active === null ? 0 : active.pitch)}
            disabled={!ship.engineAlive}
            aria-label="Pitch in degrees, -90 to 90"
            class="tm-num"
            onInput={(e) => onPlot({ pitch: parse((e.currentTarget as HTMLInputElement).value) })}
          />
        </label>
      </div>

      <div class="tm-mag">
        <div class="tm-budget-row">
          <span class="stat-k">Thrust Magnitude</span>
          <span class="grow" />
          <span class="stat-v c-amber">{round(activeMag)} Δv</span>
        </div>
        <input
          class="tm-range"
          type="range"
          min={0}
          max={magnitudeMax}
          step={1}
          value={coasting ? 0 : activeMag}
          disabled={!ship.engineAlive}
          aria-label="Thrust magnitude in delta-V"
          data-testid="arc-magnitude"
          onInput={(e) => onPlot({ magnitude: parse((e.currentTarget as HTMLInputElement).value) })}
        />
        <div class="tm-range-scale mono-xs">
          <span>0 · COAST</span>
          <span class="c-hi">{round(magnitudeMax)} · MAX</span>
        </div>
      </div>

      <Button
        size="sm"
        variant={coasting ? 'primary' : 'ghost'}
        aria-pressed={coasting}
        onClick={onCoast}
        class="tm-coast-btn"
      >
        ↔ {coasting ? 'COASTING' : 'Set to Coast'}
      </Button>

      {/* ---- boundary-exit text callout (§4.1 third channel) ---- */}
      {exiting ? (
        <div class="tm-exit-callout" role="alert" data-testid="exit-callout">
          <div class="t-label c-red" style="letter-spacing:.2em">
            ⚠ Boundary Breach Predicted
          </div>
          <div class="tm-exit-headline">PREDICTED EXIT — SHIP DESTROYED</div>
          <div class="mono-xs">
            {ship.name} · CROSSES THE KILL BOUNDARY · NOT BLOCKED — REQUIRES SECOND CONFIRM
          </div>
        </div>
      ) : null}
    </section>
  );
}
