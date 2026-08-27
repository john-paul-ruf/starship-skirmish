// M14 UI — Tactical Movement model (S05 + S03). Node-only (no JSX, no DOM):
// Δv derivation (bearing/pitch → vector, budget clamp, coast → zero), the
// fleet-gate truth table, `toMovementPlans` shape, `playerRosterRows` (living
// player ships only — the sim culls destroyed ones from `view.ships`), and the
// SESSION-03 `planBadgeFor` annotate deriver (LIVING PLAYER rows only).

import { describe, expect, it } from 'vitest';

import {
  clampMag,
  clampPitch,
  deltaVMag,
  fleetGateStatus,
  initialDraft,
  planBadgeFor,
  playerRosterRows,
  plotArc,
  setCoast,
  toDeltaV,
  toMovementPlans,
  wrapBearing,
  type PlanDraft,
  type RosterShip,
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

const draft = (over: Partial<PlanDraft> = {}): PlanDraft => ({
  bodyId: 1,
  bearing: 0,
  pitch: 0,
  magnitude: 0,
  status: 'unplanned',
  ...over,
});

const viewOf = (ships: readonly BlindShipView[]): BlindMatchView =>
  ({ turn: 1, arena: {}, selfFleetId: 0, bodies: [], ships }) as unknown as BlindMatchView;

// ---- Numeric sanitation ---------------------------------------------------

describe('numeric sanitation', () => {
  it('clampMag clamps to [0, budget] and maps NaN/negative to 0', () => {
    expect(clampMag(22, 70)).toBe(22);
    expect(clampMag(100, 30)).toBe(30); // over-spend clamps to budget
    expect(clampMag(-5, 70)).toBe(0);
    expect(clampMag(Number.NaN, 70)).toBe(0);
    expect(clampMag(10, 0)).toBe(0); // engine-dead → zero budget
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

// ---- toDeltaV -------------------------------------------------------------

describe('toDeltaV', () => {
  it('maps bearing 0 / pitch 0 to +X, scaled by magnitude', () => {
    const v = toDeltaV(draft({ status: 'planned', bearing: 0, pitch: 0, magnitude: 40 }), 70);
    expect(v.x).toBeCloseTo(40, 6);
    expect(v.y).toBeCloseTo(0, 6);
    expect(v.z).toBeCloseTo(0, 6);
  });

  it('clamps magnitude to the budget at plan construction (§4.4)', () => {
    const v = toDeltaV(draft({ status: 'planned', bearing: 0, pitch: 0, magnitude: 100 }), 30);
    expect(v.x).toBeCloseTo(30, 6);
  });

  it('pitch +90 points straight up (+Y)', () => {
    const v = toDeltaV(draft({ status: 'planned', bearing: 0, pitch: 90, magnitude: 50 }), 70);
    expect(v.y).toBeCloseTo(50, 4);
    expect(v.x).toBeCloseTo(0, 4);
    expect(v.z).toBeCloseTo(0, 4);
  });

  it('COAST → the zero vector (no free stop)', () => {
    const v = toDeltaV(draft({ status: 'coast', bearing: 41, pitch: 18, magnitude: 22 }), 70);
    expect(v).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('a planned zero-thrust draft → the zero vector', () => {
    const v = toDeltaV(draft({ status: 'planned', bearing: 41, pitch: 18, magnitude: 0 }), 70);
    expect(v).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('deltaVMag reports the clamped thrust magnitude', () => {
    expect(deltaVMag(draft({ status: 'planned', magnitude: 100 }), 30)).toBeCloseTo(30, 6);
    expect(deltaVMag(draft({ status: 'coast', magnitude: 50 }), 70)).toBe(0);
  });
});

// ---- Draft transitions ----------------------------------------------------

describe('draft transitions', () => {
  it('initialDraft starts living ships UNPLANNED, engine-dead ships COAST', () => {
    const live: RosterShip = {
      bodyId: 1, name: 'A', chassisClass: 'fighter', budget: 60, engineAlive: true, alive: true,
    };
    const dead: RosterShip = {
      bodyId: 2, name: 'B', chassisClass: 'fighter', budget: 0, engineAlive: false, alive: true,
    };
    expect(initialDraft(live).status).toBe('unplanned');
    expect(initialDraft(dead).status).toBe('coast');
  });

  it('plotArc sanitizes inputs and marks the draft planned', () => {
    const d = plotArc(draft(), { bearing: 370, pitch: 120, magnitude: 22 });
    expect(d).toMatchObject({ bearing: 10, pitch: 90, magnitude: 22, status: 'planned' });
  });

  it('setCoast switches to coast', () => {
    expect(setCoast(draft({ status: 'planned' })).status).toBe('coast');
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

// ---- toMovementPlans ------------------------------------------------------

describe('toMovementPlans', () => {
  it('emits one plan per draft, budget-clamped, coast → zero', () => {
    const budgetOf = (id: BodyId): number => (id === 1 ? 30 : 70);
    const plans = toMovementPlans(
      [
        draft({ bodyId: 1, status: 'planned', bearing: 0, pitch: 0, magnitude: 100 }),
        draft({ bodyId: 2, status: 'coast' }),
      ],
      budgetOf,
    );
    expect(plans).toHaveLength(2);
    expect(plans[0]!.bodyId).toBe(1);
    expect(plans[0]!.deltaV.x).toBeCloseTo(30, 6); // clamped to ship-1 budget
    expect(plans[1]).toEqual({ bodyId: 2, deltaV: { x: 0, y: 0, z: 0 } });
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
