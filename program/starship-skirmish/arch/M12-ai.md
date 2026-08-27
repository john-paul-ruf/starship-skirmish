# M12 — AI (`src/ai/`, as built)

> Architecture-as-built detail for M12 (`src/ai/`) — the heuristic bot: tier vocabulary,
> seeded fleet construction, threat map + boundary-safe movement planner, attack planner,
> and the `HeuristicCommander`. Session-marked; appended by Jikijitsu from each worker's
> arch fragment. Disk-only (`program/` gitignored).

<!-- SESSION-01 -->
# SESSION-01 — architecture delta (M12 AI · tier vocabulary root)

### `src/ai/tiers.ts` — new leaf under M12 (AI)

First file of the new `src/ai/` module. Zero imports; inside the deterministic
core (`src/ai/**` determinism ban-list applies). Read by every other file in
`src/ai/` and by S04's public barrel `src/ai/index.ts`.

Public surface (the whole module barrel will re-export these from S04 on):

- **`type BotTier = 'rookie' | 'veteran' | 'ace'`** — canonical difficulty
  identifier. Union of exact string literals only (no numeric ordinal).

- **`const BOT_TIERS: readonly BotTier[]`** — the three tiers in canonical
  strength order (`['rookie', 'veteran', 'ace']`). Index IS the strength
  ordinal. Downstream code iterates this; iterating `Object.keys(TIER_CONFIG)`
  is spec-undefined on a record and violates the determinism scope's stable-
  iteration requirement.

- **`type CandidateLadder = 'baseline-veto' | 'full-7' | 'full-7-wall-capped'`**
  — which movement candidate ladder the planner evaluates for boundary safety
  (Gate-2 §1b, §2). A decision policy, not a stat.

- **`type TargetingPolicy = 'nearest' | 'threat-weighted' | 'threat-map'`** —
  target-selection policy (design.md §4.10). A decision policy, not a stat.

- **`interface TierConfig`** — the tier's decision-quality knob set. Seven
  readonly fields, all decision-policy knobs; NO ship-stat / budget / point-
  cost / modifier field, at any level (FR-30, Custom Rule 4 — the negative-
  space invariant is what makes "no bot cheating" mechanically true, and
  `tests/unit/ai/tiers.test.ts` locks it with a keyword regex).

  | Field | Type | Meaning |
  |-------|------|---------|
  | `planningHorizon` | `1 \| 2 \| 3` | Lookahead depth in beats (design.md §4.10). Rookie 1, veteran 2, ace 3. |
  | `cruiseSpeedFraction` | `number` (strictly in `(0, 1)`) | Post-plan cruise speed as a fraction of the SHIP'S OWN `deltaVPerTurn` budget. Gate-2 §1a: target a cruise VELOCITY, not an impulse; the load-bearing FR-29 fix. `< 1` ⇒ brakeable in one beat. |
  | `candidateLadder` | `CandidateLadder` | Which movement ladder to evaluate. |
  | `targeting` | `TargetingPolicy` | Target-selection policy. |
  | `enableCalledShots` | `boolean` | FR-25 break-shields → kill-generator sequence. Rookie `false`; veteran and ace `true`. |
  | `enableAoeFriendlyFireCheck` | `boolean` | FR-29 "bots account for their own AoE friendly fire" on missile assignment. Ace only. |
  | `enablePredictiveIntercept` | `boolean` | Gate-2 §2 ace: cruise capped by wall distance + predictive intercept lead. Ace only. |

- **`const TIER_CONFIG: Readonly<Record<BotTier, TierConfig>>`** — the tier
  table; single source of truth. Look up via `TIER_CONFIG[tier]`. Downstream
  code MUST NOT synthesize alternate tables.

Determinism / boundary notes for the arch record:

- Leaf: imports nothing. Trivially clean under the `src/ai/**` determinism
  ban-list (no `Date` / `performance` / `Math.*` at all).
