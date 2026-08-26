# Architecture — Starship Skirmish

> **Status:** v1 — architecture phase. Derived from `specs/idea.md` v3, `specs/requirements.md` v1,
> `specs/design.md` v1.
> **Deployment target confirmed by owner: GitHub Pages.**
>
> This document decides the stack, the module boundaries, and the three load-bearing technical
> strategies (determinism, blind-commit enforcement, sim/render separation). Coder follows these
> boundaries. Where a decision traces a requirement, the ID is cited inline.

---

## 0. The Architectural Problem

Three constraints dominate everything else. Every decision below is downstream of them.

1. **Determinism is a hard requirement, not a quality bar.** NFR-Correctness demands *identical
   seed + identical plans ⇒ identical outcome, on every machine*, and FR-33 makes the headless
   harness the only balance instrument that exists. Floating-point strategy, RNG design, and
   iteration order are therefore architecture, not implementation detail.
2. **Blind commit must be structurally impossible to violate** (Pillar 2, FR-17). "The UI doesn't
   show it" is not a guarantee — the DOM is inspectable and this is an open-source-shaped static
   site. The pending plans of other fleets must not *exist* in any object the planning layer can
   reach.
3. **There is no server, forever.** No telemetry, no accounts, no runtime dependency. The share
   token and the JSON export are the only wire formats — and per Decision 18 they must load in
   year two. **They are this project's public API** and are versioned like one.

Everything else — rendering, UI framework, storage — is comparatively ordinary and is chosen for
smallness, offline-friendliness, and the ability to get out of the way.

---

## 1. Stack Decision

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Language | **TypeScript 5.7+**, `strict: true`, `noUncheckedIndexedAccess: true` | The catalog, the wire formats, and the migration chain are all type-shaped problems. Strict TS is the cheapest defense against a silent schema drift that only shows up in year two. |
| Runtime | **Browser (evergreen) + Node 22 LTS** | Node is required only for the headless harness (FR-33), tests, and CI. Nothing ships to a server. |
| Framework | **None (no meta-framework)** — plain SPA | SSR/SSG/routing/API layers of Next/Nuxt/Remix are dead weight on a static, no-backend, no-SEO game. |
| UI Framework | **Preact 10 + `@preact/signals`** | ~5 KB runtime vs React's ~45 KB, and the three.js payload already owns most of the ≤3 s first-paint budget (NFR-Performance). Signals give fine-grained updates so a 500-row Encyclopedia and a live roster don't re-render trees. `preact/compat` alias keeps React DX and ecosystem escape hatches. |
| State Management | **Two-tier: signals for UI state; plain immutable structs for match state** | The match state is **not** in the UI framework — it is a plain data object owned by the sim, mirrored into a single signal per beat. Putting simulation state in a UI store is how sim/render separation (FR-33, NFR-Maintainability) rots. |
| 3D Rendering | **three.js r171+ (WebGL2)** with `Line2`/`LineSegments2` fat lines | The art direction is neon wireframe on black (FR-13) — line rendering with controllable width and additive glow is exactly what fat-line materials do. Raw WebGL is weeks of camera/picking/resize plumbing for no gain; a game engine (Babylon, PlayCanvas) brings a scene graph, physics, and asset pipeline we actively don't want. |
| Post-processing | **`EffectComposer` + half-res selective bloom**, quality-toggleable | Glow is the aesthetic (§1.5 of design). Half-res bloom keeps the 60 fps budget; the toggle is the escape valve for weak GPUs and pairs with the reduced-motion toggle. |
| Physics | **Custom, in-house, deterministic** — sphere colliders, swept CCD, uniform-grid broadphase | Explicitly anticipated by requirements §Dependencies. Every general-purpose engine (Rapier, cannon-es, Ammo) is either non-deterministic across builds, or deterministic only under conditions we can't verify, and all of them model contact resolution far richer than "spheres bounce and take damage." A general engine here is both overkill *and* a determinism hazard. |
| Randomness | **Counter-based hash RNG (SplitMix64-derived, `Math.imul` uint32 core)** | Order-independent by construction — see §7.2. A sequential stream would make results depend on iteration order and break FR-19/FR-21. |
| Persistence | **`localStorage` behind a `LibraryRepo` interface** | Mandated by Decision 5 / FR-7. The interface exists so IndexedDB (or, someday, a server) is one adapter, not a refactor. |
| Data Layer | **Static JSON catalog + append-only lockfiles**, loaded at boot, validated in CI | FR-1 requires content as pure data with permanent IDs and a build-time regression gate. No ORM, no database, no query layer — this is a read-only lookup table with a version stamp. |
| Compression | **None for share tokens; `CompressionStream('deflate-raw')` for JSON export (optional)** | Bit-packed ordinals put a full build at ~40–80 bytes ⇒ ~60–110 base64url chars, an order of magnitude under the 1900 budget (FR-8). Adding a compressor would spend bytes on a dictionary to save nothing. |
| Build Tool | **Vite 6** | Fast dev, first-class TS + Web Worker + WASM-free static output, trivial `base` path config for project Pages, and a production build with no `eval` (matters for CSP). |
| Test Framework | **Vitest 3** (unit + determinism) + **Playwright 1.49+** (cross-engine determinism + e2e smoke) | Vitest shares the Vite config so `src/sim` is tested in Node exactly as it's bundled. Playwright is not decoration here: it is how we prove determinism holds on Chromium **and** Firefox **and** WebKit (§7.5). |
| Lint / Boundaries | **ESLint 9 flat config + `eslint-plugin-boundaries`** | Module boundaries (§4) and the determinism ban-list (§7.1) are *enforced*, not documented. FR-33 says "enforced structurally so this can't rot" — this is that enforcement. |
| Service Worker | **`vite-plugin-pwa` (Workbox `generateSW`, precache-all)** | NFR-Platform: must function fully offline after first load. Precaching the entire (small, fully static) app is the simplest correct answer. |
| Fonts | **Self-hosted JetBrains Mono + Inter, `woff2`, subset, `font-display: block`** | Design §6 flags the Google Fonts CDN as mock-only and offline-illegal. Subset to Latin + the glyph set (`▲●■◆✚✳➤◇✕`). |
| CI / CD | **GitHub Actions → `actions/deploy-pages`** | Native to the hosting target. |
| Deployment | **GitHub Pages (project site), hash routing, `.nojekyll`** | Owner's stated target. See §11. |
| Analytics | **None. Ever.** | NFR-Security. No beacons, no third-party runtime code, enforced by CSP (§10). |

