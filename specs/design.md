# Design Spec — Starship Skirmish

> **Status:** v1 — design phase. Derived from `specs/idea.md` v3 and `specs/requirements.md` v1.
> Covers design language, component inventory, screen inventory, user flows, and the
> interaction rules that carry a locked decision. Mocks live in `mocks/` and are standalone
> HTML — no framework, no build step.
>
> Where this document states a rule, it is tracing a requirement. Requirement IDs are cited
> inline. **Where a visual choice is load-bearing for a requirement, it is marked ⛓ LOAD-BEARING
> and must not be changed without revisiting the requirement.**

---

## 0. The Design Problem

Two products share one shell.

**The Shipyard is a spreadsheet that respects you.** The player came for the argument about
whether a mega destroyer at 88 points beats three frigates. That argument is made of numbers,
so the numbers get the pixels: dense rows, tabular figures, running totals, delta indicators,
no decoration between the player and the trade they are evaluating.

**The Skirmish is a tac display.** Neon abstract geometry on black. The player is a captain
reading a console, not a pilot looking out a window. The abstraction is not a budget
compromise — it is the only way a 3D turn-based fleet battle stays readable, which makes
readability a *functional* requirement (Pillar 6, FR-13).

The two must feel like the same machine. They are unified by one dark console language:
the same monospace, the same hairline borders, the same neon signal palette, the same
corner ticks. The Shipyard is that language at rest. The Skirmish is that language under load.

**Design tension to hold onto:** the aesthetic asks for glitch, flicker, and glow; the
requirements ask for WCAG AA contrast and information never conveyed by animation alone.
These are resolved by making *every* glitch effect decorative and *every* readout static.
Nothing that flickers is the only source of a fact.

---

## 1. Design Language

### 1.1 Color palette

Implemented as CSS custom properties in `mocks/console.css`. That file is the source of truth;
this table is documentation.

**Surfaces** — near-black, cool-shifted. Never pure `#000` except inside the tactical viewport,
where true black buys the neon its glow.

| Token | Value | Use |
|-------|-------|-----|
| `--void` | `#05070A` | Page background |
| `--deep` | `#000205` | Tactical viewport only |
| `--panel` | `#0A0F16` | Primary panel |
| `--panel-hi` | `#101822` | Raised / hover panel |
| `--panel-in` | `#070B11` | Inset well, list rows, fields |
| `--grid` | `#16212E` | Grid lines |
| `--line` | `#1E2C3C` | Borders |
| `--line-hot` | `#2C4155` | Border hover/focus base |

**Ink**

| Token | Value | Use |
|-------|-------|-----|
| `--ink-hi` | `#E8F4FF` | Headings, key numbers |
| `--ink` | `#C7D6E5` | Body text |
| `--ink-dim` | `#6B8299` | Labels, meta |
| `--ink-ghost` | `#33475A` | Disabled, empty-slot placeholder |

**Signal colors** — each has exactly one meaning. Do not reuse them decoratively.

| Token | Value | Meaning |
|-------|-------|---------|
| `--cyan` | `#22E3FF` | **Primary.** Player fleet, primary action, focus, shields |
| `--amber` | `#FFB020` | Caution, `needs-refit`, delta-V spend, unsaved, point cost |
| `--red` | `#FF2E63` | Lethal. Boundary, destruction, missiles, destructive actions |
| `--green` | `#3DFF9E` | Valid, in-budget, hit, committed |

**Fleet identity** — five fleets max (Decision 2). ⛓ LOAD-BEARING for FR-13 / NFR-Accessibility.

| Fleet | Color | Glyph | Label |
|-------|-------|-------|-------|
| 0 | `#22E3FF` cyan | `▲` | YOU |
| 1 | `#FF3D7F` magenta | `●` | BOT-01 |
| 2 | `#FFB020` amber | `■` | BOT-02 |
| 3 | `#A45BFF` violet | `◆` | BOT-03 |
| 4 | `#7CFF4F` lime | `✚` | BOT-04 |

**Body classes** — a ship, a piece of debris, a live missile, and a spent missile must be
distinguishable at a glance (FR-13, FR-24). ⛓ LOAD-BEARING.

