# Requirements — Starship Skirmish

> **Status:** v1 — derived from `specs/idea.md` v3 (idea phase complete, twenty decisions locked).
> Requirements-level details **A–F** from the idea doc are resolved here using the recommended
> defaults. Three further rulings (**G–I**) were required to make the combat model specifiable
> and are marked as new.
>
> This document is tech-agnostic by design. It states *what* must be true, not *how*. Stack,
> rendering approach, physics integration strategy, and data storage mechanics are Architect's
> to choose within the constraints in §Constraints.

---

## Design Pillars

These are not requirements; they are the tests a requirement must pass. Any future change that
violates one of these is a regression, not a feature.

1. **The arena is the clock.** Matches resolve through environmental pressure — a lethal
   boundary, accumulating debris, armed spent missiles, and a regen floor on damage — never
   through a timer, turn cap, draw state, or points tiebreak. *Do not "fix" a long match by
   adding a clock.*
2. **Commit under uncertainty is the whole game.** All plans are made blind and resolve
   simultaneously. Any feature that leaks an opponent's committed plan before resolution
   breaks the game.
3. **The design layer is content.** The Shipyard is a lab, not a config screen. Trades must be
   real and legible.
4. **No loss, ever.** Every build ever saved, shared, or exported must load, forever.
5. **The bots play the same game you do.** Same catalog, same points, same rules, same boundary.
6. **Abstraction is art direction.** The glitched neon console is the intended look, not
   placeholder art. Readability at 3D fleet scale is a functional requirement.

---

## Requirements-Level Rulings

Carried from `specs/idea.md` §Requirements-Level Details, plus three additions.

| # | Question | Ruling |
|---|---|---|
| **A** | Old builds: old stats or new balance? | **Migrate to current stats.** Point total is recalculated on load. If the total changed, the build is flagged `needs-refit` with a clear notice and a one-click path to re-fit. Never two versions of one component on one battlefield. |
| **B** | Missile magazines | **Limited ammo per missile slot**, capacity defined by the component. Ammo does not replenish within a skirmish. |
| **C** | Arena size | **Scales with point budget.** One tuning function, `arenaRadius = f(budget)`, exposed as a data value. |
| **D** | Residual deadlock | **Concede/resign action**, always available to the player. No draw state is introduced. |
| **E** | Does regen work under fire? | **Regen ticks every turn regardless of damage taken.** Legibility over realism. |
| **F** | Boundary warning | **Zone always visible.** Predicted-path ghost turns hostile (color + icon + text warning) the instant a plotted arc exits. Lethal and obvious. |
| **G** | *(new)* Weapon firing arcs | **None in v1.** Weapons are **range-limited and omnidirectional**, consistent with shields having no facing arcs (Decision 16). Ship orientation is presentational only and never a tactical input. This removes rotation micromanagement from a 3D game where it is close to unreadable. |
| **H** | *(new)* Hit resolution | **Probabilistic, seeded.** Hit chance is derived from range, target velocity, and target evasion. All randomness draws from a single **per-match seed** that is recorded and replayable — non-negotiable for the balance harness (FR-33). |
| **I** | *(new)* Damage types | **One damage number.** No damage-type matrix in v1. Weapons differentiate on range, damage, shots-per-turn, accuracy, and point cost. Complexity lives in the fitting trade, not a resistance table. |

---

## Functional Requirements

### Group 1 — Catalog & Data Integrity

#### FR-1: Versioned, additive-only catalog
- **User story:** As a builder, I want the ship catalog to be pure data with permanent IDs so
  that content can grow for years without ever breaking an existing build.
- **Acceptance criteria:**
  - [ ] Chassis and components are defined in **data files**, not code.
  - [ ] Every chassis and component has a **permanent string ID**, never deleted, never reused,
        never renumbered.
  - [ ] The catalog carries a monotonically increasing **`catalogVersion`**.
  - [ ] The build pipeline (or a test) **fails** if an ID present in any prior catalog version is
        missing from the current one.
  - [ ] Content may be added or re-tuned; content may **never** be retired.
  - [ ] One single catalog serves the player and all bots. No AI-exclusive entries exist, and
        the schema provides no field capable of expressing one.

#### FR-2: Migration layer (day one)
- **User story:** As a player returning after a year, I want my old builds and my friends' old
  share links to open without error so that the group's meta stays durable.
