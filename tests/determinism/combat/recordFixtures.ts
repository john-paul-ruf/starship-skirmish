// tests/determinism/combat/recordFixtures.ts — dev-only script that (re)generates
// the combat golden fixtures + manifest.json (S05, architecture §7.5, FR-2).
//
// USAGE (rare — normally the checked-in fixtures are the source of truth):
//   tsx tests/determinism/combat/recordFixtures.ts
//
// APPEND-ONLY DISCIPLINE (Custom Rule 3 / FR-2 / architecture §7.5):
//   Fixtures on disk are FROZEN artifacts. This script never overwrites an
//   existing fixture file — if a fixture would produce different bytes from
//   what's on disk, the script FAILS LOUD. To add a new scenario, append a
//   new entry to SCENARIOS below and run this script; the new file appears
//   and the manifest is updated to include it. To retire a bad seed, do NOT
//   delete the file — leave it and add a superseding one.
//
// The manifest (`combat/manifest.json`) is rebuilt from the fixtures on disk
// after any writes: it lists SHA-256 for every seed-*.json file present. The
// hash-lock test (`combatGolden.test.ts`) reads both and asserts equality —
// so if a developer ever edits a historical fixture, the on-disk SHA drifts
// from the recorded manifest entry and CI fails.
//
// DETERMINISM: every scenario below is a pure data record; the digests come
// from running `runMatch` with the scripted / pure-function `fixtureCommanders`.
// The script itself uses no wall clock, no Math.random — the sim runs it does
// are the whole entropy budget. This is what makes the recorded digests
// reproducible across machines and across days: the same script produces the
// same bytes.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  buildInitialState,
  matchDigest,
  runMatch,
  runTurn,
  seedOf,
  type Arena,
  type CombatConfig,
  type Commander,
  type MatchConfig,
  type MatchState,
  type SimFleet,
  type SimShip,
} from '../../../src/sim/index.js';
import type { PhysicsConfig } from '../../../src/sim/physics/index.js';
import type { Seed } from '../../../src/sim/mathx/index.js';
import {
  fleetScriptFromArray,
  scriptedCommander,
  simpleFireAndMissileCommander,
  simpleFireCommander,
  type TurnScript,
} from '../../../tools/balance/fixtureCommanders.js';

// ---------------------------------------------------------------------------
// Directory + write helpers
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(HERE, 'manifest.json');
const MAX_TURNS_SAFETY = 200; // test-only runaway guard; fixtures MUST terminate well before this

// ---------------------------------------------------------------------------
// Config helpers — bake tuning values directly (fixtures are self-contained).
// The catalog values these mirror are on the tuning.json side (F1); baking
// them here means a tuning re-tune doesn't invalidate a frozen fixture.
// ---------------------------------------------------------------------------

const arena = (radius: number): Arena => ({
  center: { x: 0, y: 0, z: 0 },
  radius,
});

const defaultPhysics = (a: Arena): PhysicsConfig => ({
  dt: 10,
  subStepMin: 4,
  subStepMax: 64,
  restitution: 0.15,
  collisionDamageCoefficient: 0.0012,
  arena: a,
});

const defaultCombat = (): CombatConfig => ({
  hazards: {
    maxSimultaneousBodies: 300,
    debrisLifetimeTurns: 6,
    debrisPerDestruction: {
      fighter: 2,
      frigate: 4,
      cruiser: 7,
      'mega-destroyer': 12,
    },
    debrisScatterImpulse: 120,
    debrisMassFractionOfHull: 0.06,
    debrisRadius: 12,
  },
  destruction: {
    aoeRadiusByClass: {
      fighter: 90,
      frigate: 160,
      cruiser: 260,
      'mega-destroyer': 400,
    },
    aoeDamageByClass: {
      fighter: 12,
      frigate: 30,
      cruiser: 70,
      'mega-destroyer': 140,
    },
  },
  missiles: {
    trackingBeats: 2,
    spentRemainsArmed: true,
    reacquireOnTargetLoss: false,
  },
  shields: { regenTicksRegardlessOfDamage: true },
});