- Boundary: `src/ai/**` is a lint-defined element; the flow `ai → {sim, domain,
  catalog}` is default-allowed and the new file needs none of it.
- Tier NUMERICS (0.5 / 0.66 / 0.85 cruise fractions, from Gate-2 §2) live as
  module consts marked `PROMOTION SEAM` — legitimate future `tuning.json`
  fields, deferred out of the catalog schema today per Custom Rule 4.

Downstream reads (informational — Jikijitsu, not owned by this session):

- S02 (`generateBotFleet.ts`) reads `BotTier` (typed parameter).
- S03 (`movementPlanner.ts`, `threatMap.ts`) reads `TIER_CONFIG` for
  `planningHorizon`, `cruiseSpeedFraction`, `candidateLadder`,
  `enablePredictiveIntercept`, `targeting`.
- S04 (`attackPlanner.ts`, `HeuristicCommander.ts`) reads `TIER_CONFIG` for
  `targeting`, `enableCalledShots`, `enableAoeFriendlyFireCheck`.
- S04's barrel `src/ai/index.ts` is the sole re-exporter of `BotTier` and
  `TIER_CONFIG`; S01–S03 create no barrel and their tests import concrete
  files.

<!-- SESSION-02 -->
# SESSION-02 — architecture delta (M12 AI · seeded bot fleet generator)

## `src/ai/generateBotFleet.ts` — new public API (M12)

### Public surface

```ts
export const generateBotFleet = (
  catalog: Catalog,
  budget: number,
  tier: BotTier,
  rngKey: number,
): Build[];
```

Returns an array of unvalidated `Build`s (not `ValidatedBuild[]`) so the harness
(S05) re-runs `validateFit` at the domain seam — the io/domain validation gate
stays the single source of legality truth (FR-31).

### Guarantees (mechanically checked in the CP3 property suite)

- **Determinism.** Same `(catalog, budget, tier, rngKey)` ⇒ byte-identical
  `Build[]`. Every draw goes through `mathx/rng` (`seedOf`/`hash`/`randInt`);
  no `Math.random`, no `Date`, no wall-clock — the `src/ai/**` deterministic-
  core ban-list is honoured structurally.
- **Legality (FR-4 / FR-31).** Every returned `Build` passes `validateFit`
  against `catalog`. Constructed strictly from the catalog's own
  `slotLayout` / `componentsForSlot` output, so legality holds by construction.
- **Budget (Decision 9 / FR-5).** `Σ storedCost ≤ budget`. Under-budget is
  legal; leftover is wasted. No `leftoverPoints` / `conversion` / `banked`
  field exists anywhere on the returned Builds (Custom Rule 4 — absence is
  the enforcement; a regex test asserts it).
- **Hull cap (FR-10).** Fleet length ≤ `catalog.tuning.match.fleetHullCap`.
- **Non-empty for legal budgets.** Any budget ≥ the cheapest chassis's
  `pointCost` (v1: 4 pts, Needle) yields ≥ 1 ship; every legal budget
  (25..150) clears that bar.
- **No tier advantage (FR-29 / FR-30, D-TIER-FLEET).** `tier` is a variety
  input only — folded into the per-fleet `Seed` so different tiers draw
  different-but-equally-legal fleets. No tier grants any stat, budget, or
  point advantage. Fleets are drawn from the ONE shared catalog at the same
  numeric budget.

### Synthetic identity fields

Bot builds never cross the persist/io boundary, so the domain rule "identity
is minted at the boundary" does not apply. Identity fields are minted
deterministically from inputs and MUST NOT be treated as durable ids by any
future consumer:

- `id` = `bot-{budget}-{tier}-{rngKey}-{shipIndex}` (stable string, not a UUID)
- `createdAt` / `updatedAt` = `'1970-01-01T00:00:00.000Z'` sentinel (never
  affects the sim; wall-clock read is banned in `src/ai/**`)
- `schemaVersion` = 1 (kept in sync with
  `src/io/migrate/migrations.CURRENT_SCHEMA_VERSION`; duplicated because
  `ai → io` is not in the module graph — architecture §5)