| Body | Color | Glyph | State label |
|------|-------|-------|-------------|
| Ship | fleet color | fleet glyph | — |
| Debris | `#FF7A1A` orange | `✳` | `DEBRIS` |
| Missile, tracking | `#FF2E63` red | `➤` | `T2` / `T1` (beats of guidance left) |
| Missile, fuel-out | `#8A6A4F` brown | `◇` | `SPENT · ARMED` |

**The never-color-alone rule.** Fleet ownership, hazard type, and missile state are each
carried by **color + glyph + text label**, always, everywhere — roster, viewport, legend,
combat log, post-match summary. A colorblind player loses zero information. This is not a
courtesy; it is NFR-Accessibility and it is why the glyph set exists.

### 1.2 Typography

| Role | Face | Size / treatment |
|------|------|------------------|
| Display | JetBrains Mono 700 | 28px, `.14em` tracking, uppercase |
| H1 | JetBrains Mono 700 | 18px, `.16em`, uppercase |
| H2 / panel header | JetBrains Mono 700 | 13px, `.18em`, uppercase |
| Label | JetBrains Mono 500 | 10px, `.22em`, uppercase, `--ink-dim` |
| Body / readout | JetBrains Mono 400 | 13px |
| Numeric | JetBrains Mono 700 | 15px, tabular |
| Hero numeric | JetBrains Mono 700 | 34px, tabular |
| Prose | Inter 400 | 13px / 1.65 — explanatory copy only |

Monospace is the default because **columns of numbers must align**. `font-variant-numeric:
tabular-nums` is set globally so a point total doesn't jitter as it changes. Inter appears only
where a sentence needs to be read as a sentence.

All uppercase tracked type is ≥10px and ≥`.12em` tracked — below that, tracked caps stop being
legible. Text scales to 125% without loss of function (NFR-Accessibility): no fixed-height text
containers, no truncation-critical layouts.

### 1.3 Spacing

4px base. Scale: `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`. Row padding is deliberately tight
(`8px 12px`) — this player wants density, and 24 saved builds should be visible without
scrolling.

### 1.4 Corner radius

Effectively square: `1px` / `2px` / `3px`. This is a CRT, not a phone. The only round things
are status dots and chips (fully round pills at 10px), and roundness there *means* "status",
which makes it informative rather than stylistic.

### 1.5 Glow, not shadow

Depth comes from emitted light, not cast shadow — consistent with everything being a display
surface.

| Level | Use |
|-------|-----|
| `--glow-1` | Resting hairline on interactive elements |
| `--glow-2` | Hover, active panel, primary button |
| `--glow-3` | Focus ring, committed state, selected marker |
| `--glow-red` | Boundary danger, destructive confirm |
| `--glow-amber` | Caution, `needs-refit` |

The **corner tick** (`.ticks`) — a 10px L-bracket at opposite corners of a panel — is the
signature frame. Used sparingly: only on panels that carry a decision.

### 1.6 Motion and glitch

Four decorative effects: `flick` (rare opacity dip on readouts), `pulse` (attention), `sweep`
(a scan line crossing the viewport), `glitch-x` (a 2px horizontal tear).

**Every one of them is decorative and every one of them is opt-out.** `prefers-reduced-motion`
disables all animation and removes the scanline overlay. A manual `◐ REDUCED MOTION` toggle
(`body.rm`) sits in every screen's chrome for players who have not set the OS preference.
No information is lost in reduced-motion mode — that is the test any new effect must pass
(NFR-Accessibility).

### 1.7 Layout and platform

Desktop only (NFR-Platform). Minimum 1280×720, designed for 1920×1080. Below 1024px the app
does not attempt a layout — it shows a `DESKTOP REQUIRED` gate, which is degradation, not
breakage.

The dominant pattern is a **three-column console**: a source/list rail, a work surface, and a
state/ledger rail. It appears in the Shipyard (catalog / bench / stats), Skirmish Setup
(library / fleet / opposition), and the Tactical View (roster / viewport / plan). Learning one
screen teaches all three.

Columns scroll independently; the page never scrolls. In a match especially, the frame is
fixed furniture — the player should never lose the commit button.

---

## 2. Component Inventory

All implemented in `mocks/console.css`.

