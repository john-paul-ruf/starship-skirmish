# M06 — Sim: Physics (as built)

> Architecture-as-built detail for module M06 (+ shared `src/sim/types.ts`). Session-marked;
> appended by Jikijitsu from the worker's arch fragment. Note: `program/` is gitignored, so this
> file is disk-only (not in git history). **Contains a deliberate deviation from architecture §7.4
> — see the marked section; a human/verification session should ratify it.**

<!-- SESSION-03 -->
# SESSION-03 arch delta — M06 (Sim: Physics) + shared `src/sim/types.ts`

Purpose: append the M06 public surface to the module registry / architecture and record the
one deliberate refinement of `specs/architecture.md` §7.4 this session made.

## New module — M06 `src/sim/physics/`

Imports permitted: `src/sim/mathx/**` (leaf) + `src/sim/types.ts`. Nothing else. No npm.
Lint-enforced by the `sim → sim` boundary rule already live from S01.

### Public surface (from `src/sim/physics/index.ts`)

```ts
// Config seam (tuning values injected as a plain struct — no catalog import)
export interface PhysicsConfig {
  readonly dt: number;
  readonly subStepMin: number;
  readonly subStepMax: number;
  readonly restitution: number;
  readonly collisionDamageCoefficient: number;
  readonly arena: Arena;
}

// Sub-step derivation + primitives
export const subStepCount: (
  maxRelSpeed: number, dt: number, minRadius: number, min: number, max: number,
) => number;
export const integrateBody: (body: Body, subDt: number) => Body;
export const applyPlan: (body: Body, plan: MovementPlan) => Body;

// Broadphase — REFINED signature (see deviation below)
export interface Pair { readonly a: BodyId; readonly b: BodyId; }
export const broadphase: (bodies: readonly Body[], cellSize: number) => readonly Pair[];

// Narrowphase — swept sphere-sphere CCD
export interface SweepHit { readonly toi: number; }
export const sweepSphereSphere: (
  pA: Vec3, dA: Vec3, rA: number, pB: Vec3, dB: Vec3, rB: number,
) => SweepHit | null;

// Momentum exchange + collision-damage magnitude (physics computes; rules applies)
export interface CollisionResolve {
  readonly newVelA: Vec3;
  readonly newVelB: Vec3;
  readonly normal: Vec3;          // unit, from B toward A
  readonly point: Vec3;           // on the line of centers
  readonly relSpeedNormal: number; // ≥ 0
  readonly damage: number;         // k · reducedMass · relSpeedNormal²
  readonly applied: boolean;       // false for grazing/separating (no impulse)
}
export const resolveCollision: (
  pA: Vec3, vA: Vec3, mA: number, rA: number,
  pB: Vec3, vB: Vec3, mB: number, rB: number,
  restitution: number, damageCoefficient: number,
) => CollisionResolve;

// Boundary — sphere containment + exit classification (FR-26)
export type BoundaryExitKind = 'ship-destroyed' | 'hazard-removed';
export interface BoundaryExit {
  readonly bodyId: BodyId;
  readonly kind: BoundaryExitKind;
  readonly subStep: number;
}
export const isOutsideArena: (position: Vec3, arena: Arena) => boolean;
export const classifyExit: (body: Body) => BoundaryExitKind;

// Preview — SHARED integrator with resolveMovement (the "preview must not lie" contract)
export interface PreviewPath {
  readonly positions: readonly Vec3[];   // length = subStepCount + 1
  readonly subStepCount: number;
  readonly endsOutsideArena: boolean;
}
export const previewPath: (
  body: Body, plan: MovementPlan | null, config: PhysicsConfig,
) => PreviewPath;

// Beat-level orchestrator
export interface StepContact {
  readonly subStep: number;
  readonly toi: number;
  readonly idA: BodyId;      // idA < idB
  readonly idB: BodyId;
  readonly normal: Vec3;
  readonly point: Vec3;
  readonly relSpeedNormal: number;
  readonly damage: number;
}
export interface StepResult {
  readonly finalBodies: readonly Body[];                // sorted by id
  readonly subStepCount: number;
  readonly keyframes: readonly (readonly Body[])[];     // length = subStepCount + 1
  readonly contacts: readonly StepContact[];            // canonical order
  readonly exits: readonly BoundaryExit[];
}
export const resolveMovement: (
  bodies: readonly Body[],
  plans: readonly MovementPlan[],
  config: PhysicsConfig,
) => StepResult;
```

