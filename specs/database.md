# Database Design — Starship Skirmish

> **Status:** v1 — database phase. Derived from `specs/architecture.md` v1 and
> `specs/requirements.md` v1. Schema versions and catalog versions defined here start at **1**.
> (Architecture §8.2's `schemaVersion: 3 / catalogVersion: 7` is an illustrative future example,
> not an initial value.)
>
> Requirement IDs are cited inline wherever a schema decision traces to one.

---

## 0. Engine — read this before looking for a database

**There is no database.** This is not an omission; it is a locked constraint from three documents:

- Requirements §Constraints: *"No backend, no accounts, no database, no server-side anything."*
- Architecture §1 Data Layer: *"No ORM, no database, no query layer."*
- Architecture §1 Persistence: *"`localStorage` behind a `LibraryRepo` interface"* (Decision 5, FR-7).

So this document specifies the four persistence surfaces that actually exist, with the same rigor a
relational schema would get. Constraints are stated as explicit **invariants with error codes**
rather than DDL, because there is no engine to enforce them — **`src/io/validate.ts` and
`src/domain` are the constraint engine**, and if they don't check it, nothing does.

| # | Store | Medium | Trust | Writable at runtime |
|---|-------|--------|-------|---------------------|
| 1 | **Catalog** | Static JSON, bundled + precached | Trusted (CI-validated) | No — read-only, forever |
| 2 | **Library** | `localStorage` | Trusted (self-authored) | Yes |
| 3 | **Share token** | URL fragment | **UNTRUSTED** | No — decode-only |
| 4 | **Export file** | Downloaded / uploaded JSON | **UNTRUSTED** on import | Export writes, import reads |

Stores 3 and 4 are architecture §8's "wire formats" — *this project's real public API*. They are
specified here as schema because they are schema: they cross machines and years.

### 0.1 What has no store, deliberately

| Not persisted | Why |
|---|---|
| Match / battlefield state | No requirement asks for resume-a-match. Match state is a plain in-memory struct owned by `sim/` (architecture §1). |
| Post-match summary history | FR-27 requires the summary be *reported*, not *retained*. |
| Accounts, identities, sessions | No server (Decision 5). Nothing to authenticate. |
| Telemetry, analytics, balance data | NFR-Security: none, ever. FR-33's harness is the only balance instrument, and it runs offline in Node. |

The `starship-skirmish:match:*` key namespace is **reserved but unused** so a future
resume-a-match feature can't collide with library records.

---

## 1. Schema Overview

```
   ┌──────────────────────── STATIC / READ-ONLY ────────────────────────┐
   │                                                                    │
   │   classes.json ──published slot layout──┐                          │
   │        │                                │                          │
   │        │ classId                        │ validates                │
   │        ▼                                ▼                          │
   │   chassis/*.json  ◄──slot type match──  components/*.json          │
   │        │                                │                          │
   │        └────────┬───────────────────────┘                          │
   │                 │ id                                               │
   │                 ▼                                                  │
   │        lock/catalog-vN.json   { id → permanent ordinal }  APPEND-ONLY
   │                 │                                                  │
   │   tuning.json (arena, caps, lifetimes — no ids, no ordinals)       │
   └─────────────────┼──────────────────────────────────────────────────┘
                     │                    ▲                    ▲
        ordinals ────┘                    │ chassisId          │ componentId
                     │                    │ (string FK)        │ (string FK)
                     ▼                    │                    │
   ┌─────────── UNTRUSTED ──────┐   ┌─────┴────────────────────┴─────────┐
   │  ShareToken  (ordinals)    │   │  LOCALSTORAGE                      │
   │  ExportFile  (string ids)  │──▶│                                    │
   └────────────────────────────┘   │   :meta      (1)                   │
              decode → Result       │   :index     (1) ──1:N──▶ entries  │
                                    │   :build:<id>(N) ◄──1:1── entry.id │
                                    │   :prefs     (1)                   │
                                    └────────────────────────────────────┘
```

**The one relationship that matters:** `BuildRecord.chassisId` and `BuildRecord.slots[]` are
**string foreign keys into the catalog**, and the catalog is additive-only forever (FR-1). That is
the entire mechanism behind Pillar 4, "No loss, ever." Every other design choice below defends it.

---

## 2. Store 1 — The Catalog (static, read-only)

Files as authored. See `catalog/` for the shipped v1 content.

### 2.1 `catalog/classes.json` — slot layouts

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `schemaVersion` | int | `= 1` | |
| `catalogVersion` | int | `≥ 1`, monotonic | FR-1 |
| `slotTypes` | string[] | closed set of 5 | `weapon shield missile engine special` (FR-3) |
| `slotOrder` | string[] | permutation of `slotTypes` | Canonical authoring order for layouts |
| `classes[].id` | string | PK, kebab, permanent | `fighter frigate cruiser mega-destroyer` |
| `classes[].name` | string | non-empty | Display |
| `classes[].slots` | SlotType[] | length ≥ 1, each ∈ `slotTypes` | **The published layout** |
| `classes[].addedInCatalogVersion` | int | | |

