// M14 UI — Post-match pure summary derivation (S07, node-testable).
//
// The receipt of a finished match, reduced to plain data the sibling `.tsx`
// panels render. Deliberately `.ts` (no JSX): the unit build (tsconfig.node)
// traverses transitive imports, so a screen `.tsx` pulled in here would break
// unit typecheck. Everything below is `import type` from the sim barrel — no
// sim VALUE enters the ui bundle, and `ui` is allowed sim *types* (lint).
//
// Three derivations live here:
//   • the outcome headline (FR-27 — exactly two variants, no draw/timeout),
//   • the per-ship fate table (survivors from final state, casualties from the
//     trace's destruction events, identity from the immutable initial rosters),
//   • the flattened, kind-tagged combat log (FR-28 — the deterministic record).

import type {
  BodyId,
  ChassisClass,
  CombatLogEntry,
  DamageSourceKind,
  DestructionEvent,
  MatchOutcome,
  MatchState,
  ResolutionTrace,
  SimFleet,
  SimShip,
} from '../../../sim/index.js';

// ---- Outcome headline (FR-27 / Custom Rule 5) -----------------------------

/**
 * The three display strings the two-variant `MatchOutcome` union produces.
 * `victory` resolves to VICTORY or DEFEAT depending on whether the surviving
 * fleet is the player's; `mutual-destruction` is its own honest headline. There
 * is NO draw / timeout / points-tiebreak branch — the union has no such member,
 * so this function has no such case (a concede is modelled as a `victory` for
 * the opposing fleet, so it lands here as DEFEAT).
 */
export const outcomeHeadline = (
  outcome: MatchOutcome,
  playerFleetId: number,
): string => {
  if (outcome.kind === 'victory') {
    return outcome.fleetId === playerFleetId ? 'VICTORY' : 'DEFEAT';
  }
  return 'MUTUAL DESTRUCTION';
};

/** The three tones the headline paints in — win (green), loss (red), mutual (violet). */
export type OutcomeTone = 'win' | 'loss' | 'mutual';

export const outcomeTone = (
  outcome: MatchOutcome,
  playerFleetId: number,
): OutcomeTone => {
  if (outcome.kind === 'mutual-destruction') return 'mutual';
  return outcome.fleetId === playerFleetId ? 'win' : 'loss';
};

// ---- Seed formatting (§4.11) ----------------------------------------------

const hex4 = (n: number): string =>
  (n & 0xffff).toString(16).toUpperCase().padStart(4, '0');

/**
 * Format a `(seedHi, seedLo)` uint32 pair into the `SK-XXXX-XXXX-XXXX` label —
 * three uint16 groups (high+low of `hi`, high of `lo`), byte-for-byte identical
 * to the controller's `seedLabel` so the screen can fall back to this when a
 * label is not handed in. Deterministic: the same seed always formats the same.
 */
export const formatSeed = (seedHi: number, seedLo: number): string =>
  `SK-${hex4(seedHi >>> 16)}-${hex4(seedHi)}-${hex4(seedLo >>> 16)}`;

// ---- Per-ship fates -------------------------------------------------------

export type ShipFate = 'alive' | 'destroyed';

/** One ship's fate row for the FLEETS & FATES table. */
export interface FateRow {
  readonly bodyId: BodyId;
  readonly name: string;
  readonly chassisClass: ChassisClass;
  readonly fate: ShipFate;
  /** Cause of death, or `null` when the ship survived (or a cause was unrecorded). */
  readonly cause: DamageSourceKind | null;
  readonly hull: number;
  readonly maxHull: number;
  readonly shields: number;
  readonly shieldCapacity: number;
}

/** One fleet's panel of fate rows plus its survivor tally. */
export interface FleetFates {
  readonly fleetId: number;
  readonly rows: readonly FateRow[];
  readonly survivors: number;
  readonly total: number;
}

interface AssignedShip {
  readonly bodyId: BodyId;
  readonly fleetId: number;
  readonly ship: SimShip;
}

/**
 * Reconstruct the `BodyId` every starting ship was assigned. `buildInitialState`
 * hands out ship ids `1..N` in flat `(fleet, ship)` order across the fleet array
 * it received — this replicates that exact walk over the SAME `initialFleets`
 * array, so a dead ship (whose `DestructionEvent` carries only a `bodyId`) can be
 * named from the immutable roster. Survivors are cross-checked directly against
 * `finalState.ships` by their id, so only casualties depend on this mapping.
 */