- **Acceptance criteria:**
  - [ ] Every persisted artifact — saved build, share token, JSON export — embeds the
        `catalogVersion` and a `schemaVersion` it was written against.
  - [ ] A migration chain runs on load, upgrading any historical artifact to current schema and
        current component stats (**Ruling A**).
  - [ ] Point cost is **recalculated** after migration against the current catalog.
  - [ ] If the recalculated total differs from the stored total, the build loads successfully and
        is marked **`needs-refit`** with a visible notice stating the old total, the new total,
        and what changed.
  - [ ] A `needs-refit` build is still viewable, duplicable, and shareable; it may only be fielded
        in a skirmish if it fits the chosen budget.
  - [ ] Migration is covered by a regression suite containing at least one **frozen fixture per
        historical schema version**, and fixtures are never edited after being added.
  - [ ] Loading a corrupt or unparseable artifact fails **for that artifact only**, with a clear
        message, and never destroys or blocks the rest of the Encyclopedia.

---

### Group 2 — The Shipyard

#### FR-3: Chassis selection
- **User story:** As a fleet builder, I want to choose a hull whose class dictates its slot
  layout so that class identity is a real, learnable constraint.
- **Acceptance criteria:**
  - [ ] v1 ships **~12 chassis across 4 classes**: Fighter, Frigate, Cruiser, Mega Destroyer.
  - [ ] Slot layout is **published per class**, not authored per chassis. Every chassis of a class
        exposes the same slot shape.
  - [ ] Slot types are: **weapon, shield, missile, engine, special**.
  - [ ] Each chassis publishes: point cost, hull points, base mass, slot layout, base evasion.
  - [ ] Chassis browse shows cost and stats before selection; nothing is hidden or unlocked.

#### FR-4: Component fitting
- **User story:** As a fleet builder, I want to spend into slots from a priced library so that
  every fit is an explicit trade.
- **Acceptance criteria:**
  - [ ] **5–8 components per slot type** ship in v1.
  - [ ] A component may only be fitted into a slot of its own type.
  - [ ] Empty slots are legal — an under-fitted ship is a valid, cheaper ship.
  - [ ] Shield components define **capacity and regen rate independently** (Decision 16), so the
        two-axis trade is real.
  - [ ] Missile components define **ammo capacity** (**Ruling B**), damage, AoE radius, boost
        velocity, and tracking behavior.
  - [ ] Engine components define **delta-V budget per turn**.
  - [ ] Weapon components define range, damage, shots per turn, and accuracy (**Ruling I**).
  - [ ] Special-slot components exist and are meaningfully distinct — v1 starting set:
        point-defense, armor plating, thrust booster, damage-control, decoy launcher.
  - [ ] Swapping a component updates the point total and derived stats **immediately**.

#### FR-5: Live validation and point total
- **User story:** As a fleet builder, I want a running total and instant feedback so I can tune
  a build the way I'd tune a spreadsheet.
- **Acceptance criteria:**
  - [ ] Running point total is visible at all times, updating on every change.
  - [ ] Total = chassis cost + sum of fitted component costs.
  - [ ] **Leftover points are wasted** (Decision 9). No conversion mechanism exists anywhere in
        the UI or data model.
  - [ ] Invalid fits are prevented at the point of interaction, not reported after the fact.

#### FR-6: Derived stat readout
- **User story:** As a fleet builder, I want to see what my choices did to the ship so I can
  evaluate a trade without running a battle.
- **Acceptance criteria:**
  - [ ] The Shipyard displays derived values: total hull, shield capacity, shield regen/turn,
        delta-V/turn, mass, effective acceleration, total missile ammo, and per-weapon
        range/damage.
  - [ ] Changing a component shows a **delta indicator** against the pre-change value.
  - [ ] Comparison of two saved builds side by side is available.

---

### Group 3 — The Ship Encyclopedia

#### FR-7: Persistent personal library
- **User story:** As a builder, I want my designs saved locally and organized so my library is
  the thing I come back to.
- **Acceptance criteria:**
  - [ ] Save, name, tag, browse, filter, sort, duplicate, and delete builds.
  - [ ] Persists across sessions in **`localStorage`** (Decision 5). No account, no server.
  - [ ] Delete requires confirmation and is the **only** destructive action in the app.
  - [ ] Every saved build stores `schemaVersion` + `catalogVersion` (FR-2).
  - [ ] The Encyclopedia surfaces **remaining storage headroom** and warns before quota is hit.
  - [ ] A **persistent, dismissible-but-recurring backup nudge** pushes the player toward JSON
        export (Decision 5 explicitly asks the UI to do this).
  - [ ] The app is resilient to `localStorage` being unavailable or full: it degrades to
        session-only operation with a prominent warning rather than crashing.

---

### Group 4 — Sharing & Portability

#### FR-8: Share one build as a URL
- **User story:** As a member of a friend group, I want to paste a link in chat and have it *be*
  the ship.
