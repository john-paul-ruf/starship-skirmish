// vec3 — algebraic identities. Tests live outside src/sim so `Math.*` is permitted here
// (the ban-list is scoped to src/sim + src/ai).

import { describe, it, expect } from 'vitest';
import {
  ZERO,
  UNIT_X,
  UNIT_Y,
  UNIT_Z,
  of,
  add,
  sub,
  scale,
  neg,
  dot,
  cross,
  length,
  lengthSq,
  normalize,
  lerp,
  distance,
  distanceSq,
  clampLength,
  equals,
  type Vec3,
} from '../../../src/sim/mathx/vec3.js';

const EPS = 1e-12;

const near = (a: number, b: number, eps = EPS): boolean => Math.abs(a - b) <= eps;

const vecNear = (a: Vec3, b: Vec3, eps = EPS): boolean =>
  near(a.x, b.x, eps) && near(a.y, b.y, eps) && near(a.z, b.z, eps);

describe('vec3 constructors and constants', () => {
  it('of() packs the three components', () => {
    expect(of(1, 2, 3)).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('constants are what they say they are', () => {
    expect(ZERO).toEqual({ x: 0, y: 0, z: 0 });
    expect(UNIT_X).toEqual({ x: 1, y: 0, z: 0 });
    expect(UNIT_Y).toEqual({ x: 0, y: 1, z: 0 });
    expect(UNIT_Z).toEqual({ x: 0, y: 0, z: 1 });
  });
});

describe('vec3 additive group', () => {
  it('add is commutative', () => {
    const a = of(1, 2, 3);
    const b = of(-4, 0.5, 7);
    expect(add(a, b)).toEqual(add(b, a));
  });

  it('add is associative', () => {
    const a = of(1, 2, 3);
    const b = of(4, 5, 6);
    const c = of(-1, -2, -3);
    expect(add(add(a, b), c)).toEqual(add(a, add(b, c)));
  });

  it('sub is the inverse of add (a + b - b == a)', () => {
    const a = of(1.5, -2.25, 3);
    const b = of(-0.5, 7, 11);
    expect(sub(add(a, b), b)).toEqual(a);
  });

  it('neg + add == ZERO', () => {
    const a = of(3, -4, 5);
    expect(add(a, neg(a))).toEqual(ZERO);
  });

  it('operations are pure (do not mutate inputs)', () => {
    const a = of(1, 2, 3);
    const b = of(4, 5, 6);
    add(a, b);
    sub(a, b);
    scale(a, 5);
    cross(a, b);
    normalize(a);
    clampLength(a, 1);
    expect(a).toEqual({ x: 1, y: 2, z: 3 });
    expect(b).toEqual({ x: 4, y: 5, z: 6 });
  });
});

describe('vec3 scaling', () => {
  it('scale distributes over add', () => {
    const a = of(1, 2, 3);
    const b = of(4, -5, 6);
    const k = 2.5;
    expect(vecNear(scale(add(a, b), k), add(scale(a, k), scale(b, k)))).toBe(true);
  });

  it('scaling by 0 yields the zero vector (magnitude 0)', () => {
    // IEEE-754: (-3) * 0 == -0, which is numerically 0 but a distinct bit pattern.
    // The sim never distinguishes +0 from -0 — asserting length is the meaningful check.
    const z = scale(of(7, -3, 42), 0);
    expect(z.x === 0).toBe(true);
    expect(z.y === 0).toBe(true);
    expect(z.z === 0).toBe(true);
  });

  it('scaling by 1 is identity', () => {
    const a = of(1.5, 2.5, -3.5);
    expect(scale(a, 1)).toEqual(a);
  });
});

describe('vec3 dot and cross', () => {
  it('dot is commutative', () => {
    const a = of(1, 2, 3);
    const b = of(-4, 5, 6);
    expect(dot(a, b)).toBe(dot(b, a));
  });

  it('dot with self equals lengthSq', () => {
    const a = of(3, 4, 12);
    expect(dot(a, a)).toBe(lengthSq(a));
  });

  it('cross(a, b) is anticommutative: cross(a,b) == -cross(b,a)', () => {
    const a = of(1, 2, 3);
    const b = of(4, -5, 6);
    const ab = cross(a, b);
    const ba = cross(b, a);
    expect(ab).toEqual(neg(ba));
  });

  it('cross(a, b) is perpendicular to a and to b', () => {
    const a = of(1, 2, 3);
    const b = of(-2, 5, 1.5);
    const c = cross(a, b);
    expect(near(dot(c, a), 0)).toBe(true);
    expect(near(dot(c, b), 0)).toBe(true);
  });

  it('cross of parallel vectors is ZERO', () => {
    const a = of(1, 2, 3);
    const b = scale(a, 4);
    expect(cross(a, b)).toEqual(ZERO);
  });

  it('unit basis: cross(x, y) == z', () => {
    expect(cross(UNIT_X, UNIT_Y)).toEqual(UNIT_Z);
    expect(cross(UNIT_Y, UNIT_Z)).toEqual(UNIT_X);
    expect(cross(UNIT_Z, UNIT_X)).toEqual(UNIT_Y);
  });
});

describe('vec3 length / normalize / distance', () => {
  it('length of (3,4,12) == 13', () => {
    expect(length(of(3, 4, 12))).toBe(13);
  });

  it('lengthSq matches length*length', () => {
    const a = of(1.5, -2, 4);
    expect(near(lengthSq(a), length(a) * length(a))).toBe(true);
  });

  it('normalize yields unit length', () => {
    const a = of(3, -4, 12);
    const n = normalize(a);
    expect(near(length(n), 1)).toBe(true);
  });

  it('normalize(ZERO) is ZERO (no NaN escapes)', () => {
    expect(normalize(ZERO)).toEqual(ZERO);
  });

  it('normalize preserves direction (n scaled by |a| ≈ a)', () => {
    const a = of(2, -6, 3);
    const n = normalize(a);
    expect(vecNear(scale(n, length(a)), a)).toBe(true);
  });

  it('distance is symmetric', () => {
    const a = of(1, 2, 3);
    const b = of(-4, 5, -6);
    expect(distance(a, b)).toBe(distance(b, a));
  });

  it('distance(a, b) == length(a - b)', () => {
    const a = of(1, 2, 3);
    const b = of(-4, 5, -6);
    expect(distance(a, b)).toBe(length(sub(a, b)));
  });

  it('distanceSq matches distance*distance', () => {
    const a = of(1, 2, 3);
    const b = of(4, -5, 6);
    expect(near(distanceSq(a, b), distance(a, b) * distance(a, b))).toBe(true);
  });
});

describe('vec3 lerp', () => {
  it('lerp(a, b, 0) == a', () => {
    const a = of(1, 2, 3);
    const b = of(9, -7, 4);
    expect(lerp(a, b, 0)).toEqual(a);
  });

  it('lerp(a, b, 1) == b', () => {
    const a = of(1, 2, 3);
    const b = of(9, -7, 4);
    expect(lerp(a, b, 1)).toEqual(b);
  });

  it('lerp(a, b, 0.5) == midpoint', () => {
    const a = of(0, 0, 0);
    const b = of(10, -4, 8);
    expect(lerp(a, b, 0.5)).toEqual({ x: 5, y: -2, z: 4 });
  });
});

describe('vec3 clampLength', () => {
  it('leaves shorter vectors alone', () => {
    const a = of(1, 2, 2); // length 3
    expect(clampLength(a, 10)).toEqual(a);
  });

  it('shortens longer vectors to exactly maxLen', () => {
    const a = of(3, 4, 12); // length 13
    const c = clampLength(a, 5);
    expect(near(length(c), 5)).toBe(true);
  });

  it('preserves direction when clamping', () => {
    const a = of(3, 4, 12);
    const c = clampLength(a, 5);
    // c and normalize(a) point the same way
    expect(vecNear(normalize(c), normalize(a))).toBe(true);
  });

  it('clampLength(ZERO, k) == ZERO', () => {
    expect(clampLength(ZERO, 5)).toEqual(ZERO);
  });

  it('non-positive maxLen collapses to ZERO', () => {
    expect(clampLength(of(1, 2, 3), 0)).toEqual(ZERO);
    expect(clampLength(of(1, 2, 3), -1)).toEqual(ZERO);
  });
});

describe('vec3 equals', () => {
  it('reflexive', () => {
    const a = of(1, 2, 3);
    expect(equals(a, a)).toBe(true);
  });

  it('structural equality independent of identity', () => {
    expect(equals(of(1, 2, 3), of(1, 2, 3))).toBe(true);
  });

  it('detects a difference in any component', () => {
    expect(equals(of(1, 2, 3), of(0, 2, 3))).toBe(false);
    expect(equals(of(1, 2, 3), of(1, 0, 3))).toBe(false);
    expect(equals(of(1, 2, 3), of(1, 2, 0))).toBe(false);
  });
});
