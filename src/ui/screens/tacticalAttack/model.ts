// M14 UI — Tactical Attack pure assignment logic (S06, node-testable).
//
// The blind fire-assignment screen reduced to plain data the sibling `.tsx`
// panels render. Deliberately `.ts` (no JSX): the unit build (tsconfig.node)
// traverses transitive imports, so a screen `.tsx` pulled in here would break
// unit typecheck (TS6142). Everything sim is `import type` from the sim barrel —
// no sim VALUE enters the ui bundle — EXCEPT `distance`, imported straight from
// `sim/mathx` (ui→mathx is legal; the banned `sim/physics`+`sim/rules` are never
// reached). The hit-chance formula is NOT here: every % is single-sourced through
// the controller's `hitChanceFor` (arch §13.3). This file only decides WHICH
// shots exist, WHETHER a called shot is unlocked, and WHETHER an AoE clips a
// friendly — never a to-hit number.

import type {
  AttackPlan,
  BlindMatchView,
  BlindShipView,
  BodyId,
  CalledShotTarget,
  Vec3,
} from '../../../sim/index.js';
import { distance } from '../../../sim/mathx/index.js';

// ---- Assignments ----------------------------------------------------------

/**
 * One fire assignment the player has staged. A weapon assignment sets
 * `weaponIndex`; a missile launch sets `missileIndex` — exactly one, mirroring
 * `AttackPlan`. `calledShot` is staged optimistically and only survives to the
 * plan when the target's shields are down (see `toAttackPlans`).
 */
export interface Assignment {
  readonly shooterId: BodyId;
  readonly targetId: BodyId;
  readonly weaponIndex?: number;
  readonly missileIndex?: number;
  readonly calledShot?: CalledShotTarget;
}

/** A firing slot on a player ship — one live weapon or one loaded missile rack. */
export interface FireSlot {
  readonly shooterId: BodyId;
  readonly kind: 'weapon' | 'missile';
  readonly index: number;
}

/**
 * Stable key for a (shooter, slot) pair — the map key the screen assigns under,
 * so re-selecting a target on the same slot replaces rather than duplicates.
 */
export const slotKey = (slot: FireSlot): string =>
  `${String(slot.shooterId)}:${slot.kind[0]!}${String(slot.index)}`;

/**
 * The live firing slots of one ship: every intact weapon, plus every missile
 * rack that is both intact AND still has ammo (an empty rack cannot launch —
 * mock M2 HAMMERHEAD). Dead weapons and spent racks are excluded, not disabled.
 */
export const liveFireSlots = (ship: BlindShipView): FireSlot[] => {
  const slots: FireSlot[] = [];
  ship.weaponAlive.forEach((alive, i) => {
    if (alive) slots.push({ shooterId: ship.bodyId, kind: 'weapon', index: i });
  });
  ship.missileAlive.forEach((alive, i) => {
    if (alive && (ship.missileAmmo[i] ?? 0) > 0) {
      slots.push({ shooterId: ship.bodyId, kind: 'missile', index: i });
    }
  });
  return slots;
};

/** Total live firing slots across every supplied ship (the gate denominator). */
export const fireSlotTotal = (ships: readonly BlindShipView[]): number =>
  ships.reduce((n, s) => n + liveFireSlots(s).length, 0);

/** The `COMMIT FIRE · N/M ASSIGNED` gate: assigned vs total. */
export interface FireGate {
  readonly assigned: number;
  readonly total: number;
}

/**
 * Count staged assignments against the total live slots. An unassigned slot is
 * a legal choice (hold fire) — the gate only reports the count, it never forces
 * full assignment (§4.3).
 */
export const assignmentGate = (
  assignments: readonly Assignment[],
  playerShips: readonly BlindShipView[],
): FireGate => ({
  assigned: assignments.length,
  total: fireSlotTotal(playerShips),
});

// ---- Roster slicing -------------------------------------------------------

/** Living ships of the player's own fleet — the shooters (and AoE friendlies). */
export const friendlyShips = (
  view: BlindMatchView,
  selfFleetId: number,
): BlindShipView[] =>
  view.ships.filter((s) => s.fleetId === selfFleetId && s.hull > 0);

/** Living ships NOT in the player's fleet — the legal targets. */
export const enemyShips = (
  view: BlindMatchView,
  selfFleetId: number,
): BlindShipView[] =>
  view.ships.filter((s) => s.fleetId !== selfFleetId && s.hull > 0);

/** Look up a ship's plan-blind view by body id. */
export const shipViewOf = (
  view: BlindMatchView,
  id: BodyId,
): BlindShipView | undefined => view.ships.find((s) => s.bodyId === id);

/** A body's post-movement position, or undefined if it is gone. */
export const positionOf = (
  view: BlindMatchView,
  id: BodyId,
): Vec3 | undefined => view.bodies.find((b) => b.id === id)?.position;

// ---- Called-shot unlock (§4.5 / FR-25) ------------------------------------

/**
 * A called shot is legal ONLY while the target's shields are at zero (FR-25).
 * Read straight from the view — the same field the rules layer checks — so UI
 * and sim can never disagree.
 */
export const calledShotUnlocked = (target: BlindShipView): boolean =>
  target.shields === 0;

/** The §4.5 shield readout: HOLDING (locked) above zero, DOWN at zero. */
export const shieldReadout = (target: BlindShipView): string =>
  calledShotUnlocked(target)
    ? `SHIELDS 0/${String(target.shieldCapacity)} — DOWN`
    : `SHIELDS ${String(target.shields)}/${String(target.shieldCapacity)} — HOLDING · CALLED SHOTS LOCKED`;

