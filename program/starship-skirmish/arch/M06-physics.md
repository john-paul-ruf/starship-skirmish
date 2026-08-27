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
