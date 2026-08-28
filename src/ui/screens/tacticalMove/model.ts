// M14 UI — Tactical Movement pure plotting logic (S05, extended by S03 and by
// `finite-thrust-movement` SESSION-05).
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
// SESSION-05 (finite-thrust-movement): a `PlanDraft` is now a sequence of N
// `WaypointDraft` burns, N driven by the marks-interval (`segCountFor`: 2s → 4
// segments; Off → 1). Editing a waypoint marks the draft PLANNED; the sum
// across waypoints is the total Δv committed. `toMovementPlans` emits each
// ship's plan as `{ segments }` (D-ADDITIVE-PLAN — segments override deltaV;
// deltaV is set to ZERO for shape-consistency per S01 followUp #3). Per-segment
// magnitudes are clamped at `min(shipBudget, maxAccel · sliceSeconds)` so a
// segment can never deliver more impulse than the engine physically can in its
// slice (matches `sim/physics/thrust.ts` `thrustSchedule`).
//
// What lives here:
//   • the per-ship `PlanDraft` (waypoints + activeIndex + status) + transitions,
//   • the segmentation math (`segCountFor`, `sliceSecondsFor`, `perSegmentCap`),
//   • `waypointBurnsFor` — draft → per-waypoint `WaypointBurn[]`, the shape
//     `sim/physics.previewPath` and the resolver consume,
//   • `plannedDeltaVMag` — sum of segment magnitudes for the meter readout,
//   • `previewInputFor` — draft → `{ segments }` payload for `controller.previewArc`,
//   • `impulsiveTotalDeltaV` — sum of segment deltas as a Vec3 (the CP1 bridge
//     that keeps the existing single-Vec3 previewArc calls compiling; CP3 swaps
//     over to the segmented `previewInputFor`),
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
// `WaypointBurn` is not re-exported from `sim/index.js` (an S01 follow-up); it
// lives on the shared sim types file. `ui → sim/types` is legal (only
// `sim/physics` + `sim/rules` paths are lint-banned for `ui`), and this stays a
// TYPE-only import so no sim VALUE leaks into the ui bundle.
import type { WaypointBurn } from '../../../sim/types.js';
import { add, dirFromBearingPitch, scale } from '../../../sim/mathx/index.js';

// ---- Draft state ----------------------------------------------------------

/**
 * A ship's plan state in the fleet checklist (§4.3):
 *   • `unplanned` — no decision yet; blocks the fleet commit gate.
 *   • `planned`   — a thrust plan is plotted (any waypoint edit marks the draft
 *                   planned; magnitudes may all be 0 — a deliberate zero-thrust
 *                   plan still counts as a decision).
 *   • `coast`     — no Δv spent; the ship keeps its current momentum (Newtonian).
 *                   `waypointBurnsFor` emits an all-zero segment list regardless
 *                   of the stored waypoint magnitudes.
 */
export type PlanStatus = 'unplanned' | 'planned' | 'coast';

/**
 * One waypoint burn within a ship's plan. Bearing/pitch are the numeric-primary
 * aim inputs (Gate 1 §2); `magnitude` is Δv, raw — clamped at plan construction
 * to the per-segment cap in `waypointBurnsFor` (the redundant plotting-side half
 * of the §4.4 "no free stop" clamp; the slider's `max` is the other half).
 */
export interface WaypointDraft {
  /** Compass bearing in degrees, normalized to [0, 360). */
  readonly bearing: number;
  /** Pitch in degrees, clamped to [-90, 90]. */
  readonly pitch: number;
  /** Thrust magnitude in Δv (raw; clamped to per-segment cap in `waypointBurnsFor`). */
  readonly magnitude: number;
}

/**
 * One ship's editable movement plan — now a sequence of N per-waypoint burns
 * (SESSION-05, `finite-thrust-movement`). N tracks the marks-interval control
 * (`segCountFor`: 2s → 4 segments; Off → 1). `activeIndex` is the waypoint the
 * form is currently bound to (CP2 selector). A single-waypoint plan (Off) is
 * shape-compatible with the pre-SESSION-05 arc plotter.
 */
