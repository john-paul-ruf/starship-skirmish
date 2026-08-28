# M14 — UI (`src/ui/`, as built)

> Architecture-as-built detail for M14 (`src/ui/`) — the design-token CSS layer, the shared
> Preact component library, the app shell + IoC seam, and the seven screens. Built across the
> `shipyard-suite` feature (S01–S06) and extended by later features. Session-marked; appended by
> Jikijitsu from each worker's arch fragment. Disk-only (`program/` gitignored).
>
> Design-system CSS (S01) landed in `src/ui/styles/` (tokens · fonts · base · components · index)
> but wrote no arch fragment — pure CSS + font assets, no module-registry or public-API change.
> The public TypeScript surface begins with the component library below.

<!-- SESSION-02 -->
## M14 UI — Shared component library (S02)

New in `src/ui/components/` — the public presentational surface every screen
session (S04–S06) and the composition root (S03) read from. Barrel:
`src/ui/components/index.ts` (re-exports every component + its props types).

### Load-bearing invariants

- **Stateless & app-agnostic.** No `useState` / `useEffect` / `useRef` anywhere
  in the library — components take props/callbacks only. Screen sessions MUST
  follow the same rule (D-IOC-SEAM): `ui ↛ src/app/**` is lint-enforced, so
  services reach components as props from the composition root.
- **CSS by class-name string, never by import.** No component `import`s a
  stylesheet. S03 imports `src/ui/styles/index.css` once at the root. Every
  class name matches `mocks/console.css` verbatim (the source of truth per
  `specs/design.md` §2).
- **`h()` factory, not JSX.** All components live in `.ts` files and construct
  vnodes with `h(...)` from `preact`. Rationale: keeps `tsconfig.node.json`
  (M01) from needing a JSX setting to typecheck the component tests; identical
  vnode output either way; components remain fully testable by direct call
  (see `tests/unit/ui/components/*.test.ts`).
- **Never-color-alone.** `FleetGlyph`, `SlotTag`, `SlotPips`, `BodyStateTag`,
  and `Delta` each carry color + glyph/letter + text label. Downstream sessions
  MUST use these (or match their contract) — this is the FR-13 / NFR-A11y
  defense line.
- **No `dangerouslySetInnerHTML` / `innerHTML`.** Lint-enforced repo-wide;
  string content always renders as a text child (`ErrorFallback` proves this
  for arbitrary error messages).

### Exported surface (barrel)

**Primitives** — one component per row in the design §2 inventory:

- `Panel({ variant, ticks, ...aria })`, `PanelHeader({ title, titleId })`
- `Button({ variant: 'default'|'primary'|'danger'|'warn'|'ghost', size: 'sm'|'md', ...aria })`
- `Field({ type, value, onInput, ...aria })`, `Select({ options, value, onChange })`
- `Segmented<V>({ options, value, onChange, 'aria-label' })` — REQUIRED aria-label; `role=group`
- `Tabs<Id>({ tabs, activeId, onChange, 'aria-label' })` — REQUIRED aria-label; `role=tablist`
- `Checkbox({ checked, onChange, ...aria })`
- `Chip({ tone: 'neutral'|'cyan'|'amber'|'red'|'green' })`
- `Meter({ value, max, fill: 'shield'|'hull'|'dv'|'ok'|'hot', notches?, compact? })`
  — clamps `value` to `[0, max]`; NaN → 0; `max ≤ 0` → 0% (never divides by zero)
- `StatRow({ label, value })` — `.stat-k` + `.stat-v`
- `Delta({ from, to, unit?, precision? })` + `deltaSign(diff)` helper
  — always emits arrow + explicit sign (`▲ +N` / `▼ −N` / `— 0`); FR-6

**Identity** — the never-color-alone vocabulary:

- `FleetGlyph({ fleetId: 0|1|2|3|4, label? })` — `.glyph.fl-N` badge + `.sr-only` label
- `FLEET_META` table (glyph + default label per fleet id)
- `SlotTag({ type })`, `SLOT_LETTER` table (`W/S/M/E/X`)
- `SlotPips({ layout, filled })` — one-line `W ●●● S ●○ …` fit readout with
  `.sr-only` per-type summaries; shared by Encyclopedia card + Share preview
- `SLOT_ORDER`, `groupSlotPips(layout, filled)` — pure helper (exported for tests)
- `BodyStateTag({ kind: 'debris'|'missile-tracking'|'missile-spent', guidanceLeft? })`

**Overlays**:

- `Modal({ title, onClose, children, footer?, role: 'dialog'|'alertdialog' })`
  — scrim + focus-trap + Esc → onClose; `aria-modal="true"`, `aria-labelledby`
  wired to the header title id. Focus mgmt via callback ref (no-op in node
  tests); the `onKeyDown` handler is inspectable on the returned vnode.
- `Toast({ tone: 'info'|'warn'|'danger', role: 'status'|'alert' })`
- `Banner({ tone: 'info'|'warn'|'danger', role: 'status'|'alert' })`
  — default tone is `warn` (the base `.banner` styling in `console.css`).

**Chrome**:

- `Topbar({ routes, activeRoute, onNavigate, reducedMotion, onToggleReducedMotion, brandName?, right? })`
  — nav items are `<a>` for CSS selector parity; `onClick` calls
  `event.preventDefault()` so hash routing stays under app control.
- `DesktopGate({ viewportOk, minWidth?, children })` — pure branch; S03 wires
  `viewportOk` from a `matchMedia` signal.
- `ErrorFallback({ error, onReset? })` — `role="alert"`; error text rendered as
  a text child.

### Type-shape notes for consumers

- Every prop interface uses `readonly` fields — components never mutate props.
- `Segmented` and `Tabs` are generic over their value / id string literal type
  so screens keep exhaustive-switch discriminants (`type Route = 'shipyard' | 'encyclopedia' | 'share'`).
- Component-callable APIs return the widened `VNode` type; return-type
  annotations were omitted so TS's inferred `VNode<...>` narrows for tests but
  widens at usage sites (fixes contravariance issues between `h()`'s inferred
  type and a declared `VNode`).
- One `any` in the whole library: the intermediate `VNode<any>[]` slot in
  `Meter` (line-scoped `eslint-disable` with rationale). No other `any` exists.

### Testing pattern (established here; screens follow)

Tests run under vitest's **node** env (no jsdom). Convention: import the
component, invoke as a plain function, inspect `vnode.type` / `vnode.props`
as a plain object; assert on the class-name string, on child structure, and
on the `onClick` / `onKeyDown` handlers directly. Never render to DOM.

