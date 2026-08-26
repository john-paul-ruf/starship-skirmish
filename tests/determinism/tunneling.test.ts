// Tunneling determinism — re-assertion at scenario scope (§7.5 row 3, FR-19/FR-22).
//
// `tests/unit/physics/tunneling.test.ts` is the primary unit-level regression:
// resolveMovement DOES catch a fast head-on collision that endpoint-only detection
// would silently miss. This file re-asserts the same guarantee through the harness
// path: the same collision, driven through `runScenario` + `digest`, produces:
//   - a contact record (not silent pass-through), and
//   - a stable, byte-identical digest across repeat runs.
//
// Put differently: the physics still catches tunneling AND the harness still
// records it identically. If either half regresses, this test fires.

import { describe, it, expect } from 'vitest';
import { of } from '../../src/sim/mathx/vec3.js';
import type { Body } from '../../src/sim/types.js';
import type { PhysicsConfig } from '../../src/sim/physics/config.js';
import { runScenario, type Scenario } from '../../tools/balance/scenario.js';
import { digest } from '../../tools/balance/digest.js';

const config: PhysicsConfig = {
  dt: 0.1,
  subStepMin: 4,
  subStepMax: 64,
  restitution: 0.15,
  collisionDamageCoefficient: 0.0012,
  arena: { center: of(0, 0, 0), radius: 10_000 },
};

// Identical geometry to tests/unit/physics/tunneling.test.ts — two 1-radius ships
// closing at 4000 units/sec relative, endpoint-only detection misses the crossing.
const tunnelingScenario = (): Scenario => ({
  kind: 'physics',
  name: 'tunneling-headon-4000rel',
  seed: { hi: 0, lo: 0 },
  config,
  bodies: [
    { kind: 'ship', id: 1, position: of(-101, 0, 0), velocity: of(2000, 0, 0), mass: 1, radius: 1 } satisfies Body,
    { kind: 'ship', id: 2, position: of(102, 0, 0), velocity: of(-2000, 0, 0), mass: 1, radius: 1 } satisfies Body,
  ],
  plansPerBeat: [],
  beats: 1,
});

describe('tunneling regression at scenario scope (§7.5)', () => {
  it('the swept-CCD contact survives round-trip through the harness', () => {
    const result = runScenario(tunnelingScenario());
    const contacts = result.beats[0]!.step.contacts;
    // The physics unit test proves the contact exists at subStep 32 with toi in (0,1);
    // here we just assert the harness passed a contact through unmodified. If a bug
    // in scenario.ts dropped contacts, this catches it.
    expect(contacts.length).toBeGreaterThanOrEqual(1);
    expect(contacts[0]!.idA).toBe(1);
    expect(contacts[0]!.idB).toBe(2);
  });

  it('digest is stable across repeat runs of the same scenario', () => {
    // Two independent evaluations must produce byte-identical digests — the
    // NFR-Correctness one-machine version of the cross-engine test.
    const a = digest(runScenario(tunnelingScenario()));
    const b = digest(runScenario(tunnelingScenario()));
    expect(a).toBe(b);
  });
});
