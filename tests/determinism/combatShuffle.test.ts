// Combat shuffle determinism / iteration-order independence (NFR-Correctness,
// §7.5 row 2). This is the load-bearing NFR-Correctness proof at match scope:
// the whole two-phase read/stage/commit + `(sourceId, shotIndex)` sort +
// sorted-BodyId iteration discipline (§7.3) EXISTS so that this test passes
// by construction, not by luck. It runs on every commit.
//
// Seams under test — every seam the sim's design claims is order-free:
//
//   • The per-turn `movement` and `attack` arrays each Commander returns.
//     The coordinator preserves per-commander order; the resolver sorts
//     internally by BodyId. Shuffling within each commander's return must
//     not change the digest.
//
//   • Map insertion order inside the initial `MatchState`: `bodies`, `ships`,
//     `fleetOf`. The sim iterates every ship / body / fleet-of via the
//     sorted accessors (`shipsSorted`, `bodiesSorted`) — never `Map.keys()`
//     insertion order. Rebuilding those maps with entries inserted in a
//     shuffled order must not change the digest.
//
// Seams NOT shuffled (deliberately — these are inputs, not seams):
//
//   • Fleet order in `MatchConfig.fleets` and ship order within a fleet.
//     Both feed `createMatch`'s monotonic BodyId assignment; a different
//     order IS a different match with different IDs → different digest by
//     definition. That is what the golden fixture pins; shuffling here
//     would test the wrong property.
//
// The shuffle is a deterministic LCG (Numerical Recipes constants) so a
// failure is reproducible — same permutation on every run. A truly random
// shuffle would obscure "the same shuffle passes on some runs and fails on
// others" — the point is that ANY shuffle passes.

import { describe, expect, it } from 'vitest';
import type {
  BodyId,
  Body,
  Commander,
  MatchConfig,
  MatchState,
  MovementPlan,
  AttackPlan,
  SimFleet,
} from '../../src/sim/index.js';
import {
  buildInitialState,
  matchDigest,
  runMatch,
} from '../../src/sim/index.js';
import { buildCommanders } from './combat/recordFixtures.js';
import { combatFixtureNames, loadCombatFixture } from './combat/fixtureLoader.js';

/** Numerical-Recipes LCG shuffle — identical algorithm to
 *  `tests/determinism/shuffle.test.ts::shuffled()`. Deliberately the same
 *  shuffle a reviewer already trusts upstream. */
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

/** Rebuild a Map with entries inserted in shuffled order. Sim iterates via
 *  sorted accessors — this rebuild must not change the digest. */
const shuffleMap = <K, V>(map: ReadonlyMap<K, V>, seed: number): Map<K, V> => {
  const entries = Array.from(map.entries());
  const perm = shuffled(entries, seed);
  return new Map(perm);
};

/** Reassemble a MatchState with every internal Map inserted in a shuffled
 *  order. Values are identical; only iteration order in the underlying JS
 *  Map differs. Uses different sub-seeds per map so no two maps happen to
 *  permute identically. */
const shuffleStateMaps = (state: MatchState, seed: number): MatchState => ({
  seed: state.seed,
  arena: state.arena,
  physics: state.physics,
  combat: state.combat,
  turn: state.turn,
  nextBodyId: state.nextBodyId,
  ships: shuffleMap(state.ships, seed ^ 0x11111111),
  bodies: shuffleMap(state.bodies, seed ^ 0x22222222) as ReadonlyMap<BodyId, Body>,
  fleetOf: shuffleMap(state.fleetOf, seed ^ 0x33333333),
  guidances: shuffleMap(state.guidances, seed ^ 0x44444444),
  debrisAge: shuffleMap(state.debrisAge, seed ^ 0x55555555),
});

/** Wrap a Commander so its per-turn returned plan arrays are shuffled.
 *  Seed varies by turn via GOLDEN-ratio mixing so early turns and late
 *  turns get uncorrelated permutations. */