**Total runtime third-party dependency list: `three`, `preact`, `@preact/signals`.** That is the
whole list, deliberately. Everything else is a devDependency.

---

## 2. Alternatives Considered

| Decision | Chosen | Rejected | Why |
|----------|--------|----------|-----|
| UI framework | Preact + Signals | React 18, Svelte 5, SolidJS, vanilla TS | **React**: same model, 40 KB more, and we're already carrying three.js against a 3 s budget. **Svelte 5**: excellent fit, but the compiler owns the component model and the mock CSS layer is hand-written — the win is small and the lock-in isn't. **Solid**: closest technical rival; rejected only on ecosystem/familiarity for a single builder. **Vanilla**: 7 screens with modals, live totals, validation, and delta indicators is exactly where hand-rolled DOM starts leaking state bugs. |
| 3D renderer | three.js | Babylon.js, PlayCanvas, raw WebGL2, WebGPU | **Babylon/PlayCanvas**: full engines with physics and asset pipelines we must then disable; larger payload. **Raw WebGL2**: no value — we'd rebuild orbit controls, picking, resize handling, and line joins. **WebGPU**: not universally available across the stated evergreen matrix; revisit in v1.x as an optional backend behind the renderer interface. |
| Physics | Custom spheres + swept CCD | Rapier (WASM), cannon-es, Ammo.js, Matter (2D) | Determinism is the whole ballgame. Rapier is *deterministic within an identical build* but pins us to a WASM blob's floating-point behavior and gives no cross-engine guarantee we can test cheaply. All three model friction, restitution, joints, and sleeping — none of which this game has. Our contact model is: spheres, swept, damage by `relative velocity × mass`, momentum exchange (FR-22). That is ~400 lines we fully control. |
| Numeric strategy | IEEE-754 `float64` + banned transcendentals | Fixed-point Q16.16 (int32), Q32.32 (BigInt), decimal | `+ - * / sqrt` on doubles are **exactly specified by IEEE-754** and bit-identical across every JS engine. The actual hazard is `Math.sin/cos/atan2/pow/exp/hypot`, which are implementation-defined — so we ban them and supply our own (§7.1). Fixed-point costs precision at Newtonian velocity ranges and buys nothing we don't already have; BigInt is 10–50× slower and would sink the ≥100 matches/min/core harness target. |
| RNG | Counter-based (hash of `seed, turn, beat, entityId, drawIndex`) | Sequential PCG32/xorshift stream | A sequential stream's output depends on *the order draws are requested in*, which directly contradicts the order-independence requirement (FR-19, FR-21) and the shuffle test in NFR-Correctness. Counter-based RNG makes every draw a pure function of its coordinates — order-independent for free. |
| Persistence | `localStorage`, index + per-build keys | Single JSON blob; IndexedDB | Mandated as `localStorage` (Decision 5). Splitting a lightweight browse **index** from full build records keeps browse/filter/sort responsive at 500 builds (NFR-Performance) without parsing ~500 KB on every keystroke. IndexedDB is async and overkill at a 5 MB ceiling, but the repo interface leaves the door open. |
| Share encoding | Bit-packed **permanent ordinals** → base64url | Raw JSON + deflate + base64; string IDs + deflate; msgpack | Decision 8 explicitly says "compact against a versioned catalog — not raw JSON." Permanent integer ordinals (§8.1) are the compact, durable form of permanent string IDs. Result is ~10× under the character budget, leaving headroom for the v1.x jump to 30+ chassis and richer fits. |
| Routing | Hash routing (`#/shipyard`) | History API + `404.html` SPA shim | GitHub Pages has no server-side rewrite. The `404.html` trick works but flashes an error route and pollutes any future analytics-free error monitoring. Bonus, and it matters: **a URL fragment is never sent to a server**, so share tokens (FR-8) never leave the user's machine even in transit. |
| Bot execution | Web Worker pool (module workers), main-thread fallback | Main thread only; `requestIdleCallback` slicing | Bot planning has a 2 s budget for a 5-fleet field (NFR-Performance). Doing that on the main thread freezes the UI and the canvas. The sim is DOM-free by construction, so it runs in a worker unmodified. Determinism is preserved because each bot's plan is a pure function of `(redacted view, seed, fleetId)` — parallel execution cannot change the result. |
| Resolution model | **Simulate fully, then animate the trace** | Animate and simulate in lockstep | FR-19 requires that skipping playback never change the outcome, and that resolution be replayable. If the outcome is already computed before the first frame is drawn, both properties are free and unfalsifiable. Lockstep would couple frame timing to physics — a determinism catastrophe. |
| Validation | Hand-written validators in `src/io/validate.ts` | Zod, Valibot, Ajv/JSON-Schema | The untrusted surface is exactly two formats (§8), both of which need **bounds checks and allocation caps**, not just shape checks — the thing a schema library does *least* well. Hand-written keeps it dependency-free and makes every limit explicit and greppable. |
| Testing determinism | Cross-engine CI (Node + Chromium + Firefox + WebKit) | Node-only unit tests | "Identical on every machine" is a claim about *engines*, and V8-only testing cannot support it. This is cheap to run and is the single test that protects the entire correctness NFR. |