## New file — `src/sim/types.ts` (shared sim types, sim-wide)

Deliberately minimal — holds only what physics needs AND what downstream sim modules
(`sim/rules`, `sim/loop`) will inevitably need to agree on. `MatchState` / `AttackPlan` /
`ResolutionTrace` land with the modules that own them.

```ts
export type BodyId = number;                         // uint32, sorted iteration

interface BodyCommon {
  readonly id: BodyId;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly mass: number;   // > 0
  readonly radius: number; // > 0
}
export interface ShipBody    extends BodyCommon { readonly kind: 'ship'; }
export interface DebrisBody  extends BodyCommon { readonly kind: 'debris'; }
export interface MissileBody extends BodyCommon { readonly kind: 'missile'; }
export type Body = ShipBody | DebrisBody | MissileBody;

export interface MovementPlan {
  readonly bodyId: BodyId;
  readonly deltaV: Vec3;   // physics trusts the delta; domain enforces engine caps
}

export interface Arena {
  readonly center: Vec3;
  readonly radius: number;
}
```

## Deliberate refinement of architecture §7.4 — broadphase cell size

Spec §7.4 suggests `cellSize = 2·maxRadius`. That is sound when per-sub-step displacement
is smaller than a body's radius — which is guaranteed by the sub-step formula only when
`N` is not clamped. At `N = subStepMax` (64) and high closing speeds, per-sub-step
displacement can exceed maxRadius and the naïve cell size makes the ±1 neighbourhood scan
skip the pair — even though swept CCD downstream would have caught it. This surfaced as a
concrete tunneling regression during CP2 (`tests/unit/physics/tunneling.test.ts`).

Fix: broadphase now takes `cellSize` as a caller-supplied argument. `resolveMovement`
computes `cellSize = 2·(maxRadius + maxDisplacementPerSubStep)`, which dominates
`rA + rB + |dA| + |dB|` — the worst-case center separation for a pair that could touch
this sub-step. The ±1 neighbourhood is provably sound under this cell size.

Callers who want the old semantics can pass `2·maxRadius` directly (the CP1 broadphase
tests do — the scenes are stationary).

## Contracts inherited by downstream (S04, S05, F4+)

- **`previewPath` shares its integrator with `resolveMovement`.** Any change to
  `integrate.ts` or `subStepCount` must land in both consumers atomically; the
  "preview must not lie" test (`tests/unit/physics/previewPath.test.ts`) is the tripwire.
- **`StepResult` is fully serializable.** No functions, no class instances, no `Map`/`Set` —
  plain records + arrays. This is what makes `tests/determinism` viable next session (S04).
- **`resolveMovement` does not mutate its inputs.** Two-phase read/stage/commit (§7.3
  rule 3). `finalBodies`/`keyframes` are new arrays of new objects.
- **`sim/rules` (F4) will consume `StepResult.contacts[*].damage`.** Physics reports the
  magnitude; rules decides how it lands on hull/shields (FR-25).

## Consumers wired via M06 in later work

- **S04 (Balance Harness / determinism rig):** will invoke `resolveMovement` on canned
  fleets to produce hashable digests (§7.5). `StepResult` is the digest input.
- **S05 (Gate 1 prototype):** will invoke `previewPath` for arc rendering and
  `resolveMovement` for turn playback.
- **M13 `src/render/`:** will invoke `previewPath` for the ghost `Line2` and consume
  `StepResult.keyframes` via `TracePlayer` (architecture §9).
- **M09 `src/sim/rules/` (F4):** will consume `StepContact.damage` + `.idA/.idB` to
  update shields/hull.
- **M12 `src/ai/`:** will consume `previewPath` when a bot commander evaluates its own
  candidate moves.

<!-- finite-thrust-movement / SESSION-01 -->
## finite-thrust-movement / SESSION-01 — Segmented plan + finite-thrust integrator

### M04 (Sim: Math Core) — no shape change

