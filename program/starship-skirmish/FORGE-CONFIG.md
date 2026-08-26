# FORGE-CONFIG — Starship Skirmish

> Authoritative build configuration for the whole program. Sessions and STATE.md reference
> module IDs (`M01`…) from the registry below. IDs are permanent; never renumbered or reused.
> Derived from `specs/architecture.md` v1, `specs/database.md` v1, `specs/requirements.md` v1,
> `specs/design.md` v1. Where a value traces a spec, the section is cited.

## Program

- **P_NAME:** Starship Skirmish
- **P_SLUG:** `starship-skirmish`
- **Owner:** John Ruf (`john.paul.ruf@gmail.com`)
- **Repo root:** `/Users/the.phoenix/WebstormProjects/starship-skirmish`
- **Forge artifacts root:** `program/starship-skirmish/`
- **Core intent:** A static, offline-capable, deterministic 3D turn-based tactical fleet-combat
  game — a deep point-buy Shipyard plus a blind-commit simultaneous-turn Skirmish — with no
  backend, ever.
- **Status:** Specs complete (idea → requirements → design → architecture → database, all v1).
  Catalog content authored (v1, 12 chassis / 26 components). Mocks authored (7 screens). **No
  application source exists yet.** `pipeline-state.json` confirms phases through `prototype`.

## Stack (architecture §1 — the whole runtime dependency list is `three`, `preact`, `@preact/signals`)

- **Language:** TypeScript 5.7+, `strict: true`, `noUncheckedIndexedAccess: true`
- **Runtime:** Browser (evergreen) + Node 22 LTS (harness/tests/CI only). *Installed: Node v22.17.0, npm 10.9.2.*
- **Framework:** None (plain SPA, no meta-framework)
- **UI:** Preact 10 + `@preact/signals` (`preact/compat` alias for ecosystem escape hatches)
- **State:** Two-tier — signals for UI state; plain immutable structs for match state (owned by `sim/`)
- **3D:** three.js r171+ (WebGL2), `Line2`/`LineSegments2` fat lines, `EffectComposer` half-res selective bloom
- **Physics:** Custom, in-house, deterministic — sphere colliders, swept CCD, uniform-grid broadphase
- **RNG:** Counter-based hash RNG (SplitMix64-derived, `Math.imul` uint32 core) — order-independent by construction
- **Persistence:** `localStorage` behind a `LibraryRepo` interface (index + per-build keys)
- **Data layer:** Static JSON catalog + append-only lockfiles, validated in CI. No ORM, no DB, no query layer.
- **Share encoding:** Bit-packed permanent ordinals → base64url (no compression). JSON export optional `deflate-raw`.
- **Build tool:** Vite 6 (`base: '/starship-skirmish/'`, override via `VITE_BASE`)
- **Test:** Vitest 3 (unit + determinism) + Playwright 1.49+ (cross-engine determinism + e2e smoke)
- **Lint/Boundaries:** ESLint 9 flat config + `eslint-plugin-boundaries` (module boundaries + sim determinism ban-list are *enforced*)
- **Service worker:** `vite-plugin-pwa` (Workbox `generateSW`, precache-all) — offline after first load
- **Fonts:** Self-hosted JetBrains Mono + Inter (`woff2`, subset). **No Google Fonts CDN, no Tailwind CDN** (mock-only).
- **CI/CD:** GitHub Actions → `actions/deploy-pages`. Hash routing, `.nojekyll`.
- **Analytics:** None. Ever. (CSP `connect-src 'self'`.)

## Architecture (the three load-bearing strategies — architecture §0, §7)

1. **Determinism is a hard requirement.** Identical seed + identical plans ⇒ identical outcome on
   every engine. `float64` `+ - * / sqrt` only inside `sim/`; **all transcendentals banned** and
   replaced by arithmetic-only polynomials in `sim/mathx/trig.ts`. Counter-based RNG. Order-independent
   accumulation (sort by stable `uint32` id before summation). Two-phase read/stage/commit.
2. **Blind commit is structurally impossible to violate.** Pending plans of other fleets exist only
   as a closure `const` inside `TurnCoordinator.runTurn()` — unreachable from `MatchState`,
   `BlindMatchView`, the UI store, or the DOM. There is nothing to leak because there is nothing to reach.
3. **There is no server, forever.** The share token and JSON export are the project's public API and
   are versioned like one. `src/io/` is the single untrusted-input boundary: everything returns
   `Result`, nothing throws across it, nothing mutates caller state; hard caps precede every allocation.

- **Dependency flow (architecture §5, lint-enforced):** `catalog → domain → {io, sim, ai} → {render, persist} → ui → app`.
  Two rules never waived: **(1)** nothing in `sim/` imports `render/`/`ui/`/`persist/`/`app/` or any npm package;
  **(2)** `render/` imports `sim` **types only** (one-way, no mutation path). `tools/balance` imports `sim + ai + domain + catalog` only.
