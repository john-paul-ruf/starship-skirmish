// blindView — the frozen per-beat projection a Commander plans against (M10,
// FR-17 + architecture §6.3).
//
// This file is where the FR-17 "blind-commit is structurally impossible to
// violate" guarantee lands as CODE, not policy. The `BlindMatchView` shape has
// NO field for `plans` / `pendingPlans` / `coordinator` — it is a strict
// snapshot of "what is there" plus the caller's own fleetId. A planner cannot
// reach the coordinator or any other fleet's plan through the view because
// there is no path to reach.
//
// The wrapper and its `bodies` / `ships` slices are `Object.freeze`d so a
// misbehaving planner cannot mutate its input mid-plan (dev hardening on top
// of the structural guarantee).
//
// Gate 2's `prototypes/gate2/blindView.ts` proved the shape at prototype
// scope; this file promotes it, adding the per-ship view the UI (FR-15) and
// bot need to score attacks against — full-information but plan-blind.

import type {
  Body,
  BodyId,
  ChassisClass,
  SimShip,
  Arena,
} from '../types.js';
import type { ShipCombat } from '../rules/index.js';
import type { MatchState } from './matchState.js';
import { bodiesSorted, shipsSorted } from './matchState.js';

/**
 * One ship's public status as seen by a planner. Full info (Decision 6 —
 * no fog of war) — hull, shields, per-component alive flags, ammo — so bots
 * and UI can weigh a target's remaining threat and legally set up called
 * shots. What is deliberately absent: any subsystem-level integrity number
 * (a component's HP pool is opaque; you know it's alive or dead), any
 * planned action, any coordinator hint.
 */
export interface BlindShipView {
  readonly bodyId: BodyId;
  readonly fleetId: number;
  readonly name: string;
  readonly chassisClass: ChassisClass;
  readonly hull: number;
  readonly maxHull: number;
  readonly shields: number;
  readonly shieldCapacity: number;
  /** True while shieldGenAlive; false after a called-shot kill (FR-25). */
  readonly shieldGenAlive: boolean;
  readonly engineAlive: boolean;
  readonly weaponAlive: readonly boolean[];
  readonly missileAlive: readonly boolean[];
  readonly missileAmmo: readonly number[];
  readonly pdAlive: readonly boolean[];
  readonly decoyAlive: readonly boolean[];
  readonly decoyCharges: readonly number[];
  /** 0 while inactive; otherwise the turn a decoy's bonus is still valid through. */
  readonly decoyActiveUntilTurn: number;
  /** The immutable resolved profile — read-only, folded numbers only (no plan data). */
  readonly ship: SimShip;
}

/**
 * Everything a `Commander` (player or bot) sees for a beat. Bodies + ships +
 * arena + turn + selfFleetId — and NOTHING ELSE.
 *
 * The absence of a `plans` / `pendingPlans` / `coordinator` field IS the
 * FR-17 contract at loop scope. If you find yourself wanting to add one, the
 * caller is trying to cheat.
 */
export interface BlindMatchView {
  readonly turn: number;
  readonly arena: Arena;
  readonly selfFleetId: number;
  /** Every physical body — ships, debris, missiles. Sorted by id, frozen. */
  readonly bodies: readonly Body[];
  /** Per-ship status for EVERY ship (all fleets — no fog). Sorted by bodyId. */
  readonly ships: readonly BlindShipView[];
}

// ---- View construction ------------------------------------------------------

const toShipView = (
  sc: ShipCombat,
  fleetId: number,
): BlindShipView =>
  Object.freeze({
    bodyId: sc.bodyId,
    fleetId,
    name: sc.ship.name,
    chassisClass: sc.ship.chassisClass,
    hull: sc.hull,
    maxHull: sc.ship.maxHull,
    shields: sc.shields,
    shieldCapacity: sc.ship.shieldCapacity,
    shieldGenAlive: sc.shieldGenAlive,
    engineAlive: sc.engineAlive,
    // Slices so a caller's mutation cannot leak into the source ShipCombat.
    weaponAlive: Object.freeze(sc.weaponAlive.slice()),
    missileAlive: Object.freeze(sc.missileAlive.slice()),
    missileAmmo: Object.freeze(sc.missileAmmo.slice()),
    pdAlive: Object.freeze(sc.pdAlive.slice()),
    decoyAlive: Object.freeze(sc.decoyAlive.slice()),
    decoyCharges: Object.freeze(sc.decoyCharges.slice()),
    decoyActiveUntilTurn: sc.decoyActiveUntilTurn,
    ship: sc.ship,
  });

/**
 * Build a fresh `BlindMatchView` for the given fleet from the current
 * `MatchState`. Called ONCE per commander per beat by `TurnCoordinator`.
 *
 * Structural guarantee — read the return shape: `turn`, `arena`, `selfFleetId`,
 * `bodies`, `ships`. No plans, no pending plans, no coordinator reference. A
 * bot can search over `bodies` + `ships` all day and never reach another
 * fleet's plan because none is stored in this state's transitive closure.
 *
 * The returned wrapper is `Object.freeze`d; `bodies` and `ships` are frozen
 * slices, so a planner accidentally sorting an array in place will throw in
 * strict-mode TS (which our runtime always is).
 */
export const makeBlindView = (
  state: MatchState,
  selfFleetId: number,
): BlindMatchView => {
  const bodiesFrozen = Object.freeze(bodiesSorted(state).slice());
  const ships = shipsSorted(state);
  const shipViews: BlindShipView[] = [];
  for (let i = 0; i < ships.length; i += 1) {
    const sc = ships[i]!;
    const fleetId = state.fleetOf.get(sc.bodyId);
    if (fleetId === undefined) continue;
    shipViews.push(toShipView(sc, fleetId));
  }
  return Object.freeze({
    turn: state.turn,
    arena: state.arena,
    selfFleetId,
    bodies: bodiesFrozen,
    ships: Object.freeze(shipViews),
  });
};