Still `+ − × ÷ √` arithmetic-only + `dirFromBearingPitch` (transcendental ban intact).
Consumers of the new plan shape convert bearing/pitch → `Vec3` on the *producer* side,
so `sim/physics` never sees an angle (D-PHYSICS-VEC3-ONLY holds end-to-end).

### M06 (Physics) — additive public API

- **`src/sim/types.ts`**
  - **NEW** `interface WaypointBurn { readonly deltaV: Vec3; }` — one waypoint burn
    within a beat (finite-thrust). Producer supplies world-space `deltaV`; the
    burn fires at `PhysicsConfig.maxAccel` for `|deltaV|/maxAccel` sim-seconds
    from the segment's time-slice start, then coasts. Per-segment `|Δv|` is
    capped at `maxAccel · sliceSeconds` inside `thrustSchedule`.
  - **CHANGED (additive)** `MovementPlan` gains `segments?: readonly WaypointBurn[]`.
    ABSENT → impulsive (byte-identical to pre-SESSION-01, `applyPlan`-at-start).
    PRESENT → finite-thrust; `deltaV` is IGNORED (segments override). Callers
    that emit `segments` should still set `deltaV = ZERO` for shape-consistency
    but the resolver reads only the schedule.

- **`src/sim/physics/config.ts`**
  - **NEW (optional)** `PhysicsConfig.maxAccel?: number` — engine's bounded
    acceleration in world-units per sim-second². REQUIRED whenever the resolver
    is fed a `MovementPlan` with `segments`. Optional (rather than required) so
    every existing `PhysicsConfig` literal — including `physicsConfigFromTuning`
    in `src/domain/resolveFleet.ts` (OUT of this session's lease) — still
    compiles unchanged. See the followUp note below on where the propagation
    still needs to land.
  - When `maxAccel` is missing/non-positive/non-finite AND `plan.segments` is
    present, `thrustSchedule` degrades to depositing the segments' summed
    impulse at sub-step 0 (impulsive rendering — what an infinite-thrust engine
    would do). Deterministic; keeps downstream consumers from silently coasting
    on a misconfigured physics. This is NOT the intended production path.

- **`src/sim/physics/thrust.ts`** — NEW module
  - `thrustSchedule(plan, N, dt, maxAccel) → Vec3[]` (length `N`): the per-sub-step
    velocity delta the plan delivers. Impulsive branch returns
    `[plan.deltaV, ZERO, ZERO, …]`. Finite-thrust branch distributes each
    segment across its `dt / segments.length`-second time-slice via
    overlap-weighted `maxAccel · overlap · dir_k` accumulation. All arithmetic;
    no transcendental; no wall-clock.
  - `peakSpeedSq(startVelocity, schedule) → number`: running-sum peak `|v|²`
    over the schedule (sampled AFTER each sub-step's Δv is applied — `|v0|²`
    alone is not considered, matching the pre-SESSION-01 N derivation that
    used post-plan velocity). For impulsive schedule `[deltaV, 0, …]` returns
    `|v0 + deltaV|²` — the exact `maxSpeedSq` old resolver computed.

- **`src/sim/physics/integrate.ts`** — additive
  - **NEW** `applyThrust(body, dv) → Body`: `vel ← vel + dv`, returns new body.
    Per-sub-step primitive both the resolver and preview funnel through when
    applying `thrustSchedule[k]`. Same `add` `applyPlan` uses, so an impulsive
    schedule `[deltaV, 0, …]` reproduces `applyPlan(body, plan)` exactly at k=0
    and no-ops for k > 0.
  - `applyPlan` KEPT — still exported, still called by `previewPath`'s pre-
    SESSION-01 callers via `src/sim/index.ts`, and by
    `tests/unit/physics/integrate.test.ts`. Only `resolveMovement` no longer
    routes through it.

- **`src/sim/physics/resolveMovement.ts`** — behaviour additive
  - Sub-step count derivation now uses per-body analytical peak: `lengthSq(v0)`
    for no-plan bodies, `peakSpeedSq(v0, thrustSchedule(plan, peakScheduleN, dt, maxAccel))`
    for plan-carrying bodies (with `peakScheduleN = segments.length` for
    finite-thrust, `1` for impulsive). Byte-identical to the pre-SESSION-01
    `maxSpeedSq = max lengthSq(applyPlan(body, plan).velocity)` on the
    impulsive branch (D-ADDITIVE-PLAN, locked by
    `tests/unit/physics/impulsiveEquivalence.test.ts`).
  - Sub-step loop applies `scheduleById[body.id][k]` before broadphase/sweep so
    CCD sees the same velocity the ballistic advance will use. `k = 0` is
    pre-applied in the setup (as the `keyframes[0]` snapshot). Fast-path
    `dv === ZERO` skip preserves object identity when unchanged.

- **`src/sim/physics/previewPath.ts`** — schedule + segment marks
  - Both `previewPath` and `resolveMovement` build their per-sub-step Δv
    sequence through the SAME `thrustSchedule` function (D-SHARED-SCHEDULE).
    Curved preview arcs match the flown curve byte-for-byte on lone-body
    scenarios (verified in `previewPath.test.ts`).
  - **NEW** `PreviewPath.markPositions: readonly Vec3[]` — world positions at
    each waypoint segment boundary (`k · dt / segments.length`), length
    `segments.length + 1`. Interpolated (lerp) between the enclosing sub-step
    endpoints, so marks land on the TRUE curved arc. EMPTY for null plans and
    for segments-absent impulsive plans (the UI keeps its per-second sampling
    over `positions` there, as before).

- **`src/sim/physics/index.ts`** — barrel append-only
  - New exports: `thrustSchedule`, `peakSpeedSq`, `applyThrust`, type
    `WaypointBurn` (re-exported from `../types.js`).

### M02 (Catalog Content) — additive tuning block

- **`catalog/tuning.json`**
  - **NEW** `physics.maxAccel = 25` — the engine acceleration ceiling (world-
    units/sim-sec²). Sourced from the Gate-1 prototype's `MAX_DV_PER_TURN / dt`
    relationship; S06 owns the balance re-tune.
  - **NEW** `physics.movementModel = 1` — version marker. 1 = the pre-SESSION-01
    impulsive-only model the current hash-locked fixtures were recorded under.
    S06 bumps to 2 and appends the re-recorded generation when downstream
    sessions actually emit `segments` (D-VERSION-RERECORD, Custom Rule 3).
  - Both fields are additive JSON — `test:catalog-lock` stays green (assertLock
    doesn't require the `physics` key). No `Tuning` type updates needed on this
    session because `loadCatalog` casts `tuningFile as unknown as Tuning`; the
    values live in JSON and will be read by S02/S04 once
    `physicsConfigFromTuning` in `src/domain/` (out of this session's lease) is
    taught to propagate them.

> **Jikijitsu note (cross-lease gap, carried to Forge):** the load-bearing
> propagation `src/domain/resolveFleet.ts::physicsConfigFromTuning` →
> `PhysicsConfig.maxAccel` is owned by NO session in this feature. Without it,
> producers that emit `segments` deterministically fall back to impulsive-at-k=0
> (no curve). Downstream S02/S04 must land it within their own reasoning or block.

<!-- tactical-attack-mock-parity SESSION-01 -->
## M06 · Sim shared types — display identity seam (SESSION-01, tactical-attack-mock-parity)

Additive, behavior-free identity carried across the `domain → sim` seam so M14
can render authored chassis / component names (see `mocks/tactical-attack.html`).

- **New exported interface** `SimDisplayIdentity { readonly id: string; readonly name: string }` in `src/sim/types.ts`. Display-only: forbidden from any rule / physics / AI-score / RNG-key / digest / trace-digest input.
- **Extended interfaces (all fields OPTIONAL for legacy-fixture compatibility, ALWAYS populated by `domain.resolveShip`):**
  - `SimShip.chassis?: SimDisplayIdentity`
  - `SimWeapon.display?: SimDisplayIdentity`
  - `SimMissileRack.display?: SimDisplayIdentity`
  - `SimPointDefense.display?: SimDisplayIdentity`
  - `SimDecoy.display?: SimDisplayIdentity`
- **No change** to existing numeric fields, array orders, digest inputs, ordinal / share-token wire format, or any catalog / lockfile.