- `catalogVersion` = `catalog.catalogVersion`
- `storedCost` = `pointCost(catalog, build)` (§3.3 historical fact at
  authoring)

### Determinism stream tags

Draws use the fixed high-bits tag `STREAM_BOT_FLEET = 0xb07f1eef`, plus
sub-stream tags `SUB_CHASSIS = 0` and `SUB_SLOT = 1`. The per-fleet `Seed` is
derived by feeding `(rngKey, tierIndex)` through the same `hash(BASE, ...)`
avalanche pattern used in `tools/balance/harnessScenarios.ts` — twice, once
per uint32 half — so naive `seedOf(rngKey, ~rngKey ^ k)` aliasing across
`rngKey` and `rngKey + 4` cannot collapse two seeds. Ship *i*'s draws never
alias ship *j*'s: chassis coords are `(STREAM_BOT_FLEET, SUB_CHASSIS, i)`;
slot coords are `(STREAM_BOT_FLEET, SUB_SLOT, i, slotIndex)`.

### Also exported (internal primitives; used by tests)

`pickChassis`, `fillSlots`, `buildOneShip`, `deriveFleetSeed`. These are
public exports of the module file, not re-exported through the (not yet
existing) `src/ai/index.ts` barrel — S04 alone will decide the barrel's
surface.

### Dependency edges (no boundary widening)

`ai → catalog` (Catalog / ChassisDef / ComponentDef) and
`ai → domain` (`emptyBuild` / `withSlot` / `pointCost` / `validateFit`; `Build`
/ `BuildMeta`) and `ai → sim/mathx` (`seedOf` / `hash` / `randInt` / `Seed`).
No new `ai → sim/physics` / `ai → sim/rules` edge from this module — those
land in S03 / S04.

<!-- SESSION-03 -->
# SESSION-03 — architecture delta (M12 AI · threat map + boundary-safe movement planner)

Promotes the Gate-2 verdict (`prototypes/gate2/FINDINGS.md` §0, PASS: zero unforced
boundary deaths) into two production `src/ai/` files behind `TIER_CONFIG` (S01).
Both are inside the deterministic core (`src/ai/**` ban-list applies) and both
respect the D-PHYSICS-INJECT + D-AI-IMPORTS seams recorded in STATE.md.

### `src/ai/threatMap.ts` — new (M12)

