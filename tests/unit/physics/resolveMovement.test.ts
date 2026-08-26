// resolveMovement — beat-level integration: plans applied, bodies integrated, contacts
// detected & sorted canonically. Momentum and boundary handling are covered by their
// own tests in CP3.

import { describe, it, expect } from 'vitest';
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
  arena: { center: of(0, 0, 0), radius: 10_000 },
};

const ship = (id: number, pos = of(0, 0, 0), vel = of(0, 0, 0), radius = 10, mass = 1): Body => ({
  kind: 'ship',
  id,
  position: pos,
  velocity: vel,
  radius,
  mass,
});

describe('resolveMovement — ballistic advance', () => {
  it('advances bodies by vel·dt when nothing collides', () => {
    const bodies = [ship(1, of(0, 0, 0), of(10, 0, 0))];
    const out = resolveMovement(bodies, [], config);
    expect(out.finalBodies).toHaveLength(1);
    expect(out.finalBodies[0]!.position.x).toBeCloseTo(10, 10);
    expect(out.finalBodies[0]!.velocity).toEqual({ x: 10, y: 0, z: 0 });
    expect(out.contacts).toEqual([]);
  });

  it('applies a movement plan before integrating', () => {
    const bodies = [ship(1, of(0, 0, 0), of(0, 0, 0))];
    const plans: MovementPlan[] = [{ bodyId: 1, deltaV: of(5, 0, 0) }];
    const out = resolveMovement(bodies, plans, config);
    // Post-plan velocity 5 · dt 1 = 5 units of displacement.
    expect(out.finalBodies[0]!.position.x).toBeCloseTo(5, 10);
    expect(out.finalBodies[0]!.velocity).toEqual({ x: 5, y: 0, z: 0 });
  });

  it('does NOT mutate its input bodies (two-phase read/stage/commit)', () => {
    const bodies = [ship(1, of(0, 0, 0), of(10, 0, 0))];
    const snapshot = JSON.stringify(bodies);
    resolveMovement(bodies, [{ bodyId: 1, deltaV: of(1, 0, 0) }], config);
    expect(JSON.stringify(bodies)).toBe(snapshot);
  });

  it('returns finalBodies sorted by id regardless of input order', () => {
    const bodies = [ship(3, of(0, 0, 0)), ship(1, of(50, 0, 0)), ship(2, of(-50, 0, 0))];
    const out = resolveMovement(bodies, [], config);
    expect(out.finalBodies.map((b) => b.id)).toEqual([1, 2, 3]);
  });
});

describe('resolveMovement — contact detection & canonical ordering', () => {
  it('detects a single head-on collision and emits it exactly once', () => {
    // Two ships closing to contact within one beat.
    const bodies = [
      ship(1, of(-6, 0, 0), of(5, 0, 0), 1),
      ship(2, of(6, 0, 0), of(-5, 0, 0), 1),
    ];
    const out = resolveMovement(bodies, [], config);
    expect(out.contacts).toHaveLength(1);
    expect(out.contacts[0]).toMatchObject({ idA: 1, idB: 2 });
    expect(out.contacts[0]!.toi).toBeGreaterThanOrEqual(0);
    expect(out.contacts[0]!.toi).toBeLessThanOrEqual(1);
  });

  it('contact list is deterministic under shuffled input order', () => {
    // Three-body scenario with multiple potential contacts.
    const bodies = [
      ship(1, of(-6, 0, 0), of(5, 0, 0), 1),
      ship(2, of(6, 0, 0), of(-5, 0, 0), 1),
      ship(3, of(0, 6, 0), of(0, -5, 0), 1),
    ];
    const ref = resolveMovement(bodies, [], config);
    const permutations: Body[][] = [
      [bodies[2]!, bodies[0]!, bodies[1]!],
      [bodies[1]!, bodies[2]!, bodies[0]!],
      [bodies[2]!, bodies[1]!, bodies[0]!],
    ];
    for (const perm of permutations) {
      const other = resolveMovement(perm, [], config);
      expect(other.contacts).toEqual(ref.contacts);
      expect(other.finalBodies.map((b) => b.id)).toEqual(ref.finalBodies.map((b) => b.id));
    }
  });

  it('contacts are sorted by (subStep, toi, idA, idB) ascending', () => {
    // A scene busy enough that multiple contacts land in the same sub-step.
    const bodies = [
      ship(1, of(-6, 0, 0), of(5, 0, 0), 1),
      ship(2, of(6, 0, 0), of(-5, 0, 0), 1),
      ship(3, of(0, -6, 0), of(0, 5, 0), 1),
      ship(4, of(0, 6, 0), of(0, -5, 0), 1),
    ];
    const out = resolveMovement(bodies, [], config);
    // Assert monotone non-decrease on the sort key across the whole list.
    for (let i = 1; i < out.contacts.length; i += 1) {
      const p = out.contacts[i - 1]!;
      const c = out.contacts[i]!;
      const before =
        p.subStep < c.subStep ||
        (p.subStep === c.subStep && p.toi < c.toi) ||
        (p.subStep === c.subStep && p.toi === c.toi && p.idA < c.idA) ||
        (p.subStep === c.subStep && p.toi === c.toi && p.idA === c.idA && p.idB <= c.idB);
      expect(before).toBe(true);
    }
  });
});