| Component | Class | Description | States |
|-----------|-------|-------------|--------|
| Panel | `.panel` | Primary surface | default, `.ticks`, `.panel-in` inset |
| Panel header | `.panel-hd` | Titled band with gradient | — |
| Button | `.btn` | Action | default, hover, focus-visible, disabled |
| Button — primary | `.btn-primary` | Cyan fill, glow | default, hover, focus, disabled |
| Button — danger | `.btn-danger` | Destructive | default, hover, focus |
| Button — warn | `.btn-warn` | Caution action | default, hover |
| Button — ghost | `.btn-ghost` | Tertiary | default, hover |
| Commit button | `.btn-commit` | Full-width beat commit | ready, disabled/gated, `.is-hostile` |
| Text field | `.field` | Entry | default, focus, disabled, error |
| Select | `select.field` | Dropdown | default, focus, disabled |
| Segmented control | `.seg` | Exclusive choice (budget, difficulty, sort) | default, hover, `aria-pressed` |
| Tabs | `.tabs` / `.tab` | Section switch | default, hover, `.is-active` |
| Checkbox | `.chk` | Multi-select | unchecked, checked, focus |
| Stat row | `.stat` | Key/value readout | default |
| Delta indicator | `.delta` | Change vs previous value | `.delta-up`, `.delta-down`, `.delta-none` |
| Meter | `.meter` | Bar: hull, shield, delta-V, budget, storage | `.f-shield` `.f-hull` `.f-dv` `.f-ok` `.f-hot`, `.meter-notch` |
| Chip | `.chip` | Tag, status, version | neutral, cyan, amber, red, green |
| Slot tag | `.tag-slot` | Slot type letter badge | weapon, shield, missile, engine, special |
| Fleet glyph | `.glyph` + `.fl-0..4` | Fleet identity badge | five fleets |
| Row | `.row` | List item | default, hover, `.is-selected`, `.is-dead` |
| Table | `.tbl` | Dense tabular data | default, row hover |
| Slot bay | `.bay` | Shipyard fitting mount | `.is-filled`, `.is-empty`, `.is-selected`, hover |
| Viewport | `.viewport` | Tactical display surface | — |
| Reference grid | `.viewport-grid` | Perspective depth grid | — |
| Boundary | `.boundary` | Arena kill edge | always visible |
| HUD panel | `.hud` | Floating overlay in viewport | — |
| Marker | `.mk` | Tracked body in space | default, hover, `.is-selected`, with `.mk-stalk` |
| Path | `.path` | Vector trail / predicted arc | default, `.path-ghost`, `.path-hostile` |
| Combat log line | `.log-line` | One resolution event | default, `.is-kill`, `.is-crit` |
| Banner | `.banner` | Persistent inline notice | info, warn (default), danger |
| Toast | `.toast` | Transient confirmation | default, warn, danger |
| Modal | `.modal` + `.scrim` | Blocking decision | — |
| Topbar | `.topbar` / `.nav` | App chrome | nav `.is-active` |
| Desktop gate | `.mobile-gate` | Sub-1024px fallback | — |

### 2.1 Slot type badges

Slot type is never color-only — each carries its letter (FR-4).

| Slot | Letter | Color |
|------|--------|-------|
| Weapon | `W` | `#FF6B4A` |
| Shield | `S` | cyan |
| Missile | `M` | red |
| Engine | `E` | amber |
| Special | `X` | violet |

Slot occupancy renders as filled/empty pips: `W ●●● S ●○ M ●● E ● X ●○`. This lets a build's
entire fit be read in one line inside a list row — essential at 24 saved builds and 500 at the
performance ceiling.

---

## 3. Screen Inventory

