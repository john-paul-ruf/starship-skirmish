// sweep — swept sphere-sphere TOI. Tests live outside `src/sim/**` so `Math.*` is
// permitted here as a reference/oracle.

import { describe, it, expect } from 'vitest';
import { sweepSphereSphere } from '../../../src/sim/physics/sweep.js';
import { of } from '../../../src/sim/mathx/vec3.js';

describe('sweepSphereSphere — trivial cases', () => {
  it('returns toi=0 when spheres already overlap', () => {
    // Centers 3 apart, radii 2+2=4 → overlapping.
    const hit = sweepSphereSphere(of(0, 0, 0), of(0, 0, 0), 2, of(3, 0, 0), of(0, 0, 0), 2);
    expect(hit).not.toBeNull();
    expect(hit!.toi).toBe(0);
  });

  it('returns null when there is no relative motion and no overlap', () => {
    const hit = sweepSphereSphere(of(0, 0, 0), of(0, 0, 0), 1, of(10, 0, 0), of(0, 0, 0), 1);
    expect(hit).toBeNull();
  });

  it('returns null when both bodies share an identical displacement', () => {
    // Both translate +5 in x — relative motion is zero.
    const hit = sweepSphereSphere(of(0, 0, 0), of(5, 0, 0), 1, of(10, 0, 0), of(5, 0, 0), 1);
    expect(hit).toBeNull();
  });
});

describe('sweepSphereSphere — head-on approach', () => {
  it('finds contact at the halfway point of a symmetric head-on sweep', () => {
    // A at -10 moving +10 → ends at 0. B at +10 moving -10 → ends at 0.
    // Radii 1+1=2. Contact when their surfaces touch: distance = 2.
    // Initial distance 20 → contact after they've closed 18 units → at τ where
    // relative displacement magnitude = 18. Relative displacement per sub-step = 20.
    // ⇒ τ = 18/20 = 0.9.
    const hit = sweepSphereSphere(
      of(-10, 0, 0), of(10, 0, 0), 1,
      of(10, 0, 0), of(-10, 0, 0), 1,
    );
    expect(hit).not.toBeNull();
    expect(hit!.toi).toBeCloseTo(0.9, 12);
  });

  it('finds contact when just one sphere is moving', () => {
    // A at 0 moving +10; B stationary at 5. Radii 1+1=2 → contact at distance 2.
    // A must close from 5 to 2 units of B → move +3 → τ = 3/10 = 0.3.
    const hit = sweepSphereSphere(
      of(0, 0, 0), of(10, 0, 0), 1,
      of(5, 0, 0), of(0, 0, 0), 1,
    );
    expect(hit).not.toBeNull();
    expect(hit!.toi).toBeCloseTo(0.3, 12);
  });
});

describe('sweepSphereSphere — misses', () => {
  it('returns null when trajectories are parallel and offset (no contact possible)', () => {
    // A and B both moving +10 in x on parallel lines at y=0 and y=10, radii 1.
    // Vertical gap 10 ≫ 2 → no contact regardless of x motion.
    const hit = sweepSphereSphere(
      of(0, 0, 0), of(10, 0, 0), 1,
      of(0, 10, 0), of(10, 0, 0), 1,
    );
    expect(hit).toBeNull();
  });

  it('returns null when the closing sweep would happen AFTER the sub-step', () => {
    // Same head-on as above but slower: A at -100 moving +10, B at +100 moving -10.
    // Rel displacement per sub-step = 20. Needed to close: 200 − 2 = 198. τ = 198/20 = 9.9 > 1.
    const hit = sweepSphereSphere(
      of(-100, 0, 0), of(10, 0, 0), 1,
      of(100, 0, 0), of(-10, 0, 0), 1,
    );
    expect(hit).toBeNull();
  });

  it('returns null when spheres are already moving apart', () => {
    // A at 0 moving -10, B at 5 moving +10. Separating; won't touch this sub-step.
    const hit = sweepSphereSphere(
      of(0, 0, 0), of(-10, 0, 0), 1,
      of(5, 0, 0), of(10, 0, 0), 1,
    );
    expect(hit).toBeNull();
  });
});

describe('sweepSphereSphere — determinism', () => {
  it('is a pure function — same inputs → same output', () => {
    const args: Parameters<typeof sweepSphereSphere> = [
      of(-7, 2, 1), of(3, -1, 0), 1.5,
      of(4, -1, 0.5), of(-2, 1, 0), 2.0,
    ];
    const first = sweepSphereSphere(...args);
    for (let i = 0; i < 5; i += 1) {
      const again = sweepSphereSphere(...args);
      expect(again).toEqual(first);
    }
  });

  it('symmetry: swapping A and B yields the same TOI', () => {
    const a: Parameters<typeof sweepSphereSphere> = [
      of(-5, 0, 0), of(8, 0, 0), 1.2,
      of(5, 0, 0), of(-4, 0, 0), 0.8,
    ];
    const forward = sweepSphereSphere(...a);
    const backward = sweepSphereSphere(
      of(5, 0, 0), of(-4, 0, 0), 0.8,
      of(-5, 0, 0), of(8, 0, 0), 1.2,
    );
    expect(forward).not.toBeNull();
    expect(backward).not.toBeNull();
    expect(forward!.toi).toBe(backward!.toi);
  });
});
