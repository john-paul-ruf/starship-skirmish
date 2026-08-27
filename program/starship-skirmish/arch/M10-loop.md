# M10 Sim: Loop — public surface (as built)

<!-- sim-combat SESSION-04 -->
### M10 — Sim: Loop (`src/sim/loop/`)

New module. The composition root of the deterministic core: it owns the
mutable-by-replacement `MatchState`, the FR-17 `Commander` interface, the
frozen `BlindMatchView` (blind-commit is structurally unreachable, §6.3), the
pure `runMovementBeat` / `runAttackBeat` resolvers, the async
`TurnCoordinator`, the three-branch `checkVictory` (FR-27 / Custom Rule 5),
and the authoritative `matchDigest`.

Also owns the top-level sim barrel (`src/sim/index.ts`).

**Files**

- `matchState.ts` — `MatchConfig` / `MatchState` / `Match` shapes + sorted accessors
- `createMatch.ts` — seeded fleet placement, monotonic id assignment, initial state
- `blindView.ts` — `BlindMatchView` / `BlindShipView` + `makeBlindView` (frozen)
- `commander.ts` — `Commander` interface (`planMovement`/`planAttack`, sync or Promise)
- `resolveBeat.ts` — `runMovementBeat`, `runAttackBeat`, `applyTurnEnd`
- `victory.ts` — `checkVictory` (exactly 3 branches) + `outcomeOf` stamp
- `turnCoordinator.ts` — `runTurn`, `runMatch`, `advanceMatch`
- `digest.ts` — `matchDigest` (arithmetic-only FNV-1a-32)
- `index.ts` — public barrel
- `../index.ts` (top-level sim barrel) — re-exports mathx/physics/rules/trace/loop

**Imports (in-tree only; boundary-lint enforced)**

- `../mathx/index.js` — vec3, counter-RNG, deterministic trig
- `../physics/index.js` — `resolveMovement`, `StepContact` etc.
- `../rules/index.js` — `resolveAttackBeat`, `newShipCombat`, `applyDamageBundle`,
  `guideMissiles`, `detonate`, `spawnDebris`, `enforceHazardCap`, `regenShields`,
  `MissileGuidance`, `ShipCombat`, `LaunchEnv`, `Damage`, `DebrisAge`, `HazardEntry`
- `../trace/index.js` — `emptyTrace`, `withTurn`, `withOutcome`, `logCollision`,
  `logAoe`, `logBoundaryExit`, `MovementBeatRecord`, `AttackBeatRecord`,
  `ResolutionTrace`, `MatchOutcome`
- `../types.js` — shared vocabulary

No npm package. No `render`/`ui`/`persist`/`app`. `sim/**` transcendental
ban-list obeyed: `Math.imul` / `Math.sqrt` / `Math.trunc` only. All iteration
over id-keyed maps uses sorted accessors (`shipsSorted`, `bodiesSorted`,
`guidancesSorted`) — never `Map.keys()` insertion order.

**Public surface (what F5 AI + harness + render + ui import from the barrel)**

*Types*
```
MatchConfig, MatchState, Match
BlindMatchView, BlindShipView
Commander
MovementBeatOutcome, AttackBeatOutcome, TurnResult, RunMatchResult
VictoryResult
```

*Match lifecycle*
```
createMatch(config: MatchConfig): Match
buildInitialState(config: MatchConfig): MatchState   // pure sibling for tests
```

*Sorted accessors (deterministic iteration, §7.3 rule 1)*
```
shipsSorted(state): ShipCombat[]
bodiesSorted(state): Body[]
guidancesSorted(state): MissileGuidance[]
```

*Blind view (FR-17, §6.3 — no plans/pending-plans/coordinator field)*
```
makeBlindView(state: MatchState, selfFleetId: number): BlindMatchView
```

*Pure beat resolvers (S05 + F5 harness drive with fixed plans)*
```
runMovementBeat(state, movementPlans): { state, record: MovementBeatRecord }
runAttackBeat(state, attackPlans): { state, record: AttackBeatRecord }
applyTurnEnd(state): MatchState                       // regen shields + turn++
```

*Async coordinator (UI + player play through this)*
```
runTurn(state, commanders): Promise<TurnResult>       // movement → attack → end-of-turn → victory
runMatch(state, commanders, maxTurnsGuard?): Promise<RunMatchResult>
advanceMatch(match, commanders): Promise<TurnResult>  // mutates match.state
```

