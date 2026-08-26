// combatState — mutable per-ship combat state (M09).
//
// `SimShip` is the immutable resolved profile the sim consumes; it carries no per-turn
// combat data (no hull count in flight, no ammo remaining, no per-slot alive flags).
// That mutable state lives HERE, in a plain struct the loop threads through a match.
//
// Called-shot "component integrity" is a rules concept — D-INTEGRITY in STATE.md
// (SESSION-02). `SimShip` never minted per-component HP; the pools below are seeded
// once at match start from a per-slot-type base × chassis-class scale, subtract weapon
// damage on a called shot, and drive the FR-25 knockout effects (generator ⇒ shields
// pinned to 0, engine ⇒ coast, weapon/missile/special ⇒ subsystem removed).
//
// Promotion seam (D-INTEGRITY): if per-component durability becomes a real fitting
// trade in v1.x, `BASE_INTEGRITY` and `CLASS_INTEGRITY_MULT` graduate to catalog
// component stats + per-class chassis stats. Until then they live here as named
// module constants — see the marker comment below.

import type { BodyId, ChassisClass, DamageSourceKind, SimShip } from '../types.js';

// ---- D-INTEGRITY (design default, harness-tunable) ----------------------------------
// Base component integrity by slot type. First-pass values expected to be re-tuned
// against the F5 harness. PROMOTION SEAM: when durability becomes a fitting trade,
// move these to catalog component stats (v1.x). Do NOT invent a catalog field yet
// (SESSION-02 envelope — the point of this default is that the schema stays negative).
export const BASE_INTEGRITY = {
  weapon: 30,
  missile: 30,
  special: 25,
  shieldGenerator: 40,
  engine: 45,
} as const;

// Per-class integrity multiplier — a fighter's weapon dies faster than a mega-destroyer's.
// PROMOTION SEAM: paired with BASE_INTEGRITY, moves to catalog when component durability
// becomes a fitting trade.
export const CLASS_INTEGRITY_MULT: Readonly<Record<ChassisClass, number>> = {
  fighter: 0.6,
  frigate: 1.0,
  cruiser: 1.5,
  'mega-destroyer': 2.2,
};

/**
 * One accrued damage instance, keyed for order-independent summation. Rules stage
 * these into a `Map<BodyId, Damage[]>` during attack resolution; each target's array
 * is sorted by `(sourceId, shotIndex)` before being summed (architecture §7.3 rule 2 —
 * float addition is not associative, so the sort is load-bearing).
 */
export interface Damage {
  readonly sourceId: BodyId;
  /** Stable tiebreak within a shooter (weapon shot index, missile index, aoe seq …). */
  readonly shotIndex: number;
  readonly amount: number;
  readonly source: DamageSourceKind;
}

/**
 * Component integrity pools for a ship. `specials` is a single flat array in the
 * canonical order `[pointDefense[0..], decoys[0..]]` — the resolver below is the
 * single source of truth for that layout. The UI, when generating a
 * `CalledShotTarget.special`, must use the same layout via `specialLayout`.
 */
export interface ComponentIntegrity {
  weapons: number[];
  missiles: number[];
  specials: number[];
  shieldGenerator: number;
  engine: number;
}

/**
 * Where a `special.index` points inside `SimShip`. `pd` covers point-defense; `decoy`
 * covers the decoy launcher. Rules-internal — the loop treats specials opaquely.
 */
export type SpecialSubsystemKind = 'pd' | 'decoy';

export interface SpecialSubsystemRef {
  readonly kind: SpecialSubsystemKind;
  /** Index into `SimShip.pointDefense` or `SimShip.decoys` respectively. */
  readonly subIndex: number;
}

/**
 * Canonical mapping from a flat `special.index` to which subsystem array it addresses.
 * PD slots come first, then decoys, in `SimShip` iteration order. Total length equals
 * `pd.length + decoys.length`; an out-of-range index returns `null`.
 */
export const specialLayout = (
  ship: SimShip,
  index: number,
): SpecialSubsystemRef | null => {
  if (index < 0) return null;
  const pdLen = ship.pointDefense.length;
  if (index < pdLen) return { kind: 'pd', subIndex: index };
  const decoyIndex = index - pdLen;
  if (decoyIndex < ship.decoys.length) {
    return { kind: 'decoy', subIndex: decoyIndex };
  }
  return null;
};