const assignBodyIds = (fleets: readonly SimFleet[]): readonly AssignedShip[] => {
  const out: AssignedShip[] = [];
  let nextId = 1;
  for (const fleet of fleets) {
    for (const ship of fleet.ships) {
      out.push({ bodyId: nextId, fleetId: fleet.fleetId, ship });
      nextId += 1;
    }
  }
  return out;
};

/** Every ship destruction across the whole match, keyed by body id (first wins). */
const destroyedByBody = (
  trace: ResolutionTrace,
): ReadonlyMap<BodyId, DestructionEvent> => {
  const map = new Map<BodyId, DestructionEvent>();
  for (const turn of trace.turns) {
    for (const ev of turn.movement.destroyed) {
      if (!map.has(ev.bodyId)) map.set(ev.bodyId, ev);
    }
    for (const ev of turn.attack.destroyed) {
      if (!map.has(ev.bodyId)) map.set(ev.bodyId, ev);
    }
  }
  return map;
};

/**
 * Cross every starting ship of every fleet against the final state (survivors)
 * and the trace's destruction events (casualties) → one `FateRow` per ship,
 * grouped by fleet in roster order. A ship present in `finalState.ships` is
 * ALIVE (its live hull/shields read straight off the survivor record); one that
 * is absent is DESTROYED, with its cause taken from the matching event.
 */
export const perShipFates = (
  finalState: MatchState,
  trace: ResolutionTrace,
  fleets: readonly SimFleet[],
): readonly FleetFates[] => {
  const assigned = assignBodyIds(fleets);
  const dead = destroyedByBody(trace);
  const byFleet = new Map<number, FateRow[]>();
  const fleetOrder: number[] = [];

  for (const a of assigned) {
    if (!byFleet.has(a.fleetId)) {
      byFleet.set(a.fleetId, []);
      fleetOrder.push(a.fleetId);
    }
    const survivor = finalState.ships.get(a.bodyId);
    const row: FateRow =
      survivor !== undefined
        ? {
            bodyId: a.bodyId,
            name: survivor.ship.name,
            chassisClass: survivor.ship.chassisClass,
            fate: 'alive',
            cause: null,
            hull: survivor.hull,
            maxHull: survivor.ship.maxHull,
            shields: survivor.shields,
            shieldCapacity: survivor.ship.shieldCapacity,
          }
        : {
            bodyId: a.bodyId,
            name: a.ship.name,
            chassisClass: a.ship.chassisClass,
            fate: 'destroyed',
            cause: dead.get(a.bodyId)?.cause ?? null,
            hull: 0,
            maxHull: a.ship.maxHull,
            shields: 0,
            shieldCapacity: a.ship.shieldCapacity,
          };
    byFleet.get(a.fleetId)!.push(row);
  }

  return fleetOrder.map((fleetId) => {
    const rows = byFleet.get(fleetId)!;
    const survivors = rows.filter((r) => r.fate === 'alive').length;
    return { fleetId, rows, survivors, total: rows.length };
  });
};

/** A `BodyId → ship name` lookup for the combat log (ships only; hazards fall back). */
export const nameByBodyId = (
  fleets: readonly SimFleet[],
): ReadonlyMap<BodyId, string> => {
  const map = new Map<BodyId, string>();
  for (const a of assignBodyIds(fleets)) map.set(a.bodyId, a.ship.name);
  return map;
};

// ---- Ship-focus predicates (S02 — combat-log "focus on my ship") ----------

/**
 * The BodyIds belonging to `playerFleetId` — the source of "my ships" for the
 * MINE focus in the combat-log filter (SESSION-02, D-LOG-FOCUS-DISPLAY-ONLY).
 * Bot bodies are excluded. Empty when the player fleet has no ships (shouldn't
 * happen in a real match; the set is still a valid empty filter).
 */
export const playerBodyIds = (
  fleets: readonly SimFleet[],
  playerFleetId: number,
): ReadonlySet<BodyId> => {
  const out = new Set<BodyId>();
  for (const a of assignBodyIds(fleets)) {
    if (a.fleetId === playerFleetId) out.add(a.bodyId);
  }
  return out;
};

/**
 * True when the entry's shooter OR target is in `ids`. The ship-focus filter's
 * one predicate: MINE matches when either end is a player ship, per-ship focus
 * matches when either end is THAT ship. Pure display filter — the underlying
 * `flattenCombatLog` sequence is never reordered (FR-28).
 */