// ---------------------------------------------------------------------------
// Ship / fleet factories. These construct `SimShip` directly (not via the
// domain resolver) so the fixture can pin exactly the profile it needs — the
// determinism proof only cares that the SIM produces the same digest for the
// same SimShip, not that the domain produced the same SimShip.
// ---------------------------------------------------------------------------

const ship = (name: string, overrides: Partial<SimShip>): SimShip => ({
  buildId: `fixture-${name}`,
  name,
  chassisClass: 'frigate',
  mass: 30,
  radius: 15,
  maxHull: 100,
  shieldCapacity: 0,
  shieldRegenPerTurn: 0,
  deltaVPerTurn: 200,
  baseEvasion: 0,
  hullRepairPerTurn: 0,
  weapons: [],
  missiles: [],
  pointDefense: [],
  decoys: [],
  ...overrides,
});

const fleet = (fleetId: number, ships: readonly SimShip[]): SimFleet => ({
  fleetId,
  ships,
});

// ---------------------------------------------------------------------------
// Commander spec — how the recorder AND the golden test reconstruct the same
// Commander[] from a fixture. The pure-function commanders are pinned by
// their `kind`; a per-turn scripted commander includes its plan table.
// ---------------------------------------------------------------------------

export interface FixtureCommanderSpec {
  readonly fleetId: number;
  readonly kind: 'simple-fire' | 'simple-fire-missile' | 'scripted';
  /** Present iff `kind === 'scripted'`. One entry per turn, in ascending
   *  turn order (missing trailing turns coast + no-attack). */
  readonly turns?: readonly TurnScript[];
}

/** Rebuild the Commander[] from a fixture's `commanders` spec array. Used
 *  by the recorder AND every fixture-driven test — one code path. */
export const buildCommanders = (
  specs: readonly FixtureCommanderSpec[],
): Commander[] =>
  specs.map((s) => {
    switch (s.kind) {
      case 'simple-fire':
        return simpleFireCommander(s.fleetId);
      case 'simple-fire-missile':
        return simpleFireAndMissileCommander(s.fleetId);
      case 'scripted':
        if (s.turns === undefined) {
          throw new Error(
            `scripted commander for fleet ${s.fleetId} is missing its "turns" table`,
          );
        }
        return scriptedCommander(s.fleetId, fleetScriptFromArray(s.turns));
    }
  });

// ---------------------------------------------------------------------------
// Scenario shape — pure data. Each entry becomes one fixture JSON file.
// ---------------------------------------------------------------------------

interface Scenario {
  /** Filename stem (adds `.json`). Must be filesystem-safe and lowercased. */
  readonly name: string;
  readonly description: string;
  readonly seed: Seed;
  readonly arena: Arena;
  readonly physics: PhysicsConfig;
  readonly combat: CombatConfig;
  readonly fleets: readonly SimFleet[];
  readonly commanders: readonly FixtureCommanderSpec[];
}

const buildConfig = (s: Scenario): MatchConfig => ({
  seed: s.seed,
  fleets: s.fleets,
  arena: s.arena,
  physics: s.physics,
  combat: s.combat,
});

// ---------------------------------------------------------------------------
// SCENARIOS — the actual seeded matches. Each one MUST terminate under
// scripted plans without relying on `maxTurnsGuard` (a game rule, not a
// safety valve, per FR-27 / Custom Rule 5). The safety cap in
// `runMatchRecord` below fires only if a fixture is misauthored — a failure
// means edit the scenario until it terminates naturally.
// ---------------------------------------------------------------------------

const smallFrigateArena = arena(500);

/** Scenario 1 — 1v1 duel. Two frigate-class ships with a single high-accuracy
 *  cannon, no shields; identical stats → mutual destruction is possible but
 *  the seeded RNG picks a winner (or a mutual outcome) — the RECORDED digest
 *  fixes what actually happens. */
