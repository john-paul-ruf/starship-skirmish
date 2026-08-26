// Golden-trace determinism (architecture §7.5 row 1).
//
// For every fixture in `tests/determinism/fixtures/`, run its scenario back through
// `runScenario` + `digest` and assert the recomputed digest equals the recorded one.
// This is the "same code + same input ⇒ same output" property, made testable.
//
// A failure here means one of:
//   1. `src/sim/**` produced a different float somewhere. Real regression.
//   2. `tools/balance/scenario.ts` or `tools/balance/digest.ts` changed shape.
//      That's a deliberate act — the fix is to bump a version marker and re-record
//      every fixture, not to edit historical fixtures (Custom Rule 3 / FR-2).
//   3. `src/sim/mathx/rng.ts`'s frozen stream drifted. Also deliberate; also a
//      coordinated regeneration.
//
// The test intentionally iterates fixtures at describe-time (not inside a single
// `it`) so each fixture failure is a distinct test row — a run that fails on 3 of
// 8 fixtures tells you *which* three.

import { describe, it, expect } from 'vitest';
import { runScenario } from '../../tools/balance/scenario.js';
import { digest } from '../../tools/balance/digest.js';
import { fixtureNames, loadFixture } from './fixtureLoader.js';

describe('golden-trace determinism (§7.5)', () => {
  const names = fixtureNames();
  if (names.length === 0) {
    it('has at least one recorded fixture', () => {
      throw new Error(
        'no fixtures found under tests/determinism/fixtures/ — record with `npm run harness -- --seeds 1..N --record tests/determinism/fixtures`',
      );
    });
    return;
  }

  for (const name of names) {
    it(`${name}: recomputed digest equals recorded`, () => {
      const { scenario, recordedDigest } = loadFixture(name);
      const result = runScenario(scenario);
      expect(digest(result)).toBe(recordedDigest);
    });
  }
});