**Layouts as shipped (FR-3 — published per class, never per chassis):**

| Class | Layout | Slots |
|---|---|---|
| `fighter` | W · E · S | 3 |
| `frigate` | W W · Sh · M · E · S | 6 |
| `cruiser` | W W W · Sh Sh · M M · E · S | 9 |
| `mega-destroyer` | W W W W · Sh Sh · M M M · E · S S | 12 |

Fighters carry **no shield and no missile slot**. That is the class identity, and it is expressed
structurally rather than as a stat penalty.

> ⛓ **FROZEN-LAYOUT INVARIANT.** Share tokens encode slot contents **positionally** (§6). A layout
> may therefore never be reordered, shortened, or retyped. It may **only grow at the tail**, and
> decode pads absent trailing slots with empty. Breaking this silently reinterprets every token
> ever generated. `classSlotCounts` in each lock file records the historical length so an old token
> can be decoded against the layout it was written for.

### 2.2 `catalog/chassis/*.json`

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | string | **PK**, `^[a-z]{3}-[a-z0-9-]+$`, permanent | Never deleted, reused, or renumbered (FR-1) |
| `ordinal` | int | **UNIQUE**, `≥ 1`, permanent | Shared ordinal space with components (§2.5) |
| `name` | string | non-empty | Display |
| `classId` | string | **FK** → `classes.id` | Dictates the slot layout (FR-3) |
| `pointCost` | int | `≥ 0` | Assumption 5 bands: Fig 4–8 · Frg 12–20 · Cru 28–45 · Meg 70–110 |
| `hullPoints` | int | `> 0` | FR-3 |
| `mass` | number | `> 0` | *Base* mass; components add (FR-3, FR-6) |
| `hullRadius` | number | `> 0` | Sphere collider radius (architecture §1 Physics) |
| `baseEvasion` | number | `0 ≤ x < 1` | Feeds the Ruling H hit formula |
| `addedInCatalogVersion` | int | `≥ 1` | |

### 2.3 `catalog/components/*.json`

Common envelope, plus a `stats` block discriminated by `slotType`:

| Field | Type | Constraints |
|---|---|---|
| `id` | string | **PK**, `^(wpn|shd|mis|eng|spc)-[a-z0-9-]+$`, permanent |
| `ordinal` | int | **UNIQUE** across the whole catalog, `≥ 1`, permanent |
| `name` | string | non-empty |
| `slotType` | enum | ∈ `slotTypes` — **the fitting constraint** (FR-4) |
| `pointCost` | int | `≥ 0` |
| `mass` | number | `≥ 0` — mass this adds to the ship |
| `addedInCatalogVersion` | int | `≥ 1` |
| `stats` | object | per-type, below |

| `slotType` | `stats` fields | Source |
|---|---|---|
| `weapon` | `range > 0`, `damage > 0`, `shotsPerTurn ≥ 1`, `0 < accuracy ≤ 1` | FR-4, Ruling G (no arc field), Ruling I (one damage number) |
| `shield` | `capacity > 0`, `regenPerTurn ≥ 0` | Decision 16 — **independent axes**, no facing field |
| `missile` | `ammo ≥ 1`, `damage > 0`, `aoeRadius > 0`, `boostVelocity > 0`, `0 < trackingTurnRate ≤ 1`, `bodyMass > 0`, `bodyRadius > 0` | Ruling B, Decision 12 |
| `engine` | `thrustImpulse > 0` | FR-4 — see the decision note below |
| `special` | `effect` ∈ closed set + that effect's typed params | FR-4 |

**`special.effect` is a closed discriminant**, one value per rule implemented in `sim/rules`:

| `effect` | Params |
|---|---|
| `armor-plating` | `bonusHull` |
| `decoy-launcher` | `charges`, `evasionBonus`, `durationTurns` |
| `thrust-booster` | `thrustImpulseBonus` |
| `point-defense` | `interceptRange`, `interceptChance`, `interceptsPerTurn` |
| `damage-control` | `hullRepairPerTurn` |

Re-tuning any number is pure content work. **Adding a new `effect` value is the single catalog
change that requires code** — an honest exception to "content is editable without touching game
code" (NFR-Maintainability), stated here rather than discovered later.

> **SCHEMA DECISION — engines publish `thrustImpulse`, not flat delta-V.**
> FR-4 says the engine "defines delta-V budget per turn"; FR-6 wants **both** `delta-V/turn` **and**
> `effective acceleration` in the readout. Those are the same number unless mass participates. So
> the component publishes momentum-per-turn and the *ship* derives its budget:
> `deltaVPerTurn = (engine.thrustImpulse + Σ thrustBoosterBonus) / totalMass`.
> This makes every component's `mass` a real trade in the Shipyard instead of a collision-only stat,
> and it is **reversible in data alone** — equalize all masses and it degenerates to flat delta-V.
> Missile `bodyMass`/`bodyRadius` are the in-flight missile as a physics body; the envelope `mass`
> is the rack bolted to the ship. Two different objects, deliberately two different fields.