- **Acceptance criteria:**
  - [ ] A build encodes to a URL token of **≤1900 characters** including the base URL
        (Decision 8).
  - [ ] Encoding is **compact against the versioned catalog** — IDs and indices, never raw JSON.
  - [ ] The token embeds `schemaVersion` and `catalogVersion`.
  - [ ] Opening a share URL shows an **import preview** — name, class, points, full fit — before
        anything is written to the Encyclopedia.
  - [ ] Import never silently overwrites: a name collision offers rename, replace, or cancel.
  - [ ] A malformed, truncated, or hostile token produces a clear error and **no state change**
        (see NFR-Security).
  - [ ] "Copy link" is one action and confirms visibly.

#### FR-9: Fleet import / export as JSON
- **User story:** As a group organizer, I want to hand someone a whole fleet file and to have a
  real backup of my library.
- **Acceptance criteria:**
  - [ ] Export the **entire Encyclopedia** or a **selected subset** to a JSON file.
  - [ ] Export includes `schemaVersion`, `catalogVersion`, and an export timestamp.
  - [ ] Import accepts any historically valid export (FR-2) and reports a per-build result
        summary: imported / renamed / skipped / failed-with-reason.
  - [ ] Import is **additive by default** and never deletes an existing build.
  - [ ] Import of a partially invalid file imports the valid builds and reports the rest.

---

### Group 5 — Skirmish Setup

#### FR-10: Budget and fleet draft
- **User story:** As a player, I want to pick a budget and draft against it from my own library.
- **Acceptance criteria:**
  - [ ] Budgets: **25 / 50 / 75 / 100 / 125 / 150**.
  - [ ] Draft from the Encyclopedia only; **duplicates allowed** (Decision 19).
  - [ ] Running spend and remaining points always visible; over-budget drafts cannot launch.
  - [ ] Under-budget drafts **can** launch — leftover is wasted (Decision 9).
  - [ ] A fleet is capped at **20 hulls** (performance + readability; tunable data value —
        see Assumption 4).
  - [ ] `needs-refit` builds are draftable if their **current** cost fits.
  - [ ] One skirmish = one point-buy, one fleet. No reinforcements, no carryover (Decision 14).

#### FR-11: Opponent configuration
- **User story:** As a player, I want to choose how many bots I face and how good they are.
- **Acceptance criteria:**
  - [ ] **1–4 AI opponents**; max five fleets on the field (Decision 2).
  - [ ] Each bot fleet is built to the **same budget** from the **same catalog** (Decision 10).
  - [ ] Difficulty is selectable per match; tiers affect **decision quality only** — never stats,
        never point discounts, never exclusive hulls (Decision 10, Non-Goals).
  - [ ] With 3+ fleets, the free-for-all rule is explicit and shown: all fleets are hostile to all
        other fleets. No alliances in v1.
  - [ ] Bot fleets are visible to the player in full before launch (Decision 6 — no fog of war).

#### FR-12: Arena instantiation
- **User story:** As a player, I want the battlespace sized to the fight so a duel isn't lost in
  a void and a fleet action isn't a knife fight.
- **Acceptance criteria:**
  - [ ] Arena volume is derived from the point budget (**Ruling C**) via a single data-driven
        function.
  - [ ] The arena is a **bounded volume** with a clearly defined shape and center.
  - [ ] Starting positions place each fleet separated, outside mutual weapons range, and no
        fleet starts closer to the boundary than any other.
  - [ ] Starting velocity for all ships is **zero**.
  - [ ] The match seed (**Ruling H**) is generated, displayed, and recorded at instantiation.

---

### Group 6 — The Tactical View

#### FR-13: Command-console presentation
- **User story:** As a player, I want a tac display, not a space sim, so a 3D battle stays
  readable.
- **Acceptance criteria:**
  - [ ] Ships render as **neon wireframe silhouettes** on black; abstract geometry, vector
        trails, flickering readouts.
  - [ ] Ship class is distinguishable by silhouette at fleet zoom.
  - [ ] Fleet ownership is distinguishable by **more than color alone** (NFR-Accessibility).
  - [ ] Debris, live missiles, and spent missiles are each visually distinct from ships and from
        each other at a glance.
  - [ ] No photorealism and no cinematic auto-camera (Non-Goals).

#### FR-14: Unrestricted camera
- **User story:** As a player, I want to look wherever I want, because losing track of the field
  is how 3D tactics games fail.
- **Acceptance criteria:**
  - [ ] Free orbit, pan, and zoom from **fleet scale to hull scale**; no artificial clamp beyond
        near/far limits.
  - [ ] Camera state persists across turn phases and across resolution playback.
  - [ ] A **reset-to-fleet-view** action is one input away.
  - [ ] Depth is legible: ground-plane grid or equivalent reference, plus altitude/offset
        indicators for every tracked body.