const SCEN_DUEL: Scenario = {
  name: 'seed-1-duel',
  description:
    '1v1 frigate duel with a single 40-damage cannon each; small arena, no shields, no movement.',
  seed: seedOf(0x11111111, 0x22222222),
  arena: smallFrigateArena,
  physics: defaultPhysics(smallFrigateArena),
  combat: defaultCombat(),
  fleets: [
    fleet(0, [
      ship('Alpha', {
        maxHull: 100,
        weapons: [{ range: 2000, damage: 40, shotsPerTurn: 1, accuracy: 1 }],
      }),
    ]),
    fleet(1, [
      ship('Bravo', {
        maxHull: 100,
        weapons: [{ range: 2000, damage: 40, shotsPerTurn: 1, accuracy: 1 }],
      }),
    ]),
  ],
  commanders: [
    { fleetId: 0, kind: 'simple-fire' },
    { fleetId: 1, kind: 'simple-fire' },
  ],
};

/** Scenario 2 — asymmetric duel with a shield. Fleet 0 has a bigger cannon
 *  and shield; Fleet 1 has less hull and no shield. Exercises shield → hull
 *  overflow accounting in `applyDamageBundle`. */
const SCEN_ASYMMETRIC: Scenario = {
  name: 'seed-2-asymmetric',
  description:
    '1v1 asymmetric — Fleet 0 is heavily armed and shielded; Fleet 1 is fragile. Exercises shield/hull overflow and multi-turn attrition.',
  seed: seedOf(0x0a0b0c0d, 0x1a2b3c4d),
  arena: smallFrigateArena,
  physics: defaultPhysics(smallFrigateArena),
  combat: defaultCombat(),
  fleets: [
    fleet(0, [
      ship('Titan', {
        chassisClass: 'cruiser',
        maxHull: 220,
        shieldCapacity: 80,
        shieldRegenPerTurn: 10,
        weapons: [{ range: 2000, damage: 55, shotsPerTurn: 1, accuracy: 0.9 }],
      }),
    ]),
    fleet(1, [
      ship('Skiff', {
        chassisClass: 'fighter',
        maxHull: 60,
        weapons: [{ range: 2000, damage: 20, shotsPerTurn: 2, accuracy: 0.85 }],
      }),
    ]),
  ],
  commanders: [
    { fleetId: 0, kind: 'simple-fire' },
    { fleetId: 1, kind: 'simple-fire' },
  ],
};

/** Scenario 3 — 3-way brawl. Three fleets, each 1 fighter. `simple-fire`
 *  targets the lowest-BodyId enemy, so fleets 1 and 2 gang up on fleet 0,
 *  which dies first, then fleet 1 and 2 trade shots until one falls. Ends
 *  in `victory`, not mutual destruction (weapons hit reliably). */
const SCEN_TRIANGLE: Scenario = {
  name: 'seed-3-triangle',
  description:
    '3-way 1v1v1 free-for-all. Simple-fire commanders target lowest-BodyId enemy → fleets 1+2 gang on fleet 0 first.',
  seed: seedOf(0x33333333, 0x44444444),
  arena: arena(600),
  physics: defaultPhysics(arena(600)),
  combat: defaultCombat(),
  fleets: [
    fleet(0, [
      ship('Vanguard', {
        chassisClass: 'fighter',
        maxHull: 40,
        weapons: [{ range: 2000, damage: 20, shotsPerTurn: 1, accuracy: 0.9 }],
      }),
    ]),
    fleet(1, [
      ship('Sentinel', {
        chassisClass: 'fighter',
        maxHull: 40,
        weapons: [{ range: 2000, damage: 20, shotsPerTurn: 1, accuracy: 0.9 }],
      }),
    ]),
    fleet(2, [
      ship('Marauder', {
        chassisClass: 'fighter',
        maxHull: 40,
        weapons: [{ range: 2000, damage: 20, shotsPerTurn: 1, accuracy: 0.9 }],
      }),
    ]),
  ],
  commanders: [
    { fleetId: 0, kind: 'simple-fire' },
    { fleetId: 1, kind: 'simple-fire' },
    { fleetId: 2, kind: 'simple-fire' },
  ],
};

/** Scenario 4 — missile cascade. Two cruisers with cannons + one missile
 *  rack each. Launched missiles track for `combat.missiles.trackingBeats = 2`
 *  beats, then fuel out (still armed per config), and detonate on contact
 *  producing AoE damage. Exercises the missile guidance + detonation +
 *  ownership-blind AoE code path (FR-23/FR-24). */
