// M14 UI — shared roster/inspector model (skirmish-tactical-parity SESSION-02).
//
// A pure `.ts` file so vitest's node env can exercise the grouping / pip
// derivation without touching JSX or the DOM (the sibling `.tsx` panels wrap
// this data for the two tactical screens). No `sim/physics` / `sim/rules`
// import (`ui` boundary rule); every sim symbol below is a TYPE — `import type`
// — so no sim VALUE enters the ui bundle.
//
// What lives here:
//   • `pipsFor` — one binary pip per intact/destroyed subsystem on a
//     `BlindShipView`. Binary is deliberate (`blindView.ts`: a subsystem's HP
//     pool is opaque — you know it is alive or dead). Labels are index-based
//     (`W1`, `M2`, `SHLD`, `ENG` …) because the sim carries no per-component
//     product names.
//   • `isAlive` — a `hull > 0` check. `BlindMatchView.ships` culls destroyed
//     ships in practice; the model is still defensive so a hull-0 view coming
//     through mid-tick renders struck-through rather than dropping silently.
//   • `groupByFleet` — the deterministic grouping the FR-15 all-fleets roster
//     needs: player fleet first, then bots ascending by `fleetId`; within a
//     fleet, entries ascending by `bodyId` (mirrors `BlindMatchView.ships`
//     sort — never `Object.keys` / insertion order / `Set` iteration).

import { FLEET_META, type FleetId } from '../identity.js';

import type { BlindShipView, ChassisClass } from '../../../sim/index.js';

// ---- Pip vocabulary -------------------------------------------------------

/**
 * A subsystem's status. Binary by design: `blindView.ts` exposes only
 * `weaponAlive[i]` / `missileAlive[i]` / `shieldGenAlive` / `engineAlive` /
 * `pdAlive[i]` / `decoyAlive[i]` — no HP number — so there is no truthful
 * `damaged` tier to invent. If the sim ever surfaces per-component integrity,
 * an added state joins here rather than a caller widening `state`.
 */
export type PipState = 'online' | 'destroyed';

/** The subsystem kinds the roster surfaces. Order in `pipsFor` is stable:
 *  weapons → shields → missiles → pd → decoys → engine (mirrors the mock and
 *  the never-color-alone precedent that `SHLD` / `ENG` are aggregate slots). */
export type PipKind = 'weapon' | 'shield' | 'missile' | 'engine' | 'pd' | 'decoy';

/**
 * One pip on a ship's status strip. `label` is the aria/text glyph — filled
 * from `PIP_KIND_META` — so the pip reads without the color channel (FR-13 /
 * NFR-A11y): a colorblind player still sees `W1 · online` vs `W1 · destroyed`.
 */
export interface ShipPip {
  readonly kind: PipKind;
  readonly index: number;
  readonly label: string;
  readonly state: PipState;
}

/** Prefix + whether the kind is aggregate (SHLD / ENG carry no number). */
interface PipKindMeta {
  readonly prefix: string;
  /** Aggregate slots (`SHLD`, `ENG`) skip the numeric suffix. */
  readonly numbered: boolean;
}

const PIP_KIND_META: Readonly<Record<PipKind, PipKindMeta>> = {
  weapon: { prefix: 'W', numbered: true },
  shield: { prefix: 'SHLD', numbered: false },
  missile: { prefix: 'M', numbered: true },
  pd: { prefix: 'PD', numbered: true },
  decoy: { prefix: 'DECOY', numbered: true },
  engine: { prefix: 'ENG', numbered: false },
};

const pipLabel = (kind: PipKind, index: number): string => {
  const meta = PIP_KIND_META[kind];
  return meta.numbered ? `${meta.prefix}${String(index + 1)}` : meta.prefix;
};

const pipState = (alive: boolean): PipState => (alive ? 'online' : 'destroyed');

// ---- pipsFor / isAlive ----------------------------------------------------

/**
 * Derive one binary pip per intact/destroyed subsystem on the supplied view.
 * Stable order: weapons → shields → missiles → pd → decoys → engine. Absent
 * slots (a fighter with no missile bay) drop out rather than rendering empty.
 */
