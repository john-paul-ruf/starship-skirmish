# M05 Domain — public surface (as built)

<!-- SESSION-02 -->
## `src/domain/` — public API delta added by SESSION-02

Files added (all pure, no globals, no wall-clock, no throws across the public API):

- `src/domain/types.ts` — public types
- `src/domain/build.ts` — Build constructors
- `src/domain/pointCost.ts` — current-cost + per-slot breakdown
- `src/domain/validateFit.ts` — fit-only legality gate

### Types (from `src/domain/types.ts`)

- `Result<T, E>` — `{ ok: true; value: T } | { ok: false; error: E }`. Used
  wherever a caller-constructed input can fail (`emptyBuild`, `validateFit`).
  Domain never throws across its public API.
- `Build` — the durable ship design (specs/database.md §3.2). `id`, `createdAt`,
  `updatedAt` are minted at the persist/io boundary and carried through
  verbatim. `storedCost` is a historical fact (§3.3), never silently
  recomputed.
- `BuildMeta` — the identity/version bundle callers hand to `emptyBuild`:
  `{ id, schemaVersion, catalogVersion, createdAt, updatedAt }`.
- `PointBreakdown` / `PointBreakdownSlot` — chassisCost, per-slot lines,
  total. `total === pointCost(catalog, build)`. Deliberately exposes NO
  leftover / conversion / budget surface.
- `FitCode` union: `ERR_UNKNOWN_CHASSIS | ERR_UNKNOWN_CLASS | ERR_SLOT_COUNT |
  ERR_UNKNOWN_COMPONENT | ERR_SLOT_TYPE_MISMATCH`.
- `FitError` — `{ code, message, slotIndex?, id?, expected?, actual? }`.
- `DomainError` — currently aliased to `FitError`; S03 may widen the union.
- `ValidatedBuild` — `{ readonly build: Build; readonly _validated: true }`,
  the nominal receipt `validateFit` mints. S03's `derivedStats` /
  `resolveFleet` require this so "priced/resolved an unvalidated build" is a
  compile-time error, not a runtime hope.
- `DerivedStats` / `RefitDiff` — DECLARED but not implemented (empty
  placeholder shapes). S03 fills them in without editing `types.ts` (S02's
  file, S03 does not have it in its lease). Planned fields are documented in
  the JSDoc.

### Functions

- `emptyBuild(catalog, chassisId, name, meta, tags?): Result<Build, FitError>`
  — mints a chassis-shaped `Build` with all-null slots. `storedCost` seeds to
  the chassis point cost only. Returns `ERR_UNKNOWN_CHASSIS` or
  `ERR_UNKNOWN_CLASS` when the id doesn't resolve.
- `withSlot(build, index, componentId | null): Build` — immutable slot set.
  Guards `index` against `slots.length` (throws `RangeError` for a
  caller-bug out-of-range write). Deliberately does NOT enforce slot-type
  legality — that is `validateFit`'s job.
- `slotTypesFor(catalog, build): readonly SlotType[]` — the frozen layout
  for this build's chassis class. Returns `[]` if the chassis or class isn't
  in the catalog (defensive; the real error comes from `validateFit`).
- `pointCost(catalog, build): number` — chassis + Σ fitted components. Empty
  slots contribute 0. Unknown ids contribute 0 (a defensive guard; the load
  pipeline validates before pricing per specs/database.md §7.2).
- `pointBreakdown(catalog, build): PointBreakdown` — per-slot lines S03's
  `refitDiff` reuses. `total === pointCost(catalog, build)`.
- `validateFit(catalog, build): Result<ValidatedBuild, readonly FitError[]>` —
  collects ALL violations, not first-fail. Reports:
    * `ERR_UNKNOWN_CHASSIS` alone (skips per-slot checks; nothing meaningful
      to say without a layout);
    * `ERR_UNKNOWN_CLASS` alone (same reason);
    * `ERR_SLOT_COUNT` when `build.slots.length !== layout.length`;
    * `ERR_UNKNOWN_COMPONENT` with `slotIndex` + `id`;
    * `ERR_SLOT_TYPE_MISMATCH` with `slotIndex`, `id`, `expected`, `actual`.
  Per-slot checks run over the OVERLAPPING region between fit and layout
  when a slot-count mismatch is present (surplus/deficit indices don't get
  per-index messages — the UI shows "wrong number of slots" once).

### Consumption seams for S03

- `derivedStats(catalog, validated): DerivedStats` — takes a `ValidatedBuild`,
  not a `Build`. Import `ValidatedBuild` + `DerivedStats` from
  `../domain/types.js`; import `Build` if it needs to look inside `.build`.
- `refitDiff(catalog, oldTotal, build): RefitDiff` — reuses
  `pointBreakdown` for per-slot current costs; consumes `PointBreakdown` from
  `../domain/types.js` if it wants the shape.
