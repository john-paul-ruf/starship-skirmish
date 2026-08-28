# M16 — App (`src/app/`, as built)

> Architecture-as-built detail for M16 (`src/app/`) — the composition root: bootstrap, hash
> router, session/services factory, error boundary, and `boot()`. The SOLE consumer of `src/app`
> is `src/main.tsx` (ESLint `APP_IMPORT_PATTERN`). Session-marked; appended by Jikijitsu from each
> worker's arch fragment. Disk-only (`program/` gitignored).
>
> Scope note: SESSION-03 also extended M14 UI (the shell `src/ui/App.tsx` + the D-IOC-SEAM contract
> in `src/ui/appContext.ts` + placeholder screens). That surface is documented here as one unit
> because the IoC seam spans ui↔app; `M14-ui.md` carries a SESSION-03 pointer to this file.

<!-- SESSION-03 -->
# SESSION-03 — Arch fragment (delta only)

## Module registry additions

- **M16 App — composition root** (`src/app/`)
  - Public: `boot(mount, opts?)` from `src/app/index.js`.
  - Files: `bootstrap.ts`, `router.ts`, `session.ts`, `errorBoundary.tsx`,
    `boot.tsx`, `index.ts` (barrel).
  - Imports: `catalog`, `persist`, `persist/storageAdapter`, `ui` (App, AppContext),
    `ui/components` (ErrorFallback), `preact`, `@preact/signals`.
  - Only importer: `src/main.tsx` (enforced by ESLint `APP_IMPORT_PATTERN`).