### 2.4 `catalog/tuning.json`

No ids, no ordinals — pure numbers, all harness-tunable (Assumption 3). Notable entries:

| Path | Value | Requirement |
|---|---|---|
| `arena.radiusByBudget` | table over the 6 legal budgets | Ruling C — `arenaRadius = f(budget)` as data |
| `arena.startVelocity` | `0` | FR-12 |
| `match.legalBudgets` | `[25,50,75,100,125,150]` | FR-10 |
| `match.fleetHullCap` / `fieldShipCap` | `20` / `60` | FR-10, Assumption 4 — **data, not a structural limit** |
| `match.maxFleets` / `maxBots` | `5` / `4` | FR-11, Decision 2 |
| `hazards.maxSimultaneousBodies` | `300` | FR-23 hard cap, oldest culled first |
| `hazards.debrisLifetimeTurns` | `6` | FR-23 |
| `hazards.debrisPerDestruction` | keyed by class | FR-23 — scales with chassis class |
| `missiles.trackingBeats` | `2` | Decision 15 |
| `destruction.aoe*ByClass` | keyed by class | FR-23, Decision 13 (no ownership check) |
| `collision.damageCoefficient` | `0.0012` | FR-22 — `k · reducedMass · relSpeed²` |

**CI check:** `Object.keys(arena.radiusByBudget)` must equal `match.legalBudgets` exactly. A budget
with no arena size is a crash waiting on a content edit.

### 2.5 `catalog/lock/catalog-vN.json` — the append-only ordinal lock

| Field | Type | Notes |
|---|---|---|
| `catalogVersion` | int | The version this snapshot froze |
| `lockedAt` | date | Provenance only |
| `reservedOrdinals` | map | `{ "0": "EMPTY_SLOT" }` — permanently reserved |
| `nextOrdinal` | int | Allocation cursor for the next release |
| `ordinals` | `{ id → int }` | **The frozen contract** |
| `classSlotCounts` | `{ classId → int }` | Historical layout length for decoding old tokens |

**Chassis and components share ONE ordinal space.** `Catalog.byOrdinal(n)` is a single function with
no type parameter (architecture §4), so a split space would be ambiguous. Decode still type-checks
the resolved entry against its slot position, so a cross-type ordinal can't slip through.

v1 allocates **ordinals 1–38** (12 chassis, 26 components); `nextOrdinal = 39`. Full mapping in
`catalog/lock/catalog-v1.json`; rules in `catalog/lock/README.md`.

### 2.6 Catalog invariants — CI-enforced (`test:catalog-lock`, FR-1)

| # | Invariant | Failure mode it prevents |
|---|---|---|
| C1 | Every id in **every** prior lock exists in the current catalog | A deleted component orphans every build that used it |
| C2 | Every id maps to the **same ordinal** as in every prior lock | Silently reinterprets every existing share token |
| C3 | `id` and `ordinal` are globally unique across chassis + components | Ambiguous `byOrdinal` |
| C4 | Every `chassis.classId` resolves in `classes.json` | Unresolvable slot layout |
| C5 | Every `component.slotType` ∈ `slotTypes` | Unfittable component |
| C6 | Every `special.stats.effect` is a `sim/rules`-implemented value | Content that silently does nothing |
| C7 | `catalogVersion` matches across `classes.json`, `tuning.json`, and the newest lock | Split-brain versioning |
| C8 | No class layout shrank or changed type at any existing index | Positional token corruption |
| C9 | `arena.radiusByBudget` keys ≡ `match.legalBudgets` | Unsized arena |

> ⛓ **NEGATIVE-SPACE INVARIANT (FR-1, FR-29, FR-30).** The catalog schema has **no** `factions`,
> `botOnly`, `playerOnly`, `availableTo`, `difficultyModifier`, `tierMultiplier`, or `statModifier`
> field, at any level. There is no place to *put* an AI-exclusive entry or a per-tier stat bonus.
> **Absence is the enforcement** — a CI check on a field that doesn't exist would be weaker than the
> field not existing. A reviewer adding one is making a visible schema change, not a config tweak.

---

## 3. Store 2 — The Library (`localStorage`)

### 3.1 Key namespace

| Key | Cardinality | Payload |
|---|---|---|
| `starship-skirmish:meta` | 1 | `MetaRecord` |
| `starship-skirmish:index` | 1 | `IndexRecord` |
| `starship-skirmish:build:<uuid>` | N | `BuildRecord` |
| `starship-skirmish:prefs` | 1 | `PrefsRecord` |
| `starship-skirmish:match:*` | 0 | **Reserved, unused** (§0.1) |

> ⚠ **Why the verbose prefix.** GitHub Pages project sites share **one origin** across *all* of the
> owner's repos — `https://<owner>.github.io/` — and `localStorage` is scoped to origin, not path.
> Every other project this owner ever deploys to Pages reads and writes the same store. A short
> prefix like `ss:` is a live collision risk with a real corruption-and-data-loss outcome, and it is
> not recoverable after the fact. The ~18 extra bytes × 500 records ≈ 9 KB of a 5 MB budget is not a
> trade worth thinking about. **Do not shorten this prefix.**