const shufflingCommander = (base: Commander, seed: number): Commander => ({
  fleetId: base.fleetId,
  planMovement: async (view) => {
    const raw = await base.planMovement(view);
    return shuffled(raw as readonly MovementPlan[], seed ^ ((view.turn + 1) * 0x9e3779b9));
  },
  planAttack: async (view) => {
    const raw = await base.planAttack(view);
    return shuffled(
      raw as readonly AttackPlan[],
      seed ^ ((view.turn + 1) * 0x9e3779b9) ^ 0x517cc1b7,
    );
  },
});

/** Reassemble a fleet with the ORIGINAL ship order (fleets are inputs, not
 *  shuffle seams). Provided as a helper so the config-building call sites
 *  read symmetrically with the shuffle helpers. */
const fleetsUnchanged = (fleets: readonly SimFleet[]): readonly SimFleet[] => fleets;

// ---------------------------------------------------------------------------

describe('combat shuffle determinism (NFR-Correctness, §7.5 row 2)', () => {
  const names = combatFixtureNames();
  if (names.length === 0) {
    it('has at least one combat fixture to shuffle', () => {
      throw new Error('no fixtures under tests/determinism/combat/');
    });
    return;
  }

  // Permutation seed pinned as a module constant so failures are reproducible
  // exactly. Second seed used in the "different shuffle also matches" test
  // below to prove invariance across permutations, not one lucky permutation.
  const PRIMARY_SHUFFLE_SEED = 0x1a2b3c4d;
  const SECONDARY_SHUFFLE_SEED = 0xdeadbeef;

  for (const name of names) {
    describe(`${name}`, () => {
      const fixture = loadCombatFixture(name);
      const configOf = (): MatchConfig => ({
        seed: fixture.seed,
        fleets: fleetsUnchanged(fixture.fleets),
        arena: fixture.arena,
        physics: fixture.physics,
        combat: fixture.combat,
      });

      it('shuffling per-turn plan arrays → identical final digest', async () => {
        const state = buildInitialState(configOf());
        const commanders = buildCommanders(fixture.commanders).map((c) =>
          shufflingCommander(c, PRIMARY_SHUFFLE_SEED),
        );
        const result = await runMatch(state, commanders);
        expect(matchDigest(result.state)).toBe(fixture.expected.finalDigest);
      });

      it('shuffling state Map insertion order → identical final digest', async () => {
        const state = shuffleStateMaps(
          buildInitialState(configOf()),
          PRIMARY_SHUFFLE_SEED,
        );
        const commanders = buildCommanders(fixture.commanders);
        const result = await runMatch(state, commanders);
        expect(matchDigest(result.state)).toBe(fixture.expected.finalDigest);
      });

      it('shuffling BOTH plans AND state maps → identical final digest', async () => {
        const state = shuffleStateMaps(
          buildInitialState(configOf()),
          PRIMARY_SHUFFLE_SEED,
        );
        const commanders = buildCommanders(fixture.commanders).map((c) =>
          shufflingCommander(c, PRIMARY_SHUFFLE_SEED),
        );
        const result = await runMatch(state, commanders);
        expect(matchDigest(result.state)).toBe(fixture.expected.finalDigest);
      });
    });
  }

  it('a second, differently-seeded shuffle also matches (invariance, not coincidence)', async () => {
    // Prove the invariance is across permutations, not luck at one specific
    // permutation. Runs on the first fixture only — enough signal, no need
    // to duplicate the whole matrix.
    const first = loadCombatFixture(names[0]!);
    const state = shuffleStateMaps(
      buildInitialState({
        seed: first.seed,
        fleets: first.fleets,
        arena: first.arena,
        physics: first.physics,
        combat: first.combat,
      }),
      SECONDARY_SHUFFLE_SEED,
    );
    const commanders = buildCommanders(first.commanders).map((c) =>
      shufflingCommander(c, SECONDARY_SHUFFLE_SEED),
    );
    const result = await runMatch(state, commanders);
    expect(matchDigest(result.state)).toBe(first.expected.finalDigest);
  });
});