| # | Screen | Mock file | Purpose | Key requirements |
|---|--------|-----------|---------|------------------|
| 0 | Prototype index | `mocks/index.html` | Hub: every screen, every state, the flows | — |
| 1 | The Shipyard | `mocks/shipyard.html` | Chassis + fitting + live point total + derived stats | FR-3, FR-4, FR-5, FR-6 |
| 2 | Ship Encyclopedia | `mocks/encyclopedia.html` | Library: browse, filter, tag, duplicate, delete, export | FR-7, FR-9, FR-2 |
| 3 | Share / Import | `mocks/share-import.html` | Import preview from URL token; JSON fleet import; failure states | FR-8, FR-9, FR-2, NFR-Security |
| 4 | Skirmish Setup | `mocks/skirmish-setup.html` | Budget, fleet draft, opponent config, arena, seed | FR-10, FR-11, FR-12, FR-30, FR-31 |
| 5 | Tactical — Movement | `mocks/tactical-move.html` | Blind arc plotting, delta-V, boundary warning, roster | FR-13–16, FR-17, FR-18 |
| 6 | Tactical — Attack | `mocks/tactical-attack.html` | Blind fire assignment, hit chance, called shots, AoE | FR-20, FR-21, FR-25 |
| 7 | Post-match | `mocks/post-match.html` | Outcome, seed, per-ship fate, full combat log | FR-27, FR-28 |

Shared chrome: `mocks/console.css`.

---

## 4. Interaction Rules That Carry a Decision

These are the places where a UI choice *is* the requirement. Each is ⛓ LOAD-BEARING.

### 4.1 The boundary must scream (FR-16, Ruling F, Decision 20)

A ship that leaves the arena dies with no grace period. Lethal and invisible is unfair; lethal
and obvious is tense. Therefore:

1. The boundary is **always rendered** — it never fades, never toggles off, and remains legible
   from any camera angle including from outside looking in.
2. The instant a plotted arc exits, its predicted-path ghost turns **hostile**: solid red,
   glowing, an `✕ EXIT` marker at the crossing point, and a text callout naming the turn of
   death — `PREDICTED EXIT — TURN 5 · SHIP DESTROYED`.
3. Committing a boundary-exiting arc requires an **explicit second confirmation**, and the
   commit button itself turns red (`.btn-commit.is-hostile`).
4. It is **never blocked.** Flying out is a legal choice — including deliberately, to escape a
   worse fate. It just must never be an accident.

Three redundant channels: color, shape/marker, and words. Any one alone is insufficient.

### 4.2 Blind commit must be airtight (Pillar 2, FR-17)

No opponent's committed plan for the current beat is observable — not through the UI, not
through the DOM, not through any channel. Design consequences:

- Every planning screen carries a visible statement of the contract: *"OPPONENT PLANS ARE NOT
  OBSERVABLE UNTIL RESOLUTION."* The player must trust the rule for the tension to work, and
  trust is earned by saying it out loud.
- There is **no timer anywhere.** A planning beat displays `NO TIMER` as a dim label — the
  absence is a feature and gets stated, not merely omitted (Decision 7).
- Commit is a deliberate action: a full-width button, never a hover or drag-release
  (NFR-Accessibility). Commit is final for the beat, and the button says so.

### 4.3 The fleet commit gate (FR-18)

All ships must be planned or explicitly set to coast before the fleet can commit. The plan
panel therefore carries a **per-ship checklist** — `PLANNED ✓` / `COAST ✓` / `● UNPLANNED` —
and the commit button reads its own gate: `COMMIT MOVEMENT · 3/4 PLANNED`, disabled. A
disabled button that doesn't explain itself is a bug.

### 4.4 Leftover points are wasted, loudly (Decision 9, FR-5)

Both the Shipyard and Skirmish Setup state it in plain text: *"Leftover points are wasted.
There is no conversion to initiative, reserves, or rerolls."* No UI affordance anywhere hints
that unspent points might do something. The absence of a mechanism is itself communicated,
because a point-buy player will otherwise spend the session hunting for it.

Corollary: **under-budget fleets can launch, over-budget cannot.** Both states are shown.

### 4.5 Called shots unlock visibly (FR-25, Decision 4)

The signature tactic — *break the shields, then kill the generator* — falls out of the rules
and the UI must teach it in the first match:

- While shields hold, the component target picker is visibly **locked**: `SHIELDS 88/140 —
  HOLDING · CALLED SHOTS LOCKED`.
- At zero shields it **unlocks with emphasis**: `SHIELDS 0/38 — DOWN`, and the component list
  becomes selectable.
- The shield generator entry carries the explanatory hint: *"Killing the generator removes the
  pool permanently. It does not restore depleted shields."*

