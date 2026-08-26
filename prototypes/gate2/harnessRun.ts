// prototypes/gate2/harnessRun.ts — the Gate 2 verdict driver (disposable, FR-32).
//
// Runs N seeded scenarios of bot-vs-bot through the real deterministic sim, invoking
// S04's `runScenario` one beat at a time so per-beat plans can be regenerated against
// the updated state (S04 pre-computes `plansPerBeat`; a live match re-plans each beat).
//
// Checkpoint 1 scope (this file):
//   - Build a small seeded scenario (6 ships in 2 fleets).
//   - Plan both fleets each beat with `planFleet`.
//   - Advance the beat via `runScenario`.
//   - Assert every plan's deltaV magnitude stays within the budget.
//   - Print raw contact + exit counts for eyeballing.
//   CP2 wires the FR-29 boundary constraint into the planner; CP3 extends this to a
//   100-seed run with unforced-vs-forced classification and the gate verdict.
//
// Usage (CP1):
//   tsx prototypes/gate2/harnessRun.ts                     # seeds 1..5, 10 beats
//   tsx prototypes/gate2/harnessRun.ts --seeds 1..3        # override seed range
//   tsx prototypes/gate2/harnessRun.ts --beats 6           # override beat count

import { of, seedOf, hash, randRange, type Seed } from '../../src/sim/mathx/index.js';
import { length as vecLength } from '../../src/sim/mathx/vec3.js';
import type { Body, BodyId } from '../../src/sim/types.js';
import type { PhysicsConfig } from '../../src/sim/physics/index.js';
import { runScenario, type Scenario } from '../../tools/balance/scenario.js';
import { makeBlindView } from './blindView.js';
import { DEFAULT_PLANNER_CONFIG, planFleet, type PlannerConfig } from './botPlanner.js';

// ---------------------------------------------------------------------------
// Physics config for Gate 2 scenarios. Same shape as S04's HARNESS_CONFIG so a
// human eyeballing digests can tell they share tuning. Arena a touch tighter (800)
// so the boundary matters within the beat budget.
// ---------------------------------------------------------------------------

const GATE2_CONFIG: PhysicsConfig = {
  dt: 1,
  subStepMin: 4,
  subStepMax: 64,
  restitution: 0.15,
  collisionDamageCoefficient: 0.0012,
  arena: { center: of(0, 0, 0), radius: 800 },
};

// Same avalanche construction as S04's harnessScenarios — feeds the seed integer
// through the sim's own hash so different seed integers get well-mixed 64-bit seeds.
// Never `Math.random`; the whole harness must be reproducible seed-for-seed.
const DERIVE_BASE = seedOf(0x9e3779b9, 0x243f6a88);
const deriveSeed = (n: number): Seed =>
  seedOf(hash(DERIVE_BASE, n >>> 0, 0x1), hash(DERIVE_BASE, n >>> 0, 0x2));

// ---------------------------------------------------------------------------
// Scenario builder — 6 ships in 2 fleets (odd ids → fleet 1, even ids → fleet 2).
// Position span ±700 in x/z and ±350 in y sits mostly inside the 800 shell but
// puts a healthy fraction of seeds near the wall. Velocity span ±140 is enough
// that a ship near the wall heading outward is a boundary threat within one beat.
// ---------------------------------------------------------------------------

interface Setup {
  readonly bodies: readonly Body[];
  readonly ownedByFleet: ReadonlyMap<number, ReadonlySet<BodyId>>;
}

const buildSetup = (n: number): Setup => {
  const seed = deriveSeed(n);
  const bodies: Body[] = [];
  const fleet1 = new Set<BodyId>();
  const fleet2 = new Set<BodyId>();
  const SHIP_COUNT = 6;
  for (let i = 0; i < SHIP_COUNT; i += 1) {
    const id: BodyId = i + 1;
    const body: Body = {
      kind: 'ship',
      id,
      position: of(
        randRange(seed, -700, 700, i, 0),
        randRange(seed, -350, 350, i, 1),
        randRange(seed, -700, 700, i, 2),
      ),
      velocity: of(
        randRange(seed, -140, 140, i, 3),
        randRange(seed, -70, 70, i, 4),
        randRange(seed, -140, 140, i, 5),
      ),
      mass: 100,
      radius: 30,
    };
    bodies.push(body);
    (id % 2 === 1 ? fleet1 : fleet2).add(id);
  }
  const ownedByFleet = new Map<number, ReadonlySet<BodyId>>();
  ownedByFleet.set(1, fleet1);
  ownedByFleet.set(2, fleet2);
  return { bodies, ownedByFleet };
};

// ---------------------------------------------------------------------------
// Per-scenario driver. Threads state through beats, re-planning each beat.
// ---------------------------------------------------------------------------

interface ScenarioTally {
  readonly seed: number;
  readonly beatsRun: number;
  readonly totalContacts: number;
  readonly totalShipExits: number;
  readonly survivors: number;
}

const BUDGET_EPSILON = 1e-9;