---

## 3. Module Structure

```
starship-skirmish/
├── catalog/                  — CONTENT. Pure data, no code. Edited without touching the game.
│   ├── chassis/*.json        — ~12 chassis, 4 classes
│   ├── components/*.json     — weapon / shield / missile / engine / special
│   ├── classes.json          — per-class published slot layouts (Decision 10)
│   ├── tuning.json           — arenaRadius(budget), debris lifetime, hazard cap, fleet hull cap
│   └── lock/                 — APPEND-ONLY. catalog-v1.json … catalog-vN.json (ID+ordinal snapshots)
│
├── src/
│   ├── catalog/              — catalog loading, indexing, integrity assertions
│   ├── domain/               — builds, fitting rules, point costing, derived stats, refit diff
│   ├── sim/                  — ⚑ DETERMINISTIC CORE. No DOM, no three.js, no Date, no Math.random.
│   │   ├── mathx/            — vec3, deterministic sin/cos/atan2, RNG
│   │   ├── physics/          — swept CCD, broadphase, integration, momentum exchange
│   │   ├── rules/            — damage, shields, called shots, boundary, missiles, debris
│   │   ├── loop/             — TurnCoordinator, Commander interface, BlindMatchView
│   │   └── trace/            — ResolutionTrace emission + combat log
│   ├── ai/                   — bot Commanders (3 tiers) + bot fleet generator
│   ├── io/                   — ⚑ UNTRUSTED INPUT BOUNDARY. codec, validation, migrations
│   │   ├── codec/            — share-token bit reader/writer, base64url
│   │   ├── migrate/          — schemaVersion migration chain
│   │   └── validate.ts       — bounds + shape checks for every foreign byte
│   ├── persist/              — LibraryRepo (localStorage adapter), quota accounting, backup nudge
│   ├── render/               — three.js scene, wireframes, boundary, markers, trace playback
│   ├── ui/                   — Preact screens + components (design-token CSS)
│   ├── workers/              — bot-planning module worker
│   ├── app/                  — composition root: routing, wiring, error boundary
│   └── main.tsx              — entry
│
├── tools/balance/            — headless harness CLI (Node). Imports sim + ai + catalog ONLY.
├── prototypes/               — Gate 1 & Gate 2 (FR-32). Disposable. Excluded from the app build.
├── tests/
│   ├── unit/ integration/ determinism/ e2e/
│   └── fixtures/migration/   — APPEND-ONLY, hash-manifest-locked (FR-2)
└── public/                   — fonts, favicon, .nojekyll
```

---

## 4. Module Contracts

### `catalog/` (data) + `src/catalog/`
- **Owns:** the versioned, additive-only content set and its integrity guarantees (FR-1).
- **Exports:** `loadCatalog(): Catalog`, `Catalog.chassis(id)`, `Catalog.component(id)`,
  `Catalog.ordinalOf(id)`, `Catalog.byOrdinal(n)`, `catalogVersion`, `tuning`.
- **Depends on:** nothing.
- **Key types:** `ChassisDef`, `ComponentDef`, `SlotLayout`, `SlotType = 'weapon'|'shield'|'missile'|'engine'|'special'`, `Tuning`.
- **Invariants (CI-enforced, FR-1):**
  - Every `id` is a permanent lowercase-kebab string; **never deleted, never reused, never renumbered.**
  - Every entry carries a permanent integer `ordinal`, assigned monotonically on first authoring.
  - `catalog/lock/catalog-vN.json` is a frozen snapshot of `{id → ordinal}`. **The build fails if any
    ID or ordinal from any prior lock is missing or changed in the current catalog.**
  - The schema provides **no field** capable of expressing an AI-exclusive entry or a per-faction
    stat modifier. Absence is the enforcement (FR-1, FR-30).

### `src/domain/`
- **Owns:** what a legal build *is*, what it costs, and what it derives to.
- **Exports:** `Build`, `validateFit()`, `pointCost(build)`, `derivedStats(build)`, `refitDiff(oldTotal, build)`, `resolveFleet(builds[]) → SimFleet` (the plain struct the sim consumes).
- **Depends on:** `catalog`.
- **Key types:** `Build { id, name, tags[], chassisId, slots: (componentId|null)[], schemaVersion, catalogVersion, storedCost, needsRefit }`, `DerivedStats`, `SimFleet`.
- **Rules it owns:** component type must match slot type; empty slots legal; `total = chassis + Σ components`; **leftover points are wasted — no field, method, or return value anywhere expresses a conversion** (Decision 9, FR-5).
- **Note:** `resolveFleet` is the seam. The sim never imports the catalog loader; it receives fully
  resolved plain structs. This is what lets the harness and the worker stay light.

### `src/sim/` ⚑ THE DETERMINISTIC CORE
- **Owns:** the entire game. Turn loop, physics, damage, hazards, victory. **The complete rules of
  Starship Skirmish exist here and nowhere else.**