#### FR-15: Roster sidebar
- **User story:** As a player, I want to click any ship in a list and have the camera go there.
- **Acceptance criteria:**
  - [ ] Sidebar lists **all fleets** — player and every bot — grouped by owner.
  - [ ] Clicking a ship snaps the camera to it and selects it.
  - [ ] Each entry shows live hull, shields, and component-damage state (Decision 6 — no fog).
  - [ ] Destroyed ships remain listed, marked destroyed.
  - [ ] Selecting a ship reveals its full fit and derived stats.

#### FR-16: Boundary presentation
- **User story:** As a player, I want the kill boundary to be impossible to misjudge.
- **Acceptance criteria:**
  - [ ] The boundary is **always visible** — never fades, never toggles off (**Ruling F**).
  - [ ] Proximity to the boundary is legible from any camera angle, including from outside
        looking in.
  - [ ] A plotted arc that exits the boundary turns the predicted-path ghost **hostile**: distinct
        color, exit-point marker, and explicit text warning.
  - [ ] Committing a boundary-exiting arc requires an **explicit second confirmation**. It is
        never blocked — flying out is a legal choice, just never an accident.

---

### Group 7 — The Turn Loop

#### FR-17: Two-beat simultaneous turn
- **User story:** As a player, I want everyone to commit blind and resolve at once so the game is
  about prediction.
- **Acceptance criteria:**
  - [ ] Each turn is exactly: **Movement plan → Movement resolve → Attack plan → Attack resolve**.
  - [ ] During any planning beat, **no committed plan of any other fleet is observable** through
        the UI, the DOM, network traffic, or any other channel (Pillar 2).
  - [ ] Bot plans are computed such that they cannot depend on the player's committed plan for
        the same beat.
  - [ ] **No planning timer** (Decision 7). No clock exists anywhere in the turn loop.
  - [ ] The turn loop is structured so that "player" and "bot" are the same interface, allowing a
        future networked opponent to be substituted **without redesigning the loop**
        (Non-Goals: multiplayer must be an addition, not a rewrite).

#### FR-18: Movement planning
- **User story:** As a player, I want to plot a thrust arc against real momentum and see where it
  puts me.
- **Acceptance criteria:**
  - [ ] Movement is **Newtonian**: velocity persists between turns; thrust modifies it
        (Decision 1).
  - [ ] The engine component supplies a **per-turn delta-V budget**; the plotted arc consumes it.
  - [ ] A **ghosted predicted path** shows the resulting trajectory continuously as the arc is
        edited.
  - [ ] There is **no free stop** — deceleration spends delta-V like any other maneuver.
  - [ ] Remaining delta-V is displayed numerically and cannot be exceeded.
  - [ ] A ship whose engine component is destroyed has **zero delta-V** and coasts on its current
        vector (Decision 4).
  - [ ] A plan is editable until commit; **commit is final** for the beat.
  - [ ] All ships in the player's fleet must be planned (or explicitly set to coast) before the
        fleet can commit.

#### FR-19: Movement resolution
- **User story:** As a player, I want to watch every ship move at once and find out what I got
  wrong.
- **Acceptance criteria:**
  - [ ] All bodies — ships, live missiles, spent missiles, debris — advance **simultaneously**
        within one resolution step.
  - [ ] Resolution is **order-independent**: the outcome does not depend on fleet index, ship
        creation order, or iteration order.
  - [ ] Motion is integrated in **sub-steps fine enough that collisions are detected along the
        path**, not only at endpoints. Tunneling through a body is a defect.
  - [ ] Resolution is animated as continuous motion so the player can read what happened.
  - [ ] Playback can be replayed and skipped; skipping never changes the outcome.
  - [ ] Given the same match seed and the same set of committed plans, resolution is
        **bit-identical reproducible** (**Ruling H**, FR-33).

#### FR-20: Attack planning
- **User story:** As a player, I want to assign fire blind, knowing my target may already be
  dead — or may be about to kill me.
- **Acceptance criteria:**
  - [ ] Attacks are planned **after** movement resolves, using post-movement positions.
  - [ ] Each weapon is assigned a target or held. Targets in range are indicated; out-of-range
        targets cannot be assigned.
  - [ ] Weapons are **range-limited and omnidirectional** (**Ruling G**) — no arc management.
  - [ ] Missile slots launch against a designated target and **decrement ammo** (**Ruling B**);
        an empty magazine cannot launch.
  - [ ] Once shields are down, individual **components may be called as targets** (FR-25).
  - [ ] Predicted hit chance is shown per assignment (**Ruling H**).
  - [ ] **Friendly fire is live** (Decision 13) and the UI warns — but never blocks — when an AoE
        assignment overlaps a friendly ship.
  - [ ] Opponent fire assignments are not observable before commit (Pillar 2).