### 3.2 `BuildRecord` — the durable unit

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `id` | string | **PK**, UUIDv4, immutable | Local identity only — never travels in a share token |
| `name` | string | `1 ≤ len ≤ 48`, trimmed, NFC | 48 is fixed by the token's `nameLen` cap (§6) |
| `tags` | string[] | `≤ 8` items, each `1..24`, kebab, **unique**, sorted | FR-7 filter axis |
| `chassisId` | string | **FK** → catalog chassis id, NOT NULL | |
| `slots` | `(string \| null)[]` | `len == layout(classOf(chassisId)).length`; each non-null is an **FK** → component id **whose `slotType` equals the layout type at that index** | `null` = empty slot, legal (FR-4) |
| `storedCost` | int | `≥ 0` | Cost **at time of authoring** — see §3.3 |
| `schemaVersion` | int | `≥ 1` | FR-2 |
| `catalogVersion` | int | `≥ 1` | FR-2 |
| `createdAt` | ISO-8601 UTC | | |
| `updatedAt` | ISO-8601 UTC | `≥ createdAt` | Sort axis |

**Fields that deliberately do not exist:**

| Absent field | Why |
|---|---|
| `leftoverPoints`, `pointsBanked`, `conversionRate` | Decision 9 / FR-5: leftover points are **wasted**. "No conversion mechanism exists anywhere in the UI **or data model**." There must be nothing to read. |
| `needsRefit` | Derived, never stored — see §3.3. A stale boolean here is a lie that outlives the catalog change that caused it. |
| `currentCost`, `derivedStats` | Derived from the catalog on load. Caching them creates a second source of truth that goes stale on every re-tune. |
| `ownerId`, `authorName` | No accounts, no identities, and nothing personal should be embedded in a shareable artifact. |

### 3.3 `storedCost` vs. current cost — the `needs-refit` mechanism (FR-2, Ruling A)

`storedCost` is a **historical fact**, not a cached computation: *this build cost 148 points when it
was authored against catalog v7.* It is never recomputed in place, because it is the only evidence
of what the player originally paid.

On load, `domain.pointCost(build)` re-prices against the **current** catalog. If it differs, the
build loads successfully and is flagged `needs-refit` **in memory** with the full diff (old total,
new total, per-component changes) that design §4.7 requires. A flagged build stays viewable,
duplicable, and shareable, and is draftable if its **current** cost fits the budget (FR-10).

**`needs-refit` is never written to a `BuildRecord`.** A boolean written under catalog v7 is wrong
the moment v8 ships, and nothing would go back and correct 500 records. The index caches the
*result* instead, stamped with the version it was computed under (§3.4) — so a stale cache is
detectable rather than merely wrong.

### 3.4 `IndexRecord` — the browse index

Splitting a lightweight index from full records is what keeps browse/filter/sort responsive at
**500 builds** (NFR-Performance) without parsing every record on every keystroke.

```
IndexRecord {
  schemaVersion: int
  updatedAt:     ISO-8601
  entries:       IndexEntry[]
}
```

| `IndexEntry` field | Type | Purpose |
|---|---|---|
| `id` | uuid | **FK** → `:build:<id>` |
| `name` | string | Browse, sort, name-collision detection on import |
| `nameKey` | string | `name` lowercased + whitespace-collapsed — **UNIQUE-ish** collision key (§3.6) |
| `tags` | string[] | Filter without loading records |
| `chassisId` | string | Filter |
| `classId` | string | Filter, denormalized from the catalog |
| `storedCost` | int | Display |
| `currentCost` | int | **Cached** re-price result |
| `pricedAtCatalogVersion` | int | **Cache key** — if `≠ catalogVersion`, recompute |
| `needsRefit` | bool | Cached; valid only while the cache key matches |
| `schemaVersion`, `catalogVersion` | int | Migration triage without a record read |
| `createdAt`, `updatedAt` | ISO-8601 | Sort |
| `bytes` | int | Quota accounting (§3.7) |
| `status` | enum | `ok \| failed` — a record that wouldn't parse (§3.5) |

`classId`, `currentCost`, and `needsRefit` are **deliberate denormalization**. Justification:
the index is a rebuildable cache of records that are themselves the source of truth (§3.5), and
NFR-Performance names 500-build responsiveness explicitly. The staleness risk is fully contained by
`pricedAtCatalogVersion`: after the first boot at a given catalog version, re-pricing is O(0), and
after a catalog bump it is O(n) exactly once.

### 3.5 Write ordering and self-healing

> ⛓ **THE DURABILITY RULE: prefer an orphan to a dangle.** An orphaned record (present, unindexed)
> is invisible but fully recoverable. A dangling index entry (listed, missing) is corruption the
> user sees as a build that vanished when clicked. Every write order below is chosen to fail toward
> the recoverable side.

