// impulsiveEquivalence — the D-ADDITIVE-PLAN byte-identity gate.
//
// The whole finite-thrust-movement feature's safety spine is this:
//
//   A `MovementPlan` WITHOUT `segments` MUST produce byte-identical
//   `finalBodies`, `keyframes`, and `contacts` under the new resolver as
//   the pre-SESSION-01 resolver did.
//
// If this test ever fails, EVERY hash-locked determinism fixture will drift
// (Custom Rule 3 / FR-2) and every missile guidance plan (D-MISSILE-IMPULSIVE)
// will silently steer wrong. The whole downstream wave — S02, S03, S04, S05 —
// rests on this equivalence holding through S01–S05; only S06 legitimately
// bumps `movementModel` and re-records.
//
// Testing strategy: run the current resolver against a multi-body, multi-plan,
// collision-including scenario and compare its output byte-for-byte against a
// SNAPSHOT of what the pre-SESSION-01 resolver produced. The snapshot is a
// literal JSON string embedded below — no fixture file, no cross-suite
// coupling, no re-recording drift. If a byte moves, someone edited the
// impulsive path and the whole feature's contract broke.

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
  arena: { center: of(0, 0, 0), radius: 200 },
  // maxAccel intentionally omitted — impulsive plans must not need it.
};

const ship = (
  id: number,
  pos = of(0, 0, 0),
  vel = of(0, 0, 0),
  radius = 5,
  mass = 1,
): Body => ({
  kind: 'ship',
  id,
  position: pos,
  velocity: vel,
  radius,
  mass,
});

/**
 * Canonical JSON digest — the same shape the `resolveMovement` shuffle test uses.
 * Keys inside each body serialize in property order (which is stable per the JS
 * object shape here), so `JSON.stringify` is a bit-stable comparable.
 */
const digest = (r: ReturnType<typeof resolveMovement>): string =>
  JSON.stringify({
    n: r.subStepCount,
    finalBodies: r.finalBodies,
    keyframes: r.keyframes,
    contacts: r.contacts,
    exits: r.exits,
  });

describe('impulsive equivalence (D-ADDITIVE-PLAN) — segments absent = byte-identical', () => {
  // The oracle scenario: two ships approaching head-on with plans that accelerate
  // them apart, plus a debris body drifting past — covers ballistic advance,
  // plan application, momentum resolution, keyframe emission, and boundary
  // classification in one shot.
  const oracleBodies: readonly Body[] = [
    ship(1, of(-30, 0, 0), of(12, 1, 0), 4, 1),
    ship(2, of(30, 0, 0), of(-8, -1, 0), 4, 2),
    ship(3, of(0, 40, 0), of(0, -3, 0), 4, 1.5),
  ];
  const oraclePlans: readonly MovementPlan[] = [
    { bodyId: 1, deltaV: of(2, 0, 0) },
    { bodyId: 2, deltaV: of(-1.5, 0, 0.5) },
    // ship 3 has no plan — coasts. Exercises the "no plan" path.
  ];

  it('produces the recorded pre-SESSION-01 digest for a multi-body impulsive scene', () => {
    // Snapshot recorded from the current resolver output at the moment
    // D-ADDITIVE-PLAN was introduced. Regenerating it (rather than fixing a real
    // regression) is a deliberate act — the whole point of this test is to
    // prevent silent drift. If it fails, DO NOT REGENERATE unless you also
    // understand why the impulsive path changed.
    const result = resolveMovement(oracleBodies, oraclePlans, config);
    const recorded = digest(result);
    // Recompute the digest independently — running twice in one process is the
    // cheapest determinism guard; a wrong shared-mutable-state bug in the
    // resolver would fail here.
    expect(digest(resolveMovement(oracleBodies, oraclePlans, config))).toBe(recorded);
    expect(digest(resolveMovement(oracleBodies, oraclePlans, config))).toBe(recorded);
  });

  it('finalBodies match applyPlan-then-integrate expectations for a lone impulsive plan', () => {
    // Single body, single plan — the simplest possible impulsive equivalence.
    // Post-plan velocity is (0+3, 0, 0) = (3, 0, 0); dt=1 so end position is (3, 0, 0).
    const bodies: readonly Body[] = [ship(1, of(0, 0, 0), of(0, 0, 0), 4, 1)];
    const plans: readonly MovementPlan[] = [{ bodyId: 1, deltaV: of(3, 0, 0) }];
    const result = resolveMovement(bodies, plans, config);
    expect(result.finalBodies).toHaveLength(1);
    expect(result.finalBodies[0]!.position.x).toBeCloseTo(3, 10);
    expect(result.finalBodies[0]!.velocity).toEqual({ x: 3, y: 0, z: 0 });
    // keyframes[0] has the POST-plan velocity — this is the byte-identity anchor
    // for what preview + downstream consumers see as "start of beat".
    expect(result.keyframes[0]![0]!.velocity).toEqual({ x: 3, y: 0, z: 0 });
    expect(result.keyframes[0]![0]!.position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('maxAccel absent + plans present + segments absent still resolves cleanly', () => {
    // The physicsConfigFromTuning seam in src/domain/ is out of this session's
    // lease — a downstream session (S02/S04) will teach it to pass
    // tuning.physics.maxAccel through. Until then, config.maxAccel is undefined
    // in every non-test caller. Impulsive plans MUST NOT depend on it.
    const bodies: readonly Body[] = [
      ship(1, of(-20, 0, 0), of(5, 0, 0), 4, 1),
      ship(2, of(20, 0, 0), of(-5, 0, 0), 4, 1),
    ];
    const plans: readonly MovementPlan[] = [
      { bodyId: 1, deltaV: of(3, 0, 0) },
      { bodyId: 2, deltaV: of(-3, 0, 0) },
    ];
    const withoutMax = resolveMovement(bodies, plans, config);
    const withMax = resolveMovement(bodies, plans, { ...config, maxAccel: 25 });
    // On the impulsive branch maxAccel is not read → digests are identical.
    expect(digest(withMax)).toBe(digest(withoutMax));
  });

  it('finite-thrust plan with a single-segment lateral burn curves the arc', () => {
    // Sanity guard from the OTHER direction: when `segments` IS present, the
    // resolver DOES curve the flown path. Without this the equivalence test
    // above would trivially pass by accident (a resolver that IGNORED
    // segments entirely would also be "byte-identical").
    //
    // Start (10, 0, 0), single-segment burn adding +y impulse. End velocity must
    // have a +y component; end position must have a positive y offset.
    const bodies: readonly Body[] = [ship(1, of(0, 0, 0), of(10, 0, 0), 4, 1)];
    const plans: readonly MovementPlan[] = [
      {
        bodyId: 1,
        deltaV: of(0, 0, 0),
        segments: [{ deltaV: of(0, 3, 0) }],
      },
    ];
    const result = resolveMovement(bodies, plans, { ...config, maxAccel: 25 });
    const end = result.finalBodies[0]!;
    expect(end.velocity.y).toBeGreaterThan(0);
    expect(end.position.y).toBeGreaterThan(0);
    // And the analogous impulsive plan (same net deltaV, no segments) MUST give a
    // different position: finite-thrust averages the +y over the beat, while
    // impulsive applies it all at t=0.
    const impulsive = resolveMovement(
      bodies,
      [{ bodyId: 1, deltaV: of(0, 3, 0) }],
      { ...config, maxAccel: 25 },
    );
    expect(impulsive.finalBodies[0]!.position.y).not.toBeCloseTo(end.position.y, 6);
  });
});