#### FR-21: Attack resolution
- **User story:** As a player, I want a ship I just destroyed to still land its shots.
- **Acceptance criteria:**
  - [ ] All fire resolves against a **snapshot of the battlefield taken before any damage is
        applied**. Being destroyed during the beat does not cancel a ship's own fire.
  - [ ] **Mutual destruction is possible and correct.**
  - [ ] Damage is accumulated across all shooters and applied in one pass at the end of the beat.
  - [ ] Resolution is order-independent (same rule as FR-19).
  - [ ] Destruction effects (AoE, debris) are generated after damage application and enter the
        battlespace for the **next** movement beat.
  - [ ] A per-turn combat log records every shot: shooter, target, roll, result, damage.

---

### Group 8 — Physics, Hazards & Munitions

#### FR-22: Collision
- **User story:** As a player, I want ramming to be a real option and a real risk.
- **Acceptance criteria:**
  - [ ] Ships, debris, live missiles, and spent missiles share **one collision space**.
  - [ ] Collision damage scales with **relative velocity and mass**.
  - [ ] Collision transfers momentum to both bodies — which means **shoving an enemy across the
        boundary is a legal, intentional tactic** (idea doc §What This Round Changed, item 2).
  - [ ] Collision damage applies to shields first, then hull, per FR-25.
  - [ ] Collisions detected mid-path resolve at the point of contact, not at turn end.

#### FR-23: Debris and persistent hazards
- **User story:** As a player, I want the battlefield to get more dangerous the longer I stay in it.
- **Acceptance criteria:**
  - [ ] Ship destruction produces an **AoE detonation** plus **physics-driven debris**.
  - [ ] Debris inherits the destroyed ship's velocity plus a scatter impulse.
  - [ ] Debris **persists across turns**, moves under conserved momentum, and damages any ship it
        strikes.
  - [ ] Debris count per destruction scales with chassis class.
  - [ ] Debris has a **lifetime in turns** (data-tunable, recommended ~6) after which it is culled.
  - [ ] Any hazard body that crosses the boundary is **removed** (this is the primary natural cull
        and it is consistent with FR-29).
  - [ ] A **hard cap on simultaneous hazard bodies** exists; on overflow, the oldest are culled
        first, and the cap is set high enough that it is never reached in normal play.
  - [ ] AoE detonations **do not check ownership** (Decision 13).

#### FR-24: Missile life cycle
- **User story:** As a player, I want missiles to be a timed threat I can survive or dodge —
  and a hazard that outlives its own guidance.
- **Acceptance criteria:**
  - [ ] A launched missile is a **physical body** in the battlespace (Decision 12), entering with
        the launcher's velocity plus the component's boost.
  - [ ] It **re-aims at its designated target for exactly two movement beats** (Decision 15).
  - [ ] On the third beat it **fuels out**: it stops maneuvering, retains its final vector, and
        remains **armed** — a ballistic hazard indistinguishable in behavior from debris.
  - [ ] A missile detonates on contact with **any** body, friendly or otherwise.
  - [ ] Missiles **can be shot down** by weapons and by point-defense special components.
  - [ ] A missile that leaves the boundary is destroyed (FR-29).
  - [ ] Missile state — tracking / spent — is **visually distinct** at a glance (FR-13), and turns
        of tracking remaining are readable on inspection.
  - [ ] If a missile's target is destroyed while it is still tracking, it continues on its current
        vector without re-acquiring.

---

### Group 9 — Damage & Destruction

#### FR-25: Shields, hull, and called shots
- **User story:** As a player, I want breaking a shield to open up a target's guts.
- **Acceptance criteria:**
  - [ ] Shields are a **single pool with no facing arcs** (Decision 16).
  - [ ] Damage depletes shields first; overflow carries to hull in the same application.
  - [ ] Shields **regenerate at the component's rate every turn regardless of damage taken**
        (**Ruling E**), capped at capacity.
  - [ ] **Called shots at components are only available while shields are at zero** (Decision 4).
  - [ ] A destroyed component **loses its function immediately**: dead engine = no thrust, dead
        weapon = no shot, dead missile rack = no launch, dead shield generator = **no capacity
        and no regen**.
  - [ ] Destroying a shield generator does **not** restore already-depleted shields — it removes
        the pool permanently. The break-shields-then-kill-the-generator sequence is intended
        signature play and must work exactly this way (idea doc §What This Round Changed, item 4).
  - [ ] Component damage state is visible on the ship inspector and the roster sidebar for **all**
        ships (Decision 6).
  - [ ] A ship is destroyed when hull reaches zero. There is no crew, morale, or surrender state.

