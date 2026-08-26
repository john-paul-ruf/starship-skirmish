// resolveMovement — beat-level integration: plans applied, bodies integrated, contacts
// detected & sorted canonically, momentum exchanged, boundary exits classified.

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

const boundedConfig: PhysicsConfig = { ...config, arena: { center: of(0, 0, 0), radius: 50 } };

const ship = (id: number, pos = of(0, 0, 0), vel = of(0, 0, 0), radius = 10, mass = 1): Body => ({
  kind: 'ship',
  id,
  position: pos,
  velocity: vel,
  radius,
  mass,
});

const hazard = (
  kind: 'debris' | 'missile',
  id: number,
  pos = of(0, 0, 0),
  vel = of(0, 0, 0),
): Body => ({ kind, id, position: pos, velocity: vel, mass: 0.1, radius: 3 });

describe('resolveMovement — ballistic advance', () => {
  it('advances bodies by vel·dt when nothing collides', () => {
    const bodies = [ship(1, of(0, 0, 0), of(10, 0, 0))];
    const out = resolveMovement(bodies, [], config);
    expect(out.finalBodies).toHaveLength(1);
    expect(out.finalBodies[0]!.position.x).toBeCloseTo(10, 10);
    expect(out.finalBodies[0]!.velocity).toEqual({ x: 10, y: 0, z: 0 });
    expect(out.contacts).toEqual([]);
    expect(out.exits).toEqual([]);
  });

  it('applies a movement plan before integrating', () => {
    const bodies = [ship(1, of(0, 0, 0), of(0, 0, 0))];
    const plans: MovementPlan[] = [{ bodyId: 1, deltaV: of(5, 0, 0) }];
    const out = resolveMovement(bodies, plans, config);
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

describe('resolveMovement — keyframes', () => {
  it('emits N+1 keyframes: the pre-integration state plus one per sub-step', () => {
    const bodies = [ship(1, of(0, 0, 0), of(10, 0, 0))];
    const out = resolveMovement(bodies, [], config);
    expect(out.keyframes).toHaveLength(out.subStepCount + 1);
  });

  it('keyframe[0] is the post-plan pre-integration state', () => {
    const bodies = [ship(1, of(0, 0, 0), of(1, 0, 0))];
    const out = resolveMovement(bodies, [{ bodyId: 1, deltaV: of(2, 0, 0) }], config);
    expect(out.keyframes[0]![0]!.velocity).toEqual({ x: 3, y: 0, z: 0 });
    expect(out.keyframes[0]![0]!.position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('final keyframe matches finalBodies', () => {
    const bodies = [ship(1, of(0, 0, 0), of(3, 0, 0)), ship(2, of(20, 0, 0), of(0, 0, 0))];
    const out = resolveMovement(bodies, [], config);
    expect(out.keyframes[out.keyframes.length - 1]).toEqual(out.finalBodies);
  });
});

describe('resolveMovement — momentum applied', () => {
  it('a head-on symmetric ship-ship collision reverses both velocities partially (e < 1)', () => {
    // Equal masses; e = 0.15. Post-collision along contact normal:
    //   vA' = ((1-e)/2) · vA + ((1+e)/2) · vB
    //   vB' = ((1+e)/2) · vA + ((1-e)/2) · vB
    // With vA=+10, vB=-10, e=0.15:
    //   vA' = 0.425·10 + 0.575·(-10) = -1.5
    //   vB' = 0.575·10 + 0.425·(-10) = +1.5
    const bodies = [
      ship(1, of(-6, 0, 0), of(10, 0, 0), 1, 1),
      ship(2, of(6, 0, 0), of(-10, 0, 0), 1, 1),
    ];
    const out = resolveMovement(bodies, [], config);
    expect(out.contacts.length).toBe(1);
    const [A, B] = out.finalBodies;
    expect(A!.velocity.x).toBeCloseTo(-1.5, 9);
    expect(B!.velocity.x).toBeCloseTo(1.5, 9);
    expect(out.contacts[0]!.damage).toBeGreaterThan(0);
  });

  it('emits contact geometry (normal, point, relSpeedNormal, damage)', () => {
    const bodies = [
      ship(1, of(-6, 0, 0), of(10, 0, 0), 1, 1),
      ship(2, of(6, 0, 0), of(-10, 0, 0), 1, 1),
    ];
    const out = resolveMovement(bodies, [], config);
    const c = out.contacts[0]!;
    expect(c.normal.x).toBeCloseTo(-1, 6); // A at negative x → normal from B to A is −x
    expect(c.relSpeedNormal).toBeCloseTo(20, 6);
    // damage = k · reducedMass · relSpeedNormal² = 0.0012 · 0.5 · 400 = 0.24
    expect(c.damage).toBeCloseTo(0.0012 * 0.5 * 400, 6);
  });
});

describe('resolveMovement — boundary exits (FR-26)', () => {
  it('a ship whose post-step position leaves the arena is recorded as ship-destroyed and dropped', () => {
    // Ship starts inside, moves fast enough to leave in one beat.
    const bodies = [ship(1, of(0, 0, 0), of(100, 0, 0))]; // ends at 100, arena r=50
    const out = resolveMovement(bodies, [], boundedConfig);
    expect(out.finalBodies).toHaveLength(0);
    expect(out.exits.length).toBeGreaterThanOrEqual(1);
    expect(out.exits[0]!.bodyId).toBe(1);
    expect(out.exits[0]!.kind).toBe('ship-destroyed');
  });

  it('a debris body leaving the arena is recorded as hazard-removed', () => {
    const bodies = [hazard('debris', 7, of(0, 0, 0), of(100, 0, 0))];
    const out = resolveMovement(bodies, [], boundedConfig);
    expect(out.finalBodies).toHaveLength(0);
    expect(out.exits[0]!.bodyId).toBe(7);
    expect(out.exits[0]!.kind).toBe('hazard-removed');
  });

  it('a missile leaving the arena is recorded as hazard-removed', () => {
    const bodies = [hazard('missile', 42, of(0, 0, 0), of(100, 0, 0))];
    const out = resolveMovement(bodies, [], boundedConfig);
    expect(out.exits[0]!.kind).toBe('hazard-removed');
  });

  it('bodies that stay inside are not recorded as exits', () => {
    const bodies = [ship(1, of(0, 0, 0), of(10, 0, 0))];
    const out = resolveMovement(bodies, [], boundedConfig);
    expect(out.exits).toEqual([]);
    expect(out.finalBodies).toHaveLength(1);
  });
});

describe('resolveMovement — contact detection & canonical ordering', () => {
  it('detects a single head-on collision and emits it exactly once', () => {
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

  it('contacts are sorted by (subStep, toi, idA, idB) ascending', () => {
    const bodies = [
      ship(1, of(-6, 0, 0), of(5, 0, 0), 1),
      ship(2, of(6, 0, 0), of(-5, 0, 0), 1),
      ship(3, of(0, -6, 0), of(0, 5, 0), 1),
      ship(4, of(0, 6, 0), of(0, -5, 0), 1),
    ];
    const out = resolveMovement(bodies, [], config);
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

/**
 * Deep, structural digest of a StepResult — the property that has to survive
 * shuffled input order per architecture §7.3 (the "shuffle" test named in §7.5).
 * Serializing to canonical JSON with sorted keys gives a bit-stable comparable.
 */
const digest = (r: ReturnType<typeof resolveMovement>): string =>
  JSON.stringify({
    n: r.subStepCount,
    finalBodies: r.finalBodies,
    keyframes: r.keyframes,
    contacts: r.contacts,
    exits: r.exits,
  });

describe('resolveMovement — order independence (architecture §7.3, §7.5)', () => {
  it('shuffled input body order → identical digest', () => {
    const bodies = [
      ship(1, of(-30, 0, 0), of(5, 0, 0), 5, 2),
      ship(2, of(30, 0, 0), of(-4, 1, 0), 5, 3),
      ship(3, of(0, 30, 0), of(0, -6, 0), 5, 1),
      ship(4, of(0, -30, 0), of(0, 5, 0), 5, 4),
      ship(5, of(20, 20, 0), of(-3, -3, 0), 5, 2),
    ];
    const ref = digest(resolveMovement(bodies, [], config));
    const permutations: Body[][] = [
      [bodies[4]!, bodies[3]!, bodies[2]!, bodies[1]!, bodies[0]!],
      [bodies[2]!, bodies[0]!, bodies[4]!, bodies[1]!, bodies[3]!],
      [bodies[3]!, bodies[1]!, bodies[4]!, bodies[0]!, bodies[2]!],
    ];
    for (const perm of permutations) {
      expect(digest(resolveMovement(perm, [], config))).toBe(ref);
    }
  });

  it('shuffled plan order → identical digest (plans keyed by bodyId, not position)', () => {
    const bodies = [ship(1, of(0, 0, 0)), ship(2, of(50, 0, 0)), ship(3, of(-50, 0, 0))];
    const plans: MovementPlan[] = [
      { bodyId: 1, deltaV: of(2, 0, 0) },
      { bodyId: 2, deltaV: of(-3, 1, 0) },
      { bodyId: 3, deltaV: of(4, -1, 0) },
    ];
    const ref = digest(resolveMovement(bodies, plans, config));
    expect(digest(resolveMovement(bodies, [plans[2]!, plans[0]!, plans[1]!], config))).toBe(ref);
    expect(digest(resolveMovement(bodies, [plans[1]!, plans[2]!, plans[0]!], config))).toBe(ref);
  });
});
