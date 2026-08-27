# M17 — Balance Harness + M19 Determinism Rig (as built)

> Architecture-as-built detail for M17 (`tools/balance/`) and the M19 determinism rig
> (`tests/determinism/`, `playwright.config.ts`, `tests/e2e/determinism.spec.ts`). Session-marked;
> appended by Jikijitsu from the worker's arch fragment. Disk-only (`program/` gitignored).

<!-- SESSION-04 -->
# SESSION-04 — architecture delta (M17 Balance Harness + M19 Determinism Rig)

Additive fragment only — records the surfaces added in `foundation-gates SESSION-04`.

## M17 · Balance Harness — new public surface at physics scope (`tools/balance/`)

Everything under `tools/balance/` imports only from `src/sim/**` (+ `node:*` in the
CLI code path). No render, no ui, no persist, no npm runtime packages — this is
enforced structurally by `purity-check.ts` (see below) and by the sim boundary
lint. F4 extends the same module without a rewrite: `Scenario` becomes a
discriminated union that adds a `MatchScenario` variant, `runScenario` gains a
`kind`-switch, and the digest already covers everything `resolveMovement` reports.

| Export | File | Purpose |
|--------|------|---------|
| `type Scenario` (alias of `PhysicsScenario`) | `scenario.ts` | Plain-record scenario shape; JSON-serializable end to end. `kind: 'physics'` today; F4 adds `'match'` |
| `type PhysicsScenario` | `scenario.ts` | `{ kind, name, seed, config, bodies, plansPerBeat, beats }` |
| `type BeatOutcome` / `ScenarioResult` | `scenario.ts` | Per-beat trace + convenience `finalBodies` |
| `runScenario(scenario): ScenarioResult` | `scenario.ts` | Pure. Drives `resolveMovement` for `scenario.beats` beats, threading `finalBodies` forward |
| `hexFloat(n): string` | `digest.ts` | IEEE-754 float64 → 16 hex chars via DataView (engine-portable) |
| `canonicalize(result): string` | `digest.ts` | Line-based canonical text (see grammar below) |
| `fnv1a64(text): string` | `digest.ts` | 64-bit FNV-1a via BigInt (engine-portable) |
| `digest(result): string` | `digest.ts` | `fnv1a64(canonicalize(result))` — 16 hex chars |
| `type PerScenarioSummary` / `AggregateSummary` | `aggregate.ts` | Skeleton stats (beats / contacts / exits / survivors). F4 layers on win-rate + usage-rate maps |
| `summarize(result)`, `aggregate(summaries)` | `aggregate.ts` | Pure reducers |
| `HARNESS_CONFIG`, `seedToScenario(n, beats?)` | `harnessScenarios.ts` | Demo-scenario factory the CLI drives from. Deterministic via `hash(BASE, n, tag)` twice for the seed |

### Digest canonical grammar (`canonicalize`)

Per beat:
```
b <beat> N=<subStepCount>
B <id> <kind> <hex(mass)> <hex(radius)> <hex(pos*3)> <hex(vel*3)>       # per body, sorted by id
C <subStep> <hex(toi)> <idA> <idB> <hex(normal*3)> <hex(point*3)> <hex(relSpeedNormal)> <hex(damage)>
E <bodyId> <kind> <subStep>
```
Trailing newline. Sub-step keyframes are deliberately NOT hashed (contacts already
pin every collision-boundary state; keyframes would 5×–64× the string).

**Anchored to** the S02-frozen mathx RNG stream and the S03 physics. A change to
either invalidates every recorded fixture and must be paired with a coordinated
regeneration (Custom Rule 3 / FR-2).

### Recorded golden digests (Gate 1b determinism record — Node + all 3 browsers agree)

`seed-1 ab502758947c3854 · seed-2 cb2a719e3f68bc87 · seed-3 d2211e110780c78d · seed-4 6ae021d8bd55eb71 · seed-5 9d7dc7b5662c1636 · seed-6 dfc0b05e4b1c85e2 · seed-7 27fd298591081cf2 · seed-8 4ddc92ecbef9b1f3`