#### FR-26: Boundary lethality
- **User story:** As a player, I want the edge of the world to be a weapon.
- **Acceptance criteria:**
  - [ ] A **ship** whose position leaves the bounded volume is **destroyed immediately** — no
        grace period, no warning turn, no wrap, no bounce (Decision 20).
  - [ ] Boundary destruction produces the same AoE + debris as any other destruction (FR-23) —
        but only if the detonation point is still inside the arena.
  - [ ] Boundary destruction is attributed in the combat log, including to a **collision that
        shoved the ship out** (FR-22).
  - [ ] Missiles and debris leaving the boundary are **removed silently**, without detonation.

---

### Group 10 — Match Resolution

#### FR-27: Victory
- **User story:** As a player, I want to win by being the last one alive.
- **Acceptance criteria:**
  - [ ] Victory condition is **last fleet standing** (Decision 3).
  - [ ] A fleet is eliminated when all its ships are destroyed.
  - [ ] The match ends when exactly one fleet has surviving ships.
  - [ ] If a hazard or simultaneous resolution eliminates **all** remaining fleets in the same
        beat, the match ends with **no winner** — reported honestly as mutual destruction, which
        is an outcome, not a draw state.
  - [ ] **No turn cap, no draw, no points tiebreak** (Decision 17). No such mechanism exists in
        the codebase.
  - [ ] A post-match summary reports: outcome, turns elapsed, per-ship kills and fate, damage
        dealt/taken, and the match seed.

#### FR-28: Concede
- **User story:** As a player, I want an exit from an unwinnable-but-unresolvable position.
- **Acceptance criteria:**
  - [ ] A **concede/resign** action is available to the player at any point during a match
        (**Ruling D**).
  - [ ] Concede requires confirmation and ends the match immediately as a loss.
  - [ ] Concede is a player-facing exit, **not** a game rule — bots never concede, and no draw
        state is introduced.

---

### Group 11 — AI Opponents

#### FR-29: Bot planning under identical rules
- **User story:** As a player, I want opponents that play the game I'm playing.
- **Acceptance criteria:**
  - [ ] Bots plan movement and fire under the **same blind-commit rules** — no access to the
        player's committed plan for the current beat (Pillar 2, Pillar 5).
  - [ ] Bots use the **same catalog, same slot layouts, same point budget, same boundary, same
        friendly-fire rules**.
  - [ ] Bots receive **no stat bonuses, no point discounts, no exclusive hulls** (Decision 10).
  - [ ] Bots must not fly themselves out of bounds through unforced error — boundary avoidance is
        a hard constraint in movement planning, overridable only by a deliberate ram (FR-22).
  - [ ] Bots recognize and execute the **break-shields → kill-the-generator** sequence (FR-25).
  - [ ] Bots account for their own AoE friendly fire when assigning missiles.
  - [ ] Bot planning time for a full 5-fleet field does not exceed the NFR-Performance budget.

#### FR-30: Difficulty tiers
- **User story:** As a player, I want to pick how hard the opponent thinks.
- **Acceptance criteria:**
  - [ ] At least **three tiers** shipped in v1.
  - [ ] Tiers differ **only** by decision quality — e.g. planning horizon, target prioritization
        sophistication, evasion modeling, willingness to overburn.
  - [ ] The lowest tier still obeys the boundary constraint and still fields a legal fleet.
  - [ ] Difficulty is never expressed as a numeric modifier on any ship stat. No such field exists
        in the data model.

#### FR-31: Bot fleet construction
- **User story:** As a player, I want bot fleets that are built, not hand-scripted, so they feel
  like real lists.
- **Acceptance criteria:**
  - [ ] Bot fleets are assembled from the shared catalog to the match budget.
  - [ ] Bot fleets vary between matches at the same budget and difficulty.
  - [ ] Bot fleets respect the same fleet hull cap as the player (FR-10).
  - [ ] Every bot fit is legal under Shipyard rules (FR-4) — a bot could not build a ship the
        player couldn't build.

---

### Group 12 — Tooling & Instrumentation

#### FR-32: Prototype gates (build order)
- **User story:** As the builder, I want the two riskiest unknowns proven before I invest in the
  Shipyard.
