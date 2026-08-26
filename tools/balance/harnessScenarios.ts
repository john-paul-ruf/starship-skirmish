// tools/balance/harnessScenarios.ts — the demo-scenario factory the CLI drives from.
//
// Kept separate from `cli.ts` so importers (tests, purity check, F4's future
// match-scope harness) can call `seedToScenario` without triggering the CLI's
// `main()`. `cli.ts` is a script entry point; every other consumer imports from HERE.
//
// The scenarios are TUNED to produce a mix of contacts and boundary exits within a
// small beat budget — otherwise the digest just fingerprints ballistic advance and
// misses the interesting sim surfaces. Ship radius is generous (30 world units) and
// mean speed is high relative to arena radius so collisions and exits happen every
// few seeds instead of every few dozen.

import { seedOf, randRange, randInt } from '../../src/sim/mathx/index.js';
import { of } from '../../src/sim/mathx/vec3.js';
import type { Body } from '../../src/sim/types.js';
import type { PhysicsConfig } from '../../src/sim/physics/index.js';
import type { Scenario } from './scenario.js';

/** Shared physics config for every harness scenario — small arena, standard tuning. */
export const HARNESS_CONFIG: PhysicsConfig = {
  dt: 1,
  subStepMin: 4,
  subStepMax: 64,
  restitution: 0.15,
  collisionDamageCoefficient: 0.0012,
  arena: { center: of(0, 0, 0), radius: 900 },
};

/**
 * Turn one integer seed into a full physics scenario. Deterministic by construction
 * (uses only `mathx.rng`). Position span 700 with velocity span 120 over 3 beats
 * puts bodies at ±700 ± 360 → mixed inside / outside outcomes on the 900 shell.
 */
export const seedToScenario = (n: number, beats = 3): Scenario => {
  const seed = seedOf(n >>> 0, (~n >>> 0) ^ 0x9e3779b9);
  const shipCount = 4 + randInt(seed, 0, 3, 0xa1);
  const bodies: Body[] = [];
  for (let i = 0; i < shipCount; i += 1) {
    bodies.push({
      kind: 'ship',
      id: i + 1,
      position: of(
        randRange(seed, -700, 700, i, 0),
        randRange(seed, -350, 350, i, 1),
        randRange(seed, -700, 700, i, 2),
      ),
      velocity: of(
        randRange(seed, -120, 120, i, 3),
        randRange(seed, -60, 60, i, 4),
        randRange(seed, -120, 120, i, 5),
      ),
      mass: 100,
      radius: 30,
    });
  }
  return {
    kind: 'physics',
    name: `seed-${n}`,
    seed,
    config: HARNESS_CONFIG,
    bodies,
    plansPerBeat: [],
    beats,
  };
};
