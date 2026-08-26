// Shuffle determinism / iteration-order independence (NFR-Correctness, §7.5 row 2).
//
// For every fixture, shuffle its `bodies` list AND each beat's `plans` list under a
// fixed permutation. The recomputed digest must equal the recorded (unshuffled)
// digest. This is the whole-turn version of the RNG shuffle test in
// `tests/unit/mathx/rng.test.ts` — same property, one layer up.
//
// The shuffle is DETERMINISTIC (a linear-congruential permutation seeded by a
// constant, same pattern as the mathx rng test uses) so the failure mode is
// reproducible. A truly random shuffle here would obscure "the same shuffle passes
// on some runs and fails on others" — the point is that ANY shuffle passes.

import { describe, it, expect } from 'vitest';
import { runScenario, type Scenario } from '../../tools/balance/scenario.js';
import { digest } from '../../tools/balance/digest.js';
import { fixtureNames, loadFixture } from './fixtureLoader.js';

// Numerical-Recipes LCG — reproducible, uncorrelated with the sim's RNG. Same
// pattern as `tests/unit/mathx/rng.test.ts::shuffled()` — deliberately similar so
// a reviewer can see the shuffle logic is the same one already trusted upstream.
const shuffled = <T>(items: readonly T[], seed: number): T[] => {
  const out = items.slice();
  let s = seed | 0;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    const j = ((s >>> 0) % (i + 1)) | 0;
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
};

/** Shuffle bodies + each beat's plans. Fixture-shape-preserving (no fields dropped). */
const shuffleScenario = (scenario: Scenario, seed: number): Scenario => ({
  ...scenario,
  bodies: shuffled(scenario.bodies, seed),
  plansPerBeat: scenario.plansPerBeat.map((plans, beat) => shuffled(plans, seed ^ ((beat + 1) * 0x9e3779b9))),
});

describe('shuffle determinism (NFR-Correctness / §7.5)', () => {
  const names = fixtureNames();
  if (names.length === 0) return;

  for (const name of names) {
    it(`${name}: shuffled bodies + plans → identical digest`, () => {
      const { scenario, recordedDigest } = loadFixture(name);
      const shuffledScenarioInstance = shuffleScenario(scenario, 0x1a2b3c4d);
      const result = runScenario(shuffledScenarioInstance);
      expect(digest(result)).toBe(recordedDigest);
    });
  }

  it('a second, differently-seeded shuffle also matches (per-scenario)', () => {
    // Second seed proves it's the shuffle-INVARIANCE that holds, not a coincidence
    // for one specific permutation. Runs on the first fixture only — enough signal,
    // no need to duplicate the whole matrix.
    const { scenario, recordedDigest } = loadFixture(names[0]!);
    const alt = shuffleScenario(scenario, 0xdeadbeef);
    expect(digest(runScenario(alt))).toBe(recordedDigest);
  });
});