const missileCascadeArena = arena(800);
const SCEN_MISSILE_CASCADE: Scenario = {
  name: 'seed-4-missile-cascade',
  description:
    '1v1 cruiser duel with missiles + guns. Missiles fuel out after tracking, detonate on contact with ownership-blind AoE (FR-23/FR-24).',
  seed: seedOf(0x55aa55aa, 0x33cc33cc),
  arena: missileCascadeArena,
  physics: defaultPhysics(missileCascadeArena),
  combat: defaultCombat(),
  fleets: [
    fleet(0, [
      ship('Hammerhead-Prime', {
        chassisClass: 'cruiser',
        maxHull: 180,
        shieldCapacity: 60,
        shieldRegenPerTurn: 8,
        mass: 80,
        radius: 30,
        weapons: [{ range: 2500, damage: 35, shotsPerTurn: 1, accuracy: 0.8 }],
        missiles: [
          {
            ammo: 3,
            damage: 30,
            aoeRadius: 120,
            boostVelocity: 300,
            trackingTurnRate: 0.25,
            bodyMass: 3,
            bodyRadius: 8,
          },
        ],
      }),
    ]),
    fleet(1, [
      ship('Hammerhead-Second', {
        chassisClass: 'cruiser',
        maxHull: 180,
        shieldCapacity: 60,
        shieldRegenPerTurn: 8,
        mass: 80,
        radius: 30,
        weapons: [{ range: 2500, damage: 35, shotsPerTurn: 1, accuracy: 0.8 }],
        missiles: [
          {
            ammo: 3,
            damage: 30,
            aoeRadius: 120,
            boostVelocity: 300,
            trackingTurnRate: 0.25,
            bodyMass: 3,
            bodyRadius: 8,
          },
        ],
      }),
    ]),
  ],
  commanders: [
    { fleetId: 0, kind: 'simple-fire-missile' },
    { fleetId: 1, kind: 'simple-fire-missile' },
  ],
};

/** Scenario 5 — collision / boundary. A scripted commander drives both ships
 *  toward each other with a strong first-turn deltaV, then coasts. Bodies
 *  eventually collide (collision damage per FR-22) or one exits the small
 *  arena (boundary death per FR-26). Exercises physics-integrated damage
 *  and the boundary-exit event path. */
const collisionArena = arena(700);
const rammingCommanderTurns = (deltaVX: number): readonly TurnScript[] => [
  {
    movement: [{ bodyId: 0, deltaV: { x: deltaVX, y: 0, z: 0 } }],
    attack: [],
  },
];
const SCEN_COLLISION: Scenario = {
  name: 'seed-5-collision',
  description:
    '1v1 ramming — scripted commanders push both ships toward each other on turn 1, then coast. Tests collision damage / boundary-exit resolution.',
  seed: seedOf(0x77775555, 0x99993333),
  arena: collisionArena,
  physics: defaultPhysics(collisionArena),
  combat: defaultCombat(),
  fleets: [
    fleet(0, [
      ship('Ram-Alpha', {
        chassisClass: 'frigate',
        maxHull: 80,
        mass: 40,
        radius: 18,
        deltaVPerTurn: 400,
        weapons: [{ range: 1200, damage: 20, shotsPerTurn: 1, accuracy: 0.8 }],
      }),
    ]),
    fleet(1, [
      ship('Ram-Bravo', {
        chassisClass: 'frigate',
        maxHull: 80,
        mass: 40,
        radius: 18,
        deltaVPerTurn: 400,
        weapons: [{ range: 1200, damage: 20, shotsPerTurn: 1, accuracy: 0.8 }],
      }),
    ]),
  ],
  commanders: [
    // Fleet 0 is placed at +x (equator, phase-rotated by placement RNG),
    // Fleet 1 opposite. We patch the correct bodyId at record time — see
    // note in `patchRammingScripts`. Turn 1: strong deltaV toward opponent
    // (approximated by +/-x — the placement rotation is small enough that
    // an x-only impulse still closes distance across turns).
    { fleetId: 0, kind: 'scripted', turns: rammingCommanderTurns(+400) },
    { fleetId: 1, kind: 'scripted', turns: rammingCommanderTurns(-400) },
  ],
};