## M17 · CLI entry — `tools/balance/cli.ts` + `purity-check.ts`

- `cli.ts`: `--seeds A..B --beats N --record DIR --quiet`. Digests to **stdout**
  (byte-identical across runs — the CP1 acceptance); throughput/summary to **stderr**.
- `purity-check.ts`: bundles `cli.ts` with esbuild in-memory (`format: 'iife'`,
  `platform: 'node'`, `external: ['node:*']`), greps output for `three` / `preact` /
  `document`, exits non-zero on any hit. **Structural half of FR-33**; complements
  the sim-side boundary lint. Verified end-to-end: injecting `console.log("document")`
  into the harness triggers a caught failure with a source excerpt.
  - The banned tokens are stored as `.join('')`'d character arrays inside
    `purity-check.ts` itself so its own source doesn't trip a future purity check.

## M19 · Determinism rig — `tests/determinism/**`

| File | Guarantees |
|------|------------|
| `fixtures/*.json` | 8 recorded physics scenarios + their digests. **APPEND-ONLY** (FR-2 / Custom Rule 3) |
| `manifest.json` | `{ algorithm: 'SHA-256', fixtures: { <name>: <sha> } }` — one SHA-256 per fixture |
| `fixtureLoader.ts` | Shared loader (`FIXTURES_DIR`, `MANIFEST_PATH`, `fixtureNames()`, `loadFixture()`) |
| `golden.test.ts` | Every fixture: `digest(runScenario(fixture))` equals recorded digest (§7.5 row 1) |
| `shuffle.test.ts` | Every fixture: shuffled bodies + plans yield identical digest (§7.5 row 2, NFR-Correctness) |
| `tunneling.test.ts` | Scenario-scope re-assertion of the CP2 unit-scope regression (§7.5 row 3) |
| `manifest.test.ts` | Every fixture on disk hashes to its recorded SHA-256; sets agree — verified: 1-byte edit fails; restore returns green |

## M19 · Cross-engine rig — `playwright.config.ts` + `tests/e2e/determinism.spec.ts`

- **No dev server.** The spec bundles `runScenario` + `digest` with esbuild
  in-process (IIFE, `globalName: '__harnessAPI'`) and injects via `page.setContent()`.
  Every engine receives byte-identical bytes; the only variable is the engine.
- **Three projects.** Chromium / Firefox / WebKit assert per-fixture that the
  browser-computed digest equals the recorded (Node) digest — the only test
  substantiating "identical on every machine" (§7.5).
- **Local run:** Chromium 400ms · WebKit 725ms · Firefox 750ms — all 8 fixtures agree.

## CI — `.github/workflows/ci.yml` (appended, not rewritten)

- `build` job gained `test:determinism` and `test:harness-purity` steps between
  `test:unit` and `build`.
- New `cross-engine-determinism` job (needs: build) runs the Playwright spec across
  all three engines.

## F4 extension seam (recorded so F4 doesn't re-derive it)

`Scenario = PhysicsScenario` today; F4 makes it `PhysicsScenario | MatchScenario` and
`runScenario` grows a two-branch `kind` switch. `MatchScenario` carries `Fleet`s +
`MatchConfig`. The digest module needs no change. Fixtures keep their `kind` field and
gain new schema — golden/manifest tests work unchanged. Aggregator grows `winner`/`turns`
+ `winRateByChassisId` / `usageRateByComponentId`.

## Deviations / hazards flagged this session (for Forge)

- **Lease-driven e2e refactor:** the prompt sketch named `tests/e2e/browser.html` + a
  browser-harness helper, both OUTSIDE the enumerated write set. Mu stayed in-lease by
  bundling inline (esbuild) + `page.setContent()`; port 8081 unused. Recommend Forge
  enumerate `tests/e2e/**` for sessions of this shape, or codify inline-setContent.
- **`esbuild` is a transitive Vite dep**, not declared in `package.json`. If a future
  Vite upgrade drops it, purity-check + the Playwright spec fail with `ERR_MODULE_NOT_FOUND`.
  Fix = add `esbuild` to devDependencies (M01/S01 concern).
