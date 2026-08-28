// M14 UI — Tactical Movement model (S05 + S03 + `finite-thrust-movement`
// SESSION-05). Node-only (no JSX, no DOM):
//   • segmentation math (segCountFor / sliceSecondsFor / perSegmentCap),
//   • per-waypoint Δv derivation (dir·mag → burn, per-segment cap, coast → zero),
//   • the fleet-gate truth table,
//   • `toMovementPlans` segmented shape (each ship's plan carries `segments`
//     summing — within cap — to the plotted Δv),
//   • `previewInputFor` — the `{segments}` payload handed to `previewArc`,
//   • `rebuildForInterval` — re-segment on interval change, preserving aim,
//     resetting magnitudes to 0,
//   • `plotWaypoint` — edits the ACTIVE waypoint only; waypoints ≠ k intact,
//   • `playerRosterRows` (living player ships only — the sim culls destroyed
//     ones from `view.ships`), and
//   • the SESSION-03 `planBadgeFor` annotate deriver (LIVING PLAYER rows only).

import { describe, expect, it } from 'vitest';

import {
  MARKS_INTERVAL_OPTIONS,
  buildGhostArc,
  clampMag,
  clampPitch,
  fleetGateStatus,
  impulsiveTotalDeltaV,
  initialDraft,
  normalizeMarksInterval,
  perSegmentCap,
  planBadgeFor,
  plannedDeltaVMag,
  playerRosterRows,
  plotWaypoint,
  previewInputFor,
  rebuildForInterval,
  segCountFor,
  setActiveIndex,
  setCoast,
  sliceSecondsFor,
  toMovementPlans,
  waypointBurnsFor,
  wrapBearing,
  type MarksIntervalValue,
  type PlanDraft,
  type RosterShip,
  type WaypointDraft,
} from '../../../../src/ui/screens/tacticalMove/model.js';
import type {
  BlindMatchView,
  BlindShipView,
  BodyId,
  SimShip,
} from '../../../../src/sim/index.js';

// ---- Fixtures -------------------------------------------------------------

const ship = (name: string, over: Partial<SimShip> = {}): SimShip => ({
  buildId: `b-${name}`,
  name,
  chassisClass: 'fighter',
  mass: 100,
  radius: 4,
  maxHull: 40,
  shieldCapacity: 20,
  shieldRegenPerTurn: 2,
  deltaVPerTurn: 60,
  baseEvasion: 0.2,
  hullRepairPerTurn: 0,
  weapons: [],
  missiles: [],
  pointDefense: [],
  decoys: [],
  ...over,
});

const shipView = (
  bodyId: BodyId,
  fleetId: number,
  s: SimShip,
  over: Partial<BlindShipView> = {},
): BlindShipView => ({
  bodyId,
  fleetId,
  name: s.name,
  chassisClass: s.chassisClass,
  hull: s.maxHull,
  maxHull: s.maxHull,
  shields: s.shieldCapacity,
  shieldCapacity: s.shieldCapacity,
  shieldGenAlive: true,
  engineAlive: true,
  weaponAlive: [],
  missileAlive: [],
  missileAmmo: [],
  pdAlive: [],
  decoyAlive: [],
  decoyCharges: [],
  decoyActiveUntilTurn: 0,
  ship: s,
  ...over,
});

const wp = (over: Partial<WaypointDraft> = {}): WaypointDraft => ({
  bearing: 0,
  pitch: 0,
  magnitude: 0,
  ...over,
});

const draft = (over: Partial<PlanDraft> = {}): PlanDraft => ({
  bodyId: 1,
  waypoints: [wp()],
  activeIndex: 0,
  status: 'unplanned',
  ...over,
});

const viewOf = (ships: readonly BlindShipView[]): BlindMatchView =>
  ({ turn: 1, arena: {}, selfFleetId: 0, bodies: [], ships }) as unknown as BlindMatchView;

// ---- Numeric sanitation ---------------------------------------------------