- **Exports:** `createMatch(config) → Match`, `Match.runBeat(plans) → ResolutionTrace`, `Match.state` (frozen), `Match.view(fleetId) → BlindMatchView`, `Commander` interface.
- **Depends on:** `sim/mathx` only. **It imports nothing else in the project and nothing from npm.**
- **Forbidden (lint-enforced):** `document`, `window`, `performance.now`, `Date`, `Math.random`,
  `Math.sin/cos/tan/atan/atan2/asin/acos/exp/log/pow/hypot/cbrt/fround`, `three`, `preact`,
  any import from `render/`, `ui/`, `persist/`, `app/`.
- **Key types:** `MatchState`, `Body` (discriminated: `ship | debris | missile`), `MovementPlan`, `AttackPlan`, `ResolutionTrace`, `CombatLogEntry`, `Seed`.

### `src/ai/`
- **Owns:** bot decision quality and bot fleet construction.
- **Exports:** `class HeuristicCommander implements Commander` (tiers `rookie | veteran | ace`), `generateBotFleet(budget, tier, rngKey) → Build[]`.
- **Depends on:** `sim` (types + `mathx` only), `domain`, `catalog`.
- **Contract:** implements the **same `Commander` interface as the player** (FR-17). It receives only
  a `BlindMatchView`. It has no privileged accessor, no reference to `Match`, and no stat modifier
  input (FR-29, FR-30). Bot fleets are built through `domain.validateFit` — the same gate the
  Shipyard uses, so a bot cannot field a ship the player couldn't build (FR-31).

### `src/io/` ⚑ THE UNTRUSTED-INPUT BOUNDARY
- **Owns:** every byte that came from another person or another year.
- **Exports:** `encodeShareToken(build) → string`, `decodeShareToken(str) → Result<Build, DecodeError>`, `exportLibrary(builds[]) → Blob`, `importLibrary(file) → ImportReport`, `migrate(doc) → Result<Build>`.
- **Depends on:** `domain`, `catalog`.
- **Contract:** **Everything returns `Result`, nothing throws across this boundary, and nothing
  mutates caller state.** A decode/import is a pure `bytes → Result<value>` function; the caller
  decides what to write. This is the structural form of "fails closed, no state mutation" (NFR-Security, FR-8, FR-9).

### `src/persist/`
- **Owns:** the Encyclopedia's durability story.
- **Exports:** `LibraryRepo { list(), get(id), put(build), remove(id), headroom(), lastExportAt() }`.
- **Depends on:** `domain`, `io/migrate`.
- **Contract:** writes are **record-first, index-second** so an interrupted or quota-failed write
  never leaves a dangling index entry. `QuotaExceededError` and unavailable-storage both degrade to
  in-memory session mode with a surfaced warning — **never a crash** (FR-7).

### `src/render/`
- **Owns:** pixels. Nothing else.
- **Exports:** `createTacticalView(canvas) → TacticalView`, `TacticalView.setState(MatchState)`, `.playTrace(ResolutionTrace, opts) → Playback`, `.camera`, `.pick(x,y)`.
- **Depends on:** `sim` **types only** (a one-way, read-only dependency), `three`.
- **Contract:** the renderer **cannot mutate `MatchState`** — state is frozen (`Object.freeze` in
  dev, structural discipline in prod) and the renderer holds no write path. Deleting `src/render/`
  must leave a working headless game. That is the test (FR-33).

### `src/ui/`
- **Owns:** Preact screens for the 7 designed views, the design-token CSS layer, keyboard access, reduced-motion.
- **Depends on:** `domain`, `persist`, `io`, `render`, `app`. **Never `sim/physics` or `sim/rules` directly** — it reads state and dispatches plans through `app`.
- **Contract:** the player's commit is a UI event that **resolves a promise held by the
  `TurnCoordinator`**. The UI is a `Commander` implementation like any bot.

### `src/app/` (composition root)
- **Owns:** wiring, hash routing, worker lifecycle, top-level error boundary, the match session.
- **Depends on:** everything. **Nothing depends on it** except `main.tsx`.

### `tools/balance/`
- **Owns:** FR-33. Bulk seeded bot-vs-bot matches, aggregate win/usage rates by chassis and component.
- **Depends on:** `sim`, `ai`, `domain`, `catalog`. **A CI check asserts its bundle contains no
  reference to `three`, `preact`, or `document`** — that is what makes "no dependency on the
  rendering layer" structural rather than aspirational.

---

## 5. Dependency Flow

```
                          catalog/  (pure JSON data)
                               │
                        ┌──────▼──────┐
                        │   domain    │  builds · costing · derived stats
                        └──┬───┬───┬──┘
             ┌─────────────┘   │   └──────────────┐
             ▼                 ▼                  ▼
        ┌────────┐        ┌────────┐         ┌─────────┐
        │   io   │        │  sim   │◄────────│   ai    │
        │ codec  │        │ ⚑ core │ (types) │  bots   │
        │migrate │        │        │         └─────────┘
        │validate│        └───┬────┘              │
        └───┬────┘            │ (types, one-way)  │
            │                 ▼                   │
            │            ┌────────┐               │
            │            │ render │ three.js      │
            │            └───┬────┘               │
            ▼                ▼                    │
        ┌────────┐      ┌────────┐                │
        │persist │◄─────│   ui   │  preact        │
        └────────┘      └───┬────┘                │
                            ▼                     │
                        ┌────────┐◄───────────────┘
                        │  app   │  composition root
                        └────────┘

  tools/balance ──► sim + ai + domain + catalog        (never render/ui/persist)
```

**The two rules that are lint-enforced and never waived:**
1. **Nothing in `sim/` may import from `render/`, `ui/`, `persist/`, `app/`, or any npm package.**
2. **`render/` may import `sim` *types* only** — no functions, no mutation path.