66 unit tests across `primitives.test.ts`, `identity.test.ts`,
`overlays.test.ts`, `chrome.test.ts` — Meter clamp, Delta sign→class, SlotPips
grouping, Modal Esc→onClose, DesktopGate branch selection, Topbar active
route + prevent-default nav, ErrorFallback text-node rendering.

<!-- SESSION-03 -->
## M14 UI — shell + IoC contract + placeholder screens (S03) → see M16-app.md

SESSION-03 (the app composition root) added the UI shell and the D-IOC-SEAM
service contract. Because that seam spans ui↔app as one unit, its full arch
delta lives in **`M16-app.md` (SESSION-03)**. UI-side summary:

- `src/ui/App.tsx` — the shell: `DesktopGate` → `Topbar` + routed **Outlet** +
  session-mode banner (durable=false) + toast host. Consumes `useApp()`.
  The screen switch (D-ROUTE-OUTLET) lives here; a new screen = a new `Route`
  variant + a new `Outlet` case. `src/app/**` never imports a screen.
- `src/ui/appContext.ts` — the ui-owned contract screens import: `Route`,
  `AppServices`, `ToastKind`, `ToastItem`, `AppContext`, `useApp()`. **Screens
  import THIS, never `src/app`** (ESLint `APP_IMPORT_PATTERN`).
- `src/ui/index.ts` — ui barrel (`App`, `AppContext`, `useApp`, contract types);
  components remain reached via `src/ui/components/index.js`.
- `src/ui/screens/{Encyclopedia,Shipyard,ShareImport}.tsx` + `screens/index.ts`
  — placeholder bodies (D-PLACEHOLDER); S04/S05/S06 replace bodies, keep export
  names. `.tsx` compiles here because the **app** tsconfig sets `jsx:react-jsx`
  + `jsxImportSource:preact`; keep screen unit tests at the `<screen>/model.ts`
  layer so `tsconfig.node` never pulls a `.tsx` into its graph.
- Shell `data-testid` convention (reuse in screens): `app-shell`, `app-main`,
  `session-mode-banner`, `toast-host`, `screen-{encyclopedia,shipyard,share}`,
  `share-token`, `shipyard-build-id`, `nav-{shipyard,encyclopedia}`.

<!-- SESSION-01 (tactical-skirmish) — match contract + routes + outlet/provider -->
## tactical-skirmish SESSION-01 — M14 match contract (D-MATCH-CONTEXT)

New module `src/ui/matchContext.ts` (ui-owned contract; the VALUE is app-produced, D-IOC-SEAM analog).
`ui` imports `sim`/`ai` **types only**; never `sim/physics` / `sim/rules` / `src/app`.
- `type MatchPhase = 'movement-plan'|'movement-resolve'|'attack-plan'|'attack-resolve'|'complete'`
- `interface BotSpec { readonly tier: BotTier; readonly rngKey: number }`
- `interface MatchSetup { readonly budget: number; readonly playerBuilds: readonly Build[]; readonly botSpecs: readonly BotSpec[] }`
- `interface MatchController` — signals `view`/`phase`/`turn`/`movementBeat`/`attackBeat`/`state`/`outcome`/`trace`;
  plain `seedLabel: string` (SK-XXXX-XXXX-XXXX), `playerFleetId: 0`, `initialFleets: readonly SimFleet[]`
  (the sole source of a destroyed ship's name/buildId for post-match fates — `state` holds only survivors,
  `DestructionEvent` carries no identity; stable across `rematch`);
  methods `commitMovement`/`commitAttack`/`resolveAnimationDone`/`hitChanceFor(shooter,target,weaponIndex)`
  (D-HITCHANCE-SEAM, never recompute)/`previewArc(bodyId,deltaV)->{positions,endsOutsideArena}` (D-PREVIEW-SEAM)/`concede`/`rematch({newSeed})`.
- `MatchContext`, `useMatch()` (throws outside provider), `MatchProvider({controller,children})` (authored with createElement, not JSX).

`src/ui/appContext.ts`: `Route` gains payload-less `skirmish-setup`/`tactical-move`/`tactical-attack`/`post-match`;
`AppServices` gains `activeMatch: ReadonlySignal<MatchController|null>` + `startMatch(setup): MatchController`.

`src/ui/App.tsx`: outlet renders SkirmishSetup plainly; the three in-match routes share one `<MatchRouteShell>`
(MatchProvider + persistent match-chrome + inner screen) so provider + CONCEDE survive move<->attack without re-mount;
no active match => redirect to skirmish-setup; switch on Route.name stays exhaustive (no default). CONCEDE lives ONCE
in shell chrome (`data-testid=concede-btn`, confirm Modal), hidden at phase 'complete'. Barrels: `ui/index` re-exports
useMatch/MatchProvider/types; `screens/index` exports the 4 screens (D-PLACEHOLDER roots
`screen-{skirmish-setup,tactical-move,tactical-attack,post-match}`).

(App-side value producer + phase->route navigation contract: see M16-app.md, same SESSION-01 marker.)

<!-- SESSION-02 (skirmish-tactical-parity) — shared roster + inspector -->
## M14 UI — Shared roster + inspector (skirmish-tactical-parity SESSION-02)

New isolated subdirectory `src/ui/components/roster/`. Barrel
`src/ui/components/roster/index.ts` — the surface both tactical screens
(S03 move, S04 attack) read from. Explicit re-exports (M14 barrel
convention: `export *` is rejected under `verbatimModuleSyntax` when the
underlying file mixes value + type exports).

### Load-bearing invariants

- **Sim types only.** No `sim/physics` / `sim/rules` value import; every
  sim symbol is `import type` — so the ui bundle stays free of sim
  runtime (the D-BOUNDARY rule the ui eslint block already enforces).
- **Pure model + presentational components.** No hooks, no `useEffect` /
  `useRef`, no controller reach — all state (`selectedId`, roster input)
  is a prop. Screens keep selection + focus wiring in their own
  reducer/effects layer (S03 / S04 concern).
- **Never-color-alone.** Every pip carries its label (`W1`, `SHLD`,
  `ENG`, `M1`, `PD1`, `DECOY1` …) AND an `aria-label` naming its state
  (`W1 destroyed`); every fleet header carries the `FleetGlyph` (glyph +
  text + color). A colorblind player loses zero information — the
  FR-13 / NFR-A11y defense line already established for `identity.ts`
  extends here unchanged.