describe('numeric sanitation', () => {
  it('clampMag clamps to [0, cap] and maps NaN/negative to 0', () => {
    expect(clampMag(22, 70)).toBe(22);
    expect(clampMag(100, 30)).toBe(30); // over-spend clamps to cap
    expect(clampMag(-5, 70)).toBe(0);
    expect(clampMag(Number.NaN, 70)).toBe(0);
    expect(clampMag(10, 0)).toBe(0); // engine-dead → zero cap
  });

  it('wrapBearing normalizes to [0, 360)', () => {
    expect(wrapBearing(41)).toBe(41);
    expect(wrapBearing(360)).toBe(0);
    expect(wrapBearing(370)).toBe(10);
    expect(wrapBearing(-10)).toBe(350);
    expect(wrapBearing(Number.NaN)).toBe(0);
  });

  it('clampPitch clamps to [-90, 90]', () => {
    expect(clampPitch(18)).toBe(18);
    expect(clampPitch(120)).toBe(90);
    expect(clampPitch(-120)).toBe(-90);
    expect(clampPitch(Number.NaN)).toBe(0);
  });
});

// ---- Segmentation math (SESSION-05) --------------------------------------

describe('segmentation math', () => {
  it('segCountFor: Off → 1; else floor(beatSeconds / interval); ≥ 1', () => {
    expect(segCountFor(0, 8)).toBe(1); // Off → single dt-length segment
    expect(segCountFor(1, 8)).toBe(8); // 1s marks → 8 segments
    expect(segCountFor(2, 8)).toBe(4); // 2s → 4 segments (session example)
    expect(segCountFor(4, 8)).toBe(2); // 4s → 2 segments
    expect(segCountFor(2, 3)).toBe(1); // interval > beat → floor to 1 minimum
  });

  it('segCountFor: bad beatSeconds degrades to 1', () => {
    expect(segCountFor(2, 0)).toBe(1);
    expect(segCountFor(2, Number.NaN)).toBe(1);
    expect(segCountFor(2, -8)).toBe(1);
  });

  it('sliceSecondsFor: Off → whole beat; else interval', () => {
    expect(sliceSecondsFor(0, 8)).toBe(8);
    expect(sliceSecondsFor(1, 8)).toBe(1);
    expect(sliceSecondsFor(2, 8)).toBe(2);
    expect(sliceSecondsFor(4, 8)).toBe(4);
  });

  it('segCount · sliceSeconds covers the whole beat at every supported interval', () => {
    const dt = 8;
    for (const i of [0, 1, 2, 4] as const satisfies readonly MarksIntervalValue[]) {
      expect(segCountFor(i, dt) * sliceSecondsFor(i, dt)).toBe(dt);
    }
  });

  it('perSegmentCap: min(shipBudget, maxAccel · sliceSeconds) when maxAccel set', () => {
    expect(perSegmentCap(60, 1, 25)).toBe(25); // physCap 25 < budget 60
    expect(perSegmentCap(10, 2, 25)).toBe(10); // budget 10 < physCap 50
    expect(perSegmentCap(60, 4, 100)).toBe(60); // budget below physCap 400
  });

  it('perSegmentCap: collapses to shipBudget when maxAccel is absent / non-finite / ≤ 0', () => {
    expect(perSegmentCap(60, 1, undefined)).toBe(60);
    expect(perSegmentCap(60, 1, 0)).toBe(60);
    expect(perSegmentCap(60, 1, Number.NaN)).toBe(60);
    expect(perSegmentCap(60, 1, -25)).toBe(60);
  });

  it('perSegmentCap: bad sliceSeconds also collapses to budget', () => {
    expect(perSegmentCap(60, 0, 25)).toBe(60);
    expect(perSegmentCap(60, Number.NaN, 25)).toBe(60);
  });
});

// ---- Waypoint Δv derivation ----------------------------------------------