| Operation | Order | Crash / quota failure leaves |
|---|---|---|
| `put(build)` | 1. write `:build:<id>` · 2. update `:index` | Orphan record → recovered by rebuild |
| `remove(id)` | 1. remove entry from `:index` · 2. delete `:build:<id>` | Orphan record → recovered by rebuild |
| `import(n)` | records first (chunked), index updated **once** at the end | Orphans → recovered by rebuild |

**Rebuild (self-heal):** enumerate `localStorage` keys matching `starship-skirmish:build:`, parse
each, and regenerate the index from scratch. Runs when `:index` is missing, unparseable, or when its
entry count disagrees with the key count. This is why the index may be freely denormalized: it is a
**cache**, and the records are the database.

**Per-artifact failure isolation (FR-2):** a record that fails to parse or validate is marked
`status: 'failed'` in the index with a reason, is surfaced in the UI, and **is not deleted**. One
corrupt record never blocks or destroys the rest of the Encyclopedia. `remove()` is the only
destructive path in the app, and it requires confirmation (FR-7).

### 3.6 Name collisions

`nameKey` is **not** a unique constraint — duplicate names are legal (FR-10 allows drafting the same
build twice, and a player may reasonably keep "Wasp A" twice). It exists so import can detect a
collision in O(1) and offer **rename / replace / cancel** rather than silently overwriting (FR-8).
Import **never** overwrites without an explicit choice, and is **additive by default, never
deleting** (FR-9).

### 3.7 Quota accounting (FR-7, NFR-Security)

`localStorage` cost is measured as **UTF-16 code units**:
`bytes(key, value) = (key.length + value.length) × 2`.

| Constant | Value | Notes |
|---|---|---|
| `STORAGE_BUDGET_BYTES` | `5_000_000` | Conservative; real ceilings vary by browser |
| `WARN_AT` | `0.80` | Surface headroom warning |
| `CRITICAL_AT` | `0.95` | Prominent warning + push export |

`headroom() = STORAGE_BUDGET_BYTES − Σ entry.bytes − metaOverhead`. Projected: 500 builds ×
~400 bytes ≈ **200 KB**, ~4% of budget — comfortable, matching architecture open question §5.

- **Import pre-flight (DoS-on-self, architecture §10):** estimate the import's byte cost and compare
  against `headroom()` **before writing anything**. Over budget ⇒ refuse with a clear message and
  zero writes.
- **`QuotaExceededError` on any write** ⇒ degrade to **in-memory session mode** with a prominent
  warning. Never a crash, never a partial-write cascade (FR-7).
- **`localStorage` entirely unavailable** (private mode, disabled) ⇒ same in-memory degradation,
  detected once at boot by a probe write, not by an exception mid-save.

### 3.8 `MetaRecord` and `PrefsRecord`

| `MetaRecord` field | Type | Purpose |
|---|---|---|
| `schemaVersion`, `catalogVersion` | int | Version the store was last written under |
| `createdAt` | ISO-8601 | First-run stamp |
| `lastExportAt` | ISO-8601 \| null | Drives the **recurring backup nudge** (FR-7, Decision 5) |
| `backupNudgeDismissedAt` | ISO-8601 \| null | Dismissible-**but-recurring**: re-arms after an interval |
| `usedBytes` | int | Cached quota total; authoritative value is the index sum |

`PrefsRecord`: `{ reducedMotion, renderQuality, defaultBudget, encyclopediaSort, encyclopediaFilter }`.
Justified by NFR-Accessibility — a reduced-motion setting that doesn't survive a reload isn't a
setting. Prefs are **non-critical**: a corrupt `:prefs` is silently reset to defaults, never
surfaced as an error, and never blocks boot.

---

## 4. Indexes

There are no B-trees. "Index" here means the structures built once at boot and maintained on write.
Every one exists to serve a query pattern in §8 — none is speculative.

| Index | Structure | Built from | Serves |
|---|---|---|---|
| `idx_catalog_by_id` | `Map<string, Entry>` | catalog files | `Catalog.chassis(id)`, `.component(id)` — every FK resolution |
| `idx_catalog_by_ordinal` | `Map<int, Entry>` | lock + catalog | `Catalog.byOrdinal(n)` — share-token decode |
| `idx_catalog_ordinal_of` | `Map<string, int>` | lock | `Catalog.ordinalOf(id)` — share-token encode |
| `idx_catalog_by_slot_type` | `Map<SlotType, Entry[]>` | components | Shipyard slot picker (FR-4) — must list only fittable parts |
| `idx_catalog_by_class` | `Map<classId, Chassis[]>` | chassis | Chassis browse (FR-3) |
| `idx_library_by_id` | `Map<uuid, IndexEntry>` | `:index` | O(1) entry lookup |
| `idx_library_by_tag` | `Map<tag, uuid[]>` | `:index` | Tag filter at 500 builds without a scan (FR-7) |
| `idx_library_by_name_key` | `Map<nameKey, uuid[]>` | `:index` | O(1) import collision check (FR-8, §3.6) |
| `idx_library_sorted` | `uuid[]` per sort axis (`name`, `updatedAt`, `currentCost`) | `:index` | Stable sort without re-sorting per keystroke |