---

## 6. Data Flow

### 6.1 Boot
```
main.tsx → app.bootstrap()
  ├─ load catalog JSON (bundled, precached)      → assert lock integrity
  ├─ LibraryRepo.list() → for each record: io.migrate() → domain.pointCost()
  │     └─ cost ≠ storedCost ? flag needs-refit + compute refitDiff  (FR-2, §4.7 design)
  │     └─ unparseable record ? mark failed, keep the rest loading   (FR-2)
  ├─ if location.hash carries a share token → io.decodeShareToken → route to import preview
  └─ mount UI
```

### 6.2 One turn (the load-bearing flow — FR-17)
```
TurnCoordinator.runTurn():

  ── MOVEMENT PLAN ──────────────────────────────────────────────
  view = MatchState.view()               // full info, ZERO pending plans (Pillar 2)
  plans = await Promise.all(
      commanders.map(c => c.planMovement(view, c.fleetId)))
                                          //  ▲ all commanders are called with the SAME view
                                          //    BEFORE any plan is collected. A bot's input
                                          //    literally cannot contain the player's plan.
      · player commander → resolves when the UI commit button fires
      · bot commanders   → dispatched to worker pool (≤2 s budget, NFR-Performance)

  ── MOVEMENT RESOLVE ───────────────────────────────────────────
  trace = physics.resolveMovement(state, plans, seed, turn)
      · integrate all bodies in N deterministic sub-steps (§7.4)
      · swept sphere CCD → contacts resolved at point of contact, not turn end (FR-22)
      · momentum exchange both ways → shoving across the boundary is legal (FR-22)
      · boundary check: ships destroyed, hazards removed silently (FR-26)
      · missile guidance: re-aim for 2 beats, then fuel-out → hazard (FR-24)
  render.playTrace(trace)                // animation ONLY. Skippable. Outcome already final.

  ── ATTACK PLAN ────────────────────────────────────────────────
  (same blind-commit shape, against post-movement positions)      (FR-20)

  ── ATTACK RESOLVE ─────────────────────────────────────────────
  snapshot = freeze(state)               // pre-damage (FR-21)
  every shot resolves against `snapshot` → damage accumulates into a Map<entityId, Damage>
  apply in ascending entityId order → shields first, overflow to hull (FR-25)
  destructions → AoE + debris, entering the field for the NEXT movement beat (FR-21, FR-23)
  render.playTrace(trace)

  ── VICTORY CHECK ──────────────────────────────────────────────
  one fleet with survivors → win | zero fleets → mutual destruction | else continue  (FR-27)
  no turn cap, no draw, no tiebreak — no such code path exists                       (FR-27)
```

### 6.3 The blind-commit structural guarantee
`MatchState` **has no field for a pending plan.** Collected plans live in a local `const` inside
`TurnCoordinator.runTurn()` — a closure variable, unreachable from `MatchState`, from
`BlindMatchView`, from the UI store, and from the DOM. There is nothing to leak because there is
nothing to reach. `BlindMatchView` is additionally a frozen projection built fresh per beat.

This is why FR-17 says the loop must treat player and bot as one interface: a future networked
opponent is another `Commander` whose promise resolves on a socket message. **No loop redesign.**

---

## 7. Determinism Strategy ⚑

This is the section that, if implemented sloppily, silently destroys FR-33 and the entire balance
process. NFR-Correctness names it a known hazard; here is the plan.

### 7.1 Floating point
- **Use IEEE-754 `float64` throughout the sim.** `+ - * /` and `Math.sqrt` are *exactly specified*
  by IEEE-754 and produce bit-identical results on every conforming JS engine and CPU. This is a
  guarantee, not a hope.
- **Ban every implementation-defined math function inside `sim/`**: `sin cos tan asin acos atan
  atan2 exp log log2 log10 pow hypot cbrt fround expm1 log1p sinh cosh tanh`. These are *not*
  specified to the last bit and legitimately differ between V8, SpiderMonkey, and JSC.
- `src/sim/mathx/trig.ts` supplies **our own** `sin`, `cos`, `atan2`, `pow` as fixed-degree
  polynomial/rational approximations built from `+ - * /` only. They are deterministic *by
  construction* because they are ordinary arithmetic. Needed for bearing/pitch → vector conversion
  in arc plotting (FR-18) and for evasion/accuracy curves.
- No `Math.fround`, no `Float32Array` in sim state — float32 rounding is fine but mixing widths
  invites accidental precision divergence. **`Float64Array` or plain numbers only.**
- ESLint `no-restricted-globals` / `no-restricted-properties` enforces the ban list; the rule is
  scoped to `src/sim/**` and `src/ai/**`.

### 7.2 Randomness (Ruling H)
- One `Seed` per match: a `uint32` pair, generated at instantiation from `crypto.getRandomValues`,
  **displayed and recorded** (FR-12, design §4.11).
- **Counter-based RNG.** Every draw is `rng(seed, turn, beat, streamTag, entityId, drawIndex)`,
  hashed through a SplitMix-style avalanche implemented in `Math.imul` uint32 ops.
- **Consequence: draws are order-independent.** Shot #3 from ship `s17` at target `s41` yields the
  same roll whether it is evaluated first or last. This is what makes the NFR-Correctness shuffle
  test pass by construction rather than by luck.
- `Math.random` is banned in `sim/` and `ai/`. `crypto.getRandomValues` appears exactly once, in
  `app/`, at seed generation.

### 7.3 Order independence (FR-19, FR-21)
Three concrete rules:
1. **Stable IDs.** Every body gets a monotonic `uint32` id at creation. All iteration over bodies
   is `sortBy(id)` — never insertion order, never `Object.keys`, never `Set` iteration.