- **Acceptance criteria:**
  - [ ] **Gate 1** — one turn of blind-commit Newtonian movement: two ships, conserved momentum,
        arc plotting, bounded arena, a collision, and debris persisting into the next turn.
        Programmer-art wireframes, no Shipyard. **Judged on: is that turn fun?**
  - [ ] **Gate 2** — a throwaway heuristic bot that plots a blind simultaneous 3D thrust arc
        against an unknown opponent plan without flying itself out of bounds. This is the
        project's highest-risk unknown (idea doc §What I'd Build First).
  - [ ] Neither gate ships. Both are explicitly disposable.
  - [ ] Full build does not begin until both gates pass.

#### FR-33: Headless balance-sim harness
- **User story:** As the builder, I want to tune the point curve without telemetry, because with
  no server there is no other instrument.
- **Acceptance criteria:**
  - [ ] The complete combat simulation runs **headless** — no rendering, no DOM, no UI.
  - [ ] The harness runs scripted **bot-vs-bot** matches in bulk from the command line.
  - [ ] Runs are **seeded and reproducible** (**Ruling H**); the same seed and fleets always yield
        the same result.
  - [ ] Output includes per-match outcome, turn count, and per-chassis/per-component win-rate and
        usage-rate aggregates.
  - [ ] The harness is built **early** — alongside Gate 1, not after the game is content-complete.
  - [ ] Simulation logic contains **no dependency on the rendering layer**, enforced structurally
        so this can't rot.

---

## Non-Functional Requirements

### Performance
- **Frame rate:** ≥60 fps during camera movement and resolution playback, on mid-range desktop
  hardware from the last five years.
- **Entity budget:** up to **5 fleets / 60 ships** on field, plus **300 simultaneous hazard
  bodies** (debris + missiles), without dropping below 30 fps.
- **Bot planning:** full plan for all bot fleets in **≤2 s** at maximum field size. There is no
  planning timer for the player (Decision 7), but a bot that makes the player wait breaks the
  "fits in a lunch break" promise.
- **Load:** first interactive paint in **≤3 s** on a broadband connection; catalog data loads
  before the Shipyard is usable.