- **Entry points:** `src/main.tsx` (app) · `tools/balance/*` CLI (harness) · `prototypes/gate{1,2}/` (disposable gates).
- **Wire formats (architecture §8, database §5–6):** Share token `base64url('S'|schemaVer|catalogVer|chassisOrdinal|slotCount|slotOrdinals[]|nameLen|nameUtf8|crc8)`, ≤2048 chars. JSON export `{format:"starship-skirmish/library", schemaVersion, catalogVersion, exportedAt, builds[]}` (string ids), ≤8 MB / ≤5000 builds.
- **Initial versions:** `schemaVersion = 1`, `catalogVersion = 1` (database §0). Migration chain ships **empty** with the machinery present (FR-2 "day one").

## Module Registry

Stable IDs ordered by dependency depth (leaves first). The **Path** column is load-bearing —
session write-sets derive from it. Full public-API contracts live in `specs/architecture.md` §4
(the canonical module-contract doc); per-module detail files accrue under `program/starship-skirmish/arch/`
as each module is built.

| ID | Module | Path | Owns | Imports From | Key Files (planned) |
|----|--------|------|------|--------------|---------------------|
| **M01** | Toolchain & Build | root config + `public/` | Vite/TS/ESLint config, PWA, entry HTML, CI | — | `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `eslint.config.js`, `index.html`, `public/.nojekyll`, `.github/workflows/` |
| **M02** | Catalog Content (data) | `catalog/` | Additive-only content + ordinal locks (FR-1) | — | `classes.json`, `chassis/*.json`, `components/*.json`, `tuning.json`, `lock/catalog-vN.json` **(authored, v1)** |
| **M03** | Catalog Loader | `src/catalog/` | Loading, indexing, integrity asserts | M02 | `loadCatalog.ts`, `index.ts`, `assertLock.ts` |
| **M04** | Sim: Math Core ⚑ | `src/sim/mathx/` | vec3, deterministic trig, counter-RNG | — (leaf) | `vec3.ts`, `trig.ts`, `rng.ts`, `index.ts` |
| **M05** | Domain | `src/domain/` | What a legal build is / costs / derives to | M03 | `build.ts`, `validateFit.ts`, `pointCost.ts`, `derivedStats.ts`, `refitDiff.ts`, `resolveFleet.ts` |
| **M06** | Sim: Physics ⚑ | `src/sim/physics/` | Swept CCD, broadphase, integration, momentum | M04 | `broadphase.ts`, `integrate.ts`, `sweep.ts`, `resolveMovement.ts`, `previewPath.ts` |
| **M07** | IO (untrusted boundary) ⚑ | `src/io/` | Every foreign byte; codec, validate, migrate | M05, M03 | `codec/`, `validate.ts`, `limits.ts`, `migrate/migrations.ts` **(authored)**, `migrate/migrate.ts` |
| **M08** | Persist | `src/persist/` | Encyclopedia durability (localStorage) | M05, M07 | `LibraryRepo.ts`, `localStorageAdapter.ts`, `quota.ts`, `rebuildIndex.ts` |
| **M09** | Sim: Rules ⚑ | `src/sim/rules/` | Damage, shields, called shots, boundary, missiles, debris | M04, M06 | `damage.ts`, `shields.ts`, `boundary.ts`, `missiles.ts`, `debris.ts` |
| **M10** | Sim: Loop ⚑ | `src/sim/loop/` | TurnCoordinator, Commander iface, BlindMatchView | M04, M09 | `TurnCoordinator.ts`, `commander.ts`, `blindView.ts`, `createMatch.ts` |
| **M11** | Sim: Trace ⚑ | `src/sim/trace/` | ResolutionTrace emission + combat log | M04 | `trace.ts`, `combatLog.ts` |
| **M12** | AI | `src/ai/` | Bot decision quality + fleet construction | M04 (types), M05, M03 | `HeuristicCommander.ts`, `tiers.ts`, `generateBotFleet.ts`, `threatMap.ts` |
| **M13** | Render | `src/render/` | Pixels only; three.js tactical view | M04 (types only), `three` | `TacticalView.ts`, `wireframes.ts`, `boundary.ts`, `hazardAtlas.ts`, `TracePlayer.ts`, `pick.ts`, `camera.ts` |
| **M14** | UI | `src/ui/` | 7 Preact screens + design-token CSS, a11y | M05, M08, M07, M13, M16-root | `screens/*`, `components/*`, `tokens.css` (from `mocks/console.css`) |
| **M15** | Workers | `src/workers/` | Bot-planning module worker | M12, M04 | `botPlanner.worker.ts` |
| **M16** | App (composition root) | `src/app/` | Wiring, hash routing, worker lifecycle, error boundary, seed gen | everything | `bootstrap.ts`, `router.ts`, `session.ts`, `main.tsx` |
| **M17** | Balance Harness | `tools/balance/` | FR-33 headless bot-vs-bot; win/usage aggregates | M10, M12, M05, M03 | `run.ts`, `aggregate.ts`, `cli.ts` |
| **M18** | Prototypes (disposable) | `prototypes/` | Gate 1 & Gate 2 (FR-32) — excluded from app build & boundary lint | M04, M06 | `gate1/`, `gate2/` |
| **M19** | Tests | `tests/` | unit / integration / determinism / e2e + append-only migration fixtures | all | `unit/`, `determinism/`, `e2e/`, `fixtures/migration/` |

> ⚑ = inside the deterministic core (`src/sim/**` + `src/ai/**`): transcendental-math ban-list and
> the "no DOM / no npm" boundary are lint-enforced here.

## Conventions

- **Naming:** files `camelCase.ts` for logic, `PascalCase.ts`/`.tsx` for classes & components; kebab-case ids in data; `SlotType = 'weapon'|'shield'|'missile'|'engine'|'special'`.
- **Error handling:** across the `io/` boundary, **return `Result<T, E>`; never throw** (architecture §4, §10). Inside `sim/`, no throws in hot paths; validate at boundaries.
- **Determinism (in `sim/**` + `ai/**`):** banned globals — `document`, `window`, `performance.now`, `Date`, `Math.random`; banned math — `sin cos tan asin acos atan atan2 exp log log2 log10 pow hypot cbrt fround expm1 log1p sinh cosh tanh`. Iterate bodies via `sortBy(uint32 id)` only — never `Object.keys`/`Set`/insertion order.
- **Caps live in one module:** `src/io/limits.ts` holds `name ≤ 48`, `tags ≤ 8`, `tag ≤ 24`, `token ≤ 2048`, `builds ≤ 5000`, `file ≤ 8 MB`, `STORAGE_BUDGET_BYTES = 5_000_000` (database §10).
- **XSS:** `dangerouslySetInnerHTML`/`innerHTML` lint-banned repo-wide; user strings render as text nodes only.
- **Docs:** each module's public surface documented against `specs/architecture.md` §4; content changes update `catalog/lock/README.md` rules.
- **localStorage prefix:** always `starship-skirmish:` (database §3.1 — never shorten; Pages shares one origin across all owner repos).

## Verification Commands (declared by M01 in `package.json`, extended by later features)

| Script | Command (intent) | Gate |
|--------|------------------|------|
| `typecheck` | `tsc --noEmit` (app + node configs) | every session |
| `lint` | `eslint .` — incl. boundary + determinism ban-list | every session |
| `test` / `test:unit` | `vitest run tests/unit` (`passWithNoTests`) | every session touching `src/` |
| `test:determinism` | `vitest run tests/determinism` | sim/physics/rules |
| `test:catalog-lock` | catalog id/ordinal integrity (FR-1) | catalog changes |
| `test:fixtures` | migration fixture hash-lock (FR-2) | migration changes |
| `test:harness-purity` | `tools/balance` bundle has no `three`/`preact`/`document` (FR-33) | harness/sim |
| `harness` | `tsx tools/balance/cli.ts …` — headless bot-vs-bot | balance runs |
| `build` | `vite build` → `dist/` | every session |
| `dev` / `preview` | `vite` / `vite preview` | manual |
| `test:e2e` | `playwright test` (cross-engine determinism + smoke) | render/ui/app |

Architecture-compliance checks per session: (a) no `sim/**` import of render/ui/persist/app/npm; (b) no banned global/math token in `sim/**`+`ai/**`; (c) tree builds at every checkpoint.

## Git

- **Branch:** work on `main` is acceptable per orchestration (fresh repo, no commits yet). Mu commits each checkpoint with an explicit pathspec covering only the session's `Owns`.
- **Never** `git reset --hard` (other sessions' commits share history). Crash recovery reads `git log --oneline -- <lease paths>`.
- Mu never touches `STATE.md`, `MASTER.md`, or `program/**/arch/*` — those are Jikijitsu's.

## Session Defaults

- **Checkpoints per session:** 2–6, each a real green-tree commit (`typecheck` + `lint` + relevant tests pass).
- **Read before write.** Every modification session opens by reading its target files.
- **Prototypes (`prototypes/**`) are disposable** and excluded from the app build (`tsconfig` `exclude`) and from boundary lint (ESLint `ignores`). They may use `three` directly and take shortcuts a shipping module may not.
- **Ports:** the harness and prototypes may need a dev port; Jikijitsu assigns one per subagent slot via the Orchestration Envelope. Vite dev defaults to 5173.

## Custom Rules (spec-mandated, non-negotiable)

1. **FR-32 build order:** the full application build does **not** begin until Gate 1 and Gate 2 pass. `foundation-gates` is therefore the first feature; downstream features are forged only after the gates return a verdict (Gate 1 also settles design open questions §7.1/§7.2/§7.4 that reshape the render/ui features).
2. **Additive-only catalog:** no id/ordinal ever deleted, reused, or renumbered (FR-1). `catalog/lock/*` files are append-only.
3. **Fixtures append-only, hash-locked** (FR-2). Editing a historical migration fixture fails CI.
4. **Negative-space invariant:** the catalog schema has no `factions`/`botOnly`/`difficultyModifier`/`statModifier` field, at any level. Absence is the enforcement (FR-1, FR-29, FR-30). A session that adds one is making a visible, reviewable schema change.
5. **No timer, no turn cap, no draw, no points tiebreak anywhere in the codebase** (Decision 17, FR-27). Victory check has exactly three branches: one-fleet-standing / zero-fleets / continue.
