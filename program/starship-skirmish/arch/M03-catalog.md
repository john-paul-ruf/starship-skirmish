<!-- SESSION-01 -->
# M03 Catalog Loader — public surface (as built)

New module `src/catalog/` (barrel `src/catalog/index.ts`). Realizes the
architecture §4 `catalog/` module contract and serves the six §4 indexes for
query patterns Q1–Q6 (specs/database.md §8).

## Public API

```ts
// Types (from src/catalog/types.ts)
type SlotType = 'weapon' | 'shield' | 'missile' | 'engine' | 'special';
type ChassisClass = 'fighter' | 'frigate' | 'cruiser' | 'mega-destroyer';

interface ClassDef      { id, name, slots: readonly SlotType[], addedInCatalogVersion }
interface ChassisDef    { id, ordinal, name, classId, pointCost, hullPoints,
                          mass, hullRadius, baseEvasion, addedInCatalogVersion }
interface WeaponDef     extends ComponentCommon { slotType: 'weapon',  stats: {range, damage, shotsPerTurn, accuracy} }
interface ShieldDef     extends ComponentCommon { slotType: 'shield',  stats: {capacity, regenPerTurn} }
interface MissileDef    extends ComponentCommon { slotType: 'missile', stats: {ammo, damage, aoeRadius,
                                                                               boostVelocity, trackingTurnRate,
                                                                               bodyMass, bodyRadius} }
interface EngineDef     extends ComponentCommon { slotType: 'engine',  stats: {thrustImpulse} }
interface SpecialDef    extends ComponentCommon { slotType: 'special', stats: SpecialEffect }
type ComponentDef       = WeaponDef | ShieldDef | MissileDef | EngineDef | SpecialDef;

type SpecialEffect =
  | {effect:'armor-plating', bonusHull}
  | {effect:'decoy-launcher', charges, evasionBonus, durationTurns}
  | {effect:'thrust-booster', thrustImpulseBonus}
  | {effect:'point-defense', interceptRange, interceptChance, interceptsPerTurn}
  | {effect:'damage-control', hullRepairPerTurn};

interface Tuning        { schemaVersion, catalogVersion, arena, match, hazards,
                          destruction, collision, missiles, shields }
interface CatalogLock   { catalogVersion, lockedAt, reservedOrdinals,
                          nextOrdinal, ordinals, classSlotCounts }

// The interface every downstream module resolves ids through
interface Catalog {
  readonly catalogVersion: number;
  readonly tuning: Tuning;
  chassis(id: string):        ChassisDef   | undefined;   // Q1
  component(id: string):      ComponentDef | undefined;   // Q1
  ordinalOf(id: string):      number       | undefined;   // Q4
  byOrdinal(n: number):       ChassisDef | ComponentDef | undefined;  // Q5
  classOf(c: ChassisClass):   ClassDef     | undefined;
  slotLayout(c: ChassisClass): readonly SlotType[] | undefined;       // Q3
  componentsForSlot(t: SlotType):  readonly ComponentDef[];           // Q2
  chassisOfClass(c: ChassisClass): readonly ChassisDef[];             // Q3
  allChassis():    readonly ChassisDef[];
  allComponents(): readonly ComponentDef[];
}

// Functions (from src/catalog/{loadCatalog,assertLock}.ts)
loadCatalog(): Catalog                                          // load, index, assertLock, freeze
assertLock(catalog, locks: readonly CatalogLock[]): void        // throws CatalogLockError on C1..C9
class  CatalogLockError extends Error { invariant: CatalogInvariantId }
type   CatalogInvariantId = 'C1'|'C2'|'C3'|'C4'|'C5'|'C6'|'C7'|'C8'|'C9';
```

## Notes for downstream sessions

- **`byOrdinal(n)` has no type parameter** — chassis and components share one
  ordinal space (§2.5). Decode must still type-check the resolved entry against
  its slot position (F3 io/codec).
- **Loader freezes the returned Catalog** (`Object.freeze`, top-level).
  Accessor lists are ordinal-sorted for stable output.
- **`buildCatalog(input: CatalogInput)`** is exported from `loadCatalog.ts`
  (not re-exported by the barrel) so tests can exercise assertLock with
  crafted-violation inputs. Downstream code should use `loadCatalog()`.
- **CI:** `.github/workflows/ci.yml` `build` job now runs `test:catalog-lock`
  between `test:unit` and `test:determinism`; the `TODO(F2 catalog)` comment
  is resolved.