export const logInvolves = (
  entry: CombatLogEntry,
  ids: ReadonlySet<BodyId>,
): boolean => ids.has(entry.sourceId) || ids.has(entry.targetId);

/** One entry in the ship-picker: a body, its ship name, and whether it's the player's. */
export interface ShipOption {
  readonly bodyId: BodyId;
  readonly name: string;
  readonly mine: boolean;
}

/**
 * Stable, ordered list for the combat-log ship picker: every starting ship
 * exactly once, PLAYER ships first (in roster order) then opponents (in fleet
 * then roster order). Names are pulled through `nameByBodyId` so the picker
 * and the log lines agree on the exact string a ship goes by.
 */
export const shipFocusOptions = (
  fleets: readonly SimFleet[],
  playerFleetId: number,
): readonly ShipOption[] => {
  const names = nameByBodyId(fleets);
  const mine: ShipOption[] = [];
  const others: ShipOption[] = [];
  for (const a of assignBodyIds(fleets)) {
    const opt: ShipOption = {
      bodyId: a.bodyId,
      name: names.get(a.bodyId) ?? a.ship.name,
      mine: a.fleetId === playerFleetId,
    };
    (opt.mine ? mine : others).push(opt);
  }
  return [...mine, ...others];
};

/** Human-readable cause labels for a destroyed ship's fate. */
export const CAUSE_LABEL: Readonly<Record<DamageSourceKind, string>> = {
  weapon: 'WEAPON FIRE',
  missile: 'MISSILE',
  collision: 'COLLISION',
  aoe: 'AOE BLAST',
  boundary: 'BOUNDARY EXIT',
};

/** The full fate label a row renders: `SURVIVED` or `DESTROYED · <cause>`. */
export const fateLabel = (row: FateRow): string => {
  if (row.fate === 'alive') return 'SURVIVED';
  return row.cause !== null ? `DESTROYED · ${CAUSE_LABEL[row.cause]}` : 'DESTROYED';
};

// ---- Combat log (FR-28) ---------------------------------------------------

/** The display kinds the log filter offers. One tag per entry (see `logKindOf`). */
export type LogKind =
  | 'SHOT'
  | 'CRIT'
  | 'MISSILE'
  | 'COLLISION'
  | 'KILL'
  | 'BOUNDARY'
  | 'INTERCEPT';

/** All kinds, in filter-chip order. The default filter set is every kind on. */
export const LOG_KINDS: readonly LogKind[] = [
  'SHOT',
  'CRIT',
  'MISSILE',
  'COLLISION',
  'KILL',
  'BOUNDARY',
  'INTERCEPT',
];

/**
 * Tag one `CombatLogEntry` with a single display kind. Result-derived kinds win
 * over source-derived ones (a killing shot reads as KILL, an intercept as
 * INTERCEPT) so the most salient fact wins the one available tag; otherwise the
 * damage source decides (an AoE blast shares the COLLISION lane — both are
 * ownership-blind physical impacts).
 */
export const logKindOf = (entry: CombatLogEntry): LogKind => {
  switch (entry.result) {
    case 'boundary-exit':
      return 'BOUNDARY';
    case 'intercept':
      return 'INTERCEPT';
    case 'kill':
      return 'KILL';
    case 'crit':
      return 'CRIT';
    default:
      break; // 'hit' | 'miss' → decide by source below
  }
  switch (entry.source) {
    case 'collision':
    case 'aoe':
      return 'COLLISION';
    case 'missile':
      return 'MISSILE';
    case 'boundary':
      return 'BOUNDARY';
    case 'weapon':
      return 'SHOT';
  }
};

/** One flattened log line: its ordinal position, display kind, and raw entry. */
export interface LogRow {
  readonly seq: number;
  readonly kind: LogKind;
  readonly entry: CombatLogEntry;
}

/**
 * Flatten the whole trace into ordered log rows: for each turn in order, the
 * movement beat's entries then the attack beat's entries (FR-28 — the log IS the
 * deterministic record, never reordered). Each row carries a stable `seq` so the
 * renderer keys rows without leaning on array identity.
 */
export const flattenCombatLog = (trace: ResolutionTrace): readonly LogRow[] => {
  const rows: LogRow[] = [];
  let seq = 0;
  for (const turn of trace.turns) {
    for (const entry of turn.movement.log) {
      rows.push({ seq, kind: logKindOf(entry), entry });
      seq += 1;
    }
    for (const entry of turn.attack.log) {
      rows.push({ seq, kind: logKindOf(entry), entry });
      seq += 1;
    }
  }
  return rows;
};
