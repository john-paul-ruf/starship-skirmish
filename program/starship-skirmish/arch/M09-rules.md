# M09 Sim: Rules — public surface (as built)

<!-- sim-combat SESSION-02 -->
### M09 Sim: Rules — public surface (`src/sim/rules/index.ts`)

The complete combat rulebook as pure functions over plain inputs. Owned by SESSION-02
of feature `sim-combat`. Consumed by M10 Loop (S04) via this barrel.

**Module ID:** M09
**Path:** `src/sim/rules/`
**Imports from:** `src/sim/mathx/**`, `src/sim/physics/**` (types only), `src/sim/types.js`
**Nothing else** (lint-enforced): no `render`/`ui`/`persist`/`app`, no npm.

#### Design defaults set here (STATE.md Design Decisions)

- **D-HITCHANCE** — `src/sim/rules/damage.ts` — formula constants published as module
  consts with a `PROMOTION SEAM` marker comment:
  - `RANGE_EXP = 2` (quadratic range falloff via `powi`, no `Math.pow`)
  - `VELOCITY_REF = 800`
  - `HIT_FLOOR = 0.05`
  - `HIT_CEIL = 0.95`
  - Formula: `final = clamp(base · rangeFactor · velocityFactor · evasionFactor, floor, ceil)`
    with `rangeFactor = clamp01(1 − (range/weapon.range)^RANGE_EXP)`,
    `velocityFactor = clamp01(1 − targetSpeed/VELOCITY_REF)`,
    `evasionFactor = clamp01(1 − targetEvasion)`. Published via `HitChanceBreakdown`.
- **D-INTEGRITY** — `src/sim/rules/combatState.ts` — component integrity as a rules
  concept (no catalog change):
  - `BASE_INTEGRITY = { weapon: 30, missile: 30, special: 25, shieldGenerator: 40, engine: 45 }`
  - `CLASS_INTEGRITY_MULT = { fighter: 0.6, frigate: 1.0, cruiser: 1.5, 'mega-destroyer': 2.2 }`
  - Knockouts (FR-25): shield-gen ⇒ `shields=0` + no regen (does NOT restore depleted
    shields); engine ⇒ `engineAlive=false` (loop zeroes deltaV → coast);
    weapon/missile/special ⇒ that index's alive flag flipped false.
  - Both have `PROMOTION SEAM` marker comments (candidate v1.x catalog stats).

#### Public API (the exact re-export list from `src/sim/rules/index.ts`)

Combat state:
```ts
BASE_INTEGRITY: { weapon, missile, special, shieldGenerator, engine } as const
CLASS_INTEGRITY_MULT: Readonly<Record<ChassisClass, number>>
newShipCombat(ship: SimShip, bodyId: BodyId): ShipCombat
cloneShipCombat(sc: ShipCombat): ShipCombat
specialLayout(ship: SimShip, index: number): SpecialSubsystemRef | null

interface Damage { sourceId; shotIndex; amount; source: DamageSourceKind }
interface ComponentIntegrity { weapons[]; missiles[]; specials[]; shieldGenerator; engine }
interface ShipCombat {
  bodyId; ship;
  hull; shields;
  shieldGenAlive; engineAlive;
  weaponAlive[]; missileAlive[]; missileAmmo[];
  pdAlive[]; decoyAlive[]; decoyCharges[]; decoyActiveUntilTurn;
  componentIntegrity;
}
type SpecialSubsystemKind = 'pd' | 'decoy'
interface SpecialSubsystemRef { kind: SpecialSubsystemKind; subIndex: number }
```

Damage / rolls:
```ts
RANGE_EXP, VELOCITY_REF, HIT_FLOOR, HIT_CEIL: number
STREAM_ATTACK: number  // uint32 RNG stream tag for weapon rolls
hitChance(weapon, range, targetSpeed, targetEvasion): HitChanceBreakdown
rollHit(chance, seed, turn, shooterId, targetId, shotIndex): { hit: boolean; roll: number }
applyDamageBundle(target: ShipCombat, bundle: readonly Damage[]): ApplyDamageResult
aoeFalloff(centerDamage, distance, radius): number

interface ApplyDamageResult {
  after: ShipCombat;
  shieldBefore; shieldAfter; hullBefore; hullAfter;
  shieldDamage; hullDamage;
}
```