/** Verbatim generator hint (§4.5) — the shield-generator option carries this. */
export const GENERATOR_HINT =
  'Killing the generator removes the pool permanently. It does not restore depleted shields.';

/**
 * One selectable subsystem in the called-shot picker. `target` is the exact
 * `CalledShotTarget` emitted if picked; `alive === false` renders struck-through
 * + red and is unselectable — everywhere, for all ships, no fog (Decision 6).
 * `hint` is set only on the shield generator.
 */
export interface SubsystemOption {
  readonly target: CalledShotTarget;
  readonly label: string;
  readonly alive: boolean;
  readonly hint?: string;
}

/**
 * The subsystem list for a target's `BlindShipView`: each weapon, each missile
 * rack, the shield generator, the engine, then the flat specials array (point
 * defence then decoys — the SAME layout `sim/rules.calledShot` indexes, so a
 * `special` index round-trips correctly).
 */
export const calledShotOptions = (t: BlindShipView): SubsystemOption[] => {
  const opts: SubsystemOption[] = [];
  t.weaponAlive.forEach((alive, i) =>
    opts.push({ target: { kind: 'weapon', index: i }, label: `W${String(i + 1)}`, alive }),
  );
  t.missileAlive.forEach((alive, i) =>
    opts.push({ target: { kind: 'missile', index: i }, label: `M${String(i + 1)}`, alive }),
  );
  opts.push({
    target: { kind: 'shield-generator' },
    label: 'SHIELD GENERATOR',
    alive: t.shieldGenAlive,
    hint: GENERATOR_HINT,
  });
  opts.push({ target: { kind: 'engine' }, label: 'ENGINE', alive: t.engineAlive });
  const pdCount = t.pdAlive.length;
  t.pdAlive.forEach((alive, k) =>
    opts.push({ target: { kind: 'special', index: k }, label: `PD${String(k + 1)}`, alive }),
  );
  t.decoyAlive.forEach((alive, k) =>
    opts.push({
      target: { kind: 'special', index: pdCount + k },
      label: `DECOY${String(k + 1)}`,
      alive,
    }),
  );
  return opts;
};

/** True when `a` names the same subsystem as `b` (kind + index). */
export const calledShotEquals = (
  a: CalledShotTarget | undefined,
  b: CalledShotTarget,
): boolean => {
  if (a === undefined || a.kind !== b.kind) return false;
  if ('index' in a && 'index' in b) return a.index === b.index;
  return true;
};

// ---- AoE friendly-fire geometry (§4.6 / FR-20) ----------------------------

/** One friendly caught inside a missile's blast radius. */
export interface AoeFriendlyHit {
  readonly friendly: BlindShipView;
  readonly distance: number;
}

/** A missile assignment whose blast overlaps one or more friendlies. */
export interface AoeOverlap {
  readonly shooter: BlindShipView;
  readonly target: BlindShipView | undefined;
  readonly aoeRadius: number;
  readonly hits: readonly AoeFriendlyHit[];
}

/**
 * Does this missile assignment's blast clip a friendly? Returns the overlap
 * detail (shooter, radius, the friendlies inside) when it does, else `null`.
 * Geometry only: a friendly (same fleet, living, not the shooter) whose
 * post-movement position is within `aoeRadius` of the target position (via
 * `mathx.distance`) is inside the blast. Weapon assignments and missiles with
 * no resolvable shooter/target return `null`. This WARNS — it never blocks
 * (§4.6): the caller renders a banner, commit stays enabled.
 */
export const aoeOverlapsFriendly = (
  assignment: Assignment,
  view: BlindMatchView,
): AoeOverlap | null => {
  if (assignment.missileIndex === undefined) return null;
  const shooter = shipViewOf(view, assignment.shooterId);
  if (shooter === undefined) return null;
  const rack = shooter.ship.missiles[assignment.missileIndex];
  if (rack === undefined) return null;
  const targetPos = positionOf(view, assignment.targetId);
  if (targetPos === undefined) return null;

  const hits: AoeFriendlyHit[] = [];
  for (const s of view.ships) {
    if (s.fleetId !== shooter.fleetId) continue;
    if (s.bodyId === shooter.bodyId) continue;
    if (s.hull <= 0) continue;
    const pos = positionOf(view, s.bodyId);
    if (pos === undefined) continue;
    const d = distance(pos, targetPos);
    if (d <= rack.aoeRadius) hits.push({ friendly: s, distance: d });
  }
  if (hits.length === 0) return null;
  return {
    shooter,
    target: shipViewOf(view, assignment.targetId),
    aoeRadius: rack.aoeRadius,
    hits,
  };
};

// ---- Plan emission --------------------------------------------------------

/**
 * Convert staged assignments to the `AttackPlan[]` the controller commits.
 * A `calledShot` survives ONLY when the target's shields are at zero (the rules
 * layer honours it only then anyway — but the UI must not offer a shot it will
 * silently drop). Exactly one of `weaponIndex` / `missileIndex` is carried
 * through, never both, never `undefined` keys.
 */
export const toAttackPlans = (
  assignments: readonly Assignment[],
  ships: readonly BlindShipView[],
): AttackPlan[] => {
  const shieldsById = new Map<BodyId, number>();
  for (const s of ships) shieldsById.set(s.bodyId, s.shields);
  return assignments.map((a) => {
    const unlocked = (shieldsById.get(a.targetId) ?? 1) === 0;
    return {
      shooterId: a.shooterId,
      targetId: a.targetId,
      ...(a.weaponIndex !== undefined ? { weaponIndex: a.weaponIndex } : {}),
      ...(a.missileIndex !== undefined ? { missileIndex: a.missileIndex } : {}),
      ...(a.calledShot !== undefined && unlocked ? { calledShot: a.calledShot } : {}),
    };
  });
};