All in-memory maps are rebuilt from `:index` on write; none is persisted. **Iteration order note:**
these are UI-layer structures. Anything the **sim** iterates is sorted by stable `uint32` body id
per architecture §7.3 — `Map`/`Set` iteration order must never reach `sim/`.

---

## 5. Store 3 — Share token (UNTRUSTED)

Layout is fixed by architecture §8.1. Restated here as schema with the caps that make decode total:

```
base64url( 'S' | schemaVersion | catalogVersion | chassisOrdinal
             | slotCount | slotOrdinals[] | nameLen | nameUtf8 | crc8 )
```

| Field | Encoding | **Cap — checked BEFORE any allocation** |
|---|---|---|
| magic | 1 byte | `== 0x53` ('S') else `ERR_BAD_MAGIC` |
| `schemaVersion` | varuint | `1 ≤ v ≤ CURRENT_SCHEMA_VERSION` |
| `catalogVersion` | varuint | `1 ≤ v ≤ catalogVersion` (a *future* version is a hard error, not a guess) |
| `chassisOrdinal` | varuint | must resolve **and be of kind `chassis`** |
| `slotCount` | varuint | `== classSlotCounts[class]` for that token's `catalogVersion`; else `ERR_SLOT_COUNT` |
| `slotOrdinals[]` | varuint × `slotCount` | `0` = empty; else must resolve **and its `slotType` must equal the layout type at that index** |
| `nameLen` | varuint | `≤ 48` |
| `nameUtf8` | bytes | valid UTF-8; control chars stripped; **never rendered as markup** |
| `crc8` | 1 byte | integrity check; mismatch ⇒ `ERR_CHECKSUM` |
| *(whole token)* | | `≤ 2048` chars, against the 1900-char URL budget (FR-8) |

**Decode contract:** `decodeShareToken(str) → Result<Build, DecodeError>`. Never throws, never
mutates, **never writes**. On failure returns a typed code plus the failing character offset (design
§4.9). A successful decode produces a **preview object**, not a saved build — a fresh `id` is minted
only when the player accepts (FR-8).

**Error codes:** `ERR_TOO_LONG · ERR_BAD_MAGIC · ERR_BAD_BASE64 · ERR_TRUNCATED · ERR_CHECKSUM ·
ERR_FUTURE_SCHEMA · ERR_FUTURE_CATALOG · ERR_UNKNOWN_ORDINAL · ERR_SLOT_TYPE_MISMATCH ·
ERR_SLOT_COUNT · ERR_NAME_TOO_LONG · ERR_BAD_UTF8`.

`slotCount` is validated against the token's **own** `catalogVersion` via that lock's
`classSlotCounts` — which is exactly why §2.5 records it. A token written when `cruiser` had 9 slots
still decodes after `cruiser` grows to 10; the missing tail slot pads to empty.

**Size check:** max ordinal 38 ⇒ 1-byte varuints. A fully-fitted 12-slot mega destroyer with a
20-char name ≈ **39 bytes ⇒ ~52 base64url characters**, against a 1900 budget. Confirms
architecture §8.1's estimate with ~36× headroom.

---

## 6. Store 4 — JSON export (UNTRUSTED on import)

Per architecture §8.2. **String ids here, not ordinals** — an export is a human-inspectable archival
artifact with no character budget, and both encodings resolve through the same permanent-id
guarantee.

| Field | Type | Import cap |
|---|---|---|
| `format` | string | `== "starship-skirmish/library"` else reject |
| `schemaVersion` | int | `1 ≤ v ≤ CURRENT_SCHEMA_VERSION` |
| `catalogVersion` | int | `≤ catalogVersion` |
| `exportedAt` | ISO-8601 | Informational only — **never trusted as a clock** |
| `builds[]` | array | **`≤ 5000` items**; file **`≤ 8 MB`** |

Per-build fields are `BuildRecord` **minus** `id`, `createdAt`, `updatedAt` (all minted locally on
import). Per-build result: `IMPORTED · RENAMED · SKIPPED · FAILED(reason)`.

- **Partial validity is normal, not exceptional:** valid builds import, invalid ones are reported
  with reasons, the file is never rejected wholesale (FR-9).
- **Additive only. Import never deletes** (FR-9).
- Imports > 200 builds are **chunked across animation frames** so the UI never locks
  (architecture §10).
- Selected-subset export writes the same envelope with a filtered `builds[]`.

---

## 7. Migrations (FR-2)

### 7.1 Chain

`src/io/migrate/migrations.ts` — an append-only ordered array of
`{ from: N, to: N+1, description, up(doc) → doc }`.

**v1 ships an empty chain, and the machinery still exists.** That is the point of FR-2's "day one":
the first real migration must be a five-line append, not an architecture change.

Rules (enforced in-file and by review):