2. **Float addition is not associative**, so accumulation order *is* observable. Therefore all
   damage accumulates into `Map<targetId, Damage[]>`, and each target's damage array is
   **sorted by `(sourceId, shotIndex)` before summation**. Same for collision impulses.
3. **Two-phase everything.** Read from a frozen snapshot, write to a staging buffer, commit at the
   end of the phase. No body observes another body's mid-phase mutation.

The NFR-Correctness test shuffles entity iteration order with a fixed seed and asserts an
identical state hash. It runs on every commit.

### 7.4 Integration and tunneling (FR-19, FR-22)
- Per beat, sub-step count `N` is derived **deterministically** from state:
  `N = clamp(ceil(maxRelSpeed * dt / (minRadius * 0.5)), 4, 64)`, computed from the same inputs on
  every machine. **Never from frame rate, wall clock, or device performance.**
- Broadphase: uniform spatial hash, cell size = `2 × maxRadius`, cells visited in sorted index
  order. At 360 bodies this is microseconds.
- Narrowphase: **swept sphere-sphere** — solve the quadratic for time-of-impact within the
  sub-step, resolve at the contact point. Tunneling at maximum achievable relative velocity is a
  defect with a dedicated regression test (two ships at max closing speed, hull radius 1).
- Contact resolution is order-independent per rule 7.3.2: all TOIs in a sub-step are collected,
  sorted by `(toi, idA, idB)`, and applied in that canonical order.

### 7.5 Verification (the part that makes it real)
| Test | Where | Asserts |
|------|-------|---------|
| Golden-trace | `tests/determinism` | 50 recorded `(seed, fleets, plans)` fixtures hash to recorded final-state digests. Fixtures are append-only. |
| Shuffle | `tests/determinism` | Shuffled entity iteration ⇒ identical digest (NFR-Correctness). |
| Tunneling | `tests/determinism` | No pass-through at max closing velocity. |
| **Cross-engine** | Playwright: Chromium + Firefox + WebKit, **plus Node** | All four produce **the same digests as the Node golden file.** This is the only test that can actually substantiate "on every machine." |
| Harness-purity | CI bundle check | `tools/balance` output contains no `three`/`preact`/`document` reference (FR-33). |

---

## 8. Wire Formats (this project's real public API)

There is no HTTP API. These two formats cross machines and years instead, so they are specified
with the same seriousness (FR-2, FR-8, FR-9, Decision 18).

### 8.1 Share token (FR-8, ≤1900 chars)
```
base64url(  magic 'S' (1 byte)
          | schemaVersion   varuint
          | catalogVersion  varuint
          | chassisOrdinal  varuint
          | slotCount       varuint       (cross-checked against the chassis' published layout)
          | slotOrdinals[]  varuint each  (0 = empty slot)
          | nameLen         varuint       (≤48)
          | nameUtf8        bytes
          | crc8            1 byte )
```
- **Ordinals, not string IDs** — permanent, additive-only integers assigned in the catalog lock.
  A 12-slot mega destroyer lands at ~40–80 bytes ⇒ **~60–110 characters**, versus a 1900 budget.
  The headroom is deliberate: v1.x grows the catalog, ordinals grow, tokens stay tiny.
- Lives in the **URL fragment**: `https://<user>.github.io/starship-skirmish/#/import?b=<token>`.
  Fragments are never transmitted to a server — a privacy property we get for free from hash routing.
- **Decode is total.** Hard caps before any allocation: token ≤2048 chars, `slotCount` ≤ the
  chassis' declared layout, `nameLen` ≤48, unknown ordinal ⇒ typed error. Malformed input yields
  `Result.err` with the failing offset (design §4.9 asks for the character position) and **zero
  state mutation** (NFR-Security).

### 8.2 JSON export (FR-9)
```json
{ "format": "starship-skirmish/library",
  "schemaVersion": 3, "catalogVersion": 7,
  "exportedAt": "2026-08-25T22:19:28.302Z",
  "builds": [ { "id": "...", "name": "...", "tags": [], "chassisId": "cru-hammerhead",
                "slots": ["wpn-fusion-lance", null, "shd-fluxweave"],
                "schemaVersion": 3, "catalogVersion": 7, "storedCost": 148 } ] }
```
- **String IDs here, not ordinals** — an export is a human-inspectable archival artifact; ordinals
  optimize for characters and this format has no character budget. Both encodings resolve through
  the same permanent-ID guarantee.
- Import caps: file ≤8 MB, ≤5000 builds, per-build validation, **additive-only, never deletes**
  (FR-9). Per-build report: `IMPORTED / RENAMED / SKIPPED / FAILED(reason)`.
- Partially invalid file ⇒ valid builds import, the rest are reported (FR-9).

### 8.3 Migration chain (FR-2)
`migrations: Array<{ from: N, to: N+1, up(doc): doc }>` applied in sequence from the artifact's
`schemaVersion` to current. Then **re-price against the current catalog**; if the total differs,
flag `needs-refit` with the full diff the design spec requires (§4.7).

**Fixture immutability:** `tests/fixtures/migration/manifest.json` records a SHA-256 per fixture.
A CI test recomputes them. **Editing a historical fixture fails the build** — that is how
"fixtures are never edited after being added" becomes structural (FR-2).

---

## 9. Rendering Architecture (FR-13, FR-14, NFR-Performance)

**Budget: 60 ships + 300 hazard bodies ≥30 fps; ≥60 fps in normal play.**

