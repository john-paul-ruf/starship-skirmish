// previewPath — pure trajectory + the "preview must not lie" invariant that pins
// the renderer to the sim's own integrator (architecture §9).

import { describe, it, expect } from 'vitest';
import { previewPath } from '../../../src/sim/physics/previewPath.js';
import { resolveMovement } from '../../../src/sim/physics/resolveMovement.js';
import { of } from '../../../src/sim/mathx/vec3.js';
import type { Body, MovementPlan } from '../../../src/sim/types.js';
import type { PhysicsConfig } from '../../../src/sim/physics/config.js';

const config: PhysicsConfig = {
  dt: 1,
  subStepMin: 4,
  subStepMax: 64,
  restitution: 0.15,
  collisionDamageCoefficient: 0.0012,
  arena: { center: of(0, 0, 0), radius: 500 },
};

const ship = (pos = of(0, 0, 0), vel = of(0, 0, 0), radius = 10, mass = 1): Body => ({
  kind: 'ship',
  id: 1,
  position: pos,
  velocity: vel,
  radius,
  mass,
});

describe('previewPath — sampling shape', () => {
  it('returns subStepCount + 1 samples, starting at the current position', () => {
    const body = ship(of(0, 0, 0), of(10, 0, 0));
    const pv = previewPath(body, null, config);
    expect(pv.positions.length).toBe(pv.subStepCount + 1);
    expect(pv.positions[0]).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('a stationary ship with no plan produces a flat arc', () => {
    const body = ship(of(5, -3, 0));
    const pv = previewPath(body, null, config);
    for (const p of pv.positions) expect(p).toEqual({ x: 5, y: -3, z: 0 });
  });

  it('with a plan, the arc reflects the post-plan velocity', () => {
    const body = ship(of(0, 0, 0), of(0, 0, 0));
    const plan: MovementPlan = { bodyId: 1, deltaV: of(4, 0, 0) };
    const pv = previewPath(body, plan, config);
    // dt=1, deltaV_x=4 → end position x = 4 (in exact arithmetic).
    expect(pv.positions[pv.positions.length - 1]!.x).toBeCloseTo(4, 10);
  });
});

describe('previewPath — endsOutsideArena', () => {
  it('is false when the arc stays inside', () => {
    const body = ship(of(0, 0, 0), of(10, 0, 0));
    expect(previewPath(body, null, config).endsOutsideArena).toBe(false);
  });

  it('is true when the arc leaves the arena', () => {
    const body = ship(of(400, 0, 0), of(200, 0, 0)); // ends at 600, arena radius 500
    expect(previewPath(body, null, config).endsOutsideArena).toBe(true);
  });
});

describe('previewPath — the "preview must not lie" invariant', () => {
  it('matches resolveMovement position for an unobstructed body (no plan)', () => {
    const body = ship(of(-100, 20, 5), of(30, -10, 4));
    const pv = previewPath(body, null, config);
    const step = resolveMovement([body], [], config);
    expect(pv.subStepCount).toBe(step.subStepCount);
    // Endpoint identity — bit-for-bit, both use the same integrator.
    expect(pv.positions[pv.positions.length - 1]).toEqual(step.finalBodies[0]!.position);
  });

  it('matches resolveMovement position for an unobstructed body (with plan)', () => {
    const body = ship(of(0, 0, 0), of(5, 0, 0));
    const plan: MovementPlan = { bodyId: 1, deltaV: of(2.5, 1.25, -0.5) };
    const pv = previewPath(body, plan, config);
    const step = resolveMovement([body], [plan], config);
    expect(pv.subStepCount).toBe(step.subStepCount);
    expect(pv.positions[pv.positions.length - 1]).toEqual(step.finalBodies[0]!.position);
  });

  it('per-sub-step keyframe positions match the preview samples exactly', () => {
    const body = ship(of(0, 0, 0), of(7, 3, -2));
    const plan: MovementPlan = { bodyId: 1, deltaV: of(1, -1, 0.5) };
    const pv = previewPath(body, plan, config);
    const step = resolveMovement([body], [plan], config);
    // keyframes[0] is the pre-integration state; positions[0] is the start too.
    // keyframes[k].[0] should equal positions[k] for every k.
    for (let k = 0; k < pv.positions.length; k += 1) {
      const kf = step.keyframes[k]!;
      expect(kf).toHaveLength(1);
      expect(kf[0]!.position).toEqual(pv.positions[k]);
    }
  });
});

// SESSION-01 additions — finite-thrust preview MUST agree with the resolver's
// lone-body path byte-for-byte on the SAME segmented plan, and MUST curve.
describe('previewPath — finite-thrust (D-SHARED-SCHEDULE)', () => {
  const finiteConfig: PhysicsConfig = { ...config, maxAccel: 25 };

  it('matches resolveMovement position for an unobstructed body with a segmented plan', () => {
    const body = ship(of(0, 0, 0), of(10, 0, 0));
    const plan: MovementPlan = {
      bodyId: 1,
      deltaV: of(0, 0, 0),
      segments: [{ deltaV: of(0, 3, 0) }, { deltaV: of(0, 0, 2) }],
    };
    const pv = previewPath(body, plan, finiteConfig);
    const step = resolveMovement([body], [plan], finiteConfig);
    // Byte-identical sub-step count + endpoint: the "preview must not lie"
    // invariant extends to the finite-thrust path.
    expect(pv.subStepCount).toBe(step.subStepCount);
    expect(pv.positions[pv.positions.length - 1]).toEqual(step.finalBodies[0]!.position);
    for (let k = 0; k < pv.positions.length; k += 1) {
      const kf = step.keyframes[k]!;
      expect(kf).toHaveLength(1);
      expect(kf[0]!.position).toEqual(pv.positions[k]);
    }
  });

  it('a single lateral-burn segment CURVES the arc (end bearing differs from start)', () => {
    // Start moving purely +x; burn lateral +y once. The preview must produce a
    // path whose end position has a positive y component (the whole feature's
    // reason to exist — an impulsive plan applied at t=0 would still curve too,
    // but the resolver-preview byte-identity test above pins that separately).
    const body = ship(of(0, 0, 0), of(10, 0, 0));
    const plan: MovementPlan = {
      bodyId: 1,
      deltaV: of(0, 0, 0),
      segments: [{ deltaV: of(0, 4, 0) }],
    };
    const pv = previewPath(body, plan, finiteConfig);
    const end = pv.positions[pv.positions.length - 1]!;
    expect(end.y).toBeGreaterThan(0);
    // And y grows monotonically over the beat (single-direction +y burn).
    let priorY = pv.positions[0]!.y;
    for (let k = 1; k < pv.positions.length; k += 1) {
      const y = pv.positions[k]!.y;
      expect(y).toBeGreaterThanOrEqual(priorY - 1e-9);
      priorY = y;
    }
  });

  it('markPositions has segments.length + 1 entries, start + end match positions', () => {
    const body = ship(of(0, 0, 0), of(10, 0, 0));
    const plan: MovementPlan = {
      bodyId: 1,
      deltaV: of(0, 0, 0),
      segments: [
        { deltaV: of(0, 2, 0) },
        { deltaV: of(0, 2, 0) },
        { deltaV: of(0, 2, 0) },
        { deltaV: of(0, 2, 0) },
      ],
    };
    const pv = previewPath(body, plan, finiteConfig);
    expect(pv.markPositions).toHaveLength(plan.segments!.length + 1);
    // First mark == positions[0] (t=0); last mark == positions[N] (t=dt).
    expect(pv.markPositions[0]).toEqual(pv.positions[0]);
    const lastMark = pv.markPositions[pv.markPositions.length - 1]!;
    const lastPos = pv.positions[pv.positions.length - 1]!;
    expect(lastMark.x).toBeCloseTo(lastPos.x, 9);
    expect(lastMark.y).toBeCloseTo(lastPos.y, 9);
    expect(lastMark.z).toBeCloseTo(lastPos.z, 9);
  });

  it('markPositions is empty for a null plan and for a segments-absent impulsive plan', () => {
    const body = ship(of(0, 0, 0), of(5, 0, 0));
    expect(previewPath(body, null, finiteConfig).markPositions).toEqual([]);
    const impulsive: MovementPlan = { bodyId: 1, deltaV: of(1, 0, 0) };
    expect(previewPath(body, impulsive, finiteConfig).markPositions).toEqual([]);
  });
});
