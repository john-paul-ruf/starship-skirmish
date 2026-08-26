// matchDigest — arithmetic-only hash of a MatchState (M10, S05's golden anchor).
//
// The determinism suite (S05, next feature) compares whole match states across
// runs by digest rather than deep-equal. Two runs of the same seed + same
// plans MUST produce the same MatchState down to floating-point bits; a
// stable, sensitive hash lets that reduce to one string comparison.
//
// This digest is the AUTHORITATIVE gate for the loop's determinism — the
// `traceDigest` in `sim/trace` is a convenience over the recorded trace, but
// the trace is downstream of state. If two states digest identically, every
// downstream trace does too; if they diverge, the digest is what tells us so.
//
// Scheme: FNV-1a-32 over a fixed canonical schedule of MatchState fields —
// ships sorted by BodyId, bodies sorted by BodyId, quantized floats through
// DataView / uint32 halves. `Math.imul` for bit-exact int32 multiplication
// (specified across engines, unlike `*` on numbers > 2³²). `DataView` with
// `littleEndian: true` pins the float64 → uint32 reinterpretation the same
// way on every engine. No transcendentals, no wall clock, no DOM — obeys the
// determinism ban-list by construction.
//
// Quantization: to catch REAL divergence but not noise beyond the sim's
// tolerance (~1e-9 per mathx/trig), positions and velocities are quantized to
// a fixed scale before hashing. Ship pools (hull, shields) are exact floats.

import type { Body, ChassisClass } from '../types.js';
import type { ShipCombat } from '../rules/index.js';
import type { MatchState } from './matchState.js';

const FNV_OFFSET = 0x811c9dc5 | 0;
const FNV_PRIME = 0x01000193 | 0;

/** Mix one uint32 into the running hash, one byte at a time (FNV-1a). */
const mixU32 = (h: number, value: number): number => {
  let acc = h >>> 0;
  const v = value >>> 0;
  acc = acc ^ (v & 0xff);
  acc = Math.imul(acc, FNV_PRIME);
  acc = acc ^ ((v >>> 8) & 0xff);
  acc = Math.imul(acc, FNV_PRIME);
  acc = acc ^ ((v >>> 16) & 0xff);
  acc = Math.imul(acc, FNV_PRIME);
  acc = acc ^ ((v >>> 24) & 0xff);
  acc = Math.imul(acc, FNV_PRIME);
  return acc >>> 0;
};

/** Mix a float64 by reading its IEEE-754 bit pattern as two uint32 halves. */
const makeFloatMixer = () => {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  return (h: number, v: number): number => {
    view.setFloat64(0, v, true);
    return mixU32(mixU32(h, view.getUint32(0, true)), view.getUint32(4, true));
  };
};

/** Chassis class → uint32 code, stable across TS refactors. */
const CLASS_CODE: Readonly<Record<ChassisClass, number>> = {
  fighter: 1,
  frigate: 2,
  cruiser: 3,
  'mega-destroyer': 4,
};

/** Body kind → uint32 code. */
const KIND_CODE: Readonly<Record<Body['kind'], number>> = {
  ship: 1,
  debris: 2,
  missile: 3,
};

/**
 * Quantization scale for positions and velocities. Positions are trunc'd to
 * `1e-3` world-unit precision; velocities to `1e-3` unit/turn. Rationale:
 * the sim's numeric tolerance (mathx/trig accuracy bounds + physics sub-step
 * stability) is ~1e-9; quantizing at 1e-3 catches every real divergence and
 * ignores anything under one-thousandth of a positional unit — well above
 * the ULP-scale noise floor and well below the game's smallest meaningful
 * length (a 5-unit debris radius).
 *
 * Chosen as a power-of-ten so the quantized values are exact floats — a
 * `Math.trunc(v * 1000)` is a spec-exact integer operation.
 *
 * PROMOTION SEAM (S05 will pin this): if the harness settles a different
 * tolerance, adjust here in one place. Never re-derive per call site.
 */
const POS_QUANT_SCALE = 1000;
const VEL_QUANT_SCALE = 1000;

const quantize = (v: number, scale: number): number =>
  Math.trunc(v * scale) / scale;

/**
 * Deterministic 8-character hex digest of a MatchState. Two states hash
 * identically iff their canonical serialisation matches: same ships (hull /
 * shields / alive flags / ammo, in ascending BodyId), same bodies
 * (position / velocity / mass / radius, quantized, in ascending BodyId),
 * same turn, same nextBodyId. Guidances and debrisAge maps are folded in
 * too — a match with a live missile has different downstream than one
 * without.
 */