export const pipsFor = (s: BlindShipView): ShipPip[] => {
  const pips: ShipPip[] = [];
  for (let i = 0; i < s.weaponAlive.length; i += 1) {
    pips.push({
      kind: 'weapon',
      index: i,
      label: pipLabel('weapon', i),
      state: pipState(s.weaponAlive[i] === true),
    });
  }
  pips.push({
    kind: 'shield',
    index: 0,
    label: pipLabel('shield', 0),
    state: pipState(s.shieldGenAlive),
  });
  for (let i = 0; i < s.missileAlive.length; i += 1) {
    pips.push({
      kind: 'missile',
      index: i,
      label: pipLabel('missile', i),
      state: pipState(s.missileAlive[i] === true),
    });
  }
  for (let i = 0; i < s.pdAlive.length; i += 1) {
    pips.push({
      kind: 'pd',
      index: i,
      label: pipLabel('pd', i),
      state: pipState(s.pdAlive[i] === true),
    });
  }
  for (let i = 0; i < s.decoyAlive.length; i += 1) {
    pips.push({
      kind: 'decoy',
      index: i,
      label: pipLabel('decoy', i),
      state: pipState(s.decoyAlive[i] === true),
    });
  }
  pips.push({
    kind: 'engine',
    index: 0,
    label: pipLabel('engine', 0),
    state: pipState(s.engineAlive),
  });
  return pips;
};

/** True while the ship still has hull. Destroyed ships are kept in the roster
 *  struck-through rather than dropping out (mock `.row.is-dead`). */
export const isAlive = (s: BlindShipView): boolean => s.hull > 0;

// ---- Roster entry / fleet group -------------------------------------------

/** One row of the shared roster — the exact shape both tactical screens read. */
export interface RosterEntry {
  readonly bodyId: number;
  readonly fleetId: number;
  readonly name: string;
  readonly chassisClass: ChassisClass;
  readonly alive: boolean;
  readonly hull: number;
  readonly maxHull: number;
  readonly shields: number;
  readonly shieldCapacity: number;
  readonly pips: readonly ShipPip[];
  /** The originating view — screens read `ship`/velocity/ammo for the inspector. */
  readonly view: BlindShipView;
}

/**
 * One fleet as a section — `label` comes from `identity.ts`'s FLEET_META for
 * canonical fleet ids (0..4), fallback `FLEET N` for anything higher. `isPlayer`
 * drives the "YOU" section styling; `entries` inherits the sim-side `bodyId`
 * sort (deterministic — never insertion order).
 */
export interface FleetGroup {
  readonly fleetId: number;
  readonly isPlayer: boolean;
  readonly label: string;
  readonly entries: readonly RosterEntry[];
}

const isFleetIdInMeta = (id: number): id is FleetId => id === 0 || id === 1 || id === 2 || id === 3 || id === 4;

/** Public fleet label — reused by callers rendering per-group headers so the
 *  never-color-alone "YOU / BOT-0N" vocabulary lives in exactly one place. */
export const fleetLabel = (fleetId: number): string =>
  isFleetIdInMeta(fleetId) ? FLEET_META[fleetId].label : `FLEET ${String(fleetId)}`;

const toEntry = (s: BlindShipView): RosterEntry => ({
  bodyId: s.bodyId,
  fleetId: s.fleetId,
  name: s.name,
  chassisClass: s.chassisClass,
  alive: isAlive(s),
  hull: s.hull,
  maxHull: s.maxHull,
  shields: s.shields,
  shieldCapacity: s.shieldCapacity,
  pips: pipsFor(s),
  view: s,
});

/**
 * Group ships into per-fleet sections in canonical roster order:
 *   1. player fleet first,
 *   2. bots ascending by `fleetId`,
 *   3. entries within a fleet ascending by `bodyId`.
 *
 * The `BlindMatchView.ships` slice is already sorted by `bodyId`; this function
 * re-sorts by (fleetKey, bodyId) so a caller passing an un-sorted subset still
 * lands deterministic output. Empty fleets fall out (no header without ships).
 */
export const groupByFleet = (
  ships: readonly BlindShipView[],
  playerFleetId: number,
): FleetGroup[] => {
  const byFleet = new Map<number, BlindShipView[]>();
  for (const s of ships) {
    const list = byFleet.get(s.fleetId);
    if (list === undefined) byFleet.set(s.fleetId, [s]);
    else list.push(s);
  }
  const fleetIds: number[] = [];
  for (const id of byFleet.keys()) fleetIds.push(id);
  fleetIds.sort((a, b) => {
    if (a === playerFleetId) return b === playerFleetId ? 0 : -1;
    if (b === playerFleetId) return 1;
    return a - b;
  });
  const groups: FleetGroup[] = [];
  for (const fleetId of fleetIds) {
    const bucket = byFleet.get(fleetId);
    if (bucket === undefined || bucket.length === 0) continue;
    const sorted = bucket.slice().sort((a, b) => a.bodyId - b.bodyId);
    const entries: RosterEntry[] = [];
    for (const s of sorted) entries.push(toEntry(s));
    groups.push({
      fleetId,
      isPlayer: fleetId === playerFleetId,
      label: fleetLabel(fleetId),
      entries,
    });
  }
  return groups;
};
