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

### Cross-screen import

`tacticalAttack/model.ts` + `TacticalAttack.tsx` now import from the
sibling `../postMatch/model.js` — `flattenCombatLog` / `LogRow` /
`nameByBodyId`. Both directories live in `src/ui/screens/` (M14); no
module-boundary lint change. Motivation: `postMatch/model.ts` is the
canonical `ResolutionTrace → LogRow[]` derivation and there is no
architectural gain to duplicating it under `tacticalAttack/`.