const runOneScenario = (n: number, beats: number, planner: PlannerConfig): ScenarioTally => {
  const { bodies: initialBodies, ownedByFleet: initialOwned } = buildSetup(n);
  let current: readonly Body[] = initialBodies;
  const owned: Map<number, Set<BodyId>> = new Map();
  for (const [fleetId, set] of initialOwned) owned.set(fleetId, new Set(set));

  const seed = deriveSeed(n);
  let contacts = 0;
  let shipExits = 0;
  let beatsRun = 0;

  for (let beat = 0; beat < beats; beat += 1) {
    // Early-out: fewer than 2 live fleets → nothing meaningful left to plan.
    let liveFleets = 0;
    for (const set of owned.values()) if (set.size > 0) liveFleets += 1;
    if (liveFleets < 2) break;

    const view = makeBlindView(current, GATE2_CONFIG.arena);

    // Every commander sees the SAME view BEFORE any plan is collected (architecture
    // §6.2). Collect all plans, then apply.
    const allPlans = [];
    for (const [, ownedIds] of owned) {
      const fleetPlans = planFleet(view, ownedIds, GATE2_CONFIG, planner);
      for (const p of fleetPlans) allPlans.push(p);
    }

    // Assertion (CP1): every plan respects the delta-V budget. If this ever trips,
    // the planner has a clampLength bug.
    for (let i = 0; i < allPlans.length; i += 1) {
      const mag = vecLength(allPlans[i]!.deltaV);
      if (mag > planner.deltaVBudget + BUDGET_EPSILON) {
        throw new Error(
          `seed=${n} beat=${beat} bodyId=${allPlans[i]!.bodyId}: ` +
            `deltaV magnitude ${mag} exceeds budget ${planner.deltaVBudget}`,
        );
      }
    }

    // Drive S04's runScenario for one beat. Kept as a scenario object (not a raw
    // resolveMovement call) so the harness reuse is literal.
    const singleBeat: Scenario = {
      kind: 'physics',
      name: `gate2-seed-${n}-beat-${beat}`,
      seed,
      config: GATE2_CONFIG,
      bodies: current,
      plansPerBeat: [allPlans],
      beats: 1,
    };
    const result = runScenario(singleBeat);
    const step = result.beats[0]!.step;
    contacts += step.contacts.length;
    for (let i = 0; i < step.exits.length; i += 1) {
      if (step.exits[i]!.kind === 'ship-destroyed') shipExits += 1;
    }

    // Update owned sets — dead ships leave.
    const survivorIds = new Set<BodyId>();
    for (let i = 0; i < step.finalBodies.length; i += 1) survivorIds.add(step.finalBodies[i]!.id);
    for (const set of owned.values()) {
      for (const id of Array.from(set)) if (!survivorIds.has(id)) set.delete(id);
    }
    current = step.finalBodies;
    beatsRun += 1;
  }

  return {
    seed: n,
    beatsRun,
    totalContacts: contacts,
    totalShipExits: shipExits,
    survivors: current.length,
  };
};

// ---------------------------------------------------------------------------
// CLI. Kept small and hand-rolled — mirrors tools/balance/cli.ts style.
// ---------------------------------------------------------------------------

interface CliOptions {
  readonly seedStart: number;
  readonly seedEnd: number;
  readonly beats: number;
}

const parseArgs = (argv: readonly string[]): CliOptions => {
  let seedStart = 1;
  let seedEnd = 5;
  let beats = 10;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === '--seeds') {
      const spec = argv[i + 1] ?? '';
      const m = /^(\d+)\.\.(\d+)$/.exec(spec);
      if (!m) throw new Error(`--seeds expects "A..B" (got ${JSON.stringify(spec)})`);
      seedStart = Number(m[1]);
      seedEnd = Number(m[2]);
      if (seedStart > seedEnd) throw new Error(`--seeds range empty: ${spec}`);
      i += 1;
    } else if (a === '--beats') {
      beats = Number(argv[i + 1] ?? '10');
      if (!Number.isInteger(beats) || beats <= 0) throw new Error('--beats must be a positive integer');
      i += 1;
    } else if (a === '--help' || a === '-h') {
      process.stdout.write(
        `gate2 harness (CP1) — bot vs bot smoke, budget-assert only\n\n` +
          `  --seeds A..B     (default 1..5)\n` +
          `  --beats N        (default 10)\n`,
      );
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return { seedStart, seedEnd, beats };
};

const main = (): void => {
  const opts = parseArgs(process.argv.slice(2));
  const planner = DEFAULT_PLANNER_CONFIG;

  let totalContacts = 0;
  let totalBeats = 0;
  let totalShipExits = 0;

  for (let n = opts.seedStart; n <= opts.seedEnd; n += 1) {
    const t = runOneScenario(n, opts.beats, planner);
    totalContacts += t.totalContacts;
    totalBeats += t.beatsRun;
    totalShipExits += t.totalShipExits;
    process.stdout.write(
      `seed=${n} beats=${t.beatsRun} contacts=${t.totalContacts} ship-exits=${t.totalShipExits} survivors=${t.survivors}\n`,
    );
  }

  const scenarioCount = opts.seedEnd - opts.seedStart + 1;
  process.stdout.write(`\n--- gate 2 CP1 smoke ---\n`);
  process.stdout.write(`scenarios: ${scenarioCount} (seeds ${opts.seedStart}..${opts.seedEnd})\n`);
  process.stdout.write(`beats run: ${totalBeats}\n`);
  process.stdout.write(`total contacts: ${totalContacts}\n`);
  process.stdout.write(`total ship boundary exits: ${totalShipExits}\n`);
  process.stdout.write(`planner delta-V budget: ${planner.deltaVBudget} (asserted per plan)\n`);
};

main();