- **`/test-results/` + `/playwright-report/` not gitignored** — recommend M01/S01 add them.
- **CONCURRENCY / shared git index (materialized):** a first `git add -- <paths>` + bare
  `git commit` swept S05's pre-staged `prototypes/gate1/**` into an S04 commit; fixed via
  `git reset --mixed HEAD~1` + re-commit with `git commit -- <paths>`. Under concurrent
  orchestration the safe pattern is `git commit -- <paths>` (pathspec ON THE COMMIT), never
  `git add` + bare commit. MU.md Precept 4's snippet should carry this caveat.

<!-- sim-combat SESSION-05 -->
### M19 Tests — combat determinism suite (F4 sim-combat S05)

Fixture-based end-to-end determinism proof for the assembled sim (M09 rules
+ M10 loop + M11 trace) — the last F4 session. Regression infrastructure
only; no `src/**` change.

**Files added**

- `tests/determinism/combat/recordFixtures.ts` — one-shot dev script (append-only)
- `tests/determinism/combat/fixtureLoader.ts` — shared JSON reader
- `tests/determinism/combat/manifest.json` — SHA-256 hash lock (mirrors the
  physics + migration manifests, same discipline)
- `tests/determinism/combat/seed-*.json` — five frozen golden fixtures
- `tests/determinism/combatGolden.test.ts` — hash-lock + per-turn/final replay
- `tests/determinism/combatShuffle.test.ts` — order-independence proof
- `tests/determinism/mutualDestruction.test.ts` — inline integration cases
- `tests/e2e/combatDeterminism.spec.ts` — cross-engine (Chromium/Firefox/WebKit)
- `tools/balance/fixtureCommanders.ts` — reusable scripted / pure-fn Commanders

**New reusable seam — `tools/balance/fixtureCommanders.ts`**

