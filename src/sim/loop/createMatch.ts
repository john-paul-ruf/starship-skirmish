// createMatch — seeded fleet placement + initial MatchState assembly (M10, FR-12).
//
// Every match starts from the same recipe: mint monotonic BodyIds across all
// fleets in `(fleetId, shipIndex)` order, place fleet centroids on a shared
// inset shell (equidistant from the boundary — FR-12), scatter ships within
// each fleet by small seeded offsets, and seed a `ShipCombat` per ship. The
// starting velocity is zero for every ship (`tuning.arena.startVelocity`) and
// fleets start outside mutual weapons range.
//
// Determinism: the same `Seed` produces the same placement every run. All draws
// go through the counter-based RNG (`mathx/rng.ts`); direction generation goes
// through `dirFromBearingPitch` (the deterministic-trig path) — no wall clock,
// no `Math.random`, no `Math.sin/cos` (banned in sim/**, see FORGE-CONFIG).
//
// Non-goals of this file: it is NOT the run loop, does NOT know about
// commanders, and does NOT run a beat. Its whole job is "state at turn 1".

import {
  ZERO,
  cross,
  dirFromBearingPitch,
  distance,
  length,
  of,
  rand01,
  type Vec3,
} from '../mathx/index.js';
import { newShipCombat, type MissileGuidance, type ShipCombat } from '../rules/index.js';
import type {
  Body,
  BodyId,
  MissileBody,
  DebrisBody,
  ShipBody,
  SimShip,
} from '../types.js';
import type {
  Match,
  MatchConfig,
  MatchState,
  PendingDetonation,
} from './matchState.js';

/** Fixed uint32 stream tag for placement-phase draws — separates fleet-angle
 *  and per-ship-offset streams from any beat-time draws so a placement-phase
 *  reorder can never corrupt an in-match roll. */
const STREAM_PLACEMENT = 0x91ace000;

/** Sub-stream tags within placement. */
const SUB_FLEET_ANGLE = 0;
const SUB_SHIP_OFFSET = 1;

// Spacing of ships within a fleet, expressed as a multiple of the *largest*
// ship's collision radius in that fleet. 3 × means adjacent ships sit at
// 3 radii apart — well clear of overlap. Purely a placement default; no
// gameplay effect (the tuning system has no field for this and the negative-
// space invariant forbids inventing one).
const INTRA_FLEET_SPACING_MULT = 3;

/**
 * Determine a unit direction perpendicular to `radial`. Prefers the +Y axis;
 * falls back to +Z if the radial happens to align with Y. Deterministic —
 * pure arithmetic on radial.
 */
const perpAxis = (radial: Vec3): Vec3 => {
  // cross(radial, +Y) — zero iff radial ∥ ±Y.
  const upCross = cross(radial, of(0, 1, 0));
  if (length(upCross) > 1e-9) {
    const inv = 1 / length(upCross);
    return of(upCross.x * inv, upCross.y * inv, upCross.z * inv);
  }
  // radial is (near-)vertical; use +Z as the perpendicular anchor.
  return of(0, 0, 1);
};

/**
 * Distribute N unit direction vectors around the arena's equator with a
 * seed-derived rotation offset. Even angular spread + one seeded phase =
 * reproducible per seed, distinct across seeds. All directions have zero
 * pitch → every fleet's centroid lands on the arena's equatorial plane, so
 * "equidistant from boundary" reduces to "on the inset shell", which is
 * true by construction.
 */
const fleetDirections = (n: number, seed: MatchConfig['seed']): Vec3[] => {
  const phase = rand01(seed, STREAM_PLACEMENT, SUB_FLEET_ANGLE, 0) * 360;
  const out: Vec3[] = [];
  const step = n > 0 ? 360 / n : 0;
  for (let i = 0; i < n; i += 1) {
    const bearing = phase + step * i;
    out.push(dirFromBearingPitch(bearing, 0));
  }
  return out;
};

