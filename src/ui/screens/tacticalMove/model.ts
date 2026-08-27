// M14 UI — Tactical Movement pure plotting logic (S05, extended by S03).
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
//   • `playerRosterRows` — the player fleet's LIVING ships as plottable rows;
//     destroyed player ships never appear in `view.ships` (the sim culls them),
//     so the previous initial-fleet flatten is no longer needed (the shared
//     FleetRoster owns the visual, S02),
//   • `planBadgeFor` — the plan-status annotate slot for the shared FleetRoster.
//     Living player ships get PLANNED / COAST / UNPLANNED (or ✕ EXIT ARC when
//     the plotted arc leaves the arena); bot ships and dead ships get nothing.

import type {
  BlindMatchView,
  BodyId,
  ChassisClass,
  MovementPlan,
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

/**
 * The player fleet's LIVING ships as plottable rows. `view.ships` is the sole
 * source — the sim culls destroyed ships from the view (the shared FleetRoster
 * shows survivors only, structural), so no `initialFleets` walk is needed here.
 * Engine-dead ships carry `budget: 0` (§4.3 — coasts automatically).
 */
export const playerRosterRows = (
  view: BlindMatchView,
  playerFleetId: number,
): RosterShip[] => {
  const rows: RosterShip[] = [];
  for (const s of view.ships) {
    if (s.fleetId !== playerFleetId) continue;
    rows.push({
      bodyId: s.bodyId,
      name: s.name,
      chassisClass: s.chassisClass,
      budget: s.engineAlive ? s.ship.deltaVPerTurn : 0,
      engineAlive: s.engineAlive,
      alive: true,
    });
  }
  return rows;
};

// ---- Marks-interval selector (Gate 1 prototype port) ----------------------

/** The four ghost-arc marks-interval values the shipped selector supports. */
export type MarksIntervalValue = 0 | 1 | 2 | 4;

/** Stable option list — order matches the prototype (Off → 1s → 2s → 4s). */
export interface MarksIntervalOption {
  readonly value: MarksIntervalValue;
  readonly label: string;
  readonly srLabel: string;
}

export const MARKS_INTERVAL_OPTIONS: readonly MarksIntervalOption[] = [
  { value: 0, label: 'OFF', srLabel: 'Marks off' },
  { value: 1, label: '1s', srLabel: 'Marks every second' },
  { value: 2, label: '2s', srLabel: 'Marks every two seconds' },
  { value: 4, label: '4s', srLabel: 'Marks every four seconds' },
];

/** Snap an arbitrary numeric input to the nearest supported interval value.
 *  Non-finite / negative → 1s (the default). Guards against a stray future
 *  caller (settings deserializer, hash-state restore) that hands a bad value. */
export const normalizeMarksInterval = (raw: number): MarksIntervalValue => {
  if (!Number.isFinite(raw) || raw < 0) return 1;
  if (raw === 0) return 0;
  if (raw <= 1) return 1;
  if (raw <= 2) return 2;
  return 4;
};

// ---- Ghost arc construction (pure) ----------------------------------------

/** The shape the render layer's ghost draws — mirrors `Viewport.GhostArc` but
 *  lives here in `.ts` so the assembly is pure-testable in vitest's node env.
 *  Kept structural so a widened `GhostArc` in the sibling `.tsx` is compatible
 *  as long as the same fields are present. */
export interface GhostArcInputs {
  readonly positions: readonly Vec3[];
  readonly endsOutsideArena: boolean;
  readonly deltaVMag: number;
  readonly beatSeconds: number;
  readonly hullRadius: number;
  readonly markIntervalSec?: number;
}

/**
 * Assemble a ghost arc from a preview + a plan draft. Pure; the caller pins the
 * `beatSeconds` (= `physicsConfig.dt`), `hullRadius` (the ship's collider
 * radius), and `markIntervalSec` (the Off/1s/2s/4s selector). The marks
 * interval is threaded through verbatim — the render layer honors 0 (Off) as
 * "arc line only, no numbered marks" (S01 `GhostDrawInput.markIntervalSec`).
 */
export const buildGhostArc = (
  preview: { readonly positions: readonly Vec3[]; readonly endsOutsideArena: boolean },
  draft: PlanDraft,
  budget: number,
  opts: {
    readonly beatSeconds: number;
    readonly hullRadius: number;
    readonly markIntervalSec: MarksIntervalValue;
  },
): GhostArcInputs => ({
  positions: preview.positions,
  endsOutsideArena: preview.endsOutsideArena,
  deltaVMag: deltaVMag(draft, budget),
  beatSeconds: opts.beatSeconds,
  hullRadius: opts.hullRadius,
  markIntervalSec: opts.markIntervalSec,
});

// ---- Plan-status badge (annotate for FleetRoster) -------------------------

/** One roster row's plan-status badge — text + token class, never color alone. */
export interface PlanBadge {
  readonly text: string;
  readonly cls: string;
}

/** The minimum entry shape `planBadgeFor` reads — matches the S02 `RosterEntry`
 *  without pulling the entire type through (`ui` avoids depending on siblings
 *  from a `.ts` model that vitest's node env exercises). */
export interface PlanBadgeEntry {
  readonly bodyId: BodyId;
  readonly fleetId: number;
  readonly alive: boolean;
}

export interface PlanBadgeInputs {
  readonly drafts: ReadonlyMap<BodyId, PlanDraft>;
  readonly exitIds: ReadonlySet<BodyId>;
  readonly playerFleetId: number;
}

/**
 * The FleetRoster `annotate(entry)` slot for the movement screen (SESSION-03).
 * Living PLAYER ships → PLANNED ✓ / COAST ✓ / ● UNPLANNED (or ✕ EXIT ARC when
 * the plotted arc leaves the arena, §4.1). Bot ships and dead ships → `null`
 * (the roster row gets no badge). Text-first, tokenized color class second —
 * a colorblind player still reads the state (design §1.1).
 */
export const planBadgeFor = (
  entry: PlanBadgeEntry,
  inputs: PlanBadgeInputs,
): PlanBadge | null => {
  if (!entry.alive) return null;
  if (entry.fleetId !== inputs.playerFleetId) return null;
  if (inputs.exitIds.has(entry.bodyId)) return { text: '✕ EXIT ARC', cls: 'c-red' };
  const status = inputs.drafts.get(entry.bodyId)?.status ?? 'unplanned';
  if (status === 'planned') return { text: 'PLANNED ✓', cls: 'c-green' };
  if (status === 'coast') return { text: 'COAST ✓', cls: 'c-cyan' };
  return { text: '● UNPLANNED', cls: 'c-amber' };
};