/**
 * Rewrite the scripted commander plans in SCEN_COLLISION to reference the
 * actual bodyIds assigned by createMatch (they aren't 0 — id 0 is reserved
 * per createMatch.ts). This lets the scenario declaration above stay
 * readable while the recorder still produces correct plans.
 */
const patchRammingScripts = (scenario: Scenario): Scenario => {
  const state = buildInitialState(buildConfig(scenario));
  // Order the ship bodyIds by fleetId (same order createMatch mints them).
  const idsByFleet = new Map<number, number[]>();
  for (const [id, fid] of state.fleetOf) {
    if (!idsByFleet.has(fid)) idsByFleet.set(fid, []);
    idsByFleet.get(fid)!.push(id);
  }
  for (const arr of idsByFleet.values()) arr.sort((a, b) => a - b);
  const patchedCommanders: FixtureCommanderSpec[] = scenario.commanders.map(
    (spec) => {
      if (spec.kind !== 'scripted' || spec.turns === undefined) return spec;
      const shipIds = idsByFleet.get(spec.fleetId) ?? [];
      const patchedTurns = spec.turns.map((t) => ({
        movement: t.movement.map((mp, i) => ({
          ...mp,
          bodyId: shipIds[i] ?? mp.bodyId,
        })),
        attack: t.attack.slice(),
      }));
      return { ...spec, turns: patchedTurns };
    },
  );
  return { ...scenario, commanders: patchedCommanders };
};

const SCENARIOS: readonly Scenario[] = [
  SCEN_DUEL,
  SCEN_ASYMMETRIC,
  SCEN_TRIANGLE,
  SCEN_MISSILE_CASCADE,
  patchRammingScripts(SCEN_COLLISION),
];

// ---------------------------------------------------------------------------
// Match runner — mirrors runMatch but exposes per-turn `matchDigest`s so the
// fixture can pin state at every turn boundary, not only at victory.
// ---------------------------------------------------------------------------

interface RunRecord {
  readonly perTurnDigests: readonly string[];
  readonly outcome: { readonly kind: string; readonly fleetId?: number; readonly turns: number };
}

const runMatchRecord = async (
  initial: MatchState,
  commanders: readonly Commander[],
): Promise<RunRecord> => {
  let state = initial;
  const perTurnDigests: string[] = [];
  let outcomeResult: RunRecord['outcome'] | null = null;
  let turnsElapsed = 0;
  while (outcomeResult === null) {
    turnsElapsed += 1;
    if (turnsElapsed > MAX_TURNS_SAFETY) {
      throw new Error(
        `recordFixtures: scenario did not terminate within ${MAX_TURNS_SAFETY} turns — misauthored scenario (fixtures must terminate under FR-27 without a game-rule turn cap).`,
      );
    }
    const turn = await runTurn(state, commanders);
    state = turn.state;
    perTurnDigests.push(matchDigest(state));
    if (turn.outcome !== null) {
      if (turn.outcome.kind === 'victory') {
        outcomeResult = {
          kind: 'victory',
          fleetId: turn.outcome.fleetId,
          turns: turn.outcome.turns,
        };
      } else {
        outcomeResult = {
          kind: 'mutual-destruction',
          turns: turn.outcome.turns,
        };
      }
    }
  }
  return { perTurnDigests, outcome: outcomeResult };
};

// ---------------------------------------------------------------------------
// Serialize a scenario + its recorded run into the fixture JSON on disk.
// ---------------------------------------------------------------------------

interface FixtureFile {
  readonly name: string;
  readonly description: string;
  readonly seed: Seed;
  readonly arena: Arena;
  readonly physics: PhysicsConfig;
  readonly combat: CombatConfig;
  readonly fleets: readonly SimFleet[];
  readonly commanders: readonly FixtureCommanderSpec[];
  readonly expected: {
    readonly initialDigest: string;
    readonly perTurnDigests: readonly string[];
    readonly finalDigest: string;
    readonly outcome: RunRecord['outcome'];
  };
}