- **M14 UI — shell + IoC contract + placeholder screens** (extends existing M14)
  - New files:
    - `src/ui/App.tsx` — the shell (DesktopGate + Topbar + routed outlet +
      session-mode banner + toast host). Consumes `useApp()`.
    - `src/ui/appContext.ts` — the D-IOC-SEAM service contract:
      `Route`, `AppServices`, `ToastKind`, `ToastItem`, `AppContext`,
      `useApp()`. Ui-owned; screens/app both read from here.
    - `src/ui/index.ts` — barrel (`App`, `AppContext`, `useApp`, contract types).
      Components stay reachable via `src/ui/components/index.js` — the
      double-export path is deliberate (`verbatimModuleSyntax` forbids a
      blanket `export *` over the components' explicit type re-exports).
    - `src/ui/screens/{Encyclopedia,Shipyard,ShareImport}.tsx` — placeholder
      screens (D-PLACEHOLDER; S04/S05/S06 replace bodies, export names stable).
    - `src/ui/screens/index.ts` — screens barrel.
  - New import: `ui → ui/components` (Banner, DesktopGate, Toast, Topbar,
    ErrorFallback). No `ui → app` edge.

## Public API — D-IOC-SEAM contract

```ts
// src/ui/appContext.ts — screens consume this, `src/app` produces it.

export type Route =
  | { readonly name: 'encyclopedia' }
  | { readonly name: 'shipyard'; readonly buildId?: string }
  | { readonly name: 'share'; readonly token?: string };

export type ToastKind = 'default' | 'warn' | 'danger';

export interface ToastItem {
  readonly id: string;
  readonly msg: string;
  readonly kind: ToastKind;
}

export interface AppServices {
  readonly catalog: Catalog;
  readonly repo: LibraryRepo;
  readonly durable: boolean;                             // false ⇒ session mode (FR-7)
  readonly route: ReadonlySignal<Route>;
  readonly reducedMotion: Signal<boolean>;
  readonly toasts: ReadonlySignal<readonly ToastItem[]>; // shell-only read
  navigate(to: Route): void;
  toast(msg: string, kind?: ToastKind): void;
}

export const AppContext: preact.Context<AppServices | null>;
export const useApp: () => AppServices;                  // throws if unprovided
```

## Hash format (router)

App-internal, copy-pasteable, token-safe:

| Route variant                                     | Hash                             |
|---------------------------------------------------|----------------------------------|
| `{ name: 'encyclopedia' }`                        | `#/encyclopedia`                 |
| `{ name: 'shipyard' }`                            | `#/shipyard`                     |
| `{ name: 'shipyard', buildId: <id> }`             | `#/shipyard/<encoded-id>`        |
| `{ name: 'share' }`                               | `#/share`                        |
| `{ name: 'share', token: <t> }`                   | `#/share?t=<encoded-t>`          |

`parseHash` is TOTAL — unrecognised hashes fall to `encyclopedia`. Every
variant round-trips through `serializeRoute` → `parseHash`.

## Load-bearing invariants established

- **D-IOC-SEAM (LOAD-BEARING for S04–S06):** `src/ui/**` NEVER imports
  `src/app/**` — enforced by ESLint `APP_IMPORT_PATTERN`. Screens consume
  `useApp()` from `src/ui/appContext.ts`; `src/app/**` produces the
  `AppServices` value and provides it via `<AppContext.Provider>` from
  `boot.tsx`. `src/main.tsx` is the SOLE importer of `src/app/**`.
- **D-ROUTE-OUTLET:** the screen switch lives in `src/ui/App.tsx`
  (`Outlet` component). A new screen = a new `Route` variant + a new case
  there. `src/app/**` never imports a screen.
- **D-PLACEHOLDER:** S03 placeholders `Encyclopedia` / `Shipyard` /
  `ShareImport` are replaceable BODIES; S04/S05/S06 keep the export names
  stable so `App.tsx` outlet + `screens/index.ts` barrel never need re-editing.
- **Stylesheet single-import site:** `src/main.tsx` imports
  `./ui/styles/index.css` exactly once. No other file imports a stylesheet.

## `data-testid`s the shell exposes (convention for S04–S06 to reuse)

| testid                     | Element                                                |
|----------------------------|--------------------------------------------------------|
| `app-shell`                | `<div class="app-shell">` inside DesktopGate           |
| `app-main`                 | `<main class="app-main">` — the outlet host            |
| `session-mode-banner`      | Rendered inside the durable=false Banner               |
| `toast-host`               | `<div class="toast-host">` — the toast host container  |
| `screen-encyclopedia`      | Root of the Encyclopedia placeholder                   |
| `screen-shipyard`          | Root of the Shipyard placeholder                       |
| `screen-share`             | Root of the ShareImport placeholder                    |
| `share-token`              | Placeholder's echo of the incoming share token         |
| `shipyard-build-id`        | Placeholder's echo of the incoming buildId             |
| `nav-shipyard`             | In-body nav button (Encyclopedia placeholder)          |
| `nav-encyclopedia`         | In-body nav button (Shipyard / Share placeholders)     |

## Playwright — served-app config

`playwright.config.ts` gains a `webServer` block:
`command: 'npm run dev -- --port 8081'`, `url:
'http://localhost:8081/starship-skirmish/'`, `reuseExistingServer: !CI`,
`timeout: 120_000`. Fixed port + reuse so Wave 3 (S04/S05/S06 concurrent) can
share one dev server. Pre-existing determinism specs are `page.setContent`-based
and untouched.

<!-- SESSION-01 (tactical-skirmish) — match session (app-side value producer) -->
## tactical-skirmish SESSION-01 — M16 match session (D-MATCH-CONTROLLER)

New module `src/app/match/**`:
- `config.ts`: `assembleMatchConfig(catalog,tuning,budget,seed,playerBuilds,botSpecs): MatchConfig` (pure; validate ->
  resolve player fleet 0 + generateBotFleet bots 1..N -> arena/physics/combat); `mintSeed(): Seed` — the ONLY
  `crypto.getRandomValues` in the match pipeline (arch §7.2); `const PLAYER_FLEET_ID = 0`.
- `commanders.ts`: `makePlayerCommander(fleetId): {commander,resolveMovement,resolveAttack}` (promise-backed, FR-17);
  `makeBotCommanders(fleets,tiers,physics,combat): HeuristicCommander[]`.
- `controller.ts`: `createMatchController(services: MatchServices, config, botTiers): MatchController`. Drives the PURE
  beat resolvers manually (runMovementBeat/runAttackBeat/applyTurnEnd/checkVictory), paced by UI commits +
  resolveAnimationDone; blind commit lives in `collect*Plans` (plans are `const` locals only).
  `interface MatchServices { navigate(to: Route): void }`.
- `index.ts` barrel; `session.ts`: `AppServices.startMatch` mints seed, assembles config, creates controller, stores activeMatch.

Navigation contract (phase -> route): controller navigates tactical-move on each turn's movement-plan, tactical-attack
entering attack-plan, post-match on complete/concede; screens render for the current phase, the route follows. First-turn
kickoff deferred one microtask so startMatch sets activeMatch before the first navigate reaches the outlet.

(Ui-owned match contract it produces: see M14-ui.md, same SESSION-01 marker.)

<!-- finite-thrust-movement / SESSION-04 -->
## finite-thrust-movement / SESSION-04 — Controller seam + UI contract (segmented `previewArc` + `commitMovement`)

### M16 (App) — extended controller seam

- **`src/app/match/controller.ts`** — `previewArc` now accepts a discriminated
  union: `Vec3 | { readonly segments: readonly WaypointBurn[] }`. Impulsive
  form is byte-identical to the pre-SESSION-04 shape (D-ADDITIVE-PLAN — the
  regression path). Segmented form builds a finite-thrust `MovementPlan`
  (`deltaV = ZERO`, `segments` forwarded verbatim) and hands it to the SAME
  `sim/physics.previewPath` the resolver runs (D-SHARED-SCHEDULE). The seam
  return now carries an optional `markPositions?: readonly Vec3[]` — the
  per-waypoint boundary marks S05's UI ruler reads to land on the TRUE curved
  arc (empty for impulsive plans and for unknown `bodyId`).
- **`commitMovement`, `collectMovementPlans`, `makePlayerCommander`** —
  UNCHANGED. S02 proved `runMovementBeat` forwards `MovementPlan.segments`
  opaquely; the player commander's `resolve(plans.slice())` already shallow-
  copies at the plans level and preserves segment references. Blind commit
  (FR-17 / §6.3) stays intact by construction — plans remain `const` locals
  inside `driveTurn`, unreachable from `MatchState` / `BlindMatchView` /
  signals.
- **Type-only import** `WaypointBurn` reached via `src/sim/physics/index.js`
  (allowed from `src/app/**`); S01 followup #2 (re-export from `src/sim/index.ts`)
  is still owned by no session in this feature and remains carried.

### M14 (UI) — contract change on the ui-owned seam

- **`src/ui/matchContext.ts`** — `MatchController.previewArc` signature is
  now `previewArc(bodyId, arc: Vec3 | { readonly segments: readonly WaypointBurn[] })
  : { positions, endsOutsideArena, markPositions? }`. Impulsive callers pass a
  bare `Vec3` unchanged; finite-thrust callers (S05 waypoint UI) pass
  `{ segments }` and read `markPositions` for per-waypoint marks on the true
  curved arc (D-SHARED-SCHEDULE).
- **Import discipline preserved:** `ui → sim/physics` remains lint-banned.
  `WaypointBurn` is a TYPE-only import from `../sim/types.js` (allowed —
  only `sim/physics` + `sim/rules` paths are banned for `ui`). No sim VALUE
  is pulled into the ui bundle.
- **D-PREVIEW-SEAM preserved** — the integrator stays behind the controller;
  `ui` never value-imports `sim/physics`, and `previewPath` remains the single
  crossing point.

### Contracts inherited by downstream (S05, S06)

- **S05 (Waypoint UI) — the seam it plots against:**
  - `previewArc(bodyId, deltaV: Vec3)` — impulsive, unchanged. For a "coast"
    plan or an impulsive fallback, pass `ZERO` as the Vec3.
  - `previewArc(bodyId, { segments })` — finite-thrust. `segments[i].deltaV`
    is world-space Vec3; the caller converts bearing/pitch → Vec3 via
    `sim/mathx.dirFromBearingPitch` (D-PHYSICS-VEC3-ONLY holds end-to-end).
  - Return shape reads: `positions` for the curved ghost `Line2`; the
    ruler / waypoint selector reads `markPositions ?? []` (empty in the
    impulsive branch — the UI keeps its per-second sampling over `positions`).
  - `commitMovement(plans)` accepts `readonly MovementPlan[]` with optional
    `segments` verbatim; the beat resolves them via S01's shared `thrustSchedule`.
- **S06 (determinism + balance re-record):** no new sim-visible behaviour
  landed here — the controller seam only reshapes how a caller *reaches* the
  existing S01 finite-thrust integrator. The pinned SESSION-01 determinism
  suite (88/88) is untouched by SESSION-04.

### Carried cross-lease gap (unchanged from S01/S02/S03)

- `src/domain/resolveFleet.ts::physicsConfigFromTuning` AND
  `src/app/match/config.ts::assembleMatchConfig` still do not propagate
  `tuning.physics.maxAccel → PhysicsConfig.maxAccel`. Both are OUT OF THE
  SESSION-04 LEASE, so the propagation is not landed here — the gap remains
  owned by no session in this feature. Until a downstream lease lands it, a
  committed segmented plan hits `thrustSchedule`'s impulsive-fallback path at
  runtime (deterministic, deposits summed Δv at sub-step 0, no curve). S05
  needs `maxAccel` propagated (or `ui`/test scaffolds it) to see genuine
  curved arcs at runtime. **→ Forge granularity feedback: grant a session the
  `resolveFleet.ts` / `config.ts` line, or add a dedicated propagation session.**

<!-- SESSION-01 · playtest-feedback-04 · M16 controller · hitChanceFor out-of-range gate -->
## M16 App — `hitChanceFor` out-of-range gate (SESSION-01 · playtest-feedback-04)

Behaviour mirror on the `MatchController.hitChanceFor` seam in
`src/app/match/controller.ts` — NOT a new formula. A shot ordered past
`weapon.range` now returns:

```ts
{ base: weapon.accuracy, rangeFactor: 0, velocityFactor: 0, evasionFactor: 0, final: 0 }
```

instead of the pre-existing HIT_FLOOR-clamped 5%. The resolver in
`sim/rules/attack.ts` already refuses that shot outright
(`if (range > weapon.range) continue;`), so the seam is being made honest,
not authoritative.

### Load-bearing invariants

- **D-HITCHANCE-SEAM intact** (see `arch/M14-ui.md` SESSION-01 tactical-skirmish
  fragment): the UI still consumes `hitChanceFor` via
  `MatchController.hitChanceFor(shooter,target,weaponIndex)` and never
  recomputes.
- **D-HITCHANCE / architecture §13.3 single-source rule intact** (see
  `arch/M09-rules.md` D-HITCHANCE): the to-hit **formula** still lives once in
  `src/sim/rules/damage.ts` (`hitChance` + `RANGE_EXP` / `VELOCITY_REF` /
  `HIT_FLOOR` / `HIT_CEIL`). The controller-side gate is a **range comparison**
  that decides whether to invoke the formula, not a competing formula.
- **In-range HIT_FLOOR behaviour unchanged.** A genuinely-hard in-range shot
  still clamps to 5% — the change only stops the floor from lying about shots
  the resolver will never fire.
- **Blind commit (FR-17) untouched.** The gate reads the shooter's own view;
  no opponent-plan surface reached, no `MatchState` mutation.

### Paired UI-side selector

`arch/M14-ui.md` SESSION-01 · playtest-feedback-04 adds
`weaponOutOfRange(view, shooterId, weaponIndex, targetId): boolean` — a
sibling range comparison the WeaponBench reads to render an explicit
**OUT OF RANGE** state (rather than a `0%` cell). Both gates use the same
`mathx.distance` vs `weapon.range` comparison and the same strict `>` so
the bench's OUT OF RANGE and `hitChanceFor`'s `final: 0` are unified
end-to-end.

### No public-API change

The `HitChanceBreakdown` shape (`base, rangeFactor, velocityFactor,
evasionFactor, final`) and the `MatchController.hitChanceFor` signature are
untouched. Downstream (WeaponBench + any future consumer) reads the same
type.