A destroyed component is struck through and red everywhere it appears — inspector, roster, and
the ship's damage pips — for all ships including the bots', because there is no fog of war
(Decision 6).

### 4.6 Friendly fire warns but never blocks (Decision 13, FR-20)

An AoE assignment overlapping a friendly ship renders the blast radius, highlights the friendly
inside it, and raises a danger banner: *"⚠ HAMMERHEAD AoE (r60) OVERLAPS TIN CAN 3. Friendly
fire is live. This will not be blocked."* Warning without blocking is the whole posture — the
game trusts the player to make a bad trade on purpose.

### 4.7 `needs-refit` is informative, not punitive (FR-2, Ruling A)

A migrated build whose recalculated cost changed is flagged `⚠ NEEDS REFIT` and shows **what
changed and by how much**: `Catalog v5 → v7. Recalculated 148 → 152 PTS. FLUXWEAVE regen 16 →
18 (+1 pt), FUSION LANCE 7 → 8 pts.` It remains viewable, duplicable, shareable, and draftable
if its *current* cost fits. The flag is a receipt, not a lock. "No loss, ever" means it always
loads — not that it's frozen in amber.

### 4.8 The backup nudge must nag (Decision 5, FR-7)

`localStorage` is the only persistence and it is not trustworthy. The Encyclopedia therefore
carries a **dismissible-but-recurring** banner naming the real stakes: *"Your library lives in
this browser only. Clearing site data deletes 24 builds. Last export: 18 days ago."* Storage
headroom is displayed continuously. If `localStorage` is unavailable or full, the app degrades
to session-only with a prominent warning rather than crashing.

**Delete is the only destructive action in the app** and it is the only action behind a modal
confirmation — which suggests exporting first.

### 4.9 Untrusted input fails closed (NFR-Security)

Share tokens and imported JSON come from other people. Failure states are designed, not
incidental: a malformed token produces a clear error and **no state change** —
*"TOKEN FAILED VALIDATION AT CHARACTER 412. No changes were made to your Encyclopedia."*
A name collision on import offers **rename / replace / cancel** and never silently overwrites.
A partially invalid JSON file imports what's valid and reports the rest per-build:
`IMPORTED / RENAMED / SKIPPED / FAILED (reason)`.

Build names and tags are user-authored strings and are never rendered as markup.

### 4.10 The bots are visibly fair (Decision 10, FR-11, FR-30)

There is no fog of war, so bot fleets are shown **in full before launch** — every ship, every
cost, totalling to the same budget. Difficulty tiers state what they actually change, in the
UI, in the player's words:

| Tier | What changes |
|------|--------------|
| ROOKIE | 1-turn horizon, nearest-target priority, no evasion modelling |
| VETERAN | 2-turn horizon, threat-weighted targeting, breaks shields then kills the generator |
| ACE | 3-turn horizon, predictive intercepts, willing to overburn and to ram |

Never a stat modifier, never a point discount, never an exclusive hull. The setup screen says
so out loud, because a solo game's credibility rests entirely on the player believing the
opponent isn't cheating.

### 4.11 The seed is a first-class object (Ruling H)

Generated, displayed, and recorded at arena instantiation; shown again in the post-match
summary with a copy button and the promise *"Same seed + same plans = identical outcome.
Replayable."* Determinism is a requirement; surfacing the seed is how the player can tell.

---

## 5. User Flows

### Flow 1 — Build a ship (primary; this is what the player came for)
`encyclopedia.html` → **NEW BUILD** → `shipyard.html` → pick chassis from the class-grouped
catalog → fit components into slot bays → watch the point total and the delta indicators move
on every swap → **SAVE TO ENCYCLOPEDIA** → back to `encyclopedia.html` with the new card.

The loop that matters is *swap → read delta → swap again*. It must be tight enough to feel like
editing a spreadsheet cell.

### Flow 2 — Fight (the payoff)
`encyclopedia.html` → **SKIRMISH** → `skirmish-setup.html` → choose budget → draft from the
Encyclopedia (duplicates allowed) → set opponent count + difficulty → review bot fleets and the
arena → **LAUNCH** → `tactical-move.html` → plot arcs blind → commit → movement resolves →
`tactical-attack.html` → assign fire blind → commit → fire resolves → repeat until one fleet
stands → `post-match.html`.

