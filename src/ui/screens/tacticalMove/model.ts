// M14 UI — Tactical Movement pure plotting logic (S05, node-testable).
//
// The blind arc-plotting math, reduced to plain data the sibling `.tsx` panels
// render and the controller seams consume. Deliberately `.ts` (no JSX): the
// unit build (tsconfig.node) traverses transitive imports, so a screen `.tsx`
// pulled in here would break unit typecheck. `sim` TYPES arrive via the barrel
// (`ui` is allowed sim types); the two VALUE imports are `sim/mathx` only
// (`dirFromBearingPitch` / `scale` / `length`) — legal for `ui`, unlike
// `sim/physics` (the preview integrator crosses through `controller.previewArc`,
// D-PREVIEW-SEAM, never a direct import).
//
// What lives here:
//   • the per-ship `PlanDraft` + its status transitions (plot / coast),
//   • `toDeltaV` — bearing/pitch/magnitude → a Δv vector, clamped to budget at
//     plan construction (the redundant half of the §4.4 "no free stop" clamp;
//     the slider `max` is the other half),
//   • `fleetGateStatus` — the §4.3 commit gate truth (N/M planned-or-coast),
//   • `toMovementPlans` — drafts → the `MovementPlan[]` the controller commits,
//   • `playerRoster` — the player fleet's living + destroyed ships, derived from
//     the blind view + the immutable initial rosters (dead ships struck through,
//     auto-excluded from the gate).

import type {
  BlindMatchView,
  BodyId,
  ChassisClass,
  MovementPlan,
  SimFleet,
  Vec3,
} from '../../../sim/index.js';
import { dirFromBearingPitch, length, scale } from '../../../sim/mathx/index.js';

// ---- Draft state ----------------------------------------------------------

/**
 * A ship's plan state in the fleet checklist (§4.3):
 *   • `unplanned` — no decision yet; blocks the fleet commit gate.
 *   • `planned`   — a thrust arc is plotted (magnitude may be 0 — a deliberate
 *                   zero-thrust plan still counts as a decision).
 *   • `coast`     — no Δv spent; the ship keeps its current momentum (Newtonian).
 */
export type PlanStatus = 'unplanned' | 'planned' | 'coast';

/** One ship's editable movement plan. `bearing`/`pitch`/`magnitude` are the
 *  numeric-primary inputs (Gate 1 §2); `magnitude` is Δv, clamped to the ship's
 *  budget at both the slider and at plan construction. */
export interface PlanDraft {
  readonly bodyId: BodyId;
  /** Compass bearing in degrees, normalized to [0, 360). */
  readonly bearing: number;
  /** Pitch in degrees, clamped to [-90, 90]. */
  readonly pitch: number;
  /** Thrust magnitude in Δv (raw; clamped to budget in `toDeltaV`). */
  readonly magnitude: number;
  readonly status: PlanStatus;
}

/** One row of the player's plotting roster. Living rows are plottable; a
 *  destroyed ship (`alive:false`) renders struck-through and is excluded from
 *  the gate. An engine-dead ship has zero budget and coasts automatically. */
export interface RosterShip {
  readonly bodyId: BodyId;
  readonly name: string;
  readonly chassisClass: ChassisClass;
  /** Δv budget this turn: `deltaVPerTurn`, or 0 when the engine is dead. */
  readonly budget: number;
  readonly engineAlive: boolean;
  readonly alive: boolean;
}

// ---- Numeric sanitation ---------------------------------------------------

const ZERO_V: Vec3 = { x: 0, y: 0, z: 0 };

/** Clamp a thrust magnitude to `0..budget`; `NaN` → 0 (over/under-spend is
 *  structurally impossible from here, matching the §4.4 slider clamp). */
export const clampMag = (mag: number, budget: number): number => {
  if (Number.isNaN(mag) || mag < 0) return 0;
  const cap = budget > 0 ? budget : 0;
  return mag > cap ? cap : mag;
};

/** Normalize a bearing to [0, 360); `NaN` → 0. */
export const wrapBearing = (deg: number): number => {
  if (Number.isNaN(deg)) return 0;
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
};

/** Clamp a pitch to [-90, 90]; `NaN` → 0. */
export const clampPitch = (deg: number): number => {
  if (Number.isNaN(deg)) return 0;
  return deg > 90 ? 90 : deg < -90 ? -90 : deg;
};

// ---- Draft construction + transitions -------------------------------------

/** The starting draft for a roster ship: an engine-dead ship coasts
 *  automatically (§4.3, "a destroyed engine means zero delta-V"); every other
 *  living ship starts `unplanned` and must be decided before commit. */
export const initialDraft = (row: RosterShip): PlanDraft => ({
  bodyId: row.bodyId,
  bearing: 0,
  pitch: 0,
  magnitude: 0,
  status: row.engineAlive ? 'unplanned' : 'coast',
});

/** Edit a draft's arc — any subset of bearing/pitch/magnitude — and mark it
 *  `planned`. Bearing wraps, pitch clamps; magnitude is stored raw (the budget
 *  clamp lives in `toDeltaV`, the plan-construction half of the §4.4 clamp). */