export const matchDigest = (state: MatchState): string => {
  const mixF = makeFloatMixer();

  const mixVec = (h: number, x: number, y: number, z: number): number =>
    mixF(mixF(mixF(h, x), y), z);

  const mixShip = (h: number, sc: ShipCombat): number => {
    let acc = mixU32(h, sc.bodyId);
    acc = mixU32(acc, CLASS_CODE[sc.ship.chassisClass]);
    acc = mixF(acc, sc.hull);
    acc = mixF(acc, sc.shields);
    acc = mixU32(acc, sc.shieldGenAlive ? 1 : 0);
    acc = mixU32(acc, sc.engineAlive ? 1 : 0);
    acc = mixU32(acc, sc.weaponAlive.length);
    for (let i = 0; i < sc.weaponAlive.length; i += 1) {
      acc = mixU32(acc, sc.weaponAlive[i]! ? 1 : 0);
    }
    acc = mixU32(acc, sc.missileAlive.length);
    for (let i = 0; i < sc.missileAlive.length; i += 1) {
      acc = mixU32(acc, sc.missileAlive[i]! ? 1 : 0);
      acc = mixU32(acc, sc.missileAmmo[i]! >>> 0);
    }
    acc = mixU32(acc, sc.pdAlive.length);
    for (let i = 0; i < sc.pdAlive.length; i += 1) {
      acc = mixU32(acc, sc.pdAlive[i]! ? 1 : 0);
    }
    acc = mixU32(acc, sc.decoyAlive.length);
    for (let i = 0; i < sc.decoyAlive.length; i += 1) {
      acc = mixU32(acc, sc.decoyAlive[i]! ? 1 : 0);
      acc = mixU32(acc, sc.decoyCharges[i]! >>> 0);
    }
    acc = mixU32(acc, sc.decoyActiveUntilTurn >>> 0);
    acc = mixF(acc, sc.componentIntegrity.shieldGenerator);
    acc = mixF(acc, sc.componentIntegrity.engine);
    for (let i = 0; i < sc.componentIntegrity.weapons.length; i += 1) {
      acc = mixF(acc, sc.componentIntegrity.weapons[i]!);
    }
    for (let i = 0; i < sc.componentIntegrity.missiles.length; i += 1) {
      acc = mixF(acc, sc.componentIntegrity.missiles[i]!);
    }
    for (let i = 0; i < sc.componentIntegrity.specials.length; i += 1) {
      acc = mixF(acc, sc.componentIntegrity.specials[i]!);
    }
    return acc;
  };

  const mixBody = (h: number, b: Body): number => {
    let acc = mixU32(h, b.id);
    acc = mixU32(acc, KIND_CODE[b.kind]);
    acc = mixVec(
      acc,
      quantize(b.position.x, POS_QUANT_SCALE),
      quantize(b.position.y, POS_QUANT_SCALE),
      quantize(b.position.z, POS_QUANT_SCALE),
    );
    acc = mixVec(
      acc,
      quantize(b.velocity.x, VEL_QUANT_SCALE),
      quantize(b.velocity.y, VEL_QUANT_SCALE),
      quantize(b.velocity.z, VEL_QUANT_SCALE),
    );
    acc = mixF(acc, b.mass);
    acc = mixF(acc, b.radius);
    return acc;
  };

  let acc = FNV_OFFSET >>> 0;
  acc = mixU32(acc, state.seed.hi);
  acc = mixU32(acc, state.seed.lo);
  acc = mixU32(acc, state.turn >>> 0);
  acc = mixU32(acc, state.nextBodyId >>> 0);

  // Ships in ascending BodyId.
  const shipIds = Array.from(state.ships.keys()).sort((a, b) => a - b);
  acc = mixU32(acc, shipIds.length);
  for (let i = 0; i < shipIds.length; i += 1) {
    acc = mixShip(acc, state.ships.get(shipIds[i]!)!);
  }

  // Bodies in ascending BodyId.
  const bodyIds = Array.from(state.bodies.keys()).sort((a, b) => a - b);
  acc = mixU32(acc, bodyIds.length);
  for (let i = 0; i < bodyIds.length; i += 1) {
    acc = mixBody(acc, state.bodies.get(bodyIds[i]!)!);
  }

  // Guidances in ascending bodyId — presence of a live missile matters.
  const guidanceIds = Array.from(state.guidances.keys()).sort((a, b) => a - b);
  acc = mixU32(acc, guidanceIds.length);
  for (let i = 0; i < guidanceIds.length; i += 1) {
    const g = state.guidances.get(guidanceIds[i]!)!;
    acc = mixU32(acc, g.bodyId);
    acc = mixU32(acc, g.targetId);
    acc = mixU32(acc, g.trackingBeatsLeft >>> 0);
    acc = mixF(acc, g.rackDamage);
    acc = mixF(acc, g.aoeRadius);
    acc = mixF(acc, g.trackingTurnRate);
  }

  // Debris ages in ascending id.
  const debrisIds = Array.from(state.debrisAge.keys()).sort((a, b) => a - b);
  acc = mixU32(acc, debrisIds.length);
  for (let i = 0; i < debrisIds.length; i += 1) {
    const id = debrisIds[i]!;
    acc = mixU32(acc, id);
    acc = mixU32(acc, state.debrisAge.get(id)! >>> 0);
  }

  const hex = (acc >>> 0).toString(16);
  return '00000000'.slice(hex.length) + hex;
};