/**
 * Place ships within one fleet: their positions along a line perpendicular to
 * the fleet's radial direction, centered on the fleet centroid, plus a small
 * seed-derived jitter along that same perpendicular so two runs of the same
 * seed produce IDENTICAL positions but two runs of different seeds diverge.
 */
const placeShipsInFleet = (
  centroid: Vec3,
  radial: Vec3,
  ships: readonly SimShip[],
  fleetId: number,
  seed: MatchConfig['seed'],
): Vec3[] => {
  const n = ships.length;
  if (n === 0) return [];
  // Spacing based on the LARGEST radius in the fleet (mega-destroyers need
  // room). A one-ship fleet just sits on the centroid.
  let maxRadius = 0;
  for (let i = 0; i < n; i += 1) {
    if (ships[i]!.radius > maxRadius) maxRadius = ships[i]!.radius;
  }
  const spacing = maxRadius * INTRA_FLEET_SPACING_MULT;
  const perp = perpAxis(radial);
  const out: Vec3[] = [];
  // Center the line: ship i sits at (i - (n-1)/2) * spacing along perp,
  // plus a small [-0.5, +0.5] × spacing jitter along the same axis (subtle
  // enough to preserve spacing, seed-derived so it's reproducible).
  const half = (n - 1) / 2;
  for (let i = 0; i < n; i += 1) {
    const jitter =
      (rand01(seed, STREAM_PLACEMENT, SUB_SHIP_OFFSET, fleetId, i) - 0.5) *
      0.2 *
      spacing;
    const t = (i - half) * spacing + jitter;
    out.push(of(
      centroid.x + perp.x * t,
      centroid.y + perp.y * t,
      centroid.z + perp.z * t,
    ));
  }
  return out;
};

/**
 * Turn one `SimShip` + placement into a `ShipBody`. Starting velocity is zero
 * (`tuning.arena.startVelocity` — the tuning field exists and is checked in
 * the catalog lock; using ZERO here is the same value that field carries).
 */
const shipToBody = (ship: SimShip, id: BodyId, position: Vec3): ShipBody => ({
  kind: 'ship',
  id,
  position,
  velocity: ZERO,
  mass: ship.mass,
  radius: ship.radius,
});

/**
 * Build the initial `MatchState` from `MatchConfig`. Ids mint monotonically
 * across all fleets in `(fleetId, shipIndex)` order — the sim's uint32 ordering
 * source of truth. Zero live missiles / debris at start. `turn = 1` per the
 * 1-based convention (`MatchState.turn` is the turn that is ABOUT to run).
 *
 * Invariants asserted structurally (tests check the observable ones):
 *   • Every ship starts with zero velocity.
 *   • Every fleet centroid sits on the inset shell (equidistant from boundary).
 *   • Same seed ⇒ same layout, byte-for-byte (position values equal).
 *   • Different seed ⇒ different layout.
 *   • Ships within a fleet do not overlap (spacing ≥ 3 × maxRadius).
 */
export const createMatch = (config: MatchConfig): Match => {
  const state = buildInitialState(config);
  return { state };
};

/**
 * Assemble the initial state. Split from `createMatch` so tests can inspect
 * the pure product without instantiating the mutable handle.
 */