| Concern | Approach |
|---------|----------|
| Ship silhouettes | One `LineSegments2` geometry **per chassis class** (4 total), instanced per ship via per-instance transform + fleet color. 60 ships ⇒ ~4–8 draw calls. |
| Hazard bodies | A single `InstancedMesh` of camera-facing quads sampling a **glyph atlas** (`✳` debris, `➤` tracking, `◇` spent). 300 bodies ⇒ **1 draw call**, and shape-coded identity survives colorblindness (design §1.1 ⛓). |
| Glow | Additive line material + half-resolution bloom pass. Toggleable quality tier; disabled under reduced-motion along with `sweep`/`glitch-x`/`flick`. |
| Boundary | Always-rendered shell: a shader-based hex-grid sphere/cylinder, front faces at low alpha + back faces at lower alpha, so it reads **from outside looking in** (FR-16, design §4.1). Never fades, no toggle. |
| Predicted path | `Line2` ghost, re-tessellated on arc edit using the **same integrator as the sim** (a `sim/physics.previewPath()` pure function). If the preview and the resolution disagree, the game is lying — so they share one code path. |
| Labels | **DOM overlay** (absolutely positioned, `transform: translate3d`), **ships only** (≤60) plus hovered/selected hazards. Updated at ~15 Hz, decoupled from the render loop; declutter by screen-space collision + distance LOD. This is the direct answer to design open question §7.4 — 360 DOM labels at 60 fps is not viable, and hazards carry identity in their glyph sprite instead. |
| Picking | GPU color-ID pick buffer on click (not per-frame raycast) — O(1) regardless of body count, and works on line geometry where raycasting is fiddly. |
| Playback | `TracePlayer` interpolates recorded sub-step keyframes against wall-clock time. **Wall clock never enters the sim.** Skip = jump to the trace's final frame; replay = re-run the same trace. Outcome is untouched either way (FR-19). |
| Camera | `OrbitControls`-derived custom controller: free orbit/pan/zoom, near/far clamps only (FR-14). State persists across beats and playback in `app` session state, survives screen transitions, and `R` resets to fleet view. |
| Depth cues | Ground-plane reference grid + per-body altitude stalks (`.mk-stalk` in the mocks) — mandatory, since depth on a 2D screen is otherwise unreadable (FR-14). |

**Resize/DPR:** cap `devicePixelRatio` at 2 and auto-degrade bloom + line width on sustained
frame-time overrun. Degradation is visual only — it can never touch simulation.

---

## 10. Security Posture

The app has no backend, so the entire attack surface is **data arriving from other people**
(NFR-Security).

- **Authentication / Authorization:** none. There are no accounts, no identities, no server
  (Decision 5). Nothing to authenticate to.
- **Data at rest:** plaintext in `localStorage`. Not sensitive — ship builds. Deliberately *not*
  encrypted, because encrypting it would only make it unrecoverable when the key is lost, which
  actively conflicts with "no loss, ever."
- **Data in transit:** HTTPS via GitHub Pages. Share tokens travel in the **URL fragment** and are
  therefore never sent to any server at all.
- **Untrusted input:** `src/io/` is the single entry point. Every decode returns `Result`, never
  throws across the boundary, and never mutates. Hard caps precede every allocation and every loop
  (§8.1, §8.2). No unbounded `while`, no length taken from foreign data without a cap.
- **XSS:** Preact escapes text by default. `dangerouslySetInnerHTML` and `innerHTML` are
  **lint-banned repo-wide**. Build names and tags render as text nodes only (design §4.9).
- **CSP** (meta tag, since Pages serves no custom headers):
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
  font-src 'self'; worker-src 'self' blob:; connect-src 'self'; object-src 'none';
  base-uri 'none'; frame-ancestors 'none'`.
  No `unsafe-eval` — Vite's production output doesn't need it, and this kills a whole class of
  injection. (`'unsafe-inline'` for styles is required by three.js/inline token styling; scripts
  are strictly `'self'`.)
- **DoS on self:** import cannot exhaust `localStorage` (pre-flight size estimate vs headroom,
  refuse with a clear message) and cannot lock the UI (imports >200 builds are chunked across
  animation frames).
- **Telemetry:** none. No analytics, no beacons, no third-party runtime code. CSP `connect-src
  'self'` makes exfiltration structurally impossible even if a dependency were compromised.

---

## 11. Deployment Architecture — GitHub Pages

- **Target:** GitHub Pages, project site → `https://<owner>.github.io/starship-skirmish/`.
  A custom domain is a `CNAME` file drop-in and changes nothing below except `base`.
- **Build:** `npm ci && npm run build` → Vite → `dist/`. `vite.config.ts` sets
  `base: '/starship-skirmish/'` (override via `VITE_BASE` env for custom-domain or fork builds).
- **Runtime:** 100% static. HTML + JS + CSS + JSON + woff2. **No server-side component of any
  kind**, satisfying NFR-Platform and Decision 5.
- **`.nojekyll`** in `public/` — **required.** Without it, GitHub Pages runs Jekyll and silently
  drops any directory starting with `_`, which will eventually eat a build asset. This is the
  single most common way a Pages deploy breaks mysteriously.
- **Hash routing** (`#/shipyard`, `#/import?b=…`) — no `404.html` SPA shim needed, deep links and
  share links work on first load, and fragments stay client-side.
- **Offline (NFR-Platform):** Workbox `generateSW` precaches the full app shell + catalog JSON +
  fonts. After first load the game is fully playable with the network off. Update strategy:
  prompt-on-new-version (never auto-reload mid-match — a service-worker reload during a committed
  beat would be an unforgivable way to lose a game).