export interface PlanDraft {
  readonly bodyId: BodyId;
  readonly waypoints: readonly WaypointDraft[];
  /** Index into `waypoints` — the segment the plot form currently edits. */
  readonly activeIndex: number;
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

/** Clamp a thrust magnitude to `0..cap`; `NaN` → 0. Caller supplies the cap
 *  (per-segment or per-ship-budget depending on the slot). */
export const clampMag = (mag: number, cap: number): number => {
  if (Number.isNaN(mag) || mag < 0) return 0;
  const capped = cap > 0 ? cap : 0;
  return mag > capped ? capped : mag;
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

// ---- Marks-interval selector (Gate 1 prototype port) ----------------------

/** The four ghost-arc marks-interval values the shipped selector supports.
 *  Doubles as the WAYPOINT-GRANULARITY control (SESSION-05): the beat is split
 *  into segments of `interval` sim-seconds (Off → a single dt-length segment).*/
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

// ---- Segmentation math ----------------------------------------------------

/**
 * How many waypoint segments a beat splits into at the given marks interval.
 * Off → 1 (a single dt-length segment); otherwise `floor(beatSeconds / interval)`.
 * Non-positive / non-finite `beatSeconds` degrades to 1 (defensive — the
 * shipping app pins `state.physics.dt` at 8, but a caller with a bad config
 * still gets a legal single-segment plan). Result is always ≥ 1.
 */
export const segCountFor = (
  interval: MarksIntervalValue,
  beatSeconds: number,
): number => {
  if (!Number.isFinite(beatSeconds) || beatSeconds <= 0) return 1;
  if (interval === 0) return 1;
  const n = Math.floor(beatSeconds / interval);
  return n >= 1 ? n : 1;
};

/**
 * Sim-seconds per waypoint segment for the given interval + beat length.
 * Off → the whole beat; otherwise the interval itself. Symmetric with
 * `segCountFor` so `segCountFor(i, dt) * sliceSecondsFor(i, dt)` covers the
 * beat exactly at every supported interval (dt=8, i∈{0,1,2,4}).
 */
export const sliceSecondsFor = (
  interval: MarksIntervalValue,
  beatSeconds: number,
): number => {
  if (!Number.isFinite(beatSeconds) || beatSeconds <= 0) return 1;
  if (interval === 0) return beatSeconds;
  return interval;
};

/**
 * Per-segment magnitude cap. `maxAccel · sliceSeconds` is the physical burn-rate
 * limit `sim/physics.thrustSchedule` enforces at the resolver; capping here
 * mirrors it on the producer side so the plan we commit matches the flown arc.
 * A ship-budget upper bound keeps a single segment from claiming more than the
 * ship's whole Δv-per-turn. When `maxAccel` is absent / non-positive / non-finite
 * (the un-owned resolveFleet gap, SESSION-04 followUp #4) the cap collapses to
 * the ship budget — the impulsive-fallback path physics already takes when
 * `maxAccel` is unset (see `sim/physics/thrust.ts` guardrail).
 */
export const perSegmentCap = (
  shipBudget: number,
  sliceSeconds: number,
  maxAccel: number | undefined,
): number => {
  const budgetFloor = shipBudget > 0 ? shipBudget : 0;
  if (maxAccel === undefined || !Number.isFinite(maxAccel) || maxAccel <= 0) {
    return budgetFloor;
  }
  if (!Number.isFinite(sliceSeconds) || sliceSeconds <= 0) return budgetFloor;
  const physCap = maxAccel * sliceSeconds;
  return physCap < budgetFloor ? physCap : budgetFloor;
};

// ---- Draft construction + transitions -------------------------------------

/** One zeroed waypoint at the given aim. */
const zeroWaypoint = (bearing = 0, pitch = 0): WaypointDraft => ({
  bearing,
  pitch,
  magnitude: 0,
});

/**
 * The starting draft for a roster ship at a given marks interval + beat length.
 * Every living ship starts on `coast` — no Δv spent, keep current momentum —
 * so `fleetGateStatus.canCommit` is true on turn entry and the fleet can commit
 * without touching a single control (playtest-feedback-03 `D-COMMIT-DEFAULT-
 * COAST`; supersedes the pre-feedback-03 "living → `unplanned`" seed). Plotting
 * any waypoint magnitude/bearing flips the draft back to `planned` via
 * `plotWaypoint`, so an intentional arc still overrides the default. Engine-dead
 * ships were already coasting (§4.3, "a destroyed engine means zero delta-V");
 * that path is unchanged. All waypoints start zeroed at bearing 0 / pitch 0.
 */
export const initialDraft = (
  row: RosterShip,
  opts: { readonly interval: MarksIntervalValue; readonly beatSeconds: number },
): PlanDraft => {
  const n = segCountFor(opts.interval, opts.beatSeconds);
  const waypoints: WaypointDraft[] = [];
  for (let i = 0; i < n; i += 1) waypoints.push(zeroWaypoint());
  return {
    bodyId: row.bodyId,
    waypoints,
    activeIndex: 0,
    status: 'coast',
  };
};

/** Clamp a waypoint index into `[0, count - 1]`. */
const clampIndex = (i: number, count: number): number => {
  if (count <= 0) return 0;
  if (!Number.isFinite(i) || i < 0) return 0;
  const floored = Math.floor(i);
  return floored >= count ? count - 1 : floored;
};

/**
 * Edit the ACTIVE waypoint's aim — any subset of bearing/pitch/magnitude — and
 * mark the draft `planned`. Bearing wraps, pitch clamps; magnitude is stored
 * raw (the per-segment cap lives in `waypointBurnsFor`, mirroring the previous
 * plan-construction half of the §4.4 clamp). Waypoints other than the active
 * one are untouched — editing waypoint k leaves waypoints ≠ k intact.
 */
export const plotWaypoint = (
  draft: PlanDraft,
  patch: { readonly bearing?: number; readonly pitch?: number; readonly magnitude?: number },
): PlanDraft => {
  const idx = clampIndex(draft.activeIndex, draft.waypoints.length);
  const current = draft.waypoints[idx] ?? zeroWaypoint();
  const nextWp: WaypointDraft = {
    bearing: patch.bearing !== undefined ? wrapBearing(patch.bearing) : current.bearing,
    pitch: patch.pitch !== undefined ? clampPitch(patch.pitch) : current.pitch,
    magnitude:
      patch.magnitude !== undefined
        ? Number.isNaN(patch.magnitude) || patch.magnitude < 0
          ? 0
          : patch.magnitude
        : current.magnitude,
  };
  const nextWps = draft.waypoints.slice();
  nextWps[idx] = nextWp;
  return { ...draft, waypoints: nextWps, status: 'planned' };
};

/** Move the waypoint-selector cursor. Out-of-range indices clamp; status
 *  unchanged (selection is not a plot decision). */
export const setActiveIndex = (draft: PlanDraft, index: number): PlanDraft => ({
  ...draft,
  activeIndex: clampIndex(index, draft.waypoints.length),
});

/** Set a draft to COAST — no Δv spent, current momentum kept. Waypoints are
 *  preserved as-is (the coast status short-circuits `waypointBurnsFor` to all
 *  zero segments), so toggling back off COAST restores the prior aim. */
export const setCoast = (draft: PlanDraft): PlanDraft => ({ ...draft, status: 'coast' });

/**
 * Re-segment a draft to a new marks interval — the CP3 wiring for
 * "marks-interval doubles as waypoint-granularity" (prototype `rebuildSegments`).
 * Preserves the aim (bearing/pitch of waypoint 0) across every new waypoint,
 * resets magnitudes to 0, snaps `activeIndex` back to 0, and preserves the
 * plan status (a COAST draft stays COAST; a PLANNED draft stays PLANNED — the
 * user has still made a decision, just now against a different granularity).
 */
export const rebuildForInterval = (
  draft: PlanDraft,
  interval: MarksIntervalValue,
  beatSeconds: number,
): PlanDraft => {
  const n = segCountFor(interval, beatSeconds);
  const first = draft.waypoints[0] ?? zeroWaypoint();
  const bearing = first.bearing;
  const pitch = first.pitch;
  const nextWps: WaypointDraft[] = [];
  for (let i = 0; i < n; i += 1) nextWps.push(zeroWaypoint(bearing, pitch));
  return { ...draft, waypoints: nextWps, activeIndex: 0 };
};

// ---- Δv derivation --------------------------------------------------------

/** The Δv contribution of one waypoint at the given per-segment cap. */
const waypointBurn = (wp: WaypointDraft, cap: number): WaypointBurn => {
  const mag = clampMag(wp.magnitude, cap);
  if (mag === 0) return { deltaV: ZERO_V };
  return { deltaV: scale(dirFromBearingPitch(wp.bearing, wp.pitch), mag) };
};

/**
 * The per-waypoint burn list a draft commits. COAST → every burn is the zero
 * vector regardless of stored magnitudes ("no free stop"). Each burn's Δv is
 * `dirFromBearingPitch(bearing, pitch) · clampMag(magnitude, perSegCap)` — the
 * D-PHYSICS-VEC3-ONLY producer-side conversion so `sim/physics` never sees an
 * angle.
 */
export const waypointBurnsFor = (
  draft: PlanDraft,
  budget: number,
  opts: { readonly sliceSeconds: number; readonly maxAccel?: number },
): readonly WaypointBurn[] => {
  const cap = perSegmentCap(budget, opts.sliceSeconds, opts.maxAccel);
  if (draft.status === 'coast') return draft.waypoints.map(() => ({ deltaV: ZERO_V }));
  return draft.waypoints.map((wp) => waypointBurn(wp, cap));
};

/**
 * Total Δv this draft flies across all waypoints — the meter readout. COAST → 0.
 * Each waypoint contributes its clamped magnitude (the Δv vectors are along
 * different bearings, so we sum magnitudes rather than the vector length —
 * matches "SPENT X / BUDGET" semantics as fuel spent, not net displacement).
 */
export const plannedDeltaVMag = (
  draft: PlanDraft,
  budget: number,
  opts: { readonly sliceSeconds: number; readonly maxAccel?: number },
): number => {
  if (draft.status === 'coast') return 0;
  const cap = perSegmentCap(budget, opts.sliceSeconds, opts.maxAccel);
  let total = 0;
  for (const wp of draft.waypoints) total += clampMag(wp.magnitude, cap);
  return total;
};

/**
 * The `{ segments }` payload `controller.previewArc` consumes for a segmented
 * finite-thrust preview (SESSION-04 D-ADDITIVE-PLAN). Callers pass this
 * verbatim to `previewArc(bodyId, previewInputFor(draft, budget, opts))` — the
 * returned `positions` curves while thrusting when `state.physics.maxAccel` is
 * set (see the SESSION-04 handoff followUp on the un-owned `resolveFleet` gap).
 */
export const previewInputFor = (
  draft: PlanDraft,
  budget: number,
  opts: { readonly sliceSeconds: number; readonly maxAccel?: number },
): { readonly segments: readonly WaypointBurn[] } => ({
  segments: waypointBurnsFor(draft, budget, opts),
});

/**
 * Sum-of-segment-deltas as a Vec3 — the CP1 bridge that keeps the pre-CP3
 * `previewArc(bodyId, Vec3)` impulsive-fallback path compiling while the model
 * carries multi-waypoint state. CP3 swaps the ghost + exit-detection callers
 * over to `previewInputFor`; this helper stays available for any consumer that
 * still needs an impulsive net displacement (e.g. a HUD readout).
 */
export const impulsiveTotalDeltaV = (
  draft: PlanDraft,
  budget: number,
  opts: { readonly sliceSeconds: number; readonly maxAccel?: number },
): Vec3 => {
  if (draft.status === 'coast') return ZERO_V;
  const cap = perSegmentCap(budget, opts.sliceSeconds, opts.maxAccel);
  let acc: Vec3 = ZERO_V;
  for (const wp of draft.waypoints) {
    const mag = clampMag(wp.magnitude, cap);
    if (mag === 0) continue;
    acc = add(acc, scale(dirFromBearingPitch(wp.bearing, wp.pitch), mag));
  }
  return acc;
};

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
 * Drafts → the segmented `MovementPlan[]` the controller commits (SESSION-05).
 * Every plan carries `segments` (D-ADDITIVE-PLAN — segments override deltaV);
 * `deltaV` is set to `ZERO` for shape-consistency per SESSION-01 followUp #3.
 * `budgetOf` supplies each ship's per-turn Δv budget (0 when engine-dead);
 * `opts` supplies the sim-time slice length (from the current marks interval)
 * + `maxAccel` (from `state.physics.maxAccel`, may be undefined until the
 * SESSION-04 un-owned `resolveFleet` gap closes — the fallback is documented on
 * `perSegmentCap`).
 */
export const toMovementPlans = (
  drafts: readonly PlanDraft[],
  budgetOf: (bodyId: BodyId) => number,
  opts: { readonly sliceSeconds: number; readonly maxAccel?: number },
): MovementPlan[] =>
  drafts.map((d) => ({
    bodyId: d.bodyId,
    deltaV: ZERO_V,
    segments: waypointBurnsFor(d, budgetOf(d.bodyId), opts),
  }));

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
  /** SESSION-05: waypoint-boundary world positions from `sim/physics.previewPath`
   *  (segmented). Optional passthrough — the render layer's numbered marks will
   *  land on the TRUE curved arc at each segment boundary once the render layer
   *  reads it. Absent for the impulsive branch (S04 seam contract). */
  readonly markPositions?: readonly Vec3[];
}

/**
 * Assemble a ghost arc from a preview + a plan draft. Pure; the caller pins the
 * `beatSeconds` (= `physicsConfig.dt`), `hullRadius` (the ship's collider
 * radius), `markIntervalSec` (the Off/1s/2s/4s selector), and the meter Δv
 * (SESSION-05: total Δv across all waypoints, `plannedDeltaVMag`). The marks
 * interval is threaded through verbatim; `markPositions` (segmented preview
 * only) is passed straight to the ghost input when present.
 */
export const buildGhostArc = (
  preview: {
    readonly positions: readonly Vec3[];
    readonly endsOutsideArena: boolean;
    readonly markPositions?: readonly Vec3[];
  },
  deltaVMagnitude: number,
  opts: {
    readonly beatSeconds: number;
    readonly hullRadius: number;
    readonly markIntervalSec: MarksIntervalValue;
  },
): GhostArcInputs => ({
  positions: preview.positions,
  endsOutsideArena: preview.endsOutsideArena,
  deltaVMag: deltaVMagnitude,
  beatSeconds: opts.beatSeconds,
  hullRadius: opts.hullRadius,
  markIntervalSec: opts.markIntervalSec,
  ...(preview.markPositions !== undefined ? { markPositions: preview.markPositions } : {}),
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