1. **Append only.** A bug in `1 → 2` is fixed by adding `2 → 3`, never by editing `1 → 2`.
2. Every step is exactly `from → from + 1`. `assertChainIsWellFormed()` fails CI on a gap.
3. `up()` is **pure**: no mutation, no throw, no globals, no catalog, no clock, no storage.
4. `up()` must survive **hostile** input — it runs on foreign bytes. Never take a loop bound or an
   allocation size from the document.
5. **Migrations move shape only.** Stat and point changes are catalog concerns, applied by
   re-pricing after the chain runs (Ruling A) — never by a migration.
6. `MINIMUM_SUPPORTED_SCHEMA_VERSION` stays `1` forever. If it ever moves, Pillar 4 is broken.

### 7.2 Load pipeline (the order is the requirement)

```
raw artifact
  → shape guard         (is this an object with a numeric schemaVersion?)
  → version gate        (future version ⇒ ERR_FUTURE_SCHEMA, fail closed, no write)
  → migration chain     (v_doc → CURRENT_SCHEMA_VERSION, one step at a time)
  → validate            (FK resolution, slot-type match, all caps — §3.2)
  → RE-PRICE            (domain.pointCost against the CURRENT catalog)
  → cost ≠ storedCost ? flag needs-refit + compute refitDiff   (in memory only, §3.3)
  → Result<Build>
```

Re-pricing happens **after** validation, never before: pricing an unvalidated document means
resolving foreign ids against the catalog before checking they're resolvable.

### 7.3 Fixtures (append-only, hash-locked)

`tests/fixtures/migration/v<N>/*.json`, with SHA-256 per fixture recorded in
`tests/fixtures/migration/manifest.json`. CI recomputes and compares. **Editing a historical fixture
fails the build** — that is how FR-2's "fixtures are never edited after being added" becomes
structural instead of aspirational.

Adding a migration **requires** adding at least one frozen fixture for the outgoing version, plus
one deliberately-corrupt fixture asserting failure isolation (FR-2: one bad artifact must never
block the rest of the Encyclopedia).

### 7.4 Migration history

| # | Version | Description | Artifact |
|---|---|---|---|
| 001 | schema v1 | Initial storage schema: `:meta`, `:index`, `:build:<id>`, `:prefs`. No predecessor. | `src/io/migrate/migrations.ts` (empty chain) |
| 001 | catalog v1 | Initial catalog: 4 classes, 12 chassis, 26 components, ordinals 1–38. | `catalog/lock/catalog-v1.json` |

---

## 8. Query Patterns

Every index in §4 exists to serve a row here.

| # | Pattern | Requirement | Shape | Index used |
|---|---|---|---|---|
| Q1 | Resolve a component id | FR-1 | `catalog.component(id)` | `idx_catalog_by_id` |
| Q2 | List fittable parts for a slot | FR-4 | filter by `slotType` | `idx_catalog_by_slot_type` |
| Q3 | Browse chassis by class | FR-3 | group by `classId` | `idx_catalog_by_class` |
| Q4 | Encode a build to a token | FR-8 | `ordinalOf(id)` per slot | `idx_catalog_ordinal_of` |
| Q5 | Decode a token | FR-8 | `byOrdinal(n)` per slot | `idx_catalog_by_ordinal` |
| Q6 | Price a build | FR-5 | `chassis.pointCost + Σ component.pointCost` | `idx_catalog_by_id` |
| Q7 | List library (default) | FR-7 | `:index` sorted by `updatedAt DESC` | `idx_library_sorted['updatedAt']` |
| Q8 | Filter by tag | FR-7 | tag → ids → entries | `idx_library_by_tag` |
| Q9 | Filter by class / cost range | FR-7 | scan `:index` (≤500, denormalized fields) | `idx_library_sorted` + entry fields |
| Q10 | Sort by name / cost / date | FR-7 | precomputed order | `idx_library_sorted[axis]` |
| Q11 | Open one build | FR-7 | `:build:<id>` — the **only** record read on a click | `idx_library_by_id` |
| Q12 | Import name-collision check | FR-8, FR-9 | `nameKey` lookup | `idx_library_by_name_key` |
| Q13 | List `needs-refit` builds | FR-2 | `:index` where `needsRefit` and cache key fresh | `:index` scan |
| Q14 | Draftable at budget B | FR-10 | `:index` where `currentCost ≤ remaining` | `idx_library_sorted['currentCost']` |
| Q15 | Storage headroom | FR-7 | `Σ entry.bytes` | `:index` scan |
| Q16 | Duplicate a build | FR-7 | read record, new `id`, new timestamps | `idx_library_by_id` |
| Q17 | Compare two builds | FR-6 | two record reads + derived stats | `idx_library_by_id` |

**Q7–Q10 and Q13–Q15 never touch a `:build:` record.** That is the whole reason the index exists,
and it is what holds NFR-Performance's 500-build responsiveness target. Records are read on Q11,
Q16, Q17 — one at a time, on explicit user action.

---

## 9. Seed Data

The catalog **is** the seed data, and it ships in the repo rather than being written at first run.