- **Design-token classes only.** No token literal is hardcoded; every
  class name (`row`, `row.is-selected`, `row.is-dead`, `panel`,
  `panel-hd`, `panel-in`, `pip-on` / `pip-off`, `pips`, `meter`,
  `t-h1` / `t-h2` / `t-label` / `mono-xs`, `c-*`, `grow`, `sr-only`,
  `glyph.fl-N`) already lives in `src/ui/styles/**` (S01); no mock-only
  variant (`.side-hd`, `.row-ship`, `.fleet-hd`, `.grp-hd`) is
  reintroduced (recorded S05 / S06 lesson).

### Exported surface (barrel)

**Model** — three-free, node-testable pure functions + shapes:

- `groupByFleet(ships: readonly BlindShipView[], playerFleetId: number): FleetGroup[]`
  — deterministic ordering: player fleet first, then bots ascending by
  `fleetId`; entries within a fleet ascending by `bodyId` (mirrors the
  `BlindMatchView.ships` sim-side sort — never `Object.keys` /
  insertion order / `Set` iteration).
- `pipsFor(ship: BlindShipView): ShipPip[]` — binary
  (`online` / `destroyed`) per subsystem; stable emission order
  `weapons → shield → missiles → pd → decoys → engine`; labels are
  index-based (`W1`, `SHLD`, `M2`, `PD1`, `DECOY1`, `ENG`) because the
  sim carries no per-component product name (recorded S06 limitation).
- `isAlive(s): boolean` — `s.hull > 0`; destroyed ships stay in the
  roster struck through, not dropped.
- `fleetLabel(fleetId: number): string` — reuses `FLEET_META` (`YOU`,
  `BOT-0N`) for the canonical ids 0..4, `FLEET N` fallback for higher
  ids. Kept public so screens rendering non-roster fleet chrome name
  fleets identically.
- Types: `FleetGroup`, `RosterEntry`, `ShipPip`, `PipKind`, `PipState`.

**Components**:

- `FleetRoster({ groups, selectedId, onSelect, annotate?, aria-label? })`
  — the all-fleets roster panel. Living rows are `<button>` with
  `aria-pressed`; destroyed rows are non-interactive `<div class="row
  is-dead">`. `data-testid`s the S03 / S04 screens + e2e assert on:
  `fleet-roster` (the `<aside>`), `fleet-group` + `data-fleet-role`
  (each `<section>`), `roster-ship` / `roster-ship-dead` (each row,
  with `data-ship-id` + `data-fleet-id`), `ship-pips`, `ship-pip`
  (each pip).
- `ShipInspector({ ship, velocity? })` — read-only detail for the
  selected ship (any fleet). `ship: null` renders a
  `data-testid="inspector-empty"` "SELECT A SHIP" quiet state.
  Populated state emits `data-testid="ship-inspector"` +
  `data-ship-id`, and one `inspector-pip` per weapon / missile / pd /
  decoy / core row with `data-pip-state`. When `velocity` is provided,
  a speed magnitude row is rendered (deterministic-free `Math.sqrt` —
  ui is outside the sim ban-list).

### Type-shape notes for consumers (S03 / S04)

- `FleetRoster` props: `groups` come from `groupByFleet(view.ships,
  controller.playerFleetId)`; `selectedId` is the screen's own
  selection signal; `onSelect(bodyId)` should call the render seam's
  `focusBody(id)` (S01) plus set the screen's selection state.
  `annotate(entry)` is the per-screen slot — the movement screen paints
  a plan status badge on `entry.fleetId === playerFleetId` rows
  (`PLANNED ✓` / `COAST ✓` / `● UNPLANNED` / `✕ EXIT ARC`); the attack
  screen paints fire-plan / target / AoE context.
- `ShipInspector.ship` is a `BlindShipView | null` — the screen looks up
  the selected view by id (`view.ships.find((s) => s.bodyId ===
  selectedId) ?? null`). `velocity` is optional; when the screen wants
  a speed readout, it derives the world-space velocity from
  `state.bodies` and passes the `{x,y,z}` triple through.

### Testing

Node-only tests target `model.ts` (`tests/unit/ui/components/roster/
model.test.ts`, 14 assertions): grouping order (player-first, bots
ascending), entries by bodyId, destroyed ship stays with `alive:false`,
pip label + stable order, `fleetLabel` reuse of `FLEET_META`. The `.tsx`
components are exercised by the S03 / S04 e2e (visual + accessibility).
The barrel imports a `.tsx` file; tests avoid pulling the barrel and
instead import `./model.js` directly, so `tsconfig.node.json`'s no-JSX
graph is not disturbed (matches the `screens/postMatch/model.ts`
precedent).

<!-- SESSION-06 · playtest-feedback-01 · M14 public-API delta -->

### M14 (ui) — components barrel · additions

`src/ui/components/index.ts` gains two new public entries from files added
this session. Both are stateless (no `preact/hooks` imports) and follow the
existing `h()`-factory authoring pattern — `verbatimModuleSyntax`-safe
`export { ... }` / `export type { ... }` re-exports (no `export *`).

- `InfoTip(props: InfoTipProps): VNode` — CSS-revealed info-tooltip primitive
  (source: `src/ui/components/tooltip.ts`). Trigger is a real focusable
  `<button type="button">` carrying `aria-describedby={id}`; the popup is a
  `<span id role="tooltip" class="tip-pop">`. Reveal is CSS-only —
  `.tip:hover .tip-pop` + `.tip:focus-within .tip-pop` — so the component
  works keyboard-first without JS state. The M14 no-hooks contract is
  preserved by construction.
- `InfoTipProps` — `{ readonly id: string; readonly label: string;
  readonly class?: string; readonly children?: ComponentChildren; }`.
- `GLOSSARY: Record<GlossaryKey, string>` — plain-language definitions for
  every `DerivedStats` field the Shipyard renders, plus `expectedDpt` and
  `weaponSpec` for the PER-WEAPON sub-table (source:
  `src/ui/components/glossary.ts`). Copy is grounded in
  `src/domain/derivedStats.ts` so a rename over there surfaces here as a
  stale key.
- `GlossaryKey` — union of the eleven definition keys.

CSS delta: `src/ui/styles/components.css` appends a `19. INFOTIP` section
(`.tip`, `.tip-dot`, `.tip-pop`) — additive-only, all values sourced from
existing tokens; no existing rule is edited and no token is redefined. `.tip-pop`
uses `z-index: 40`, below the existing `.scrim` (100) / `.modal` (101) layer.