### Flow 3 — Share a build (the meta)
`shipyard.html` or `encyclopedia.html` → **COPY SHARE LINK** → visible confirmation → friend
opens the URL → `share-import.html` import preview showing the full fit before anything is
written → resolve any name collision → **ADD TO ENCYCLOPEDIA**.

### Flow 4 — Back up / trade a fleet
`encyclopedia.html` → select builds → **EXPORT SELECTED (JSON)** → file downloads. Inbound:
drop a `.json` on the import zone → per-build result summary → additive merge, never deletion.

### Flow 5 — Return after a year (the "no loss, ever" flow)
Open the app → migration chain runs on load → affected builds carry `⚠ NEEDS REFIT` with an
explicit diff → player clicks **RE-FIT** or **KEEP AS IS** → everything still loads. Nothing is
ever rejected.

### Flow 6 — Deadlock exit (Ruling D)
Any point in a match → **CONCEDE** in the match chrome → confirmation → immediate loss →
`post-match.html`. A player-facing exit, not a game rule. Bots never concede, and no draw state
exists.

---

## 6. What The Mocks Deliberately Fake

Honest accounting, so nobody mistakes a mock for a spike:

- **3D is faked** with CSS perspective, absolute positioning, and inline SVG. Real rendering is
  Architect's call and Coder's build. The mocks prove *layout, legibility, and information
  hierarchy* at fleet scale — not that the renderer can hit 60fps with 300 hazard bodies.
- **Ship silhouettes are placeholder wireframes.** The requirement that class be
  distinguishable by silhouette at fleet zoom (FR-13) is asserted in the mocks and must be
  re-verified against real geometry in the `polish` phase.
- **Tailwind CDN and Google Fonts are mock-only conveniences.** Both violate the
  offline-after-first-load requirement (NFR-Platform) and neither should survive into `src/`.
  Fonts must be self-hosted; the token layer in `console.css` is the part meant to carry
  forward.
- **No state is real.** Every number is a plausible fixture. Point totals were checked for
  internal arithmetic consistency, but they are not balanced — balance comes from the headless
  harness (FR-33), which is the only instrument that exists.

---

## 7. Open Questions for Architect / Coder

1. **Camera control scheme.** The mocks show a camera HUD with reset-to-fleet-view and a
   zoom scale, but the actual orbit/pan/zoom input mapping (drag, modifier keys, scroll) needs
   a real spike. FR-14 requires no artificial clamp; that is easy to state and fiddly to tune.
2. **Arc plotting input.** The mock shows thrust magnitude + bearing + pitch as numeric fields
   with presets. Whether a 3D drag-handle is better than numeric entry is exactly the question
   Gate 1 (FR-32) should answer. Numeric entry is the accessible fallback regardless, since all
   planning actions must be keyboard-reachable.
3. **Hit-chance transparency.** The mock exposes range / target velocity / target evasion as
   the three factors behind the percentage. If the real formula has more terms, the readout
   needs redesigning — the player will reverse-engineer it either way, so it may as well be
   honest.
4. **Marker density at the ceiling.** 60 ships plus 300 hazard bodies is the stated entity
   budget. The mocks show ~14 bodies. Label collision and glyph legibility at 20× that density
   is unproven and should be checked during Gate 1, not at polish.
5. **Silhouette legibility at fleet zoom.** Related, and the one FR-13 clause a mock genuinely
   cannot settle.

---

## 8. Polish Phase Checklist (deferred)

To be executed after Coder implements `src/`, producing `specs/polish-report.md`:

- [ ] Verify class silhouettes are distinguishable at fleet zoom with real geometry
- [ ] Verify marker/label legibility at maximum entity count
- [ ] Audit WCAG AA contrast on every readout in the implemented UI, including flickering ones
- [ ] Verify reduced-motion mode loses no information anywhere
- [ ] Verify full keyboard reachability of every planning action
- [ ] Verify text scaling to 125% without loss of function
- [ ] Confirm the boundary is legible from outside the arena looking in
- [ ] Replace CDN Tailwind and Google Fonts with self-hosted assets (offline requirement)
- [ ] Reconcile mock components with implemented components; retire any drift