*Victory (FR-27 / Custom Rule 5 — exactly 3 outcomes)*
```
checkVictory(state): VictoryResult                    // 'victory' | 'mutual-destruction' | null
outcomeOf(result, turns): MatchOutcome | null
```

*Determinism gate*
```
matchDigest(state): string                            // 8-char lowercase hex, FNV-1a-32
```

**Contract for downstream modules**

- **Body ids** are monotonic uint32s minted at `createMatch` (ships in
  `(fleetId, shipIndex)` order) and advanced by beat resolvers when they
  spawn debris / missiles. `state.nextBodyId` is the single source.
- **Blind commit is unreachable, not policy.** Collected plans exist only as
  a local `const` inside `runTurn()`. Every view a commander sees is a
  frozen snapshot with keys `{turn, arena, selfFleetId, bodies, ships}` —
  NO `plans` / `pendingPlans` / `coordinator` field. Adding one to
  `MatchState` or `BlindMatchView` would fail the shape tests in
  `tests/unit/loop/blindView.test.ts` + `turnCoordinator.test.ts`.
- **Two-layer split** — pure vs async — is what lets S05's determinism suite
  and F5's headless harness drive `runMovementBeat`/`runAttackBeat` with
  scripted plans without any Commander. The UI drives through
  `runTurn`/`advanceMatch`.
- **Victory has exactly three branches** (FR-27 / Custom Rule 5). `runMatch`
  takes an OPTIONAL `maxTurnsGuard`: a THROWN error to stop a runaway
  test. This is **not** a game rule; defaults to disabled in real play.
- **`matchDigest` is authoritative.** Position/velocity fields are
  quantized to `1e-3` before hashing (well above the sim's ~1e-9
  tolerance; well below any meaningful unit). `traceDigest` (in trace) is
  a convenience over the RECORDING; `matchDigest` is the gate.

**Cost:** +2874 LOC (10 new files under `src/sim/loop/**` + top-level barrel;
8 test files under `tests/unit/loop/**`). Every checkpoint is a green-tree
commit (typecheck + lint + `test:unit` + `test:determinism` + `build`).

<!-- combat-integration SESSION-01 -->
### combat-integration S01 — `CombatConfig` + `Tuning` gate vocabulary

**`src/sim/types.ts` — `CombatConfig` (additive, OPTIONAL fields)**

Two new optional gate fields (absent ⇒ off) so the 5 frozen combat goldens
(seed-1..5) — whose loaded `CombatConfig` omits these fields — retain their
exact byte-identical digests while real play + new goldens can turn them on:

- `destruction.cascadeToNextMovement?: boolean` — when true, an ATTACK-beat
  kill contributes class-scaled AoE + debris to the NEXT movement beat
  (FR-21). Absent/false ⇒ no cascade (pre-F6 loop behavior).
- `missiles.launchClearsLauncher?: boolean` — when true, a launched missile
  spawns offset ahead of its launcher by (launcherRadius + missileRadius + ε)
  along the firing bearing so it cannot detonate on its own launcher on the
  following movement beat. Absent/false ⇒ launcher-position spawn (pre-F6).

Consumers (S02): `sim/loop/resolveBeat.ts` reads both via `state.combat`;
`sim/rules/missiles.ts::launch` reads `launchClearsLauncher` off the passed
`LaunchEnv`.

**`src/catalog/types.ts` — `Tuning` (additive, REQUIRED fields)**

Mirrors the existing `spentRemainsArmed` / `regenTicksRegardlessOfDamage`
pattern — tuning.json always provides them:

- `Tuning.destruction.cascadeToNextMovement: boolean`
- `Tuning.missiles.launchClearsLauncher: boolean`

**`catalog/tuning.json`**

- `destruction.cascadeToNextMovement: true` (real play gets cascade ON)
- `missiles.launchClearsLauncher: true` (real play gets clears-launcher ON)
- `arena.minFleetSeparationFraction: 0.9 → 0.8` — reinterpreted as
  *minimum pairwise fleet-centroid separation, as a fraction of arena RADIUS*.
  Equidistant placement on the inset shell gives
  `2 · fleetStartInsetFraction · sin(180°/N) · R`; tightest supported case is
  N = `match.maxFleets` = 5 (`≈ 0.846·R`), so 0.8 holds for N=2..5.
  `$comment_minFleetSeparationFraction` documents the semantic. S02's
  `createMatch` invariant test gives this field teeth.