First consumer: `src/ui/screens/shipyard/StatsPanel.tsx` — every derived-stat
row and the PER-WEAPON header now carries an `InfoTip` sourced from
`GLOSSARY`. Screens outside the Shipyard remain unchanged this session
(follow-ups: Skirmish setup, Tactical Attack hit-chance breakdown,
Encyclopedia storage rail — each is that screen's own future lease).

Dependency direction: unchanged. Components import from `preact` only.

<!-- SESSION-04 · playtest-feedback-02 · M14 in-match UI delta -->

## M14 UI — playtest-feedback-02 · SESSION-04 delta

### New public component

`src/ui/screens/tacticalAttack/CombatLogPanel.tsx` — compact in-match
combat-log strip mounted below the tactical attack viewport during
`attack-plan` AND `attack-resolve`. Renders TEXT NODES only (§4.9). Props:

```ts
export interface CombatLogPanelProps {
  readonly rows: readonly LogRow[];            // from postMatch/model
  readonly nameOf: (id: BodyId) => string;
  readonly turnLabel: string;                  // e.g. "TURN 4"
}
```

Reuses the existing `LogRow`/`logKindOf` types + the `.log` / `.log-line` /
`.is-kill` / `.is-crit` classes from `components.css §12 COMBAT LOG` —
zero new tokens. Row shape mirrors the post-match `LogLine` verbatim so
the strip and the FULL COMBAT LOG (§4.11) read the same across phases.

### New pure selector

`src/ui/screens/tacticalAttack/model.ts` — appended:

```ts
export const liveLogRows = (
  trace: ResolutionTrace,
  currentTurn: number,
): readonly LogRow[]
```

Filters `flattenCombatLog(trace)` to the current turn, reverses to
newest-first, returns. **D-LOG-SURFACE-ONLY** — no `sim/trace` change,
no new `MatchController` field: the panel reads what the trace already
carries (arch §6.2). Blind-commit invariant preserved: `trace`
accumulates only after a beat resolves; pending plans never reach the
strip. Node-only import (`.ts` sibling of the JSX panel).

### New load-bearing CSS classes

`src/ui/styles/components.css` — appended §20 (in-match shell frame,
gated at `@media (min-width: 1024px)` — the DesktopGate breakpoint):

- `.app-shell` — `height:100vh; display:flex; flex-direction:column;
  overflow:hidden`. The whole shell becomes a fixed 100vh flex column so
  the tactical viewport can no longer drift with page scroll.
- `.app-main` — `flex:1 1 auto; min-height:0; overflow-y:auto`. Default
  behaviour: non-tactical screens (Encyclopedia, Shipyard, PostMatch)
  keep natural page flow and scroll THE MAIN AREA when their content
  exceeds the frame.
- `.app-main.is-fixed-frame` — `overflow:hidden; display:flex;
  flex-direction:column`. Applied by `App.tsx` on tactical routes only
  (`tactical-move`, `tactical-attack`). Under this class the middle
  never scrolls; side panels + bench regions own their own scroll.

Tactical screens' scoped `<style>` tags carry the column-level rules
(`.ta-shell` / `.ta-layout` / `.ta-col-l` / `.ta-col-r` /
`.ta-roster-scroll` / `.ta-bench-scroll` on `TacticalAttack.tsx`;
`.tm-layout > [data-testid="fleet-roster"]` + `.tm-roster` on
`TacticalMove.tsx`).

**Superseded** (`.ta-bench-scroll` only): `playtest-feedback-05` SESSION-04
CP4 renamed `.ta-bench-scroll` → `.ta-plan-scroll` in-lease (Attack's right
column now wraps inspector + bench + combat-log in ONE scroll, matching the
Move screen's pattern from the same feature). Scoped-style discipline
unchanged; every other class named here still holds.

### Cross-screen import

`tacticalAttack/model.ts` + `TacticalAttack.tsx` now import from the
sibling `../postMatch/model.js` — `flattenCombatLog` / `LogRow` /
`nameByBodyId`. Both directories live in `src/ui/screens/` (M14); no
module-boundary lint change. Motivation: `postMatch/model.ts` is the
canonical `ResolutionTrace → LogRow[]` derivation and there is no
architectural gain to duplicating it under `tacticalAttack/`.

<!-- SESSION-03 · playtest-feedback-03 · M14 shipyard delta -->
### M14 (ui) — Shipyard per-item info copy · D-CATALOG-COPY-UI-SIDE

New screen-local module `src/ui/screens/shipyard/catalogInfo.ts` — the
Shipyard's "why should I pick this?" copy for every catalog item, keyed
by catalog id. UI-local: NOT re-exported from `src/ui/components/index.ts`
and NOT read by any screen outside the Shipyard. Extends the same
precedent `src/ui/components/glossary.ts` set for derived-stat definitions
(SESSION-06 playtest-feedback-01) — reference copy iterates while the
catalog schema (FR-1 additive-only, hash-locked) does not, so item text
lives in the UI, not in `catalog/**`.

Public surface:

```ts
export const CATALOG_INFO: Record<string, string>;
export const DIFF_TAG: Record<string, string>;
export const infoFor:   (id: string) => string | undefined;
export const diffTagFor:(id: string) => string | undefined;
```

- `CATALOG_INFO` — one-sentence blurb per id; covers all 26 v1 components
  + all 12 v1 chassis. Rendered as an `InfoTip` label (text node only,
  XSS-safe).
- `DIFF_TAG` — per-COMPONENT differentiator phrase (e.g. `ALPHA STRIKE`,
  `HIGH REGEN`, `MAX THRUST`), rendered as a `.chip` next to the row name
  so items read apart without relying on the shared `SlotTag` glyph
  (never-color-alone, design §1.1). Chassis rows deliberately have NO
  tag — the class glyph (F/G/C/D) + hull/mass/evasion + cost is already
  enough per-row differentiation.

Coverage is drift-safe: `tests/unit/ui/shipyard/catalogInfo.test.ts`
loads the real catalog and proves (a) every live id has a non-empty
blurb, (b) no orphan `CATALOG_INFO` keys, (c) every component id has a
`DIFF_TAG`, (d) no chassis / orphan `DIFF_TAG` keys.

### M14 (ui) — Shipyard picker rows: `<button>` → `<div role="button">`

`ComponentPicker.tsx` and `ChassisPicker.tsx` row elements changed from
`<button type="button">` to `<div role="button" tabIndex={0}>` so the
InfoTip's own focusable `<button class="tip-dot">` can nest inside as
valid HTML (nested `<button>` elements are illegal). Keyboard semantics
preserved: `Enter` / `Space` fire `onPick`. `ComponentPicker` maps the
prior `disabled={targetBay === null}` to
`aria-disabled` + `tabIndex={-1}` + no click / keydown handlers, so a
picker row drops out of tab order until a bay is selected — mirroring
the button-disabled behaviour byte-for-byte. This matches the existing
SlotBench precedent (its clear-bay `<button>` already sits inside a
`role="button"` div). Tip clicks are wrapped in a `stopPropagation`
`<span>` so a hit on the `ⓘ` glyph never bubbles up to `onPick`;
the CSS-driven reveal (`:hover` / `:focus-within`) is untouched.

Dependency direction: unchanged. `catalogInfo.ts` imports nothing from
outside `src/ui/screens/shipyard/**`; the pickers import `InfoTip` from
the components barrel READ-ONLY (no barrel edit — SESSION-01 concurrency).
No `components.css` edit. No `catalog/**` edit (FR-1 additive-only).

<!-- SESSION-02 · playtest-feedback-03 · M14 tactical-move delta -->
### M14 (ui) — TacticalMove default-plan semantics + persistent combat log

Two additive notes from `playtest-feedback-03` SESSION-02. Neither adds nor
removes a public export; both are behaviour clarifications the roster + gate
readouts now depend on.

- **`D-COMMIT-DEFAULT-COAST`** — `src/ui/screens/tacticalMove/model.ts`
  `initialDraft` now seeds every LIVING ship on `PlanStatus = 'coast'`
  (previously only engine-dead ships were seeded coast; living ships were
  `unplanned`). This flips `fleetGateStatus.canCommit` to `true` on turn
  entry — the fleet may commit without touching a single control ("commit
  without changing any values", owner playtest FB3a). Semantics chain:
  * `coast` still means "no thrust — keep current velocity" (Newtonian). A
    committed coast draft still emits an all-zero segment burn list from
    `waypointBurnsFor`, so `sim/physics` sees the same shape as before —
    the plan-side default alone changed, not the resolver contract.
  * Any `plotWaypoint` edit (bearing / pitch / magnitude) still flips the
    draft to `planned` via the existing transition, so intentional arcs
    override the default with no new opt-out control.
  * The FleetRoster plan-status badge (`planBadgeFor`) reads `COAST ✓` on
    entry for every living player ship (never `● UNPLANNED` in the fresh
    state); FR-13 never-color-alone contract holds — the text + token
    class are unchanged.
  * Blind-commit invariant (FR-17) untouched: no new field, no new sim
    contact, no opponent-plan surface.

- **Persistent combat log strip** — `src/ui/screens/TacticalMove.tsx` mounts
  the shared `CombatLogPanel` (owned in `screens/tacticalAttack/`) in the
  right `.tm-plan` column between the scrolling plan body and `CommitBar`,
  visible in BOTH `movement-plan` AND `movement-resolve`. Same
  D-LOG-SURFACE-ONLY seam the Attack screen uses (playtest-feedback-02 · S04
  delta): reads `liveLogRows(match.trace.value, match.turn.value)` +
  `nameByBodyId(match.initialFleets)`; no `MatchController` field added, no
  `sim/trace` change, no `postMatch/model` API surface change. The new slot
  wrapper `.tm-log-slot { flex: none; padding: 0 var(--s3) var(--s3); }`
  lives in the file-scoped `TM_STYLES` block — never in
  `styles/components.css`, never in `styles/tokens.css` — so the fixed-frame
  100vh contract (playtest-feedback-02 · S04 CP1) is preserved: viewport +
  plotter keep their space, the panel's own `.log` body owns internal
  scroll (`max-height: 132px`).

Dependency direction unchanged: `ui` reads `sim` types only via `matchContext`
+ the sim barrel; no new module-boundary edge. The cross-screen sibling read
(`screens/tacticalMove → screens/tacticalAttack`,
`screens/tacticalMove → screens/postMatch`) mirrors the existing
`screens/tacticalAttack → screens/postMatch` seam and stays within M14.

<!-- SESSION-01 · playtest-feedback-04 · M14 tactical-attack delta -->
## M14 UI — tactical-attack model · public-selector additions (SESSION-01 · playtest-feedback-04)

Two new pure selectors added to `src/ui/screens/tacticalAttack/model.ts`'s
public surface. Both are node-testable (no `.tsx` reach); both preserve the
`ui ↛ sim/physics|sim/rules` boundary — sim types only, via existing
`../postMatch/model.js` re-exports.

### `weaponOutOfRange(view, shooterId, weaponIndex, targetId): boolean`

True when the chosen target sits BEYOND the shooter's weapon range — the
resolver in `sim/rules/attack.ts` refuses that shot outright
(`if (range > weapon.range) continue;`), so the bench must announce it as
OUT OF RANGE instead of the (now-honest) 0% published by `hitChanceFor`.

- A range **comparison** (`mathx.distance` vs `weapon.range`), NOT a to-hit
  number — architecture §13.3 single-source rule intact (a gate, not a
  second formula; formula still lives once in `sim/rules` per D-HITCHANCE
  in `arch/M09-rules.md`).
- Missile slots → `false` (no line-of-sight envelope; AoE is a separate channel).
- Missing shooter view / missing body / unknown weapon index → `false`.
- Strict `>` — mirrors the resolver: distance === weapon.range still fires.

Paired app-side gate: see `arch/M16-app.md` SESSION-01 · playtest-feedback-04
— the same out-of-range refusal now also appears in `hitChanceFor`'s
`{ final: 0 }`, so the bench's OUT OF RANGE and the `%` reader agree.

### `lastResolvedLogRows(trace): { rows: readonly LogRow[]; turn: number | null }`

The newest fully-resolved turn's log rows (newest-first) + its turn number.
`{ rows: [], turn: null }` before any turn has resolved. Consumed by
SESSION-02 on the Move screen — this signature is that session's contract.

- Reads `trace.turns[trace.turns.length - 1]` (turns are pushed ascending
  per FR-28; never re-sort).
- Rows flatten via the canonical `flattenCombatLog` walk (movement then
  attack) then reverse to newest-first.
- Blind-commit intact: the trace only accumulates resolved beats.
- Rationale: the trace batches a turn at turn-end
  (`controller.ts::driveTurn`), so during any player-facing phase of turn N
  the newest resolved turn is N−1 — a `currentTurn` filter (see legacy
  `liveLogRows`) reads empty the whole time. Surface what actually
  happened, not what is still being planned.

**Supersedes** the `liveLogRows(trace, currentTurn)` selector introduced by
playtest-feedback-02 · SESSION-04 (earlier in this file). `liveLogRows` was
LEFT exported at S01's request as an atomic swap point for SESSION-02, then
consumed there.

**Prune landed:** `playtest-feedback-05` SESSION-04 CP4 removed the dead
`liveLogRows` selector from `src/ui/screens/tacticalAttack/model.ts` along
with its 5-test block in `tests/unit/ui/tacticalAttack/combatLog.test.ts`.
The cross-screen `tests/unit/ui/inMatchLayout.test.ts` reference was
resolved in the same feature by SESSION-01 (D-LAYOUT-TEST-DECOUPLE — the
shared, unowned test now covers the shell frame only and no longer
literal-locks per-screen source strings). `lastResolvedLogRows` is the
sole log-surface selector as of this feature's landing; Move (SESSION-03)
already reads only it.

### D-INFOTIP-TOPLAYER — InfoTip escape-clip (SESSION-03 · playtest-feedback-04)

Design-decision reconciliation for the SESSION-06 · playtest-feedback-01
InfoTip fragment earlier in this file. **`InfoTipProps` and the `InfoTip`
signature are unchanged** — this is a CSS-internal fix inside
`src/ui/styles/components.css` §19 that all current and future consumers
inherit at once, so no new arch fragment was declared. Noted here only so
future readers of §19 don't try to reconcile the SESSION-06 "additive-only,
no existing rule is edited" claim (true at S06 landing) against the current
source.

- `.tip-pop` is now `position: fixed` — escapes any ancestor `overflow`
  clip (the Shipyard's `.col-scroll` was the trigger case). `z-index: 40`
  is unchanged; still below the modal-scrim (100) / modal (101) layer.
- Adjacency uses CSS Anchor Positioning: `anchor-name: --tip-anchor` on
  `.tip-dot`, `position-anchor: --tip-anchor` on `.tip-pop`,
  `anchor-scope: --tip-anchor` on `.tip` so per-page duplicate `.tip-dot`
  elements don't race to the first one in tree order.
- Position-try-fallbacks provide auto-flip near viewport edges; degraded
  browsers without anchor-positioning support fall through to a legible
  static position (never hidden — NFR-A11y intent preserved).
- Vnode shape unchanged. Hooks-free. Component tests untouched.

<!-- SESSION-03 + SESSION-04 · playtest-feedback-05 · M14 tactical-screen delta -->
## M14 UI — tactical-screen delta (SESSION-03 + SESSION-04 · playtest-feedback-05)

Two screen sessions (S03 Move, S04 Attack) ran concurrently after S01
decoupled the shared literal-locking `inMatchLayout.test.ts`
(D-LAYOUT-TEST-DECOUPLE — the S01 handoff, Final Report §Verification, and
the pf-04 · cycle 3 ROSHI-LOG proposal that framed the fix). Jikijitsu
stapled no arch commit for either — both fit inside the existing M14
surface — but the reconciliation below captures four items the Final
Report explicitly names under `Architecture impact` so a future reader
does not have to re-derive them from handoff notes.

### New pure model helpers (public, node-only, three-free)

- **`velocityReadout(v: Vec3 | null): VelocityReadout | null`** —
  `src/ui/screens/tacticalMove/model.ts`. Returns
  `{ speed, bearing, pitch }` from a world-space velocity triple; renders
  the plotter's `VEL {n} m/s · BEARING {bbb} / {±p}°` line + a Newtonian
  one-liner. Uses `Math.sqrt` + `sim/mathx.atan2` — the arithmetic-only
  polynomial approximation `sim/mathx` already exports (`sim/**` ban-list
  scoped, `ui` outside it, no transcendental import in ui). Zero-vector →
  `{0,0,0}`. **No new sim math; no new sim field.** The existing VX/VY/VZ
  triple is preserved as a dim companion line.
- **`hitChanceBarFill(final: number): 'ok' | 'dv' | 'hot'`** —
  `src/ui/screens/tacticalAttack/model.ts`. Presentation transform of
  `HitChanceBreakdown.final` for the ship-by-ship bench's `<Meter>` bar.
  Thresholds **mirror `hitChanceTone` verbatim** — a 66% shot reads
  green in BOTH channels. **D-HITCHANCE-SEAM intact / architecture §13.3
  intact:** the to-hit formula still lives once in `sim/rules/damage.ts`
  and reaches the UI only through `MatchController.hitChanceFor`
  (`arch/M09-rules.md`, `arch/M16-app.md` pf-04 fragment); this helper
  never recomputes a `%`.

### D-IMMERSIVE-GRID-COLLAPSE — in-frame full-field mode (both screens)

Both tactical screens grew a `FULL FIELD` / `RESTORE` toggle on
`CameraHud` that flips a screen-local `fullscreen` signal, which adds
`.is-immersive` to the outer shell (`.tm-shell.is-immersive` /
`.ta-shell.is-immersive`). The `.is-immersive` rules collapse the
screen's grid to the tactical stage and hide the side panels + plan
scroll + CommitBar; the header (with the RESTORE button) stays
visible. Esc restores.

- **Scoped to each screen's `<style>` block** (`TM_STYLES` / `TA_STYLES`);
  no `styles/components.css` edit, no `styles/tokens.css` edit — the
  scoped-style discipline that keeps Move ∥ Attack disjoint (recorded
  pf-02 / pf-03 / pf-04) holds.
- **Bounded by the fixed frame.** The pf-02 SESSION-04 `.app-main.is-fixed-frame`
  contract (§20 above) is the outer container the collapse lives inside;
  immersive mode is NOT a `position: fixed` escape.
- **No browser Fullscreen API dependency.** In-app immersive maximize
  keeps the mode testable (unit + e2e) and portable. If the owner ever
  asks for OS-level `requestFullscreen()`, it can layer over the current
  toggle without unwinding this pattern (Open Question §3 in the
  feature's STATE.md).
- **A11y:** the toggle button is a real `<button aria-pressed>` with a
  text label (`FULL FIELD` / `RESTORE`) plus the `⤢` / `⤡` glyph
  (never-color-alone / FR-13).

### D-COMMIT-PER-SCREEN-REF — CommitBar position, contained + pinned

Both screens keep the CommitBar **inside its right panel** and **pinned**
(never a full-page-width bottom bar) — a hardening of the pf-02
SESSION-04 §20 `.app-main.is-fixed-frame` contract into per-screen
scoped classes. Vertical position differs by owner reference and is
deliberate:

- **Move (SESSION-03):** CommitBar mounted at the **top** of the right
  panel (owner note: "if you pin commit movement, it should be at the
  top of the panel"). `.tm-plan-scroll` wraps inspector + plotter +
  combat-log below it. Nested `.log` internal scroll neutralised via a
  scoped descendant override — never a `components.css` edit.
- **Attack (SESSION-04):** CommitBar at the **bottom** of the right
  column, contained by `.panel-ft { flex: none }` in `.ta-col-r`
  (endorsed mock, screenshot 7). `.ta-plan-scroll` (renamed from
  `.ta-bench-scroll` in the same session — see pf-02 · SESSION-04
  supersession note above) wraps the ship-by-ship bench above it.

Each screen was built to its own endorsed reference rather than guessing
a global rule; the owner may confirm consistency (Open Question §2 in
the feature's STATE.md).

### Ship-by-ship bench parity (Attack)

`.ta-ship-group` + `.ta-card` treatment with left-border modifiers
(`is-set` / `is-msl` / `is-oor`) landed in `TA_STYLES` only. Each row
shows an absolute `RANGE {d} / {r}` readout + a hit-chance `<Meter>` bar
sourced from `MatchController.hitChanceFor().breakdown.final` via the new
`hitChanceBarFill` helper above (no to-hit math added to the UI). OUT
OF RANGE is announced by the existing `weaponOutOfRange` predicate
(pf-04 SESSION-01 fragment above), with the shooter/target range
comparison that matches `sim/rules/attack.ts`'s strict `>`.

**Superseded:** `tactical-attack-mock-parity` SESSION-03 (fragment further
down this file) replaces the ship-by-ship bench and its single-scroll
right-column plan wrap (`.ta-plan-scroll` around inspector + bench + log)
with **D-TA-RAIL-SHOOTER** — a literal three-column frame whose right rail
renders exactly ONE active player shooter. `.ta-ship-group` and
`.ta-plan-scroll` no longer appear in `src/` (grep-verified); the
`.ta-card` weapon-card treatment (`is-set` / `is-msl` / `is-oor`) survives
verbatim as per-slot cards INSIDE the rail. The combat log stays under the
center column only (D-TA-NO-BOTTOM-PLAN — unchanged from pf-02 for Attack).
`hitChanceBarFill` / `weaponOutOfRange` / `MatchController.hitChanceFor`
single-sourcing all still hold. A reader who lands here for a per-shooter
row layout should read the SESSION-03 delta for the current one.

### Cross-screen READ contract preserved

`src/ui/screens/tacticalMove/**` continues to read `lastResolvedLogRows`
+ `CombatLogPanel` + `nameByBodyId` from `src/ui/screens/tacticalAttack/**`
and `src/ui/screens/postMatch/**`. Signatures of those cross-screen
imports were **not** changed by either SESSION-03 or SESSION-04; the
Wave-2 concurrency contract (a stability contract, not a serialization
— see pf-05 STATE.md) held cleanly.

### Not touched

`src/sim/**`, `src/sim/trace/**`, `src/sim/rules/**`,
`src/ui/styles/components.css`, `src/ui/styles/tokens.css`,
`src/ui/components/**`, `src/ui/components/roster/**`,
`MatchController` signatures. All new CSS lives inside `TM_STYLES` /
`TA_STYLES`; all new pure helpers live inside each screen's own
`model.ts`. The Module Registry `M14` `Key Files` column
(`screens/*, components/*, tokens.css`) still describes the surface
faithfully — no drift signal.

<!-- SESSION-03 · tactical-attack-mock-parity · M14 tactical-attack rebuild delta -->
## M14 UI — tactical-attack rebuild delta (SESSION-03 · tactical-attack-mock-parity)

Jikijitsu stapled no M14 arch commit for this session (the M05/M06 identity
seam and the M13 label/range primitives landed as their own fragments in
`arch/M05-domain.md`, `arch/M06-physics.md`, and `arch/M13-render.md`, and
the Attack screen work fit inside the existing M14 surface). The Final
Report's §Architecture impact §M14 UI item and the §Design decisions block
in `prompts/tactical-attack-mock-parity/STATE.md` name the load-bearing
contracts explicitly, so this reconciliation captures them in-place — the
same discipline pf-05 cycle-4 applied when Jikijitsu stapled no M14 fragment
for the concurrent Move+Attack shell work.

### New file (in-lease)

`src/ui/screens/tacticalAttack/FieldOverlay.tsx` — SVG overlay layer mounted
above the tactical `Viewport`, `pointer-events:none` so it never steals
canvas or roster clicks. Consumes projected screen coordinates from
`TacticalView.worldToScreen` (M13 seam already exposed since pf-01) plus
the field-solution / range / AoE data the new model selectors surface.
Decorative overlay SVG is `aria-hidden`; state cues (assignment, out of
range, friendly-in-AoE) are conveyed as text pills alongside colour, per
the never-color-alone contract §M14 already carried.

### New pure model selectors (public, node-only, three-free)

Additive to `src/ui/screens/tacticalAttack/model.ts` — no existing
selector renamed or retyped, blind-commit intact (all read the local
player's `BlindMatchView` + own staged assignments only):

- **`activeShooterOf(shooters, id)`** — validates the screen-local
  `activeShooterId` signal against the current live-shooter list each
  render, and falls back to the lowest-body-ID living player ship when
  the prior shooter has disappeared (roster-clicked enemy or wreck ⇒
  focus/inspection changes, active shooter does not; see D-TA-RAIL-SHOOTER
  below). Node-only import shape (Attack screen wires `useSignal<BodyId|null>`).
- **`liveFireSlots(shooter)`** — the ordered set of launchable weapon
  and missile slots the rail renders as cards. Static mock has five
  cards; production returns four when the rail should not paint spent or
  empty racks — this is the sole intentional gap between mock and
  production and is called out under Residual gap §4 of the Final Report
  (a slot-eligibility rule change, not a visual parity gap; blocked on
  design intent, not on this session).
- **Range-preview / fire-solution / AoE / projection selectors** — pure
  functions of `(view, activeShooterId, stagedAssignments)` used by
  `FieldOverlay.tsx` to render every weapon envelope, firing-solution
  line, midpoint pill, and AoE ring for the active shooter without a
  React `useEffect` (no Preact hooks, per the M14 stateless model rule
  established in S02). Each selector reads through
  `MatchController.hitChanceFor(...).final` for percentage pills and
  through the M13 seam for screen projection; no gameplay formula or
  render integrator is added at the UI layer.

### D-TA-RAIL-SHOOTER — one active shooter in the right rail

The right fire rail renders exactly ONE active player shooter, not every
shooter fleet-wide. Screen-local `activeShooterId` signal governs which
ship's `liveFireSlots` fill the rail. Behaviour rules (verbatim from
Final Report §Active-shooter behavior):

- Active shooter and focused/inspected body are distinct signals.
- On entry (or when the prior shooter disappears), the lowest-body-ID
  living player ship becomes active. `activeShooterOf` validates each render.
- Clicking a living player ship in the roster or canvas changes BOTH
  focus and active shooter.
- Clicking an enemy or wreck changes inspection/focus only; the last
  valid player shooter remains active.
- Assignments are keyed fleet-wide by shooter+slot, so switching
  shooters does not discard staged plans; commit legality and counts
  remain fleet-wide (blind commit unchanged — staged plans are the
  local player's own; opponent pending plans stay unreachable per §6.3).
- Production cards use authored chassis / weapon / missile / point-defense
  / decoy identity via the M05/M06 SESSION-01 identity seam (`ship.chassis`,
  `weapon.display`, etc.). Synthetic / legacy fixtures retain the
  textual fallbacks the S01 handoff specified
  (`ship.chassis?.name ?? ship.chassisClass.toUpperCase()` and
  `weapon.display?.name ?? 'WEAPON'` etc.), so hand-authored
  deterministic tests keep passing without importing catalog identity.

### D-TA-THREE-COLUMN — literal three-column frame

The Attack screen is three siblings: left all-fleet roster (~288px) /
fluid center tactical stage / right fire rail (~344px). Bounded side
tracks equivalent to `minmax(260px, 288px) / minmax(0, 1fr) /
minmax(320px, 344px)` at both 1920×1080 and 1280×720. This supersedes
the earlier `.ta-plan-scroll` single-right-column stack (pf-05 SESSION-04
above); grep-verified that `.ta-ship-group` and `.ta-plan-scroll` no
longer appear anywhere in `src/`. The fire-card body is the rail's
SOLE vertical scroller — header and commit footer remain fixed within
the rail (contained + pinned, extending the pf-02 SESSION-04 §20
`.app-main.is-fixed-frame` contract).

### D-TA-NO-BOTTOM-PLAN — combat log center-only, no full-width plan

No weapon bench or commit control lives below the tactical field or
spans the page. The combat log stays under the CENTER column only (this
is a hardening for Attack — pf-02 SESSION-04 already mounted the log
below the Attack viewport; the change is that the pf-05 SESSION-04
Attack "single right-column scroll wrapping inspector + bench +
combat-log" pattern is superseded and the right column no longer carries
the log at all). Move is unaffected — its own persistent log strip
under the plan column (pf-03 SESSION-02) still lives in its own scoped
`TM_STYLES` and is not touched by this feature.

### D-TA-WIRE-RANGE + D-TA-LIVE-OVERLAYS + D-TA-HIT-CHANCE-SINGLE-SOURCE

Read together, these keep the render seam honest and the single-source
rule intact:

- Every live weapon on the active shooter emits one line-only range
  envelope (via the M13 SESSION-02 `RangeShell.mesh: Object3D` widening
  — the three-orthogonal-`LineLoop` group under `Group`) plus a DOM
  label; the real harness shows three envelopes. Missile AoE remains a
  separate red/dashed overlay, not a range shell.
- Boundary labels, range labels, firing-solution lines, midpoint
  percentage/status pills, selected-body callout, active missile AoE
  ring + `FRIENDLY IN AoE` warning, fleet/body-class legend, and beat/
  turn HUD all derive from current state and the local player's staged
  assignments. Production JSX contains no hardcoded ship, distance, or
  percentage from the mock (verified against the browser harness which
  pins distinct controller-derived values 68% / 41% / 77%).
- Percentage pills and rail meters format only `hitChanceFor(...).final`
  (D-HITCHANCE-SEAM / D-HITCHANCE / architecture §13.3 — unchanged). Out
  of range and missile lines show explicit non-percent states via the
  `weaponOutOfRange` predicate from pf-04 SESSION-01. No competing
  formula added at the UI layer.

### D-TA-VISUAL-GATE + D-TA-NO-DEFERRED-BROWSER — M19 gate rules

Test-shape decisions this session codified explicitly (see
`arch/M17-harness.md` peers for the physics/combat determinism
patterns). Both are per-feature test-gate rules, not framework changes:

- **D-TA-VISUAL-GATE:** completion requires real shipped CSS, real
  M13 rendering (not a render stub), exact bounding-box checks at
  1920×1080 and 1280×720, side-by-side mock review, and a reviewed
  Chromium screenshot baseline. The committed baseline
  `tests/e2e/tacticalAttack.spec.ts-snapshots/attack-plan-1920-chromium-darwin.png`
  is unmasked and passes three consecutive runs at threshold `0.2` +
  `maxDiffPixelRatio: 0.02` for deterministic engine antialiasing.
- **D-TA-NO-DEFERRED-BROWSER:** the e2e/visual gate may not be marked
  done without execution. A missing dev server is a blocker to resolve
  during the session, not a permissible "deferred verification" note.
  This session's Mu→Enso delegation ran the browser gate 14/14 pass,
  three stable runs, in-lease.

### Not touched

`src/sim/**`, `src/sim/trace/**`, `src/sim/rules/**`, `src/ai/**`,
`src/ui/styles/components.css`, `src/ui/styles/tokens.css`,
`src/ui/components/**`, `src/ui/components/roster/**`,
`src/ui/matchContext.ts`, `MatchController` signatures. All new CSS
scopes live inside the file-scoped `TA_STYLES` block on
`TacticalAttack.tsx`; the new `FieldOverlay.tsx` file lives under
`src/ui/screens/tacticalAttack/` (M14 `screens/*` wildcard — no
Module Registry `Key Files` drift signal). `hitChanceFor(...).final`
remains the sole hit-chance source (architecture §13.3). Blind commit,
deterministic-core boundaries, persistence, catalog schema, share/JSON
wire formats, and migration surfaces are all unchanged.

### Known scoped gaps (from Final Report §Residual gap — informational)

Recorded here so a future reader doesn't re-derive them from the report:

- The committed screenshot baseline is macOS-specific
  (`-chromium-darwin.png`); enabling this assertion on Linux CI needs a
  `-chromium-linux` baseline or an explicit platform scope on the
  screenshot step.
- Very large weapon radii can project a top-edge range label above the
  viewport; overflow clips it safely, and the fleet-zoom live scene
  keeps the current three envelope labels visible.
- The rail reports four launchable fire slots where the static mock
  shows five, because `liveFireSlots` excludes empty/spent racks. No
  visual-parity slot-eligibility rule was invented; if design requires
  empty/spent racks to remain visible in the rail count, Forge should
  plan that behavior as a separate feature.
- `tests/unit/ui/encyclopedia/export.test.ts` still exposes the
  unrelated `TS6142` node-config baseline — outside every lease this
  cycle (see ROSHI-LOG cycle 5).