| File | Contents |
|---|---|
| `catalog/classes.json` | 4 classes, frozen slot layouts (3 / 6 / 9 / 12) |
| `catalog/chassis/*.json` | 12 chassis, 3 per class, ordinals 1–12 |
| `catalog/components/*.json` | 26 components — 6 weapon, 5 shield, 5 missile, 5 engine, 5 special — ordinals 13–38 |
| `catalog/tuning.json` | Arena sizing, caps, lifetimes, collision + AoE coefficients |
| `catalog/lock/catalog-v1.json` | Frozen `{id → ordinal}` for all 38 entries |

Satisfies FR-3 (~12 chassis / 4 classes) and FR-4 (5–8 components per slot type), inside the
Requirements §Constraints v1 content ceiling.

> **Every number in the content files is provisional.** Assumption 3 states point costs "will be
> **wrong** on first pass and will need multiple tuning rounds against the harness," and FR-33 makes
> that harness the only balance instrument that exists. These values are a *starting curve chosen to
> be internally consistent and to exercise every trade axis* — cost vs. mass, capacity vs. regen,
> range vs. accuracy, ammo vs. warhead — not a balanced game. Re-tuning them is content work and
> requires **no code change and no new ordinals**, only a `catalogVersion` bump.

**No first-run library seeding.** A new player's Encyclopedia is empty by design; there are no demo
builds, because a shipped demo build would be a catalog-versioned artifact nobody chose to save.

---

## 10. Handoff Notes for Coder

1. **`src/io/migrate/migrations.ts` is the registry only.** The runner `migrate()` — which composes
   chain + validation + re-pricing per §7.2 — is yours to implement in `src/io/migrate/migrate.ts`.
2. **Put every cap in one module.** `name ≤ 48`, `tags ≤ 8`, `tag ≤ 24`, `token ≤ 2048`,
   `builds ≤ 5000`, `file ≤ 8 MB`, `STORAGE_BUDGET_BYTES`. Duplicating them across the codec, the
   validator, and the UI is how a token that encodes stops decoding. One `src/io/limits.ts`.
3. **`name ≤ 48` is a cross-format constraint,** fixed by the share token's `nameLen` cap. Raising
   it in the Shipyard alone silently produces builds that can be saved but not shared.
4. **`needsRefit` and `currentCost` live in the index, never in the record** (§3.3). The cache key is
   `pricedAtCatalogVersion`.
5. **Honor the write orders in §3.5.** Orphan over dangle, every time.
6. **`Map`/`Set` iteration order must never cross into `sim/`** (architecture §7.3). The library
   indexes in §4 are UI-layer only.
7. **Never write during a decode or an import validation pass.** Validate everything, then write —
   that is what makes "fails closed, no state mutation" (NFR-Security) true rather than intended.

---

## 11. Open Questions

1. **`STORAGE_BUDGET_BYTES = 5_000_000` is a conservative guess.** Browsers disagree on whether the
   ~5 MB ceiling counts bytes or UTF-16 code units. A one-time calibration probe at first run would
   give a real number; it costs a slow first boot. Recommend shipping the constant and revisiting
   only if the 200 KB projection (§3.7) proves wrong — which architecture open question §5 already
   flags as the IndexedDB trigger.
2. **`damage-control` repairs hull only.** FR-25 says a destroyed component "loses its function
   immediately" and provides no repair path, so restoring components would be inventing a rule.
   Flagged for Gate 1 — if component repair is wanted, it is a rules change plus a new `stats` field,
   not a tuning tweak.
3. **`arena.radiusByBudget` is a table, not a formula.** Budgets are a closed set of six (FR-10), so
   a table is exactly as expressive and far more legible than coefficients. If v1.x opens arbitrary
   budgets, this becomes `base + k·∛budget` and the CI check in §2.4 changes shape.
4. **The cheapest-engine-on-heaviest-hull fit is degenerate.** Because `deltaVPerTurn` divides by
   total mass (§2.3), `meg-anvil` + `eng-ion-trickle` + 2× `spc-armor-plating` yields **~10 delta-V
   per turn in a 4200-radius arena** — a ship that legally exists and cannot meaningfully move all
   match. This is a legal-but-bad trade, which is arguably the Shipyard working (FR-4: an
   under-fitted ship is a valid, cheaper ship). But "cannot move at all" is a different category
   from "slow," and it is the kind of thing the harness will surface as a 0% win rate rather than as
   a bug. Recommend Gate 1 decide between (a) leaving it as a learnable trap, (b) raising engine
   `thrustImpulse` floors, or (c) a `minDeltaVPerTurn` floor in `tuning.json`. All three are data
   changes; none is a schema change.
5. **Ordinals are a single shared space** (§2.5). This costs nothing at 38 entries. At several
   hundred, chassis ordinals would still be tiny while component ordinals push into 2-byte varuints —
   a split space would save ~1 byte per slot. Against a 36× character budget headroom, not worth the
   ambiguity. Recorded so the trade isn't re-litigated blind later.
