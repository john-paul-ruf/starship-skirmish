// trig — error-bound assertions vs Math.* reference. Test files live outside src/sim,
// so `Math.sin` / `Math.cos` / `Math.atan2` are permitted here as oracles.
//
// The point is not bit-equality with Math — it's a KNOWN, BOUNDED, STABLE approximation
// whose bound is asserted in-test so a regression that widens the error fails CI.

import { describe, it, expect } from 'vitest';
import {
  PI,
  TAU,
  HALF_PI,
  QUARTER_PI,
  DEG_TO_RAD,
  RAD_TO_DEG,
  sin,
  cos,
  atan2,
  powi,
  powHalf,
  dirFromBearingPitch,
} from '../../../src/sim/mathx/trig.js';
import { length } from '../../../src/sim/mathx/vec3.js';

const SIN_COS_MAX_ERROR = 1e-9;
const ATAN2_MAX_ERROR = 1e-6;

describe('trig constants', () => {
  it('PI, TAU, HALF_PI, QUARTER_PI have their expected values', () => {
    expect(PI).toBe(Math.PI);
    expect(TAU).toBe(2 * Math.PI);
    expect(HALF_PI).toBe(Math.PI / 2);
    expect(QUARTER_PI).toBe(Math.PI / 4);
  });

  it('DEG_TO_RAD and RAD_TO_DEG round-trip', () => {
    const cases = [0, 45, 90, 137, 180, 270, 360, -30];
    for (const d of cases) {
      expect(Math.abs(d * DEG_TO_RAD * RAD_TO_DEG - d)).toBeLessThan(1e-12);
    }
  });
});

describe('sin / cos — spot checks at critical angles', () => {
  it('sin(0), sin(π), sin(2π) ≈ 0', () => {
    expect(Math.abs(sin(0))).toBeLessThan(SIN_COS_MAX_ERROR);
    expect(Math.abs(sin(PI))).toBeLessThan(SIN_COS_MAX_ERROR);
    expect(Math.abs(sin(TAU))).toBeLessThan(SIN_COS_MAX_ERROR);
  });

  it('sin(π/2) ≈ 1, sin(-π/2) ≈ -1', () => {
    expect(Math.abs(sin(HALF_PI) - 1)).toBeLessThan(SIN_COS_MAX_ERROR);
    expect(Math.abs(sin(-HALF_PI) + 1)).toBeLessThan(SIN_COS_MAX_ERROR);
  });

  it('cos(0) ≈ 1, cos(π) ≈ -1, cos(π/2) ≈ 0', () => {
    expect(Math.abs(cos(0) - 1)).toBeLessThan(SIN_COS_MAX_ERROR);
    expect(Math.abs(cos(PI) + 1)).toBeLessThan(SIN_COS_MAX_ERROR);
    expect(Math.abs(cos(HALF_PI))).toBeLessThan(SIN_COS_MAX_ERROR);
  });

  it('sin(-x) == -sin(x) (odd)', () => {
    for (const x of [0.3, 1.1, 2.7, -3.4, PI / 3]) {
      expect(Math.abs(sin(-x) + sin(x))).toBeLessThan(SIN_COS_MAX_ERROR);
    }
  });

  it('cos(-x) == cos(x) (even)', () => {
    for (const x of [0.3, 1.1, 2.7, -3.4, PI / 3]) {
      expect(Math.abs(cos(-x) - cos(x))).toBeLessThan(SIN_COS_MAX_ERROR);
    }
  });

  it('sin² + cos² ≈ 1 for many samples', () => {
    for (let i = 0; i <= 200; i += 1) {
      const x = -2 * TAU + (4 * TAU * i) / 200;
      const s = sin(x);
      const c = cos(x);
      expect(Math.abs(s * s + c * c - 1)).toBeLessThan(SIN_COS_MAX_ERROR);
    }
  });
});

describe('sin / cos — max-abs-error vs Math over [-4π, 4π]', () => {
  it('sin: max |error| < 1e-9', () => {
    let maxErr = 0;
    const N = 10001;
    for (let i = 0; i < N; i += 1) {
      const x = -4 * PI + (8 * PI * i) / (N - 1);
      const err = Math.abs(sin(x) - Math.sin(x));
      if (err > maxErr) maxErr = err;
    }
    expect(maxErr).toBeLessThan(SIN_COS_MAX_ERROR);
  });

  it('cos: max |error| < 1e-9', () => {
    let maxErr = 0;
    const N = 10001;
    for (let i = 0; i < N; i += 1) {
      const x = -4 * PI + (8 * PI * i) / (N - 1);
      const err = Math.abs(cos(x) - Math.cos(x));
      if (err > maxErr) maxErr = err;
    }
    expect(maxErr).toBeLessThan(SIN_COS_MAX_ERROR);
  });

  it('periodicity: sin(x + 2π) ≈ sin(x) after large wrap', () => {
    for (const x of [0.1, 1.234, -2.7]) {
      // 8 full turns positive
      const shifted = x + 8 * TAU;
      expect(Math.abs(sin(shifted) - sin(x))).toBeLessThan(SIN_COS_MAX_ERROR);
    }
  });
});