**`src/domain/resolveFleet.ts` — `combatConfigFromTuning`**

Threads both new tuning fields into the returned `CombatConfig`. No other
behavior change; per-class narrower unchanged. Real play now emits both flags
as `true` (S02 will read them off `state.combat`).

**Boundary impact:** none. Additive to shared sim vocabulary + catalog types +
one domain resolver — no new imports, no dependency-flow change, no sim
runtime code touched. Existing `combatConfigFromTuning` tests extended with two
positive assertions + the full-shape snapshot updated.

<!-- combat-integration SESSION-02 -->
### combat-integration S02 — Loop behaviours wired: PD, cascade, launch offset, min-sep

**`src/sim/loop/matchState.ts` — `MatchState` gains one field + one type**

New public type:
```ts
export interface PendingDetonation {
  readonly event: DestructionEvent;   // detonates === true invariant
  readonly ship: SimShip;              // needed by spawnDebris (ship.mass) after removal
}
```

New `MatchState` field (OPTIONAL — absent ⇒ empty; every reader defends with
`?? []`):
```ts
readonly pendingDetonations?: readonly PendingDetonation[];
```

Loop constructors (`buildInitialState`, both `runMovementBeat` /
`runAttackBeat` output states, `applyTurnEnd`) ALWAYS populate it explicitly:
- `buildInitialState` → `[]`
- `runAttackBeat` output → cascade queue (see below) when the gate is on,
  `[]` when it's off
- `runMovementBeat` output → `[]` (cascade consumed in Stage G.5)
- `applyTurnEnd` → preserves `state.pendingDetonations` verbatim so the
  attack-beat cascade survives the turn boundary and reaches the next
  movement beat

Optional (not required) on the type so out-of-lease test-only MatchState
reconstructions (`tests/determinism/combatShuffle.test.ts::shuffleStateMaps`)
that predate this field continue to typecheck — the additive-optional pattern
S01 established for `CombatConfig` gates, applied to state.

**NOT part of the blind-commit surface** (§6.3): post-resolution destruction
data, never a plan.

**NOT hashed by `matchDigest`** (D-DIGEST unchanged). The effect of a pending
detonation is captured by the following turn's bodies / ships, which the
digest already reads. Adding the field to the digest schedule would break the
5 frozen combat goldens (empty-array value would mix into every hash).

New sorted accessor beside `shipsSorted` / `bodiesSorted` /
`guidancesSorted`:
```ts
pendingDetonationsSorted(state): PendingDetonation[]  // ascending event.bodyId
```

**`src/sim/loop/createMatch.ts` — one new placement helper**

Adds a public helper the placement invariants read; no change to the
`createMatch` / `buildInitialState` contract itself:
```ts
minFleetCentroidSeparation(state: MatchState): number
```
Returns the smallest pairwise fleet-centroid distance, or `+Infinity` when
fewer than two distinct fleets exist. The invariant is that this is
`≥ tuning.arena.minFleetSeparationFraction × arena.radius` (v1 = 0.8).
Iterates fleet ids in ascending order for deterministic pairwise iteration.

**`src/sim/rules/missiles.ts` — `LaunchInput` gains one optional field**

Additive to the F4 public API:
```ts
export interface LaunchInput {
  // …existing 9 fields…
  readonly launchClearsLauncher?: boolean;
}
```
When true, the launched missile spawns offset ahead of its launcher by
`shooter.ship.radius + rack.bodyRadius + 1e-3` along the firing bearing so
the physics broadphase cannot report an overlap on the first sub-step (which
would fire `detonatesOnContact` on the launcher). Absent/false ⇒ spawn at
`shooterPosition` (pre-F6 behavior — the frozen combat golden fixtures'
loaded configs omit the flag).

Loop-side de-duplication: the LaunchEnv inside `sim/loop/resolveBeat.ts`
previously duplicated the launch geometry; it now delegates to `rules.launch`
verbatim, injecting the two per-match config fields it owns
(`state.combat.missiles.trackingBeats`,
`state.combat.missiles.launchClearsLauncher ?? false`). One home for the
geometry.

**No other module surface changes.** `runMovementBeat` and `runAttackBeat`
keep their signatures; PD interception, cascade produce/consume, launch
offset, and the min-sep helper are all behind existing types.

**Boundary impact:** none. Additive to sim types + rules `LaunchInput`; the
loop's stage additions are internal composition. No new npm import, no
dependency-flow change, no cross-module edge added.