export const plotArc = (
  draft: PlanDraft,
  patch: { readonly bearing?: number; readonly pitch?: number; readonly magnitude?: number },
): PlanDraft => ({
  ...draft,
  bearing: patch.bearing !== undefined ? wrapBearing(patch.bearing) : draft.bearing,
  pitch: patch.pitch !== undefined ? clampPitch(patch.pitch) : draft.pitch,
  magnitude:
    patch.magnitude !== undefined
      ? Number.isNaN(patch.magnitude) || patch.magnitude < 0
        ? 0
        : patch.magnitude
      : draft.magnitude,
  status: 'planned',
});

/** Set a draft to COAST — no Δv spent, current momentum kept. */
export const setCoast = (draft: PlanDraft): PlanDraft => ({ ...draft, status: 'coast' });

// ---- Δv derivation --------------------------------------------------------

/**
 * The Δv vector a draft commits: `dirFromBearingPitch` (unit) scaled by the
 * budget-clamped magnitude. COAST → the zero vector ("no free stop": a coast
 * spends nothing and simply keeps momentum). The clamp here is redundant with
 * the slider `max` on purpose — over-spend cannot reach the `MovementPlan`.
 */
export const toDeltaV = (draft: PlanDraft, budget: number): Vec3 => {
  if (draft.status === 'coast') return ZERO_V;
  const mag = clampMag(draft.magnitude, budget);
  if (mag === 0) return ZERO_V;
  return scale(dirFromBearingPitch(draft.bearing, draft.pitch), mag);
};

/** The magnitude of a draft's committed Δv — what the ghost's arc marks read
 *  (Gate 1 §2a). COAST or zero-thrust → 0. */
export const deltaVMag = (draft: PlanDraft, budget: number): number =>
  length(toDeltaV(draft, budget));

// ---- Fleet commit gate (§4.3) ---------------------------------------------

/** The §4.3 gate truth: how many living player ships are decided, and whether
 *  the fleet may commit. A disabled commit button reads `plannedCount/total`
 *  so it explains itself. */
export interface FleetGate {
  /** Ships that are `planned` OR `coast`. */
  readonly plannedCount: number;
  readonly total: number;
  /** True only when every living ship is decided (and there is ≥1 to commit). */
  readonly canCommit: boolean;
}

export const fleetGateStatus = (drafts: readonly PlanDraft[]): FleetGate => {
  const total = drafts.length;
  let plannedCount = 0;
  for (const d of drafts) {
    if (d.status !== 'unplanned') plannedCount += 1;
  }
  return { plannedCount, total, canCommit: total > 0 && plannedCount === total };
};

// ---- Plan assembly --------------------------------------------------------

/**
 * Drafts → the `MovementPlan[]` the controller commits. `budgetOf` supplies
 * each ship's Δv budget (per-ship `deltaVPerTurn`, 0 when engine-dead) so the
 * plan-construction clamp is applied — over-spend is impossible in the emitted
 * plan regardless of draft state.
 */
export const toMovementPlans = (
  drafts: readonly PlanDraft[],
  budgetOf: (bodyId: BodyId) => number,
): MovementPlan[] =>
  drafts.map((d) => ({ bodyId: d.bodyId, deltaV: toDeltaV(d, budgetOf(d.bodyId)) }));

// ---- Roster derivation ----------------------------------------------------

interface FlatShip {
  readonly bodyId: BodyId;
  readonly name: string;
  readonly chassisClass: ChassisClass;
  readonly deltaVPerTurn: number;
  readonly fleetId: number;
}

/**
 * Flatten the immutable initial rosters, assigning each ship its BodyId the
 * same way the sim does (`createMatch.buildInitialState`: ids `1..N` in
 * `(fleet-array-order, shipIndex)` order). This is the sole source of a
 * destroyed ship's identity — `view.ships` holds only survivors.
 */
const flattenInitialRoster = (initialFleets: readonly SimFleet[]): FlatShip[] => {
  const out: FlatShip[] = [];
  let nextId = 1;
  for (const fleet of initialFleets) {
    for (const ship of fleet.ships) {
      out.push({
        bodyId: nextId,
        name: ship.name,
        chassisClass: ship.chassisClass,
        deltaVPerTurn: ship.deltaVPerTurn,
        fleetId: fleet.fleetId,
      });
      nextId += 1;
    }
  }
  return out;
};

/**
 * The player fleet's roster for the plotting panel: every ship the player
 * STARTED with, each flagged alive/dead. Living ships take their engine state
 * (and thus budget) from the blind view; destroyed ships come through as
 * `alive:false` with zero budget — struck through in the UI, excluded from the
 * gate by never receiving a draft.
 */
export const playerRoster = (
  initialFleets: readonly SimFleet[],
  view: BlindMatchView,
  playerFleetId: number,
): RosterShip[] => {
  const living = new Map(
    view.ships.filter((s) => s.fleetId === playerFleetId).map((s) => [s.bodyId, s] as const),
  );
  const rows: RosterShip[] = [];
  for (const flat of flattenInitialRoster(initialFleets)) {
    if (flat.fleetId !== playerFleetId) continue;
    const alive = living.get(flat.bodyId);
    if (alive !== undefined) {
      rows.push({
        bodyId: flat.bodyId,
        name: alive.name,
        chassisClass: alive.chassisClass,
        budget: alive.engineAlive ? alive.ship.deltaVPerTurn : 0,
        engineAlive: alive.engineAlive,
        alive: true,
      });
    } else {
      rows.push({
        bodyId: flat.bodyId,
        name: flat.name,
        chassisClass: flat.chassisClass,
        budget: 0,
        engineAlive: false,
        alive: false,
      });
    }
  }
  return rows;
};
