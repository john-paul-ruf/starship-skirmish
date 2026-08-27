// interp — pure keyframe interpolation for trace playback (arch §9).
//
// `MovementBeatRecord.keyframes` is a `Body[]` snapshot at every sub-step boundary
// (length = `subStepCount + 1`), uniform in sim-time. `lerpBodyAt` samples that
// recording at a normalized instant `tNorm ∈ [0,1]` and returns the interpolated
// bodies for that moment. This is the "preview must not lie" sibling: playback reads
// the sim's OWN keyframes — it never re-simulates.
//
// Deliberately three-free and side-effect-free so it unit-tests in the node env. The
// determinism ban-list is a `sim/**` rule, not a render rule — `Math` is fine here.

import type { Body, BodyId } from '../sim/index.js';
import type { Vec3 } from '../sim/index.js';

/**
 * One body sampled at an interpolated instant. Not a `Body`: it carries `alpha`, the
 * presence factor the renderer fades with. `alpha < 1` while a body spawns in
 * (debris appearing mid-beat) or is removed out (destroyed / boundary-exit mid-beat).
 */
export interface LerpedBody {
  readonly id: BodyId;
  readonly kind: Body['kind'];
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly radius: number;
  /** Presence 0..1 — 1 for a body live across the whole `[lo,hi]` span. */
  readonly alpha: number;
}

/** Clamp into `[0,1]`. */
export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Scalar linear interpolation. */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerpVec3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  z: lerp(a.z, b.z, t),
});

/**
 * Playback cadence easing — a symmetric ease so a movement resolve accelerates then
 * settles ("the beat lands with a thud", Gate 1 §0). Endpoints are fixed: `0→0`, `1→1`,
 * which is what keeps `skip` (jump to `tNorm=1`) outcome-identical to a full play.
 */
export const easeInOutQuad = (t: number): number => {
  const c = clamp01(t);
  if (c < 0.5) return 2 * c * c;
  const u = -2 * c + 2;
  return 1 - (u * u) / 2;
};

const present = (b: Body): LerpedBody => ({
  id: b.id,
  kind: b.kind,
  position: b.position,
  velocity: b.velocity,
  radius: b.radius,
  alpha: 1,
});

/**
 * Sample the keyframe recording at `tNorm ∈ [0,1]`.
 *
 * `f = tNorm · (n − 1)` is the fractional keyframe index; the two bracketing frames
 * `lo = ⌊f⌋` and `hi = min(lo+1, n−1)` are lerped by `frac = f − lo`, matched by
 * `BodyId`. A body present in `lo` but gone by `hi` fades OUT at its last position
 * (`alpha = 1 − frac`); a body appearing in `hi` fades IN (`alpha = frac`). Output is
 * sorted by id (render determinism, mirroring the sim's stable-id ordering).
 *
 * `tNorm = 0` returns frame 0 exactly; `tNorm = 1` returns the last frame exactly.
 */
export const lerpBodyAt = (
  keyframes: readonly (readonly Body[])[],
  tNorm: number,
): LerpedBody[] => {
  const n = keyframes.length;
  if (n === 0) return [];
  if (n === 1) return keyframes[0]!.map(present);

  const t = clamp01(tNorm);
  const f = t * (n - 1);
  let lo = Math.floor(f);
  if (lo > n - 1) lo = n - 1;
  const hi = Math.min(lo + 1, n - 1);
  const frac = f - lo;

  const loById = new Map<BodyId, Body>();
  for (const b of keyframes[lo]!) loById.set(b.id, b);
  const hiById = new Map<BodyId, Body>();
  for (const b of keyframes[hi]!) hiById.set(b.id, b);

  const ids = new Set<BodyId>();
  for (const b of keyframes[lo]!) ids.add(b.id);
  for (const b of keyframes[hi]!) ids.add(b.id);
  const sorted = Array.from(ids).sort((a, b) => a - b);

  const out: LerpedBody[] = [];
  for (const id of sorted) {
    const a = loById.get(id);
    const b = hiById.get(id);
    if (a !== undefined && b !== undefined) {
      out.push({
        id,
        kind: a.kind,
        position: lerpVec3(a.position, b.position, frac),
        velocity: lerpVec3(a.velocity, b.velocity, frac),
        radius: lerp(a.radius, b.radius, frac),
        alpha: 1,
      });
    } else if (a !== undefined) {
      // Present at `lo`, gone by `hi` — fade out at its last known position.
      out.push({
        id,
        kind: a.kind,
        position: a.position,
        velocity: a.velocity,
        radius: a.radius,
        alpha: 1 - frac,
      });
    } else if (b !== undefined && frac > 0) {
      // Appears at `hi` — fade in at its first-seen position. At `frac === 0` it is not
      // yet present (keeps `tNorm` on a keyframe boundary exactly equal to that frame).
      out.push({
        id,
        kind: b.kind,
        position: b.position,
        velocity: b.velocity,
        radius: b.radius,
        alpha: frac,
      });
    }
  }
  return out;
};
