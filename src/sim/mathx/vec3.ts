// Vec3 — deterministic 3D vector algebra for the sim core (architecture §7.1, §7.3).
//
// Every operation is pure (no in-place mutation) and uses only IEEE-754 `+ - * /` and
// `Math.sqrt` — the four operators plus sqrt are the only float ops specified bit-for-bit
// across V8/SpiderMonkey/JSC. `Vec3` is a readonly plain-number record; no `Float32Array`,
// no mixed widths — mixing widths invites accidental precision divergence (§7.1).

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
export const UNIT_X: Vec3 = { x: 1, y: 0, z: 0 };
export const UNIT_Y: Vec3 = { x: 0, y: 1, z: 0 };
export const UNIT_Z: Vec3 = { x: 0, y: 0, z: 1 };

export const of = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const add = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});

export const sub = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});

export const scale = (a: Vec3, s: number): Vec3 => ({
  x: a.x * s,
  y: a.y * s,
  z: a.z * s,
});

export const neg = (a: Vec3): Vec3 => ({ x: -a.x, y: -a.y, z: -a.z });

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

export const lengthSq = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z;

export const length = (a: Vec3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);

/**
 * Return a unit-length copy of `a`. A zero vector returns `ZERO` (no NaNs escape into the
 * sim). Callers that need to react to the degenerate case should check `lengthSq(a) === 0`
 * before calling.
 */
export const normalize = (a: Vec3): Vec3 => {
  const lenSq = a.x * a.x + a.y * a.y + a.z * a.z;
  if (lenSq === 0) return ZERO;
  const inv = 1 / Math.sqrt(lenSq);
  return { x: a.x * inv, y: a.y * inv, z: a.z * inv };
};

export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

export const distanceSq = (a: Vec3, b: Vec3): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
};

export const distance = (a: Vec3, b: Vec3): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

/**
 * Return `a` clamped to at most `maxLen` in magnitude. Used by physics for delta-V
 * budgeting: a thruster produces at most its rated impulse regardless of how the
 * planner asks for it. A zero vector returns `ZERO`; a negative `maxLen` returns `ZERO`.
 */
export const clampLength = (a: Vec3, maxLen: number): Vec3 => {
  if (maxLen <= 0) return ZERO;
  const lenSq = a.x * a.x + a.y * a.y + a.z * a.z;
  if (lenSq <= maxLen * maxLen) return { x: a.x, y: a.y, z: a.z };
  const inv = maxLen / Math.sqrt(lenSq);
  return { x: a.x * inv, y: a.y * inv, z: a.z * inv };
};

export const equals = (a: Vec3, b: Vec3): boolean => a.x === b.x && a.y === b.y && a.z === b.z;