const runOne = async (scen: Scenario): Promise<FixtureFile> => {
  const config = buildConfig(scen);
  const initial = buildInitialState(config);
  const initialDigest = matchDigest(initial);
  const commanders = buildCommanders(scen.commanders);
  // Also sanity: replay runMatch (the canonical entry) and compare its final
  // digest to the last per-turn digest — proves the two entry points agree.
  const record = await runMatchRecord(initial, commanders);
  const commanders2 = buildCommanders(scen.commanders);
  const runMatchResult = await runMatch(buildInitialState(config), commanders2);
  const finalDigest = matchDigest(runMatchResult.state);
  const perTurnLast = record.perTurnDigests[record.perTurnDigests.length - 1];
  if (perTurnLast !== finalDigest) {
    throw new Error(
      `recordFixtures[${scen.name}]: per-turn last digest ${perTurnLast} ≠ runMatch final digest ${finalDigest} — sim inconsistency.`,
    );
  }
  return {
    name: scen.name,
    description: scen.description,
    seed: scen.seed,
    arena: scen.arena,
    physics: scen.physics,
    combat: scen.combat,
    fleets: scen.fleets,
    commanders: scen.commanders,
    expected: {
      initialDigest,
      perTurnDigests: record.perTurnDigests,
      finalDigest,
      outcome: record.outcome,
    },
  };
};

const serialize = (f: FixtureFile): string =>
  JSON.stringify(f, null, 2) + '\n';

const sha256Hex = (bytes: Buffer): string =>
  createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------------------
// Main — write fixtures + rebuild manifest.
// ---------------------------------------------------------------------------

const main = async (): Promise<void> => {
  fs.mkdirSync(HERE, { recursive: true });
  let wrote = 0;
  let unchanged = 0;
  for (const scen of SCENARIOS) {
    const fixture = await runOne(scen);
    const body = serialize(fixture);
    const filePath = path.join(HERE, `${scen.name}.json`);
    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath, 'utf8');
      if (existing === body) {
        unchanged += 1;
        continue;
      }
      throw new Error(
        `recordFixtures: on-disk fixture ${scen.name}.json would change bytes — historical fixtures are append-only (Custom Rule 3 / FR-2). If a scenario truly needs a new outcome, ADD a new scenario (different name) rather than editing an existing one.`,
      );
    }
    fs.writeFileSync(filePath, body, 'utf8');
    wrote += 1;
    process.stdout.write(`recorded ${scen.name}.json\n`);
  }

  // Rebuild manifest from on-disk fixtures (SHA-256 per file).
  const fixtureFiles = fs
    .readdirSync(HERE)
    .filter((n) => n.endsWith('.json') && n !== 'manifest.json')
    .sort();
  const fixtures: Record<string, string> = {};
  for (const name of fixtureFiles) {
    const bytes = fs.readFileSync(path.join(HERE, name));
    fixtures[name] = sha256Hex(bytes);
  }
  const manifest = {
    $comment:
      'Hash-lock for tests/determinism/combat/*.json (Custom Rule 3, FR-2, architecture §7.5). Append-only: adding a new fixture appends a new entry; editing a historical fixture makes combatGolden.test.ts fail. Regenerated by recordFixtures.ts.',
    algorithm: 'SHA-256' as const,
    fixtures,
  };
  const manifestBody = JSON.stringify(manifest, null, 2) + '\n';
  fs.writeFileSync(MANIFEST_PATH, manifestBody, 'utf8');
  process.stdout.write(
    `recordFixtures: ${wrote} written, ${unchanged} unchanged; manifest lists ${fixtureFiles.length} fixture(s).\n`,
  );
};

// Only run as a script when invoked directly (tsx recordFixtures.ts) — never
// on import. `buildCommanders` + `FixtureCommanderSpec` are imported by the
// test files, and running `main()` during a `vitest` invocation would re-run
// the full sim per test file and (worse) attempt to write files.
const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(
      `recordFixtures: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