- `resolveFleet(catalog, validatedBuilds[]): SimFleet` — takes an array of
  `ValidatedBuild`, produces the `SimFleet` type S03 adds to `src/sim/types.ts`.

### Deliberately absent (spec-mandated, grep-checked)

- No `leftoverPoints` / `pointsBanked` / `conversionRate` on any exported
  shape (Decision 9 / FR-5 / specs/database.md §3.2 "Fields that deliberately
  do not exist").
- No `needsRefit` field on `Build` — derived on load, never stored (§3.3).
- No `currentCost` / `derivedStats` cached on `Build` — derived on demand.
- No `src/io/limits.ts` — name/tag caps are a cross-format concern that lives
  at the io/persist boundary (F3), not in domain (STATE.md Design Decision
  #4). `validateFit` here is fit-only.

<!-- SESSION-03 -->
## M05 Domain — S03 additions (derive / refit / resolve)

### Public surface added to `src/domain/index.ts` (barrel)

Re-exports S02's public API (`Build`, `BuildMeta`, `Result`, `PointBreakdown`,
`PointBreakdownSlot`, `FitCode`, `FitError`, `DomainError`, `ValidatedBuild`,
`emptyBuild`, `withSlot`, `slotTypesFor`, `pointCost`, `pointBreakdown`,
`validateFit`) plus the S03 surface:

- `interface DerivedStats` (see file for full shape) — FR-6 Shipyard readout
- `interface SimWeaponReadout { name, range, damage, shotsPerTurn, accuracy }`
- `derivedStats(catalog, validated: ValidatedBuild): DerivedStats`
- `interface RefitDiff { oldTotal, newTotal, delta, lines: readonly RefitDiffLine[] }`
- `interface RefitDiffLine { index, componentId, currentCost }`
- `refitDiff(catalog, build: Build): RefitDiff | null` (null = no refit needed)
- `needsRefit(catalog, build: Build): boolean` (computed, never cached on Build)
- `resolveShip(catalog, validated: ValidatedBuild): SimShip`
- `resolveFleet(catalog, fleetId: number, builds: readonly ValidatedBuild[]): SimFleet`
- `resolveArena(tuning, budget: number): Arena` (throws `RangeError` on illegal budget)
- `physicsConfigFromTuning(tuning, budget: number): PhysicsConfig`

SHAPE NOTE: the barrel re-exports S02's `./types.js` **selectively** — S02's
placeholder `DerivedStats` / `RefitDiff` (`{_s03Placeholder?: never}` stubs) are
NOT re-exported; the real shapes come from `./derivedStats.js` / `./refitDiff.js`.
A blanket `export *` would name-collide.

### M04/M06 Sim Core — `src/sim/types.ts` extension (types-only, additive)

Added the resolved-fleet input contract sim consumes. Zero new imports; pure
type declarations only (deterministic-core lint gates satisfied trivially).
`ChassisClass` / weapon / missile / special sub-shapes are declared **fresh**
here (not imported from `catalog/`, which sim may not reach); the string-literal
unions are structurally identical to the catalog's so `domain.resolveShip`
bridges them by plain assignment.

- `export type ChassisClass = 'fighter' | 'frigate' | 'cruiser' | 'mega-destroyer'`
- `interface SimWeapon { range, damage, shotsPerTurn, accuracy }`
- `interface SimMissileRack { ammo, damage, aoeRadius, boostVelocity, trackingTurnRate, bodyMass, bodyRadius }`
- `interface SimPointDefense { interceptRange, interceptChance, interceptsPerTurn }`
- `interface SimDecoy { charges, evasionBonus, durationTurns }`
- `interface SimShip { buildId, name, chassisClass, mass, radius, maxHull, shieldCapacity, shieldRegenPerTurn, deltaVPerTurn, baseEvasion, hullRepairPerTurn, weapons[], missiles[], pointDefense[], decoys[] }`
- `interface SimFleet { fleetId, ships: readonly SimShip[] }`

### Dependency-flow deltas

- `domain → sim/types` (type-only) and `domain → sim/physics` (type-only, for
  `PhysicsConfig`). Both allowed under the existing boundary rules
  (`default: allow`; only `sim → *` is restricted). No sim/render/ui/persist
  imports from domain.
- `sim/types.ts` unchanged import surface — only `./mathx/index.js` (sim→sim),
  as before S03.

### Load-pipeline gate (§7.2 validate → resolve made compile-time)

`derivedStats`, `resolveShip`, `resolveFleet` all take `ValidatedBuild` — resolving
or deriving an unvalidated build is a type error.

### Design decisions ratified

- `SimShip` is sim-owned, domain-produced (sim can't import domain).
- Passive specials fold (armor-plating→maxHull, thrust-booster→deltaV numerator
  before divide, damage-control→hullRepairPerTurn); active specials
  (point-defense, decoy-launcher) stay STRUCTURED in
  `SimShip.pointDefense[]` / `SimShip.decoys[]` for `sim/rules` (F4).
- `decoy.evasionBonus` is a per-turn rule — NOT folded into `baseEvasion`.
- No delta-V floor (§11 Q4 degenerate fit reported faithfully; a floor is a
  data/tuning decision, not code).
- `needsRefit` is computed, never stored on the `Build` record (§3.3).

### Follow-ups for downstream features

- **F3 io/persist** consumes `refitDiff` on the load pipeline (§7.2) and creates
  `src/io/limits.ts` for the name/tag caps S02 deferred.
- **F4 sim/rules + sim/loop** consumes `SimShip` + `physicsConfigFromTuning`;
  may extend `SimShip` additively if new rule state is required at construction
  time.
- **F5 ai** consumes `resolveFleet` for bot fleet construction.

<!-- sim-combat SESSION-01 -->
## F4 sim-combat — S01 delta (shared combat vocabulary + `combatConfigFromTuning`)

### M-shared `src/sim/types.ts` — additive combat vocabulary

New exported types (all read-only, appended; nothing renamed or retyped):

- `CalledShotTarget` — discriminated union of `weapon`/`missile`/`special` (with `index: number`) plus aggregate `shield-generator`/`engine`. Addresses called-shot targets (FR-25).
- `AttackPlan` — one fire assignment for the attack beat (`shooterId`, `targetId`, optional `weaponIndex` / `missileIndex` / `calledShot`). Symmetric with `MovementPlan`; produced by `Commander`, consumed by `sim/rules` (M09), recorded via `sim/trace` (M11).
- `CombatLogResult = 'hit' | 'miss' | 'crit' | 'kill' | 'intercept' | 'boundary-exit'`.
- `DamageSourceKind = 'weapon' | 'missile' | 'collision' | 'aoe' | 'boundary'`.
- `CombatLogEntry` — FR-21 per-shot record: `turn`, `beat`, `source`, `sourceId`, `targetId`, `result`, `chance` (0..1 published), `roll` (0..1 seeded draw), `damage`, `shield{Before,After}`, `hull{Before,After}`, optional `calledShot`.
- `DestructionEvent` — ship destruction record (`bodyId`, `chassisClass`, `position`, `velocity`, `cause`, `detonates`). Drives AoE + debris (FR-23/26).
- `HitChanceBreakdown` — the *published* hit-chance breakdown UI reads (Ruling H, architecture §13.3): `base`, `rangeFactor`, `velocityFactor`, `evasionFactor`, `final`. Formula lives in `sim/rules`; nothing recomputes.
- `CombatConfig` — resolved combat tuning the sim consumes (`hazards`, `destruction`, `missiles`, `shields` sub-blocks). Mirrors `PhysicsConfig` — `sim` never imports catalog; domain produces this struct.

The file header note was updated: `AttackPlan`/`CombatLogEntry`/`DestructionEvent` live in the shared leaf (not `sim/rules`) to avoid a `rules ↔ trace ↔ loop ↔ ai` cycle — the same rationale that already keeps `MovementPlan`/`Body` here.

### M05 Domain — new public export

New function (added to `src/domain/resolveFleet.ts`, re-exported from `src/domain/index.ts`):

- `combatConfigFromTuning(tuning: Tuning): CombatConfig` — the tuning → sim-combat-config seam. Mirrors `physicsConfigFromTuning`. Narrows the catalog's `Record<string, number>` per-class tables to `Record<ChassisClass, number>` for `debrisPerDestruction`, `aoeRadiusByClass`, `aoeDamageByClass`; throws `RangeError` on a missing class key (same fail-loud posture as `resolveArena` on an illegal budget). Reads only existing `tuning.json` fields — no catalog / tuning-schema change.

No `Tuning` field is added, removed, or retyped. F4 S04's `createMatch` will assemble `MatchConfig { seed, fleets, arena, physics, combat }` on top of `physicsConfigFromTuning` + `combatConfigFromTuning`.

<!-- tactical-attack-mock-parity SESSION-01 -->
## M05 · Domain — production resolver populates identity

`src/domain/resolveShip` now emits `chassis` on `SimShip` and `display` on every
structured component (`weapons[]`, `missiles[]`, `pointDefense[]`, `decoys[]`)
by copying `{id, name}` straight from the already-validated catalog definitions.
Slot-derived array order is unchanged; downstream `weaponIndex` /
`missileIndex` / `CalledShotTarget.special.index` continue to address the same
entries. Numeric mapping is byte-for-byte identical.