Shields + called shot:
```ts
regenShields(sc: ShipCombat, cfg: CombatConfig): ShipCombat
calledShotsUnlocked(target: ShipCombat): boolean
resolveCalledShot(target: ShipCombat, which: CalledShotTarget, incoming: number): CalledShotResult
interface CalledShotResult { after: ShipCombat; destroyed: boolean }
```

Attack beat (FR-20 + FR-21 snapshot semantics):
```ts
interface LaunchEnv {
  nextBodyId(): BodyId;
  launch(input: {
    shooter, shooterPosition, shooterVelocity,
    rackIndex, targetId, targetPosition, turn, bodyId
  }): { body: MissileBody; guidance: unknown } | null;
}
resolveAttackBeat(
  snapshot: ReadonlyMap<BodyId, ShipCombat>,
  positions: ReadonlyMap<BodyId, Vec3>,
  velocities: ReadonlyMap<BodyId, Vec3>,
  plans: readonly AttackPlan[],
  seed: Seed, turn: number, env: LaunchEnv,
): AttackResolution
interface AttackResolution {
  combats: ReadonlyMap<BodyId, ShipCombat>;
  log: readonly CombatLogEntry[];
  destroyed: readonly DestructionEvent[];
  launchedMissiles: readonly MissileBody[];
  launchedGuidance: readonly unknown[];
}
```

Missiles (life cycle):
```ts
STREAM_PD: number
interface MissileGuidance { bodyId; targetId; trackingBeatsLeft; rackDamage; aoeRadius; trackingTurnRate }
interface LaunchInput { shooter; shooterPosition; shooterVelocity; rackIndex; targetId; targetPosition; turn; bodyId; trackingBeats }
launch(input: LaunchInput): { body: MissileBody; guidance: MissileGuidance } | null
guideMissiles(
  guidances, bodyById: ReadonlyMap<BodyId, MissileBody>,
  targetPosById: ReadonlyMap<BodyId, Vec3>, reacquireOnTargetLoss: boolean,
): { plans: MovementPlan[]; nextGuidances: MissileGuidance[] }
detonatesOnContact(guidance: MissileGuidance, spentRemainsArmed: boolean): boolean
interface InterceptCandidate { defenderId; defenderPosition; pdIndex; missileId; missilePosition }
interceptMissiles(
  defenders: ReadonlyMap<BodyId, ShipCombat>,
  candidates: readonly InterceptCandidate[], seed: Seed, turn: number,
): { intercepted: BodyId[] }
```

Debris + destruction:
```ts
STREAM_DEBRIS: number
interface DebrisDescriptor { position; velocity; mass; radius }
spawnDebris(dest: DestructionEvent, ship: SimShip, seed: Seed, turn: number, cfg: CombatConfig): DebrisDescriptor[]
interface DebrisAge { bodyId; age }
tickDebrisLifetime(ages: readonly DebrisAge[], cfg: CombatConfig): { survivors: DebrisAge[]; culled: BodyId[] }
interface HazardEntry { bodyId; age }
enforceHazardCap(entries: readonly HazardEntry[], cfg: CombatConfig): {
  kept: HazardEntry[]; droppedCount: number; droppedIds: BodyId[]
}
// enforceHazardCap: NO silent truncation — droppedCount + droppedIds are for
// the loop to log. Never expected to fire in normal play (cap 300 ≫ field).

interface AoeHit { bodyId; damage }
interface DetonationResult { aoe: { center; radius; centerDamage }; hits: readonly AoeHit[] }
detonate(dest: DestructionEvent, bodyPositions: ReadonlyMap<BodyId, Vec3>, cfg: CombatConfig): DetonationResult | null
// boundary deaths (detonates=false) → null; ownership-blind (FR-23, Decision 13);
// dying body is excluded from its own AoE.
```

#### Determinism disciplines enforced here (S05 will hash-lock)

- Counter-based RNG only (`mathx/rng.ts`); RNG streams tagged with fixed uint32
  constants: `STREAM_ATTACK`, `STREAM_PD`, `STREAM_DEBRIS`.
- Damage bundles sorted by `(sourceId, shotIndex)` before summation (float addition
  is not associative — the sort is load-bearing).
- Body iteration by sorted uint32 `BodyId` — never `Object.keys`/`Set` order.
- Hazard-cap tie-break: age DESC then bodyId ASC.
- No transcendentals — `powi`/`cos`/`sin`/`atan2` from `mathx/trig.ts`. `Math.sqrt`,
  `Math.trunc`, `Math.imul` are the only bare `Math.*` calls (all IEEE-exact / spec-exact).