describe('waypointBurnsFor', () => {
  it('a single-waypoint planned draft flies its Δv along +X for bearing 0 / pitch 0', () => {
    const d = draft({
      status: 'planned',
      waypoints: [wp({ bearing: 0, pitch: 0, magnitude: 40 })],
    });
    const burns = waypointBurnsFor(d, 70, { sliceSeconds: 8 });
    expect(burns).toHaveLength(1);
    expect(burns[0]!.deltaV.x).toBeCloseTo(40, 6);
    expect(burns[0]!.deltaV.y).toBeCloseTo(0, 6);
    expect(burns[0]!.deltaV.z).toBeCloseTo(0, 6);
  });

  it('per-segment clamp: maxAccel · sliceSeconds caps a single segment', () => {
    // maxAccel = 25, sliceSeconds = 1 → per-segment cap = 25 (< budget 60).
    const d = draft({
      status: 'planned',
      waypoints: [wp({ bearing: 0, pitch: 0, magnitude: 100 })],
    });
    const burns = waypointBurnsFor(d, 60, { sliceSeconds: 1, maxAccel: 25 });
    expect(burns[0]!.deltaV.x).toBeCloseTo(25, 6);
  });

  it('COAST → every segment is the zero vector regardless of stored magnitudes', () => {
    const d = draft({
      status: 'coast',
      waypoints: [
        wp({ bearing: 90, pitch: 0, magnitude: 40 }),
        wp({ bearing: 180, pitch: 0, magnitude: 30 }),
      ],
    });
    const burns = waypointBurnsFor(d, 70, { sliceSeconds: 2 });
    expect(burns).toHaveLength(2);
    for (const b of burns) expect(b.deltaV).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('a planned zero-thrust waypoint contributes the zero vector', () => {
    const d = draft({
      status: 'planned',
      waypoints: [wp({ bearing: 41, pitch: 18, magnitude: 0 })],
    });
    const burns = waypointBurnsFor(d, 70, { sliceSeconds: 8 });
    expect(burns[0]!.deltaV).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('multi-waypoint: each waypoint clamped independently at per-segment cap', () => {
    // 4 segments at cap 20 each (maxAccel 20, sliceSec 1); user tries to spend 30 each.
    const d = draft({
      status: 'planned',
      waypoints: [
        wp({ bearing: 0, pitch: 0, magnitude: 30 }),
        wp({ bearing: 90, pitch: 0, magnitude: 30 }),
        wp({ bearing: 180, pitch: 0, magnitude: 30 }),
        wp({ bearing: 270, pitch: 0, magnitude: 30 }),
      ],
    });
    const burns = waypointBurnsFor(d, 200, { sliceSeconds: 1, maxAccel: 20 });
    expect(burns).toHaveLength(4);
    // Each capped at 20 → magnitudes are 20 in four cardinal directions.
    for (const b of burns) {
      const mag = Math.hypot(b.deltaV.x, b.deltaV.y, b.deltaV.z);
      expect(mag).toBeCloseTo(20, 4);
    }
  });

  it('plannedDeltaVMag sums clamped per-segment magnitudes (COAST → 0)', () => {
    const planned = draft({
      status: 'planned',
      waypoints: [wp({ magnitude: 25 }), wp({ magnitude: 100 }), wp({ magnitude: 10 })],
    });
    // Per-segment cap = maxAccel 20 · slice 1 = 20; sum = 20 + 20 + 10 = 50.
    expect(plannedDeltaVMag(planned, 200, { sliceSeconds: 1, maxAccel: 20 })).toBeCloseTo(50, 6);
    // COAST short-circuits to 0.
    const coasting = draft({
      status: 'coast',
      waypoints: [wp({ magnitude: 100 })],
    });
    expect(plannedDeltaVMag(coasting, 200, { sliceSeconds: 1, maxAccel: 20 })).toBe(0);
  });

  it('impulsiveTotalDeltaV sums the segment vectors (CP1 bridge for the old previewArc shape)', () => {
    const d = draft({
      status: 'planned',
      waypoints: [
        wp({ bearing: 0, pitch: 0, magnitude: 30 }),
        wp({ bearing: 90, pitch: 0, magnitude: 40 }),
      ],
    });
    const v = impulsiveTotalDeltaV(d, 200, { sliceSeconds: 1, maxAccel: 100 });
    // bearing 0 = +X, bearing 90 = +Z (per dirFromBearingPitch convention).
    expect(v.x).toBeCloseTo(30, 4);
    expect(v.z).toBeCloseTo(40, 4);
    expect(v.y).toBeCloseTo(0, 4);
  });
});

// ---- previewInputFor (the `{segments}` payload to previewArc) -------------

describe('previewInputFor', () => {
  it('yields a segments payload the controller.previewArc segmented seam consumes', () => {
    const d = draft({
      status: 'planned',
      waypoints: [wp({ magnitude: 20 }), wp({ magnitude: 30 })],
    });
    const input = previewInputFor(d, 60, { sliceSeconds: 4, maxAccel: 25 });
    expect(input).toHaveProperty('segments');
    expect(input.segments).toHaveLength(2);
    // Per-segment cap = 25·4 = 100; ship-budget 60 wins → cap 60. Both under cap.
    expect(Math.hypot(input.segments[0]!.deltaV.x, input.segments[0]!.deltaV.y, input.segments[0]!.deltaV.z)).toBeCloseTo(20, 6);
    expect(Math.hypot(input.segments[1]!.deltaV.x, input.segments[1]!.deltaV.y, input.segments[1]!.deltaV.z)).toBeCloseTo(30, 6);
  });

  it('CP3 ghost-draw path: the value handed to controller.previewArc is `{ segments }`', () => {
    // The screen calls `controller.previewArc(id, previewInputFor(draft, budget, opts))`.
    // A spy previewArc captures the exact ARC argument to lock the segmented
    // seam without touching WebGL (session CP3 commit-condition).
    const captured: unknown[] = [];
    const previewArcSpy = (_bodyId: BodyId, arc: unknown): { positions: unknown[]; endsOutsideArena: boolean } => {
      captured.push(arc);
      return { positions: [], endsOutsideArena: false };
    };

    const d = draft({
      bodyId: 7,
      status: 'planned',
      waypoints: [wp({ bearing: 45, magnitude: 12 }), wp({ bearing: 90, magnitude: 18 })],
    });

    previewArcSpy(d.bodyId, previewInputFor(d, 60, { sliceSeconds: 2, maxAccel: 30 }));
    previewArcSpy(d.bodyId, previewInputFor(d, 60, { sliceSeconds: 2, maxAccel: 30 }));

    expect(captured).toHaveLength(2);
    for (const arc of captured) {
      // Every call carries `{segments}`, never a bare Vec3 (the impulsive form).
      expect(arc).not.toHaveProperty('x');
      expect(arc).toHaveProperty('segments');
      const segments = (arc as { segments: readonly { deltaV: { x: number; y: number; z: number } }[] }).segments;
      expect(segments).toHaveLength(2);
      // Segments carry WaypointBurn { deltaV: Vec3 } — the sim/types contract.
      for (const s of segments) {
        expect(s).toHaveProperty('deltaV');
        expect(s.deltaV).toHaveProperty('x');
        expect(s.deltaV).toHaveProperty('y');
        expect(s.deltaV).toHaveProperty('z');
      }
    }
  });
});

// ---- Draft transitions ----------------------------------------------------

describe('draft transitions', () => {
  it('initialDraft: every living ship starts COAST (D-COMMIT-DEFAULT-COAST) with N zeroed waypoints', () => {
    // playtest-feedback-03 SESSION-02 CP1 — living ships start on `coast` so
    // `fleetGateStatus.canCommit` is true on turn entry. Engine-dead ships were
    // already coasting for the same underlying reason (zero Δv budget); that
    // path is unchanged. A plotted waypoint still flips a coast draft to
    // `planned` via `plotWaypoint` (asserted below in draft transitions).
    const live: RosterShip = {
      bodyId: 1, name: 'A', chassisClass: 'fighter', budget: 60, engineAlive: true, alive: true,
    };
    const dead: RosterShip = {
      bodyId: 2, name: 'B', chassisClass: 'fighter', budget: 0, engineAlive: false, alive: true,
    };
    const d1 = initialDraft(live, { interval: 2, beatSeconds: 8 });
    expect(d1.status).toBe('coast');
    expect(d1.activeIndex).toBe(0);
    expect(d1.waypoints).toHaveLength(4); // 2s → 4 segments (session example)
    for (const w of d1.waypoints) expect(w).toEqual({ bearing: 0, pitch: 0, magnitude: 0 });

    const d2 = initialDraft(dead, { interval: 1, beatSeconds: 8 });
    expect(d2.status).toBe('coast');
    expect(d2.waypoints).toHaveLength(8);
  });

  it('a fresh turn is immediately committable — every living ship coasts by default', () => {
    // The D-COMMIT-DEFAULT-COAST invariant, end to end: the drafts we build
    // for every living ship on turn entry, unchanged, satisfy the §4.3 gate.
    const rows: readonly RosterShip[] = [
      { bodyId: 1, name: 'WIDOWMAKER', chassisClass: 'fighter', budget: 70, engineAlive: true, alive: true },
      { bodyId: 2, name: 'HARRIER-2', chassisClass: 'fighter', budget: 40, engineAlive: true, alive: true },
      { bodyId: 3, name: 'IRON VERDICT', chassisClass: 'cruiser', budget: 0, engineAlive: false, alive: true },
    ];
    const drafts = rows.map((r) => initialDraft(r, { interval: 1, beatSeconds: 8 }));
    const gate = fleetGateStatus(drafts);
    expect(gate.canCommit).toBe(true);
    expect(gate.plannedCount).toBe(rows.length);
    expect(gate.total).toBe(rows.length);
  });

  it('plotWaypoint sanitizes inputs and marks the ACTIVE waypoint planned', () => {
    const d = draft({
      waypoints: [wp(), wp(), wp()],
      activeIndex: 1,
    });
    const next = plotWaypoint(d, { bearing: 370, pitch: 120, magnitude: 22 });
    expect(next.status).toBe('planned');
    expect(next.waypoints[1]).toEqual({ bearing: 10, pitch: 90, magnitude: 22 });
    // Waypoints 0 and 2 untouched (editing k leaves ≠ k intact).
    expect(next.waypoints[0]).toEqual({ bearing: 0, pitch: 0, magnitude: 0 });
    expect(next.waypoints[2]).toEqual({ bearing: 0, pitch: 0, magnitude: 0 });
  });

  it('plotWaypoint with a bad activeIndex clamps and edits waypoint 0', () => {
    const d = draft({
      waypoints: [wp(), wp()],
      activeIndex: 99,
    });
    // clampIndex → count - 1 = 1
    const next = plotWaypoint(d, { magnitude: 40 });
    expect(next.waypoints[1]!.magnitude).toBe(40);
  });

  it('active-waypoint binding: setActiveIndex + plotWaypoint edit only the current slot (CP2)', () => {
    // Start with 4 waypoints, all zeroed; simulate the CP2 UI flow — select
    // waypoint 2, plot it, then select waypoint 0 and plot it. Every other
    // waypoint must remain untouched throughout ("editing k leaves others intact").
    let d = draft({ waypoints: [wp(), wp(), wp(), wp()] });
    d = setActiveIndex(d, 2);
    d = plotWaypoint(d, { bearing: 90, pitch: 15, magnitude: 12 });
    d = setActiveIndex(d, 0);
    d = plotWaypoint(d, { bearing: 45, pitch: 0, magnitude: 30 });
    expect(d.waypoints[0]).toEqual({ bearing: 45, pitch: 0, magnitude: 30 });
    expect(d.waypoints[1]).toEqual({ bearing: 0, pitch: 0, magnitude: 0 });
    expect(d.waypoints[2]).toEqual({ bearing: 90, pitch: 15, magnitude: 12 });
    expect(d.waypoints[3]).toEqual({ bearing: 0, pitch: 0, magnitude: 0 });
    // Any plotWaypoint call keeps status planned.
    expect(d.status).toBe('planned');
    // activeIndex tracks the last selection.
    expect(d.activeIndex).toBe(0);
  });

  it('setActiveIndex clamps into range; status unchanged', () => {
    const d = draft({
      waypoints: [wp(), wp(), wp()],
      activeIndex: 0,
      status: 'planned',
    });
    expect(setActiveIndex(d, 2).activeIndex).toBe(2);
    expect(setActiveIndex(d, 99).activeIndex).toBe(2); // clamp to count - 1
    expect(setActiveIndex(d, -1).activeIndex).toBe(0);
    expect(setActiveIndex(d, 1).status).toBe('planned');
  });

  it('setCoast switches to coast (waypoints preserved for toggle-back)', () => {
    const d = draft({
      status: 'planned',
      waypoints: [wp({ bearing: 41, pitch: 18, magnitude: 22 })],
    });
    const next = setCoast(d);
    expect(next.status).toBe('coast');
    expect(next.waypoints[0]!.bearing).toBe(41);
  });

  it('rebuildForInterval preserves aim (bearing/pitch of waypoint 0) + resets magnitudes to 0', () => {
    const d = draft({
      status: 'planned',
      waypoints: [
        wp({ bearing: 90, pitch: 30, magnitude: 25 }),
        wp({ bearing: 180, pitch: 0, magnitude: 15 }),
      ],
      activeIndex: 1,
    });
    const rebuilt = rebuildForInterval(d, 2, 8); // 2s → 4 segments
    expect(rebuilt.waypoints).toHaveLength(4);
    for (const w of rebuilt.waypoints) {
      expect(w.bearing).toBe(90); // aim of waypoint 0 propagated
      expect(w.pitch).toBe(30);
      expect(w.magnitude).toBe(0); // magnitudes reset
    }
    expect(rebuilt.activeIndex).toBe(0); // selector snaps back
    expect(rebuilt.status).toBe('planned'); // status preserved (decision still made)
  });

  it('rebuildForInterval preserves the COAST status (a COAST draft stays COAST)', () => {
    const d = draft({ status: 'coast', waypoints: [wp({ bearing: 45 })] });
    const rebuilt = rebuildForInterval(d, 1, 8);
    expect(rebuilt.status).toBe('coast');
    expect(rebuilt.waypoints).toHaveLength(8);
  });
});

// ---- fleetGateStatus ------------------------------------------------------

describe('fleetGateStatus', () => {
  it('blocks while any ship is unplanned', () => {
    const g = fleetGateStatus([draft({ status: 'planned' }), draft({ status: 'unplanned' })]);
    expect(g).toEqual({ plannedCount: 1, total: 2, canCommit: false });
  });

  it('opens when every ship is planned or coast', () => {
    const g = fleetGateStatus([draft({ status: 'planned' }), draft({ status: 'coast' })]);
    expect(g).toEqual({ plannedCount: 2, total: 2, canCommit: true });
  });

  it('an empty fleet cannot commit', () => {
    expect(fleetGateStatus([])).toEqual({ plannedCount: 0, total: 0, canCommit: false });
  });
});

// ---- toMovementPlans (SESSION-05: segmented) -----------------------------

describe('toMovementPlans', () => {
  it('emits one plan per draft carrying `segments`; deltaV is ZERO for shape-consistency', () => {
    const budgetOf = (id: BodyId): number => (id === 1 ? 30 : 70);
    const plans = toMovementPlans(
      [
        draft({
          bodyId: 1,
          status: 'planned',
          waypoints: [wp({ bearing: 0, pitch: 0, magnitude: 100 })],
        }),
        draft({ bodyId: 2, status: 'coast', waypoints: [wp(), wp()] }),
      ],
      budgetOf,
      { sliceSeconds: 8 },
    );
    expect(plans).toHaveLength(2);
    // Every plan carries segments (D-ADDITIVE-PLAN); deltaV is the zero vector.
    for (const p of plans) {
      expect(p.deltaV).toEqual({ x: 0, y: 0, z: 0 });
      expect(p.segments).toBeDefined();
    }
    // Ship 1: single segment clamped to ship budget 30.
    expect(plans[0]!.bodyId).toBe(1);
    expect(plans[0]!.segments).toHaveLength(1);
    expect(plans[0]!.segments![0]!.deltaV.x).toBeCloseTo(30, 6);
    // Ship 2: coast → both segments are zero.
    expect(plans[1]!.bodyId).toBe(2);
    expect(plans[1]!.segments).toHaveLength(2);
    for (const s of plans[1]!.segments!) expect(s.deltaV).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('sum of segment magnitudes matches plotted Δv within the per-segment cap', () => {
    const budgetOf = (): number => 200;
    const d = draft({
      status: 'planned',
      waypoints: [
        wp({ bearing: 0, pitch: 0, magnitude: 20 }),
        wp({ bearing: 0, pitch: 0, magnitude: 20 }),
      ],
    });
    const [plan] = toMovementPlans([d], budgetOf, { sliceSeconds: 1, maxAccel: 25 });
    // Under cap 25·1=25 each → both fire at 20 → sum magnitudes = 40.
    const sum = plan!.segments!.reduce(
      (a, s) => a + Math.hypot(s.deltaV.x, s.deltaV.y, s.deltaV.z),
      0,
    );
    expect(sum).toBeCloseTo(40, 6);
  });
});

// ---- playerRosterRows -----------------------------------------------------

describe('playerRosterRows', () => {
  const shipA = ship('WIDOWMAKER', { deltaVPerTurn: 70 });
  const shipB = ship('HARRIER-2', { deltaVPerTurn: 40 });
  const shipC = ship('IRON VERDICT', { deltaVPerTurn: 20 });

  it('returns only living ships from the player fleet — destroyed player ships are absent from view.ships', () => {
    // Ship 2 (HARRIER-2) is destroyed → absent from view.ships (the sim culls it).
    const view = viewOf([shipView(1, 0, shipA), shipView(3, 1, shipC)]);
    const rows = playerRosterRows(view, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      bodyId: 1,
      name: 'WIDOWMAKER',
      budget: 70,
      alive: true,
      engineAlive: true,
    });
  });

  it('engine-dead living ships carry zero budget (coasts automatically, §4.3)', () => {
    const view = viewOf([shipView(1, 0, shipA, { engineAlive: false }), shipView(2, 0, shipB)]);
    const rows = playerRosterRows(view, 0);
    expect(rows[0]).toMatchObject({ bodyId: 1, alive: true, engineAlive: false, budget: 0 });
    expect(rows[1]).toMatchObject({ bodyId: 2, alive: true, budget: 40 });
  });

  it('ignores other fleets entirely', () => {
    const view = viewOf([shipView(1, 0, shipA), shipView(3, 1, shipC)]);
    const rows = playerRosterRows(view, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.bodyId).toBe(3);
  });
});

// ---- planBadgeFor ---------------------------------------------------------

describe('planBadgeFor', () => {
  const inputs = (over: {
    drafts?: ReadonlyMap<BodyId, PlanDraft>;
    exitIds?: ReadonlySet<BodyId>;
    playerFleetId?: number;
  } = {}) => ({
    drafts: over.drafts ?? new Map<BodyId, PlanDraft>(),
    exitIds: over.exitIds ?? new Set<BodyId>(),
    playerFleetId: over.playerFleetId ?? 0,
  });

  const entry = (bodyId: BodyId, fleetId: number, alive = true) => ({ bodyId, fleetId, alive });

  it('living player ship with no draft reads UNPLANNED', () => {
    expect(planBadgeFor(entry(1, 0), inputs())).toEqual({ text: '● UNPLANNED', cls: 'c-amber' });
  });

  it('living player ship with a planned draft reads PLANNED', () => {
    const drafts = new Map<BodyId, PlanDraft>([[1, draft({ bodyId: 1, status: 'planned' })]]);
    expect(planBadgeFor(entry(1, 0), inputs({ drafts }))).toEqual({
      text: 'PLANNED ✓',
      cls: 'c-green',
    });
  });

  it('living player ship on coast reads COAST', () => {
    const drafts = new Map<BodyId, PlanDraft>([[1, draft({ bodyId: 1, status: 'coast' })]]);
    expect(planBadgeFor(entry(1, 0), inputs({ drafts }))).toEqual({
      text: 'COAST ✓',
      cls: 'c-cyan',
    });
  });

  it('living player ship whose plotted arc leaves the arena reads ✕ EXIT ARC (over any status)', () => {
    const drafts = new Map<BodyId, PlanDraft>([[1, draft({ bodyId: 1, status: 'planned' })]]);
    const exitIds = new Set<BodyId>([1]);
    expect(planBadgeFor(entry(1, 0), inputs({ drafts, exitIds }))).toEqual({
      text: '✕ EXIT ARC',
      cls: 'c-red',
    });
  });

  it('bot ships never get a badge (FR-17 — no opponent plan surface)', () => {
    const drafts = new Map<BodyId, PlanDraft>([[2, draft({ bodyId: 2, status: 'planned' })]]);
    expect(planBadgeFor(entry(2, 1), inputs({ drafts }))).toBeNull();
  });

  it('destroyed ships never get a badge (excluded from the gate)', () => {
    expect(planBadgeFor(entry(1, 0, false), inputs())).toBeNull();
  });
});

// ---- Marks-interval selector (SESSION-03) ---------------------------------

describe('MARKS_INTERVAL_OPTIONS', () => {
  it('lists Off / 1s / 2s / 4s in order (Gate 1 prototype cadence)', () => {
    expect(MARKS_INTERVAL_OPTIONS.map((o) => o.value)).toEqual([0, 1, 2, 4]);
    expect(MARKS_INTERVAL_OPTIONS.map((o) => o.label)).toEqual(['OFF', '1s', '2s', '4s']);
    // Every option carries a screen-reader label — never color-alone.
    for (const opt of MARKS_INTERVAL_OPTIONS) {
      expect(opt.srLabel.length).toBeGreaterThan(0);
    }
  });
});

describe('normalizeMarksInterval', () => {
  it('passes valid values through', () => {
    expect(normalizeMarksInterval(0)).toBe(0);
    expect(normalizeMarksInterval(1)).toBe(1);
    expect(normalizeMarksInterval(2)).toBe(2);
    expect(normalizeMarksInterval(4)).toBe(4);
  });

  it('snaps arbitrary numeric input to the nearest supported interval', () => {
    expect(normalizeMarksInterval(0.5)).toBe(1);
    expect(normalizeMarksInterval(1.5)).toBe(2);
    expect(normalizeMarksInterval(3)).toBe(4);
    expect(normalizeMarksInterval(100)).toBe(4);
  });

  it('non-finite / negative → 1s (default)', () => {
    expect(normalizeMarksInterval(Number.NaN)).toBe(1);
    expect(normalizeMarksInterval(-1)).toBe(1);
    expect(normalizeMarksInterval(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

// ---- Ghost arc construction (marks-interval reaches the draw input) -------

describe('buildGhostArc', () => {
  const preview = {
    positions: [
      { x: 0, y: 0, z: 0 },
      { x: 20, y: 0, z: 0 },
    ],
    endsOutsideArena: false,
  };

  it('threads markIntervalSec through verbatim — the S01 ghost input', () => {
    for (const mi of [0, 1, 2, 4] as const satisfies readonly MarksIntervalValue[]) {
      const arc = buildGhostArc(preview, 20, {
        beatSeconds: 8,
        hullRadius: 4,
        markIntervalSec: mi,
      });
      expect(arc.markIntervalSec).toBe(mi);
    }
  });

  it('pins beatSeconds + hullRadius + deltaVMag; mirrors preview positions / exit flag', () => {
    const arc = buildGhostArc(preview, 42, {
      beatSeconds: 8,
      hullRadius: 4,
      markIntervalSec: 1,
    });
    expect(arc.positions).toBe(preview.positions);
    expect(arc.endsOutsideArena).toBe(false);
    expect(arc.beatSeconds).toBe(8);
    expect(arc.hullRadius).toBe(4);
    expect(arc.deltaVMag).toBe(42);
  });

  it('passes markPositions through when the preview carries them (segmented branch)', () => {
    const marks = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }];
    const previewWithMarks = { ...preview, markPositions: marks };
    const arc = buildGhostArc(previewWithMarks, 20, {
      beatSeconds: 8,
      hullRadius: 4,
      markIntervalSec: 2,
    });
    expect(arc.markPositions).toBe(marks);
  });

  it('omits markPositions when the preview does not supply them (impulsive branch)', () => {
    const arc = buildGhostArc(preview, 20, {
      beatSeconds: 8,
      hullRadius: 4,
      markIntervalSec: 1,
    });
    expect(arc).not.toHaveProperty('markPositions');
  });
});