/**
 * Mutable per-ship combat state the loop threads through a match. Constructed once
 * at match start from the immutable `SimShip`. Slot-indexed alive flags mirror the
 * `SimShip` arrays; ammo/decoyCharges start at rack/launcher totals.
 */
export interface ShipCombat {
  readonly bodyId: BodyId;
  readonly ship: SimShip;
  hull: number;
  shields: number;
  shieldGenAlive: boolean;
  engineAlive: boolean;
  weaponAlive: boolean[];
  missileAlive: boolean[];
  missileAmmo: number[];
  pdAlive: boolean[];
  decoyAlive: boolean[];
  decoyCharges: number[];
  /** 0 = inactive; otherwise the decoy's evasion bonus applies through this turn. */
  decoyActiveUntilTurn: number;
  componentIntegrity: ComponentIntegrity;
}

const integrityFor = (
  base: number,
  chassisClass: ChassisClass,
): number => base * CLASS_INTEGRITY_MULT[chassisClass];

const fillArray = (n: number, value: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) out.push(value);
  return out;
};

const fillBool = (n: number, value: boolean): boolean[] => {
  const out: boolean[] = [];
  for (let i = 0; i < n; i += 1) out.push(value);
  return out;
};

/**
 * Seed a fresh `ShipCombat` from a `SimShip` + assigned `BodyId`. Every subsystem
 * starts alive; hull/shields at max; ammo/decoyCharges at rack totals; integrity
 * pools scaled per-slot × per-class (D-INTEGRITY).
 */
export const newShipCombat = (
  ship: SimShip,
  bodyId: BodyId,
): ShipCombat => {
  const c = ship.chassisClass;
  const weapons = fillArray(
    ship.weapons.length,
    integrityFor(BASE_INTEGRITY.weapon, c),
  );
  const missiles = fillArray(
    ship.missiles.length,
    integrityFor(BASE_INTEGRITY.missile, c),
  );
  const specialsLen = ship.pointDefense.length + ship.decoys.length;
  const specials = fillArray(specialsLen, integrityFor(BASE_INTEGRITY.special, c));
  return {
    bodyId,
    ship,
    hull: ship.maxHull,
    shields: ship.shieldCapacity,
    shieldGenAlive: true,
    engineAlive: true,
    weaponAlive: fillBool(ship.weapons.length, true),
    missileAlive: fillBool(ship.missiles.length, true),
    missileAmmo: ship.missiles.map((r) => r.ammo),
    pdAlive: fillBool(ship.pointDefense.length, true),
    decoyAlive: fillBool(ship.decoys.length, true),
    decoyCharges: ship.decoys.map((d) => d.charges),
    decoyActiveUntilTurn: 0,
    componentIntegrity: {
      weapons,
      missiles,
      specials,
      shieldGenerator: integrityFor(BASE_INTEGRITY.shieldGenerator, c),
      engine: integrityFor(BASE_INTEGRITY.engine, c),
    },
  };
};

/**
 * Return a shallow-cloned `ShipCombat` — the arrays inside `componentIntegrity` and the
 * alive/ammo arrays are also copied so a mutation on the clone can't leak into the
 * source. Used by the pure damage/shield/called-shot appliers below to preserve the
 * "no in-place mutation of a snapshot" discipline (architecture §7.3 rule 3).
 */
export const cloneShipCombat = (sc: ShipCombat): ShipCombat => ({
  bodyId: sc.bodyId,
  ship: sc.ship,
  hull: sc.hull,
  shields: sc.shields,
  shieldGenAlive: sc.shieldGenAlive,
  engineAlive: sc.engineAlive,
  weaponAlive: sc.weaponAlive.slice(),
  missileAlive: sc.missileAlive.slice(),
  missileAmmo: sc.missileAmmo.slice(),
  pdAlive: sc.pdAlive.slice(),
  decoyAlive: sc.decoyAlive.slice(),
  decoyCharges: sc.decoyCharges.slice(),
  decoyActiveUntilTurn: sc.decoyActiveUntilTurn,
  componentIntegrity: {
    weapons: sc.componentIntegrity.weapons.slice(),
    missiles: sc.componentIntegrity.missiles.slice(),
    specials: sc.componentIntegrity.specials.slice(),
    shieldGenerator: sc.componentIntegrity.shieldGenerator,
    engine: sc.componentIntegrity.engine,
  },
});