- **Encyclopedia:** browse, filter, and sort remain responsive at **500 saved builds**.
- **Headless sim:** ≥100 full matches per minute per core (FR-33 is useless if it's slow).

### Correctness & Determinism
- Identical seed + identical committed plans ⇒ **identical outcome**, every run, on every machine.
- Simultaneous resolution is **order-independent** — verified by a test that shuffles entity
  iteration order and asserts identical results.
- Physics integration must not permit **tunneling** at maximum achievable relative velocity.
- Floating-point strategy must be chosen deliberately by Architect to satisfy the reproducibility
  requirement; this is a known hazard, not an afterthought.

### Security
The app has no backend, which removes most of the usual attack surface and concentrates the rest
in **one place: data arriving from other people.**
- Share tokens and imported JSON are **untrusted input**. They must be schema-validated and
  bounds-checked before use — no unbounded loops, no unbounded allocations, no reflected values
  ever interpolated as markup.
- A hostile artifact must fail closed: clear error, **no state mutation**, no partial write.
- No user-authored string (build name, tag) may be rendered as executable markup.
- Import must not be able to exhaust `localStorage` or lock the UI.
- No telemetry, no analytics, no third-party beacons — there is no server and there is no data
  collection.

### Accessibility
- **Never color alone.** Fleet ownership, hazard type, and missile state must each be conveyed
  by shape, label, or icon in addition to color — this is load-bearing for a neon-on-black game.
- Contrast meets **WCAG AA** for all text and all critical readouts, including flickering ones.
- A **reduced-motion mode** that disables glitch, flicker, and screen-shake without removing
  information.
- All planning actions reachable by **keyboard**; commit requires a deliberate action, never a
  hover or drag-release alone.
- No information conveyed **exclusively** by animation — post-resolution state is always
  inspectable statically (roster sidebar, combat log).
- Text scaling to 125% without loss of function.

### Platform
- **Desktop web browser**, current versions of the major evergreen browsers.
- Minimum viewport **1280×720**; designed for 1920×1080.
- **No mobile or touch-first layout in v1** (Non-Goals). The site should degrade to a readable
  "desktop required" message rather than a broken layout.
- **Static hosting only** — deployable to GitHub Pages with no server-side component of any kind.
- Must function fully **offline after first load**, since there is nothing to talk to.

### Maintainability
- Catalog content is **pure data**, editable without touching game code (enables the v1.x jump to
  30+ chassis as content work, not engineering).
- Simulation is **separable from rendering** — enforced, not merely intended (FR-33).
- The turn loop treats "player" and "bot" as the same interface so a future network opponent is an
  addition, not a rewrite (FR-17, Non-Goals).
- Migration fixtures are **append-only** and never edited (FR-2).

---

## Constraints

- **No backend, no accounts, no database, no server-side anything.** Static hosting.
- **`localStorage` is the only persistence.** Practical ceiling ~5 MB; JSON export is the backup
  story and the UI must say so.
- **Share links ≤1900 characters total.** This is a hard budget that constrains the encoding
  scheme and, indirectly, how many components a build may carry.
- **No telemetry.** The headless harness (FR-33) is the *only* balance instrument. This is why it
  is a day-one requirement rather than a nice-to-have.
- **Additive-only catalog, forever.** Nothing is ever deleted or renumbered. This constrains data
  architecture from commit one.
- **v1 content ceiling:** ~12 chassis, 5–8 components per slot type. More is v1.x content.
- **Single builder, no art or audio budget assumed.** The abstract neon console aesthetic is
  chosen partly because it is achievable without an artist — this is a feature of the direction,
  not a compromise of it.

---

## Dependencies

Stated as *capabilities*, not products — selection is Architect's call.

- A **browser 3D rendering capability** able to draw wireframe/line geometry with glow at the
  stated entity budget.
- A **physics/collision approach** supporting continuous (swept) collision detection and
  deterministic integration. May be custom; a general-purpose engine is likely overkill and may
  actively conflict with the determinism requirement.
- A **compact binary/text encoding + compression scheme** for share tokens within the 1900-char
  budget.
- A **headless execution environment** for the balance harness.
- **Static file hosting** (GitHub Pages named as the target).
- No paid services, no external APIs, no runtime third-party dependencies at play time.

---

## Assumptions

1. The player has a desktop browser and a mouse. Touch and mobile are explicitly deferred.
2. `localStorage` is available and not cleared unexpectedly. The backup nudge (FR-7) exists
   precisely because this assumption is unreliable.
3. Point costs will be **wrong on first pass** and will need multiple tuning rounds against the
   harness. The balance harness is therefore infrastructure, not tooling.
4. **20 hulls per fleet / 60 on field** is a working cap derived from readability and the
   performance budget, not from a design ruling. If Gate 1 shows the field stays legible at
   higher counts, raise it — it is a data value, not a structural limit.
5. Recommended chassis cost bands for the initial curve, to be tuned: Fighter **4–8**,
   Frigate **12–20**, Cruiser **28–45**, Mega Destroyer **70–110**. At the 150 budget this yields
   roughly one-to-two mega destroyers *or* a large fighter swarm — the intended headline trade.
6. Bots are heuristic in v1 (threat maps, standoff-range preference, evasion estimation), not
   learned and not search-based. Difficulty tiers are tuned heuristics.
7. A free-for-all with 5 fleets is fun. This is unproven and worth an early check — if it isn't,
   the fallback is 1v1 plus 1-vs-many, both of which are already supported by FR-11.
8. Players will accept a build being flagged `needs-refit` after a balance change. The alternative
   (pinning historical stats) was rejected in **Ruling A** as breaking point-buy fairness.

---

## Glossary

- **Beat** — half of a turn. Each turn has a movement beat and an attack beat, each with a blind
  planning phase and a simultaneous resolution phase.
- **Blind commit** — planning without visibility of any opponent's plan for the same beat. Locks
  on commit.
- **Called shot** — targeting a specific slot component rather than the hull. Only legal while the
  target's shields are at zero.
- **Catalog** — the versioned, additive-only data set of all chassis and components.
- **Chassis** — a hull. Carries point cost, hull points, mass, base evasion, and a class-published
  slot layout.
- **Debris** — physics-driven wreckage from a destroyed ship. Armed, persistent, lethal, ownerless.
- **Delta-V** — the per-turn thrust budget supplied by the engine component. Spent by any change
  in velocity, including deceleration.
- **Encyclopedia** — the player's local library of saved builds.
- **Fuel-out** — the moment a missile exhausts its two beats of powered tracking and becomes an
  armed ballistic hazard.
- **Hazard body** — any non-ship physical object: debris or spent missile. Behaviorally unified.
- **`needs-refit`** — flag on a migrated build whose recalculated point cost differs from its
  stored cost.
- **Overburn** — spending a large share of delta-V in one direction, incurring multi-turn
  momentum debt and, near the edge, risk of boundary death.
- **Refit** — re-fitting a `needs-refit` build to bring it back to an intended point total.
- **Seed** — the per-match random seed governing all probabilistic resolution. Recorded, displayed,
  and replayable.
- **Share token** — the compact URL-encoded representation of a single build.
- **Skirmish** — one match: one budget, one fleet per side, one battlespace, no reinforcements.
- **Slot** — a typed mount point on a chassis (weapon / shield / missile / engine / special).
- **Snapshot resolution** — resolving all fire against pre-damage battlefield state, so destroyed
  ships still land their shots.