Deterministic target-quality scoring over a `BlindMatchView`. Mathx-only
arithmetic; no `sim/rules` import (Ruling H unchanged — the bot's approximate
score is a heuristic, not a published number). Consumed by the movement
planner (this session, ace's `threat-map` targeting) and by S04's attack
planner (target selection for a shooter).

Public surface:

- **`interface ThreatScore { bodyId: BodyId; score: number }`** — one
  (bodyId, score) pair; higher = higher-priority target.
- **`threatScore(target, from, targetPosition): number`** — single-ship
  contribution: `offensive / (1 + survivability) × engageability`. Term
  breakdown:
  - `offensive` — Σ over live weapons of `damage × shotsPerTurn × accuracy`,
    plus Σ over live missile racks with ammo of `damage × ammo`.
  - `survivability` — `hull + shields` (inverse-weighted, biasing against
    high-HP targets per design.md §4.10 and veteran's `threat-weighted`).
  - `engageability` — `1 / (1 + distance(from, targetPosition))`, bounded in
    `(0, 1]`.
- **`rankThreats(view, selfFleetId, from): readonly ThreatScore[]`** — rank
  ENEMY ships (`fleetId !== selfFleetId`) by DESCENDING score, tie-break
  ASCENDING BodyId. Drops non-live enemies (`hull ≤ 0`). Iterates the frozen
  `view.ships` (BodyId-sorted). Order-independent and reproducible.
- **`nearestEnemyBodyId(view, selfFleetId, from): BodyId | null`** — Gate-2
  §1c's target-selection policy hoisted so `rookie`'s `nearest` targeting and
  the threat map share one enemy-filter path. Deterministic BodyId tiebreak on
  ties of `distanceSq`.

### `src/ai/movementPlanner.ts` — new (M12)

Tier-parameterized promotion of `prototypes/gate2/botPlanner.ts`. Six exported
functions, all pure, all deterministic. Takes `PhysicsConfig` as an EXPLICIT
parameter (D-PHYSICS-INJECT — the Commander view has no physics config; S04
closes over the injected config).

Public surface:

- **`pickTargetBodyId(view, self, tier): BodyId | null`** — routes by
  `TIER_CONFIG[tier].targeting`. `nearest` → `nearestEnemyBodyId`;
  `threat-weighted` / `threat-map` → top of `rankThreats`. BodyId tiebreak.
- **`baselineArc(self, target, budget, cruiseSpeed): Vec3`** — the FINDINGS
  §1a cruise-velocity target: `desired = normalize(toTarget) × cruiseSpeed`,
  `deltaV = clampLength(desired − self.velocity, budget)`. Cruise VELOCITY,
  not per-beat impulse — the load-bearing FR-29 fix. `target === null` (or
  coincident target) → `ZERO`.
- **`buildCandidates(self, baseline, view, budget, tier): readonly Vec3[]`** —
  ladder keyed by `TIER_CONFIG[tier].candidateLadder`:
  - `baseline-veto` (rookie) → `[baseline, ZERO]` (coast if baseline exits).
  - `full-7` (veteran) → the full Gate-2 7-candidate ladder unchanged.
  - `full-7-wall-capped` (ace) → the full-7 shape; the wall cap is applied
    UPSTREAM in `cruiseSpeedFor`, not here (the candidate array is the same
    shape either way; only the baseline's magnitude differs).
- **`cruiseSpeedFor(self, view, tierCfg, budget, physicsDt): number`** —
  effective cruise speed. `baseCruise = budget × tierCfg.cruiseSpeedFraction`
  (0.5 / 0.66 / 0.85 per S01, verbatim — NOT scaled further). For
  `full-7-wall-capped` (ace only), additionally caps by
  `min(baseCruise, wallDistance / dt / ACE_WALL_CAP_SAFETY_FACTOR)`, where
  `wallDistance = arena.radius − distance(self, arena.center)`. The safety
  factor is `2` (module const, marked `PROMOTION SEAM` — a legitimate future
  `tuning.json` field, deferred out of the catalog schema today per Custom
  Rule 4).
- **`planShipMovement(self, view, tier, physicsConfig, budget): MovementPlan`**
  — Gate-2 `planShip` promoted:
  1. Pick target per `TIER_CONFIG[tier].targeting`.
  2. Compute baseline arc at `cruiseSpeedFor(...)`.
  3. Build the tier's candidate ladder.
  4. Evaluate each with `previewPath`; require `isSafe` (all sub-step
     positions inside the arena) AND `passesLookahead(planningHorizon)`.
  5. Pick lowest-rank safe candidate; fallback = most in-bounds sub-steps,
     ties → rank ASC.

  **Lookahead veto (FINDINGS §2 promoted).** Parameterized by
  `TIER_CONFIG[tier].planningHorizon`. Horizon 1 (rookie): no lookahead.
  Horizon N ≥ 2 (veteran = 2, ace = 3): from the candidate's end-state, run
  N − 1 consecutive coast-beat previews (`previewPath(coastBody, null,
  physics)`). Reject if any coast preview exits. A candidate is "N-beat safe"
  iff its own beat AND every coast-beat lookahead all stay inside.

- **`planFleetMovement(view, tier, physicsConfig): readonly MovementPlan[]`** —
  Gate-2 `planFleet` promoted. No `ownedIds: Set` param — owned ships derived
  from `view.selfFleetId + view.ships[].fleetId`; live = `hull > 0`.
  Kinematics (position, velocity, radius) join `view.bodies` to `view.ships`
  on `bodyId`. Per-ship engine budget = `ship.ship.deltaVPerTurn` (real per-
  ship value, NOT Gate-2's fixed 80). Plans returned in ascending BodyId
  order — the canonical order `resolveMovement` iterates.

### Determinism / boundary notes for the arch record

- **`src/ai/**` ban-list holds.** `threatMap.ts` uses `distance` /
  `distanceSq` only; `movementPlanner.ts` uses vec3 primitives + the exported
  physics functions. No `Math.pow` / `sin` / `cos` / `Date` / `performance`.
  All draws for the FR-29 regression setup go through `mathx/rng` (same
  avalanche as Gate-2 `deriveSeed`).
- **D-PHYSICS-INJECT (from STATE.md) upheld.** Every planner top-level takes
  `PhysicsConfig` explicitly. The `Commander.planMovement(view)` interface
  never widens — S04's `HeuristicCommander` closes over the injected config
  and calls `planFleetMovement(view, tier, physicsConfig)`.
- **D-AI-IMPORTS (from STATE.md) upheld.** The single physics-import surface
  is `{ previewPath, isOutsideArena, type PhysicsConfig }` from
  `src/sim/physics/index.js` — the two functions Gate 2's verdict rides on.
  `sim/rules` is NOT imported (attack scoring stays mathx-only). ESLint
  `boundaries/element-types` `ai → sim` is default-allowed; only
  `sim → non-sim` is forbidden.
- **Shared-integrator invariant (architecture §9) is what the regression
  proves.** `previewPath` and `resolveMovement` share their integrator, so
  an in-preview-safe plan resolves safely absent a collision (FR-22). The
  `boundarySafety.test.ts` tripwire asserts this by classifying every
  boundary exit as forced-by-collision, forced-by-momentum, or UNFORCED, and
  asserting UNFORCED = 0 across 32 seeds × 6 beats × 3 tiers.

### Downstream reads (informational — not owned by this session)

- **S04** (`attackPlanner.ts`, `HeuristicCommander.ts`): reads
  `rankThreats` for target selection; calls `planFleetMovement(view, tier,
  physicsConfig)` from `HeuristicCommander.planMovement`, passing the
  `PhysicsConfig` closed over at construction (D-PHYSICS-INJECT). S04's
  barrel `src/ai/index.ts` is the sole re-exporter of these; this session
  creates no barrel.
- **S05/S06** (harness + goldens): consume the `HeuristicCommander` S04
  assembles; no direct dependency on these two files.

### Notes / open items for Forge

- **Ace wall-cap safety factor.** Set to `2` as a conservative default; the
  FINDINGS §2 sketch does not pin a number. Registered as a `PROMOTION SEAM`
  module const so a future tuning migration is a one-line edit + a
  `tuning.json` field. The regression at safety=2 passes clean across all
  tiers; smaller values would tighten ace's cruise near the wall.
- **Enemy `Body` join on `BlindShipView`.** The `BlindShipView` carries
  status (hull, shields, alive flags) but not kinematics; every planner path
  that needs a position/velocity does a linear scan over `view.bodies` (≤ ~60
  bodies per beat per FR-15). If S04/S05 want to avoid the double scan, a
  shared `bodyById` helper on the view would be a natural M10 addition — not
  in scope here.
- **Test-only `BlindMatchView` construction is a repeated pattern.** Every
  test in this session builds a minimal frozen view directly (bypassing
  `createMatch` because the planner shouldn't drag rules/loop into a unit
  test). S04/S05 will hit the same shape; a shared `tests/support/blindView.ts`
  helper is worth considering when the third caller appears.

<!-- SESSION-04 -->
# SESSION-04 — architecture delta (M12 AI · attack planner + HeuristicCommander + barrel)

### `src/ai/attackPlanner.ts` — public surface

```ts
export const planFleetAttack = (
  view: BlindMatchView,
  selfFleetId: number,
  tier: TierConfig,           // takes TierConfig (not BotTier) per SESSION-04 pseudocode
  combat?: CombatConfig,      // optional — ace AoE friendly-fire check reads aoeRadiusByClass
): readonly AttackPlan[];
```

Deterministic, mathx-only, no `sim/rules` import (D-AI-IMPORTS upheld). Iterates
BodyId-sorted `view.ships` / `view.bodies`. Blind-safe: reads only the frozen
`BlindMatchView` (no view / state field added).

**Target selection** per `tier.targeting`:
- `'nearest'` (rookie) → lowest-BodyId live enemy — the `simpleFireCommander`
  rule (`tools/balance/fixtureCommanders.ts:101`).
- `'threat-weighted'` (veteran) / `'threat-map'` (ace) → top of
  `rankThreats(view, selfFleetId, shooterPos)` (S03).

**FR-25 called-shot ladder** — gated by `tier.enableCalledShots`, ONLY emitted
when `target.shields === 0` (matches `calledShotsUnlocked` legality gate in
`src/sim/rules/shields.ts`):
1. `{ kind: 'shield-generator' }` while `shieldGenAlive` (the headline play —
   killing the generator drops shield capacity to 0 for the rest of the match).
2. `{ kind: 'engine' }` once the generator is down (disable mobility).
3. `{ kind: 'weapon', index: bestLiveWeaponIndex }` — highest
   `damage × shotsPerTurn × accuracy` DESC, lowest index tiebreak.
4. Fall through — omit `calledShot` (plain hull shot).

Same subsystem applies to both weapon and missile plans this turn.

**FR-29 ace AoE friendly-fire skip** — gated by
`tier.enableAoeFriendlyFireCheck && combat !== undefined`. For missile plans
only (weapons have no AoE). Skips a missile assignment when any own-fleet live
ship (including the shooter, conservative) sits inside
`combat.destruction.aoeRadiusByClass[targetChassisClass]` of the target now.
`distanceSq` comparison (no sqrt / no transcendental).

### `src/ai/HeuristicCommander.ts` — Commander implementation

```ts
export class HeuristicCommander implements Commander {
  constructor(
    public readonly fleetId: number,
    private readonly tier: BotTier,
    private readonly physics: PhysicsConfig,   // D-PHYSICS-INJECT — view lacks it, movement planner needs previewPath
    private readonly combat?: CombatConfig,    // optional — ace FR-29 AoE friendly-fire check
  ) {}
  planMovement(view: BlindMatchView): MovementPlan[];   // → planFleetMovement(view, tier, physics).slice()
  planAttack(view: BlindMatchView):   AttackPlan[];     // → planFleetAttack(view, fleetId, TIER_CONFIG[tier], combat).slice()
}
```

Sync methods (the `Commander` interface accepts sync-or-Promise). No mutable
per-turn state, no wall clock, no `Math.random` — pure function of
`(view, tier, physics, combat)`. `.slice()` copy on both returns converts
`readonly T[]` → `T[]` and defends against a future in-tree consumer mutating
the return in place. Does not mutate the frozen view (tested — view stays
`Object.isFrozen === true` after both calls).

### `src/ai/index.ts` — module barrel (final surface, M12 public face)

```ts
export type { BotTier, TierConfig } from './tiers.js';
export { BOT_TIERS, TIER_CONFIG } from './tiers.js';
export { generateBotFleet } from './generateBotFleet.js';
export { HeuristicCommander } from './HeuristicCommander.js';
```

Exactly the four architecture §4 public exports (`BotTier` type, `TIER_CONFIG`,
`generateBotFleet`, `HeuristicCommander`) plus `TierConfig` type + `BOT_TIERS`
canonical tier ordering for S05's CLI parsing / iteration. Everything else
(`attackPlanner`, `movementPlanner`, `threatMap`) stays module-local — S05 or
S06 can widen with a follow-up edit if needed (a new export line, not a
breaking change).