describe('atan2', () => {
  it('canonical octants', () => {
    expect(Math.abs(atan2(0, 1))).toBeLessThan(ATAN2_MAX_ERROR); // 0
    expect(Math.abs(atan2(1, 0) - HALF_PI)).toBeLessThan(ATAN2_MAX_ERROR); // +y axis
    expect(Math.abs(atan2(-1, 0) + HALF_PI)).toBeLessThan(ATAN2_MAX_ERROR); // -y axis
    expect(Math.abs(atan2(0, -1) - PI)).toBeLessThan(ATAN2_MAX_ERROR); // -x axis (+π)
    expect(Math.abs(atan2(1, 1) - QUARTER_PI)).toBeLessThan(ATAN2_MAX_ERROR);
    expect(Math.abs(atan2(-1, 1) + QUARTER_PI)).toBeLessThan(ATAN2_MAX_ERROR);
  });

  it('atan2(0, 0) === 0 (degenerate, we pick 0)', () => {
    expect(atan2(0, 0)).toBe(0);
  });

  it('max |error| vs Math.atan2 on a 200×200 grid over [-4, 4]² < 1e-6', () => {
    let maxErr = 0;
    const N = 200;
    for (let i = 0; i <= N; i += 1) {
      for (let j = 0; j <= N; j += 1) {
        const x = -4 + (8 * i) / N;
        const y = -4 + (8 * j) / N;
        if (x === 0 && y === 0) continue; // skip the singleton
        const err = Math.abs(atan2(y, x) - Math.atan2(y, x));
        if (err > maxErr) maxErr = err;
      }
    }
    expect(maxErr).toBeLessThan(ATAN2_MAX_ERROR);
  });

  it('sin(atan2(y, x)) matches y / sqrt(x²+y²) for random points', () => {
    // Consistency of our sin/cos with our atan2.
    const pts: Array<[number, number]> = [
      [3, 4],
      [-2, 5],
      [1, -7],
      [-4, -3],
      [0.001, 100],
      [10, 0.5],
    ];
    for (const [y, x] of pts) {
      const r = Math.sqrt(x * x + y * y);
      const theta = atan2(y, x);
      expect(Math.abs(sin(theta) - y / r)).toBeLessThan(1e-6);
      expect(Math.abs(cos(theta) - x / r)).toBeLessThan(1e-6);
    }
  });
});

describe('powi — integer exponent', () => {
  it('base^0 == 1 for any base', () => {
    expect(powi(0, 0)).toBe(1);
    expect(powi(2, 0)).toBe(1);
    expect(powi(-7.5, 0)).toBe(1);
  });

  it('base^1 == base', () => {
    expect(powi(2.5, 1)).toBe(2.5);
    expect(powi(-3, 1)).toBe(-3);
  });

  it('small integer exponents match repeated multiplication', () => {
    expect(powi(2, 10)).toBe(1024);
    expect(powi(3, 4)).toBe(81);
    expect(powi(-2, 5)).toBe(-32);
  });

  it('negative exponent is the reciprocal', () => {
    expect(powi(2, -3)).toBe(1 / 8);
    expect(powi(4, -1)).toBe(0.25);
  });
});

describe('powHalf — half-integer exponent', () => {
  it('powHalf(x, 2*n) == powi(x, n)', () => {
    expect(powHalf(3, 4)).toBe(powi(3, 2));
    expect(powHalf(2.5, 6)).toBe(powi(2.5, 3));
  });

  it('powHalf(x, 1) == sqrt(x)', () => {
    expect(powHalf(9, 1)).toBe(3);
    expect(powHalf(2, 1)).toBe(Math.sqrt(2));
  });

  it('powHalf(x, 3) == x * sqrt(x)', () => {
    // 4^(3/2) = 8
    expect(powHalf(4, 3)).toBe(8);
    // 9^(3/2) = 27
    expect(powHalf(9, 3)).toBe(27);
  });

  it('negative half-power is reciprocal', () => {
    // 4^(-1/2) = 0.5
    expect(powHalf(4, -1)).toBe(0.5);
  });
});

describe('dirFromBearingPitch', () => {
  it('(0, 0) → +X', () => {
    const d = dirFromBearingPitch(0, 0);
    expect(Math.abs(d.x - 1)).toBeLessThan(SIN_COS_MAX_ERROR);
    expect(Math.abs(d.y)).toBeLessThan(SIN_COS_MAX_ERROR);
    expect(Math.abs(d.z)).toBeLessThan(SIN_COS_MAX_ERROR);
  });

  it('(90, 0) → +Z', () => {
    const d = dirFromBearingPitch(90, 0);
    expect(Math.abs(d.x)).toBeLessThan(SIN_COS_MAX_ERROR);
    expect(Math.abs(d.y)).toBeLessThan(SIN_COS_MAX_ERROR);
    expect(Math.abs(d.z - 1)).toBeLessThan(SIN_COS_MAX_ERROR);
  });

  it('(0, 90) → +Y (straight up)', () => {
    const d = dirFromBearingPitch(0, 90);
    expect(Math.abs(d.x)).toBeLessThan(SIN_COS_MAX_ERROR);
    expect(Math.abs(d.y - 1)).toBeLessThan(SIN_COS_MAX_ERROR);
    expect(Math.abs(d.z)).toBeLessThan(SIN_COS_MAX_ERROR);
  });

  it('(180, 0) → -X', () => {
    const d = dirFromBearingPitch(180, 0);
    expect(Math.abs(d.x + 1)).toBeLessThan(SIN_COS_MAX_ERROR);
    expect(Math.abs(d.y)).toBeLessThan(SIN_COS_MAX_ERROR);
    expect(Math.abs(d.z)).toBeLessThan(SIN_COS_MAX_ERROR);
  });

  it('always returns a unit vector', () => {
    const cases: Array<[number, number]> = [
      [0, 0],
      [30, 45],
      [-137, 12],
      [270, -80],
      [360 * 3 + 47, 89],
    ];
    for (const [b, p] of cases) {
      const d = dirFromBearingPitch(b, p);
      expect(Math.abs(length(d) - 1)).toBeLessThan(1e-9);
    }
  });
});
