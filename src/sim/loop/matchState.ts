// matchState — the composition-root state for a running match (M10, S04).
//
// This is the mutable core of a match, though the value itself is treated as
// immutable data: every beat resolver in `resolveBeat.ts` returns a NEW
// `MatchState`. Two-phase read/stage/commit (architecture §7.3 rule 3) is the
// per-beat contract — no body observes another's mid-beat mutation because we
// never mutate in place; we rebuild.
//
// The blind-commit guarantee (§6.3, FR-17) is structural, not policy: there is
// no `pendingPlans` / `plans` / coordinator back-reference field on this type.
// The only place plans exist during a beat is a local `const` inside
// `TurnCoordinator.runTurn()`. There is nothing to leak because there is
// nothing to reach.
//
// Determinism (§7.3 rule 1): all iteration over ships/bodies uses the sorted
// accessors below — never `Map.keys()` insertion order, never `Object.keys`,
// never a `Set` iteration. The `nextBodyId` counter is the single source of
// truth for id assignment across the match lifetime; `createMatch` seeds it,
// and each beat resolver advances it monotonically when it spawns new debris /
// missile bodies.

import type { Seed } from '../mathx/index.js';
import type { PhysicsConfig } from '../physics/index.js';
import type { MissileGuidance, ShipCombat } from '../rules/index.js';
import type {
  Arena,
  Body,
  BodyId,
  CombatConfig,
  SimFleet,
} from '../types.js';

/**
 * Everything `createMatch` needs to assemble a running `MatchState`. The three
 * config structs (`arena`, `physics`, `combat`) come from domain resolvers
 * (`resolveArena`, `physicsConfigFromTuning`, `combatConfigFromTuning`) so the
 * sim never imports the catalog.
 */
export interface MatchConfig {
  readonly seed: Seed;
  readonly fleets: readonly SimFleet[];
  readonly arena: Arena;
  readonly physics: PhysicsConfig;
  readonly combat: CombatConfig;
}

/**
 * The running state of a match. Structurally immutable — beat resolvers
 * produce a fresh `MatchState` rather than mutating in place. The bare `Map`
 * fields are declared `ReadonlyMap<K,V>` for the same reason: a caller cannot
 * accidentally add or remove an entry through the state handle.
 *
 * There is NO field for a pending plan (blind-commit invariant, §6.3). Plans
 * live only as locals inside `runTurn`.
 */
export interface MatchState {
  readonly seed: Seed;
  readonly arena: Arena;
  readonly physics: PhysicsConfig;
  readonly combat: CombatConfig;
  /** 1-based turn counter — increments after a full turn completes. */
  readonly turn: number;
  /** Monotonic id source; new debris / missile bodies mint from this. */
  readonly nextBodyId: BodyId;
  /** Ships in play, keyed by BodyId. Iterate SORTED (see `shipsSorted`). */
  readonly ships: ReadonlyMap<BodyId, ShipCombat>;
  /** Every physical body — ships + debris + missiles. Iterate SORTED. */
  readonly bodies: ReadonlyMap<BodyId, Body>;
  /** Ship BodyId → fleetId. Debris/missiles have no fleet. */
  readonly fleetOf: ReadonlyMap<BodyId, number>;
  /** Live missile guidance records, keyed by missile BodyId. */
  readonly guidances: ReadonlyMap<BodyId, MissileGuidance>;
  /** Debris body → turns alive. Advanced by `tickDebrisLifetime` each beat. */
  readonly debrisAge: ReadonlyMap<BodyId, number>;
}

/**
 * The handle the app / harness / UI holds. `state` is a mutable REFERENCE to
 * the current `MatchState` — the state itself is immutable, but the pointer
 * updates as beat resolvers produce new states. The handle exposes a few
 * pure-derived views (`view`, `digest`) plus the async `runTurn` (added CP5).
 *
 * A `runTurn` implementation lives in `turnCoordinator.ts`; this file only
 * declares the handle shape so `MatchState` and `Match` can co-exist without
 * a cyclic import between `matchState.ts` and `turnCoordinator.ts`.
 */
export interface Match {
  /** Current state — updates in place as turns run. */
  state: MatchState;
}

// ---- Sorted accessors -------------------------------------------------------
// Every iteration in the loop MUST go through one of these. Using `Map` order
// directly would make results depend on insertion order — a determinism sin
// (§7.3 rule 1). Named helpers keep the discipline visible at every call site.

/** Ships in ascending `BodyId` order. */
export const shipsSorted = (state: MatchState): ShipCombat[] => {
  const ids = Array.from(state.ships.keys()).sort((a, b) => a - b);
  const out: ShipCombat[] = [];
  for (let i = 0; i < ids.length; i += 1) out.push(state.ships.get(ids[i]!)!);
  return out;
};

/** All bodies (ships + debris + missiles) in ascending `BodyId` order. */
export const bodiesSorted = (state: MatchState): Body[] => {
  const ids = Array.from(state.bodies.keys()).sort((a, b) => a - b);
  const out: Body[] = [];
  for (let i = 0; i < ids.length; i += 1) out.push(state.bodies.get(ids[i]!)!);
  return out;
};

/** Live missile guidances in ascending `bodyId` order. */
export const guidancesSorted = (state: MatchState): MissileGuidance[] => {
  const ids = Array.from(state.guidances.keys()).sort((a, b) => a - b);
  const out: MissileGuidance[] = [];
  for (let i = 0; i < ids.length; i += 1) out.push(state.guidances.get(ids[i]!)!);
  return out;
};