Public API (imported by both the recorder and F5's future balance harness):

```ts
scriptedCommander(fleetId: number, script: FleetScript): Commander
fleetScriptFromArray(perTurn: readonly TurnScript[]): FleetScript
simpleFireCommander(fleetId: number): Commander
simpleFireAndMissileCommander(fleetId: number): Commander
```

`TurnScript = { movement: MovementPlan[]; attack: AttackPlan[] }`.
`FleetScript = ReadonlyMap<turnNumber, TurnScript>` (1-based).

All commanders are **pure functions of `(view, script)`** — no closure
state, no wall clock, no `Math.random`. `simpleFireCommander` +
`simpleFireAndMissileCommander` iterate the sim's already-sorted
`view.ships`, so their output is invariant under Map insertion-order
shuffles — a load-bearing property `combatShuffle.test.ts` proves. F5's
`HeuristicCommander` replaces these for balance runs; S05's fixtures reuse
them as the reproducibility baseline `matchDigest` compares against.

**Fixture-commander spec (JSON-serialisable)**

```ts
type FixtureCommanderSpec =
  | { fleetId: number; kind: 'simple-fire' }
  | { fleetId: number; kind: 'simple-fire-missile' }
  | { fleetId: number; kind: 'scripted'; turns: readonly TurnScript[] };
```

`buildCommanders(specs)` lives in `recordFixtures.ts` but is imported by the tests
too — one code path, one place to add a new commander kind. F5 extends by adding a
new discriminant (e.g. `{ kind: 'heuristic'; params }`) — old fixtures keep working.

**Determinism budget — what's proved by construction**

- **matchDigest is authoritative** — `combatGolden.test.ts` pins the digest after
  EVERY turn and at final. `traceDigest` is not used; matchDigest over state IS the gate.
- **Order-independence at match scope** — `combatShuffle.test.ts` shuffles per-turn
  `movement`/`attack` arrays AND state Map insertion order (`bodies`/`ships`/`fleetOf`/
  `guidances`/`debrisAge`); every permutation reproduces the recorded digest. Fleet order
  and ship-in-fleet order are deliberately NOT shuffled — they feed `createMatch`'s
  monotonic BodyId assignment, so shuffling them IS a different match.
- **Cross-engine** — `combatDeterminism.spec.ts` bundles sim + `fixtureCommanders.ts` via
  esbuild, injects into a data-URL page, replays every fixture in Chromium/Firefox/WebKit;
  same digest as the Node golden per fixture per engine (§7.5 row 4, extended to combat).
- **Append-only** — SHA-256 hash lock on every fixture; editing a historical fixture flips
  the SHA and fails `combatGolden.test.ts`; the recorder refuses to overwrite with different bytes.

**Residual sim wire-throughs surfaced here (F5's to add, NOT F4 scope)**

- Point-defense (`rules.interceptMissiles`) is not wired into `runMovementBeat` — the
  missile-cascade fixture has no interception because the loop never calls it.
- The attack-beat destruction cascade → next-movement AoE/debris is not wired; the tests
  assert today's truth (kill + `detonates=true` event) and guard the future pathway.
- Missile self-detonation smell: a launched missile spawns at the shooter's exact position,
  so next movement beat the physics overlap fires `detonatesOnContact` — the missile
  detonates on its own launcher on turn 2. Candidate v1.x refit (offset spawn by radius+eps).

<!-- ai-balance-harness SESSION-05 -->
# ai-balance-harness SESSION-05 — architecture delta (M17 · bot-vs-bot match pipeline)

### M17 Balance Harness — S05 additions (bot-vs-bot match pipeline, FR-33)

Extends the physics-scope harness (F4 sim-combat S05) with a full bot-vs-bot
match runner + FR-33 aggregation. Physics-scope surfaces (`PhysicsScenario`,
sync `runScenario`, `PerScenarioSummary`, `summarize`, `aggregate`, the CLI
default path) stay BYTE-COMPATIBLE — a `diff <(old cli --seeds 1..5) <(new cli
--seeds 1..5)` is empty. Additions land as new peer types + a new async runner
+ new aggregate exports + a `--mode match` CLI branch.

#### Public surface added

`tools/balance/scenario.ts`:

```ts
export interface MatchScenario {
  readonly kind: 'match';
  readonly name: string;
  readonly seed: Seed;
  readonly budget: number;
  readonly fleetTiers: readonly BotTier[];   // length in [minFleets, maxFleets]
}
export interface MatchFleetSnapshot {
  readonly fleetId: number;
  readonly tier: BotTier;
  readonly builds: readonly Build[];         // regenerated bot builds
}
export interface MatchScenarioResult {
  readonly scenario: MatchScenario;
  readonly outcome: MatchOutcome;            // victory | mutual-destruction
  readonly turnDigests: readonly string[];   // matchDigest per turn
  readonly fleets: readonly MatchFleetSnapshot[];
}
export const runMatchScenario:
  (scenario: MatchScenario, catalog: Catalog) => Promise<MatchScenarioResult>;
```

`tools/balance/harnessMatches.ts` (new file):

```ts
export interface SeedToMatchOpts {
  readonly budget?: number;
  readonly fleetTiers?: readonly BotTier[];
}
export const deriveMatchSeed: (n: number) => Seed;
export const seedToMatch:
  (n: number, catalog: Catalog, opts?: SeedToMatchOpts) => MatchScenario;
```

`tools/balance/aggregate.ts` (additive):

```ts
export interface MatchSummary {
  readonly name: string;
  readonly outcome: 'victory' | 'mutual-destruction';
  readonly winnerFleetId: number | null;
  readonly turns: number;
  readonly chassisByFleet: readonly (readonly string[])[];
  readonly componentsByFleet: readonly (readonly string[])[]; // per-fleet SET, sorted
}
export interface MatchAggregate {
  readonly matchCount: number;
  readonly victories: number;
  readonly mutualDestructions: number;
  readonly avgTurns: number;
  readonly winRateByChassisId: Readonly<Record<string, number>>;
  readonly usageRateByComponentId: Readonly<Record<string, number>>;
}
export const summarizeMatch: (r: MatchScenarioResult) => MatchSummary;
export const aggregateMatches: (s: readonly MatchSummary[]) => MatchAggregate;
```

`tools/balance/cli.ts` — new args, backward-compatible:

```
--mode physics|match       (default physics; physics path byte-identical to pre-S05)
--seeds A..B               physics seed range (default 1..50)
--matches A..B             match seed range (match mode; alias of --seeds)
--budget N                 match mode: fixed budget (default: seeded from n)
--tiers r,v,a              match mode: fixed per-fleet tiers (default: seeded from n)
--record DIR               append-only fixture recording (both modes)
--quiet                    suppress stderr throughput summary
```

Match-mode stdout is one line per match
(`<name> <victory|mutual-destruction> winner=<n|none> turns=<t> <finalDigest>`)
plus a single-line JSON `MatchAggregate` at the end. Deterministic — verified
`diff <(cli --mode match --budget 25 --matches 1..3) <(cli ...)` is empty.

#### Decisions (as-built)

- **`Scenario` NOT widened to a union** (deviation from the F4 seam note in
  arch/M17-harness.md:98). Pre-S05 determinism tests (`shuffle.test.ts`,
  `tunneling.test.ts`, `fixtureLoader.ts`) read `.bodies`/`.plansPerBeat` off
  a `Scenario`; widening would fail their typecheck and those files are OUTSIDE
  S05's write set. `MatchScenario` therefore sits as its own PEER type; a
  follow-up session that owns those files can widen the union in one lease.
  `Scenario = PhysicsScenario` today.

- **Separate async `runMatchScenario`** (D-MATCH-SCENARIO). `runTurn`/
  `advanceMatch`/`runMatch` are async because `Commander` accepts sync-or-
  Promise plans (FR-17). Making `runScenario` async would break every sync
  physics caller (the `shuffle`/`tunneling`/`golden` determinism tests).
  The physics `runScenario` stays sync and byte-compatible.

- **Runaway guard = 10 000 turns** (NOT a game rule, FR-27 / Custom Rule 5 —
  no turn cap in game logic). Only in the harness driver, to catch an
  infinite-loop bug fast. Real bot-vs-bot matches at budget=75 have been
  observed running past 500 turns in stalemate-prone compositions (a genuine
  stalemate is a match-quality signal, not a bug); 10 000 is comfortable
  headroom over the realistic tail. A match hitting this guard is a bug worth
  surfacing (fail loud, not a silent turn-cap).

- **Regenerate fleets from `(seed, budget, tiers, catalog)`** (D-MATCH-
  SCENARIO). Fixture size stays tiny (integer + tiers + budget, not a
  serialized `Build[]`). Fleet key: `hash(seed, i, STREAM_MATCH_FLEET_KEY)`
  where `STREAM_MATCH_FLEET_KEY = 0xf1eec0de` — distinct from placement /
  planning / attack streams so per-fleet key draws never alias in-match RNG.

- **`HeuristicCommander` constructed with matching physics + combat configs**
  (D-PHYSICS-INJECT + FR-29 AoE parity). Passes combat uniformly for all
  tiers — only ace consults it, but passing it everywhere is cheaper than
  per-tier branching and future-proofs veteran/rookie widening.

- **Per-fleet `validateFit` at the domain seam** (S02 followUp). Bot builds
  are `Build[]` (unvalidated) by contract; the harness re-runs `validateFit`
  and unwraps to `ValidatedBuild[]` before `resolveFleet`. A failure here
  signals a catalog-lock invariant break, not a bot bug — fail loud with the
  fleet index.

- **Aggregation denominators (FR-33):**
  - **win-rate BY CHASSIS** = wins / appearances (per SHIP). Each ship in
    the winning fleet contributes +1 win; each ship in ANY fleet contributes
    +1 appearance. Mutual-destruction contributes appearances only. A
    chassis never seen is OMITTED (not "0" — the report distinguishes
    "unsampled" from "0% win rate").
  - **usage-rate BY COMPONENT** = fleets-fielding-it / total fleets
    (per-FLEET denominator, not per-build). A fleet with three copies of
    the same shield counts as 1 fleet using that shield — "usage" is a
    fleet-composition metric.
  - Maps' keys are emitted in ascending order for byte-stable JSON.

- **`seedToMatch(n, catalog, opts?)`** takes catalog as its second positional
  arg (not via opts). Tuning info for defaults (legal budgets, min/max
  fleets) lives in `catalog.tuning.match`; the negative-space invariant
  (Custom Rule 4) forbids inventing a private table.

#### Purity (FR-33 structural)

`tools/balance/cli.ts` bundle grew from 17 308 → 146 780 bytes (bot fleet
construction + tuning JSON + resolveFleet + the M09/M10 sim graph joined).
`purity-check.ts` PASSES — no `three` / `preact` / `document` substring in
the bundle. New string literals audited; only comments contain those tokens
and esbuild strips comments.

#### CI / test surface

- `tests/unit/harness/matchScenario.test.ts` — 12 tests (runner smoke +
  determinism + `seedToMatch` factory + deriveMatchSeed non-aliasing).
- `tests/unit/harness/aggregate.test.ts` — 11 tests (summarize +
  aggregate win-rate + aggregate usage-rate + determinism + empty input).
- All `npm run typecheck` / `lint` / `test:unit` (771 pass) /
  `test:determinism` (78 pass) / `test:harness-purity` / `build` are green
  at every checkpoint boundary.
- FR-33 acceptance verified manually:
  `diff <(cli --mode match --budget 25 --matches 1..3) <(cli ...)` empty.

#### S06 hand-off

- Runner entry: `runMatchScenario(scenario: MatchScenario, catalog: Catalog)`
  — returns `MatchScenarioResult` with `turnDigests[]` (per-turn
  `matchDigest`). This IS the shape S06's fixture-loader replays.
- Factory: `seedToMatch(n, catalog, opts?)` derives a `MatchScenario` from
  an integer + optional overrides. Determinism is anchored on
  `deriveMatchSeed(n)` = twice-hashed `seedOf(hash(BASE, n, 0xa),
  hash(BASE, n, 0xb))` — no aliasing across `n` and `n+4`.
- `catalog` MUST be passed in — the runner does NOT call `loadCatalog()`
  internally (allows S06 to pass a test double if ever needed).
- CLI recorder (append-only) at `--mode match --record DIR` writes
  `${scenario.name}.json` files of shape:
  `{ ...MatchScenario, outcome: MatchOutcome, turnDigests: string[] }`.
  S06's `recordMatches.ts` can either drive `runMatchScenario` directly OR
  parse these files as the golden.

<!-- ai-balance-harness SESSION-06 -->
# ai-balance-harness SESSION-06 — architecture delta (M19 · bot-vs-bot determinism golden + cross-engine lock)

### M19 · Bot-vs-bot determinism golden + cross-engine lock (S06)

The heuristic bot (`src/ai/**` — `generateBotFleet` + `previewPath`
movement + threat-scored attack) is a **new determinism surface** that
neither the physics golden (`tests/determinism/fixtures/`) nor the combat
golden (`tests/determinism/combat/`) exercises — those use scripted /
`simpleFire` commanders. S06 lands the append-only bot-vs-bot golden rig
that covers it (FR-33 / architecture §7.5), mirroring `sim-combat` S05.

**Files added (all under M19):**

| Path | Role |
|------|------|
| `tests/determinism/harness/fixtureLoader.ts` | Shared reader — `FIXTURES_DIR`, `MANIFEST_PATH`, `fixtureNames()`, `loadFixture()`. Splits the on-disk fixture back into `MatchScenario` + recorded truth (`outcome`, `turnDigests`). JSON-only; imports no sim/runner. |
| `tests/determinism/harness/recordMatches.ts` | One-shot dev script (`tsx …`). Runs `runMatchScenario(seedToMatch(n, …), catalog)` per RECIPES entry; refuses to overwrite existing bytes (append-only, Custom Rule 3 / FR-2); rebuilds `manifest.json` with SHA-256 per fixture. |
| `tests/determinism/harness/manifest.json` | Hash-lock — `{ algorithm: 'SHA-256', fixtures: { <name>: <sha> } }`. |
| `tests/determinism/harness/seed-1-rookie-vs-ace.json` | 2-fleet rookie-vs-ace duel, budget=25, 8 turns → victory. |
| `tests/determinism/harness/seed-2-mixed-tier.json` | 3-fleet mixed-tier (rookie/veteran/ace), budget=25, 8 turns → victory. Multi-fleet order-independent accumulation under bot planners. |
| `tests/determinism/harness/seed-3-ace-vs-ace.json` | 2-fleet ace-vs-ace, budget=50, 7 turns → victory. Both commanders consult `combatConfig` (called-shot + AoE friendly-fire paths, FR-25 / FR-29). |
| `tests/determinism/harnessMatchGolden.test.ts` | Manifest hash-lock (4 tests) + per-fixture golden replay (turnDigests + outcome, 2 tests per fixture). Replay re-runs `runMatchScenario` — the whole generate → validate → resolve → runTurn pipeline under one lock (D-GOLDEN-CAPSTONE). |
| `tests/e2e/harnessMatchDeterminism.spec.ts` | Cross-engine lock (§7.5 row 4). esbuild-bundles `runMatchScenario` + `loadCatalog` (static JSON imports inline); Playwright injects the IIFE via `page.setContent()` and asserts per-turn digests + outcome per fixture in Chromium / Firefox / WebKit. No dev server. |

**Determinism posture (peer of combat golden):**

- **Append-only law** enforced at three points: the recorder refuses to
  overwrite differing bytes; the golden test's SHA-256 hash-lock detects
  any byte drift; the manifest ↔ disk membership check catches orphans
  either way. A 1-byte edit was manually verified to fail the golden and
  the restore to return green.
- **Runner recipe** (`runMatchScenario(scenario, catalog)`) sits at the
  seam between the harness (`tools/balance/scenario.ts`, S05) and the
  fixture; the catalog is passed in (loader is not called from the
  runner). Scenarios reconstruct fully from `(seed, budget, fleetTiers)`
  per D-MATCH-SCENARIO — fixtures stay tiny; goldens exercise the whole
  bot pipeline.
- **Cross-engine bundle** imports `loadCatalog()` and calls it once at
  IIFE init; esbuild inlines the static catalog JSON so the browser needs
  no filesystem. Every engine parses the same bytes; the ONLY variable is
  the engine, which is the §7.5 "identical on every machine" proof.

**Verification (all green on this machine):**

- `npm run typecheck` — clean (both `tsconfig.json` and `tsconfig.node.json`).
- `npm run lint` — clean; determinism ban-list scoped to `src/sim/**` +
  `src/ai/**` (not `tests/**`), so wall-clock reads in the recorder are
  fine.
- `npm run test:determinism` — 88 pass (10 new in
  `harnessMatchGolden.test.ts`: 4 hash-lock + 3×2 per-fixture golden).
- `npm run test:e2e` — 9 pass (existing 6 physics/combat + 3 new
  harness-match: Chromium 291ms, Firefox 867ms, WebKit 553ms locally).

**Append-only proof (manual):** injected a stray byte into
`seed-1-rookie-vs-ace.json` → `every fixture on disk hashes to its
recorded manifest entry` failed with the exact SHA mismatch message;
restore from backup returned all 88 determinism tests green; the recorder
run against the tampered file rejected with the append-only error.

<!-- finite-thrust-movement / SESSION-06 -->
# finite-thrust-movement / SESSION-06 — architecture delta (M17 · movement-model generation dispatch + M19 · append-only re-record)

### M17 Balance Harness — S06 additions (movement-model generation dispatch)

Extends the S05 match runner with a version marker so the pre-S06 bot-vs-bot
harness fixtures stay pinned to their impulsive-fallback generation and a new
generation captures the finite-thrust model (D-VERSION-RERECORD, Custom Rule
3 / FR-2, `catalog/tuning.json::physics.movementModel`). Additive:
`MatchScenario`, `runMatchScenario`, `seedToMatch`, and the CLI keep their
pre-S06 signatures — every new field is optional, and a missing field
means "impulsive fallback" (byte-identical to pre-S06 outcomes).

- `MatchScenario.movementModel?: number` (absent/1 = impulsive-fallback; >=2 = finite-thrust).
- `runMatchScenario` dispatches on `movementModel`: absent/1 → PhysicsConfig omits `maxAccel` → `thrustSchedule` impulsive-fallback; >=2 → PhysicsConfig gains `maxAccel = tuning.physics.maxAccel` (locally widened cast — `Tuning` still doesn't declare `.physics`; missing/invalid → fail loud).
- `SeedToMatchOpts.movementModel?` passthrough; CLI `--movement-model N` (match mode; omitting == `1`, byte-equivalent to pre-S06).

#### In-lease injection (documented deviation)

`src/domain/resolveFleet.ts::physicsConfigFromTuning` still does NOT propagate
`tuning.physics.maxAccel` to `PhysicsConfig` (S01/S02/S03 all flagged; owned by
no session). `runMatchScenario` is the ONLY place `maxAccel` reaches
`resolveMovement` — the harness widens the config out-of-band (Envelope
explicitly permitted this in-lease injection). **The production match code path
(`src/app/match/**` → `physicsConfigFromTuning`) is UNCHANGED; the production
runtime still coasts on the impulsive-fallback branch.** The domain propagation
is the single remaining gap for finite-thrust to reach the game runtime.

### M19 Determinism — S06 additions (append-only harness re-record)

- `HarnessFixtureFile.movementModel?` (absent = model 1); `loadFixture` threads it only when present (model-1 fixtures reconstruct byte-equivalent to pre-S06).
- `recordMatches.ts`: `RecipeSpec.movementModel?`; serialization spreads it only when present (model-1 recipes write files without the field — append-only bytes match pre-S06).
- New fixtures appended (old 3 byte-untouched, Custom Rule 3):
  - `seed-1-rookie-vs-ace-m2.json` — model 2; winner unchanged (fleet 0), 6 turns vs 8 (finite-thrust converges faster).
  - `seed-2-mixed-tier-m2.json` — model 2; winner + turn count unchanged (fleet 2, 8 turns) but EVERY per-turn digest differs (curved arc changes play, not outcome).
  - `seed-3-ace-vs-ace-m2.json` — model 2; byte-identical `turnDigests` + outcome (point-blank ace-vs-ace decides before finite-thrust divergence surfaces); only on-disk diff is `"movementModel": 2`.
- `manifest.json` — 6 entries (3 old SHAs preserved byte-for-byte, 3 new appended). `test:determinism` 94 pass (was 88; +6). `test:fixtures` 6, `test:catalog-lock` 36 — all green.

#### Balance re-validation (S06 CP3, FR-33)

Small-sample bot-vs-bot `--movement-model 1` vs `2` at fixed budget/tiers. No
aggregate divergence: at budget=50 ace-vs-ace the aggregates are IDENTICAL
(matchCount=3, victories=3, avgTurns=10.33, winRate/usage maps literally
identical); at budget=25 rookie-vs-ace, model 2 slightly IMPROVES convergence
(8→6 turns; one previously-runaway match → 2 turns). **Verdict: keep
`tuning.physics.maxAccel = 25` as authored. No re-tune.** (Owner decision.)

### Deviations / hazards flagged this session (for Forge)

- **`src/domain/resolveFleet.ts::physicsConfigFromTuning` propagation remains un-owned** — 4th session to flag it (S01/S02/S03/S06). Concrete impact: finite-thrust reaches the harness lease, but a Skirmish game session still runs impulsive-fallback → **the feature ships behaviorally impulsive to the end user until this one-line domain patch lands.** Recommended: a follow-up feature owning `physicsConfigFromTuning` maxAccel propagation + the `src/catalog/types.ts::Tuning.physics` block in one lease.
- **Pre-existing 10000-turn runaway guard hits under BOTH models** on some seeds (not S06-induced; finite-thrust actually resolved one previously-runaway match). Deferred bot-planning concern.
- **`Tuning` in `src/catalog/types.ts` still doesn't declare `.physics`** (S01 punted) — worked around with a local widening cast; should land with the propagation fix.