- **CI pipeline** (`.github/workflows/`):
  1. `typecheck` → `lint` (incl. boundary + determinism rules) → `test:unit`
  2. **`test:catalog-lock`** — fails if any historical ID/ordinal vanished (FR-1)
  3. **`test:fixtures`** — fails if any migration fixture was edited (FR-2)
  4. **`test:determinism`** — Node + Chromium + Firefox + WebKit digests must match (§7.5)
  5. `test:harness-purity` — no render deps in the balance bundle (FR-33)
  6. `build` → `actions/upload-pages-artifact` → `actions/deploy-pages` on `main`
- **Bundle budget:** ≤650 KB gzipped total for first interactive paint (≈550 KB of that is
  three.js + fonts), against the ≤3 s broadband target. Catalog JSON loads before the Shipyard is
  interactive; the tactical renderer is a **dynamic `import()`** so the Shipyard and Encyclopedia
  paint without waiting on three.js. CI fails the build on budget regression.

---

## 12. Build Order (FR-32 — the gates come first)

Architecture is a plan, and this plan says **do not build the Shipyard yet.**

| Stage | Contents | Exit criterion |
|-------|----------|----------------|
| **Gate 1** *(disposable)* | `prototypes/gate1/` — `sim/mathx` + `sim/physics` + a raw three.js wireframe view. Two ships, momentum, arc plotting, bounded arena, one collision, debris persisting a turn. | **Is that turn fun?** Also settles design open questions §7.1 (camera mapping), §7.2 (drag handle vs numeric arc entry), §7.4 (marker density). |
| **Gate 1b** | `tools/balance` skeleton + golden-trace + shuffle + tunneling tests. **Built alongside Gate 1, per FR-33** — not after. | Harness runs ≥100 matches/min/core; determinism digests stable across all four engines. |
| **Gate 2** *(disposable)* | `prototypes/gate2/` — one heuristic bot plotting a blind 3D thrust arc without flying itself out of bounds. The project's highest-risk unknown. | Bot survives 100 seeded matches with zero unforced boundary deaths. |
| **Build** | Everything above, promoted properly: catalog → domain → io/persist → sim rules → ai tiers → render → ui. | — |

Neither gate ships. `prototypes/` is excluded from the app build and from CI's boundary rules.
**The full build does not begin until both gates pass.**

---

## 13. Open Architectural Questions

Decisions I am deliberately deferring to evidence rather than guessing at now.

1. **Arc-plotting input mapping** (design §7.2). Numeric bearing/pitch/magnitude entry is the
   committed accessible baseline (NFR-Accessibility requires keyboard reachability regardless).
   Whether a 3D drag handle *replaces* or *supplements* it is Gate 1's call. Architecturally
   irrelevant — both drive the same `MovementPlan` struct — so it is safe to defer.
2. **Bloom vs. sprite-halo glow.** Half-res bloom is the plan; if it costs more than ~2 ms at the
   entity ceiling, fall back to additive halo sprites. Measure at Gate 1, not at polish.
3. **Hit-chance formula terms** (design §7.3). Ruling H names range, target velocity, and target
   evasion. If tuning demands more terms, the readout must be redesigned honestly. **Architectural
   constraint: the formula lives in `sim/rules` and the UI reads its published term breakdown —
   it must never be duplicated in the UI layer.**
4. **Worker pool sizing.** One worker per bot fleet (≤4) is the plan; whether the transfer cost of
   the `BlindMatchView` beats the parallelism at small fleet sizes needs measurement. Fallback is
   sequential main-thread planning, which stays correct, just slower.
5. **`localStorage` ceiling in practice.** 500 builds × ~400 bytes ≈ 200 KB — comfortably inside
   5 MB. If real-world builds prove larger (long names, many tags), the repo interface allows an
   IndexedDB adapter with no call-site changes.
6. **Fleet hull cap of 20 / 60 on field** is a `tuning.json` data value, not a structural limit
   (Assumption 4). If Gate 1 shows the field stays legible higher, raise the number — **no code
   changes anywhere.**

---

## 14. Requirements Traceability (architectural claims only)

| Requirement | Where it is architecturally guaranteed |
|-------------|----------------------------------------|
| FR-1 additive-only catalog | `catalog/lock/` + CI `test:catalog-lock`; schema has no AI-exclusive field |
| FR-2 migration day one | `io/migrate` chain + hash-locked append-only fixtures |
| FR-8 ≤1900-char share | Ordinal bit-packing → ~60–110 chars (§8.1) |
| FR-17 blind commit | Pending plans exist only as a closure local in `TurnCoordinator` (§6.3) |
| FR-19/21 order independence | Counter-based RNG + sorted accumulation + two-phase commit (§7.3) |
| FR-19 no tunneling | Swept CCD + state-derived sub-stepping (§7.4) |
| FR-27 no turn cap/draw | No such code path exists; victory check has three branches only |
| FR-29/30 no AI cheating | Bots implement the same `Commander`; no stat-modifier field exists in the data model |
| FR-33 headless sim | `sim/` imports nothing; CI bundle-purity check on `tools/balance` |
| NFR-Correctness | Cross-engine determinism CI on Node + 3 browser engines (§7.5) |
| NFR-Platform offline | Workbox precache-all; zero CDN; self-hosted fonts |
| NFR-Platform static | GitHub Pages, hash routing, `.nojekyll` (§11) |
| NFR-Security | `io/` Result boundary + CSP with no `unsafe-eval` and `connect-src 'self'` |
| NFR-Accessibility | Glyph atlas carries identity in *shape*; DOM labels are real text; reduced-motion kills only decoration |
```