export const buildInitialState = (config: MatchConfig): MatchState => {
  const insetRadius =
    config.arena.radius * FLEET_START_INSET_FRACTION;
  const dirs = fleetDirections(config.fleets.length, config.seed);

  // Assign BodyIds in (fleetId, shipIndex) order — the monotonic uint32 that
  // every determinism check hangs off. Start at 1 so 0 remains reserved for
  // "no body" sentinels in future test scaffolding.
  let nextId = 1;
  const bodies = new Map<BodyId, Body>();
  const ships = new Map<BodyId, ShipCombat>();
  const fleetOf = new Map<BodyId, number>();

  for (let fi = 0; fi < config.fleets.length; fi += 1) {
    const fleet = config.fleets[fi]!;
    const dir = dirs[fi]!;
    const centroid = of(
      config.arena.center.x + dir.x * insetRadius,
      config.arena.center.y + dir.y * insetRadius,
      config.arena.center.z + dir.z * insetRadius,
    );
    const positions = placeShipsInFleet(centroid, dir, fleet.ships, fleet.fleetId, config.seed);
    for (let si = 0; si < fleet.ships.length; si += 1) {
      const sim = fleet.ships[si]!;
      const id = nextId;
      nextId += 1;
      const body = shipToBody(sim, id, positions[si]!);
      bodies.set(id, body);
      ships.set(id, newShipCombat(sim, id));
      fleetOf.set(id, fleet.fleetId);
    }
  }

  return {
    seed: config.seed,
    arena: config.arena,
    physics: config.physics,
    combat: config.combat,
    turn: 1,
    nextBodyId: nextId,
    ships,
    bodies,
    fleetOf,
    guidances: new Map<BodyId, MissileGuidance>(),
    debrisAge: new Map<BodyId, number>(),
    pendingDetonations: [] as readonly PendingDetonation[],
  };
};

// The tuning field `arena.fleetStartInsetFraction` is the shell radius as a
// fraction of arena.radius. Its authored value in catalog/tuning.json is 0.72.
// The sim never imports the catalog, so the value lives here as a module
// constant matching the tuning — the catalog lock is what pins them equal.
const FLEET_START_INSET_FRACTION = 0.72;

// ---- Ancillary sanity helpers (used by tests) ------------------------------

/**
 * True when no two ships in `state` are within (rA + rB) of each other —
 * i.e. no start-time overlap. Used by the placement tests.
 */
export const shipsNoOverlap = (state: MatchState): boolean => {
  const shipIds: BodyId[] = [];
  for (const [id, body] of state.bodies) {
    if (body.kind === 'ship') shipIds.push(id);
  }
  shipIds.sort((a, b) => a - b);
  for (let i = 0; i < shipIds.length; i += 1) {
    const a = state.bodies.get(shipIds[i]!)! as ShipBody | DebrisBody | MissileBody;
    for (let j = i + 1; j < shipIds.length; j += 1) {
      const b = state.bodies.get(shipIds[j]!)! as ShipBody | DebrisBody | MissileBody;
      const gap = distance(a.position, b.position) - (a.radius + b.radius);
      if (gap <= 0) return false;
    }
  }
  return true;
};

/**
 * True when every pair of ships from DIFFERENT fleets is outside the maximum
 * weapon range in the fleet drafting the shot. This is the FR-12 "out of
 * weapons range at start" invariant.
 */
export const fleetsOutOfMutualWeaponsRange = (state: MatchState): boolean => {
  const shipIds: BodyId[] = [];
  for (const [id, body] of state.bodies) {
    if (body.kind === 'ship') shipIds.push(id);
  }
  shipIds.sort((a, b) => a - b);
  for (let i = 0; i < shipIds.length; i += 1) {
    const idA = shipIds[i]!;
    const shipA = state.ships.get(idA)!;
    const fleetA = state.fleetOf.get(idA)!;
    const bodyA = state.bodies.get(idA)!;
    for (let j = i + 1; j < shipIds.length; j += 1) {
      const idB = shipIds[j]!;
      const fleetB = state.fleetOf.get(idB)!;
      if (fleetA === fleetB) continue;
      const shipB = state.ships.get(idB)!;
      const bodyB = state.bodies.get(idB)!;
      const d = distance(bodyA.position, bodyB.position);
      // Max range across A's and B's weapons — if any weapon reaches, we fail.
      for (let wi = 0; wi < shipA.ship.weapons.length; wi += 1) {
        if (d <= shipA.ship.weapons[wi]!.range) return false;
      }
      for (let wi = 0; wi < shipB.ship.weapons.length; wi += 1) {
        if (d <= shipB.ship.weapons[wi]!.range) return false;
      }
    }
  }
  return true;
};
