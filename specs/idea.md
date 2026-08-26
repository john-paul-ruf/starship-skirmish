# Idea — Starship Skirmish

> **Status:** v3 — **idea phase complete.** All twenty decisions are locked. The remaining
> items at the bottom are requirements-level details with recommended defaults, not
> idea-level blockers. This document is ready to hand to Architect, Designer, and DB.

## One-Sentence Summary

Starship Skirmish is a 3D turn-based tactical combat game where you design point-costed
warships in a deep shipyard, then field them against AI fleets in simultaneous-turn
battles where momentum, collision, and exploding wreckage are as lethal as the guns.

## Problem

There is a specific player — the tabletop fleet-combat fan — who is badly served by
digital games.

They grew up on *Battlefleet Gothic*, *Full Thrust*, *Star Fleet Battles*, *Car Wars*.
What they love is not the fight. It's the **week before the fight**: the spreadsheet, the
argument about whether a mega destroyer at 90 points is worth three light fighters, the
build they've been tuning for a month. The battle is where you find out if you were right.

Today they have bad options:

- **Real tabletop** requires an opponent, a table, four hours, and physical minis.
- **Digital 4X and RTS games** (Homeworld, Nebulous, Sins) bury the build meta under
  economy management, or make it real-time so tactics collapse into APM.
- **Turn-based space games** are almost always 2D, and almost always ship a fixed roster
  of hulls — the design layer, the thing this player actually came for, is missing.
- **Simultaneous-turn ("WEGO") combat** — the format that makes fleet tactics feel like
  fleet tactics — is nearly extinct outside of a handful of niche titles.

Nobody is shipping the combination: a deep point-buy shipyard, a real 3D battlefield,
simultaneous resolution, and an opponent that's available at 11pm on a Tuesday.

## Vision

**Starship Skirmish is two games stacked.**

The first is the **Shipyard** — a lab, not a menu. You pick a chassis, from a nimble light
fighter up to a mega destroyer, each with a point cost and a slot layout published by
class: weapons, shields, missiles, engine, special. You spend into those slots from a
component library. Every choice is a trade: a high-capacity shield eats the points you
wanted for a second gun; a fast-regenerating one survives attrition but folds to an alpha
strike; a hot engine buys you initiative but leaves you thin when a lance connects. Builds
are saved to a personal **Ship Encyclopedia**, shared with a friend as a single URL, and
exported as JSON so a group can trade whole fleets. The design layer is first-class
content, not a config screen. And a build, once saved, **works forever** — the catalog only
ever grows, and old designs are migrated, never rejected.

The second is the **Skirmish** — you choose a point budget (25 through 150), draft ships
from your Encyclopedia against it, and drop into a battle presented as a **glitched-out
command console**: neon-glow abstract geometry on black, ships as wireframe silhouettes,
vector trails, readouts that flicker. It is not a rendered space sim. It is what a captain
sees on a tac display, and the abstraction is a feature — it keeps the game readable in
3D, which is where most 3D tactics games fail. The camera is unrestricted: zoom from fleet
scale to hull scale, orbit anywhere; the only limit is your own field of view. A roster
sidebar lets you click any ship — yours or a bot's — to snap the camera to it.

The battle runs on a **simultaneous two-beat turn** over **Newtonian movement**, inside a
**bounded battlespace**. Everyone plans movement blind by plotting a thrust arc, and on
commit, *all* movement resolves at once. Momentum is conserved and thrust is a per-turn
budget, so the plan you commit is a debt you carry: floor the engine to close the range and
you will be three turns crossing the map before you can turn around — and if the arena wall
is in front of you, you will not get to turn around at all, because **a ship that leaves the
zone is destroyed.** The boundary is not scenery. It is a weapon, a mistake you can make,
and the reason overburn is a real decision.

This is where the game gets its teeth. Ships can collide, and a collision or a kill
produces a real hazard: an area-of-effect detonation, plus **debris that keeps moving under
physics**, tumbling through the battlespace for turns afterward, capable of gutting a live
ship that flies into it. A dead ship keeps fighting. Missiles are physical objects too —
they **track for two turns of powered flight, then burn out** and coast on as live ballistic
warheads. Which means the battlespace gets *more lethal the longer the fight runs*: spent
missiles and wreckage accumulate, and the arena itself becomes the pressure that ends the
game. Then everyone plans attacks blind, and on commit, *all* fire resolves at once — so
two ships can kill each other, and a ship you destroyed still lands its shots. Friendly
fire is live, so an AoE detonation does not check who launched it.

The result is a game about **committing to a prediction under uncertainty**, at a scale
that fits in a lunch break, against opponents that never cancel.

The hook — the sentence a player repeats to a friend — is: *"I killed his destroyer and
the wreck took out my own cruiser two turns later."*

## Target User

- **Primary — The Tabletop Fleet Builder.** 25–55, plays or used to play miniatures
  wargames, loves list-building and cost-efficiency math, has strong opinions about
  balance. Wants the design meta deep and the session short. Plays solo because
  scheduling humans is the hard part.
- **Secondary — The Tactics Gamer.** Enjoys XCOM / Into the Breach / Frozen Synapse-style
  commit-and-watch turns. Comes for the simultaneous resolution and the physics chaos, and
  gets pulled into the shipyard.
- **Tertiary — The Sharer.** A small friend group that trades builds by link, argues about
  point costs, and runs an informal meta. They're the reason share/import/export exists
  even before any real multiplayer does.

## Locked Decisions

These are settled. Architect, Designer, and DB can build against them.

| # | Decision | Ruling |
|---|---|---|
| 1 | **Movement model** | **Newtonian waypoint-arc plotting.** Momentum conserved; engine supplies a delta-V budget per turn; you plot an arc and see a ghosted predicted path. Overburn has multi-turn consequences. There is no free stop — deceleration costs delta-V. |
| 2 | **Players** | Strictly **1 human vs 1–4 AI**. Max five fleets on the field. No hotseat, no netcode in v1. |
| 3 | **Win condition** | **Last fleet standing.** |
| 4 | **Damage model** | **Shields → hull + destructible slot components.** While shields hold, damage is absorbed. Once shields are down, slots can be **called as targets**; a destroyed component loses its function (dead engine = no thrust, dead weapon = no shot). |
| 5 | **Persistence** | **`localStorage` only**, static hosting (GitHub Pages), no account, no server. **JSON export is the backup story** and the UI should actively push the player toward it. |
| 6 | **Fog of war** | **None.** Full information on all ships and stats. Uncertainty comes from blind commit, not hidden data. |
| 7 | **Planning timer** | **None.** A turn takes as long as it takes. |
| 8 | **Share links** | URL token up to **~1900 characters**. Compact encoding against a versioned catalog — not raw JSON. |
| 9 | **Leftover points** | **Wasted.** No conversion to initiative, reserves, or rerolls. |
| 10 | **Slot layouts** | **Published pattern per class**, not hand-authored per chassis. One shared chassis catalog for player and bots — **no AI-exclusive hulls and no AI point discounts.** |
| 11 | **Squadrons** | None. **Every hull is an individual unit.** |
| 12 | **Missiles** | **Persistent physical objects.** They have speed, fly across turns, detonate for AoE, can be **shot down**, and can **collide with something unintended**. |
| 13 | **Friendly fire** | **On.** |
| 14 | **Fleet scope** | One skirmish = **one point-buy, one fleet.** No reinforcement waves, no between-battle carryover. |
| 15 | **Missile guidance** | **Two turns of powered tracking, then fuel-out.** A live missile re-aims at its target each turn for two turns. When fuel is spent it stops maneuvering and coasts on its final vector as a **still-armed ballistic hazard**. Counterplay is explicit: survive the burn, or break its intercept. |
| 16 | **Shields** | **Single pool, no facing arcs.** Shields **regenerate**, and both capacity and regen rate are **properties of the equipped shield component** — a real two-axis design trade, not a global rule. |
| 17 | **Match end** | **The player wins, or the game continues.** No turn cap, no draw state, no points tiebreak. The bounded arena (20) and accumulating hazards are the pressure that resolves matches. |
| 18 | **Catalog compatibility** | **No loss, ever.** The catalog is **additive-only**: component and chassis IDs are permanent and never deleted or reused. Old share links and old JSON exports **always load**, via a **migration layer built on day one**. Retiring content is forbidden. |
| 19 | **Duplicate builds** | **Allowed.** You may field multiple copies of the same saved design, tabletop-style, as long as the points fit. |
| 20 | **Battlespace bounds** | **Bounded.** A ship that leaves the zone is **destroyed** — no warning grace, no wrap, no bounce. The boundary is a live tactical hazard and the primary stalemate valve. |

**Accepted scope recommendations:**

- **Content:** ship v1 with **~12 chassis across 4 classes** and **5–8 components per slot
  type**, all as **pure data files**. 30+ chassis becomes v1.x content work, not v1
  engineering. Build a **headless bot-vs-bot balance-sim harness** early — with no server
  and therefore no telemetry, it is the *only* instrument available for tuning the point
  curve.
- **AI:** first-class feature with difficulty tiers, validated by a **throwaway prototype
  of blind simultaneous 3D movement planning** before the full build. Early bots are
  heuristic — threat maps, standoff-range preference, evasion rolls — not clever.

## Key Features (high-level)

1. **The Shipyard.** ~12 chassis across 4 classes (light fighter → mega destroyer), each
   with a point cost and a class-published slot layout (weapon / shield / missile / engine
   / special). Priced component library per slot type. Live validation and running point
   total.
2. **The Ship Encyclopedia.** Save, name, tag, browse, duplicate, delete. Persists in
   `localStorage` across sessions. Every saved build remains loadable for the life of the
   product.
3. **Build sharing.** Encode one build into a ≤1900-char URL — the link *is* the ship. No
   account, no server. Import a link into your Encyclopedia.
4. **Fleet import/export.** Whole-Encyclopedia or selected-subset JSON export and import,
   for group trading and for backup.
5. **Catalog migration.** A versioned, additive-only catalog with a migration layer that
   upgrades any historical build to current data. Present from the first release.
6. **Skirmish setup.** Budgets of 25 / 50 / 75 / 100 / 125 / 150. Draft against the budget
   from your Encyclopedia, duplicates allowed. Choose count (1–4) and difficulty of AI
   opponents.
7. **The tactical view.** Glitched command-console aesthetic, neon abstract geometry,
   unrestricted zoom and orbit, roster sidebar → click player → click ship → camera snaps.
   Arena boundary rendered as a permanent, legible presence.
8. **The movement beat.** All combatants plot thrust arcs blind against conserved momentum;
   commit locks; all movement executes together. Predicted path warns on boundary exit.
9. **Collision, debris, and munition physics.** Ships, wreckage, and in-flight missiles
   share one collision space. Destruction yields AoE plus persistent physics-driven debris.
   Burnt-out missiles join the hazard field as armed ballistic objects.
10. **The attack beat.** All combatants plan fire blind; commit locks; all fire resolves
    together. Mutual destruction possible. Called shots at exposed slots once shields drop.
    Friendly fire live.
11. **AI opponents.** Bots planning movement and fire under the *same* blind-commit rules,
    the same catalog, the same point budget, and the same lethal boundary as the player, at
    selectable difficulty.

## Non-Goals

Named explicitly so they stay dead:

- **No campaign, no persistence between battles.** No fleet XP, veterancy, carried damage,
  meta-progression, or unlocks. Every chassis is available from minute one. Depth lives in
  the design space, not a grind.
- **No economy or base building.**
- **No real-time anything.** There is no clock at all, including on planning.
- **No fog of war.**
- **No squadrons or multi-hull purchases.**
- **No reinforcements or second waves within a skirmish.**
- **No turn cap, no draw, no points-based victory.**
- **No content retirement.** Nothing is ever removed from the catalog or renumbered.
- **No photorealistic ships or cinematic camera.** The abstract neon console *is* the art
  direction, not a placeholder.
- **No accounts, no login, no server, no backend.** Static hosting only.
- **No live human-vs-human multiplayer in v1**, and no hotseat. The turn loop must be
  *designed* so multiplayer is a later addition rather than a rewrite.
- **No AI cheating.** Difficulty tiers come from better play, never from stat bonuses,
  point discounts, or exclusive hulls.
- **No in-game modding UI or content editor.** Content is data files; power users can edit
  them, but there's no editor to build.
- **No mobile or touch-first layout in v1.** Desktop-scale interface.
- **No narrative, campaign fiction, or voice acting.**

## What This Round Changed

Five consequences worth carrying into requirements.

**1. The arena is the clock — and it replaces every mechanism you rejected.**
You declined a turn cap, a draw, and a points tiebreak (17), which normally leaves a
Newtonian game unable to end. It doesn't here, because three of your other rulings quietly
solve it. A lethal boundary (20) means drifting away is not escape, it's death. Burnt-out
missiles stay armed (15) and debris persists (12), so the battlespace accumulates hazards
every turn. And regenerating shields (16) put a floor on damage output — a fleet that can't
out-damage regen can't win by grinding, so it has to close. Long games get *more* dangerous,
not more static. **The pressure to resolve is environmental, not administrative.** That is a
better design than a turn cap, and it should be stated as an explicit design pillar so
nobody later "fixes" it by adding a timer.

**2. The boundary makes overburn genuinely dangerous — and gives ramming a second use.**
Decision 1 said overburn has multi-turn consequences. Decision 20 makes one of those
consequences *death*. Flooring the engine now risks flying out of the world, which turns
every aggressive burn into a real gamble instead of a positioning cost. It also creates
an emergent tactic nobody designed: **collide with an enemy to shove them across the line.**
That is free depth. It needs to be intentional in the physics, and it needs a UI that makes
the boundary impossible to misjudge — the predicted-path ghost must scream before it exits.

**3. Missiles now have a clean, teachable life cycle — and the third body class collapses.**
Two turns of tracking then fuel-out (15) gives missiles a legible envelope: they are guided
threats with a hard expiry, so evasion is *possible but timed*. It also gives you an
effective missile range measured in turns, which is a clean balance lever. Best of all, a
burnt-out missile is behaviorally almost identical to debris — an inert-thrust, armed,
physics-driven body. **The "three body classes" cost from v2 partially collapses to two**:
guided munitions, and unpowered hazards that debris and spent missiles both feed into. This
is the one place scope got *cheaper* this round.

**4. Regenerating shields make the shield generator the highest-value called shot.**
Regen (16) means damage now has a **breakpoint** — you must exceed regen to make progress,
which is exactly the lever that makes alpha-strike builds and attrition builds both viable.
But it collides beautifully with called shots (4): you can only target slots once shields
are down, and the shield generator is a slot. So the sequence *break the shields, then
immediately kill the generator* permanently removes regen. Nobody designed that; it falls
out of the rules. It should be the first tactic the game teaches, and the AI must know it.

**5. "No loss, ever" is the strongest architectural constraint in this document.**
Decision 18 is not a nice-to-have — it dictates data architecture from commit one. Stable
permanent IDs, additive-only catalog files, a version stamp inside every share token and
every JSON export, and a migration chain that runs on load. **Architect must treat this as
a day-one requirement**, because retrofitting versioning onto an unversioned save format is
one of the reliably miserable jobs in software. The upside is real: your friend group's
builds from launch week still work in year two, which is exactly what makes the sharing
meta durable.

## Requirements-Level Details

These are no longer blockers. Each has a recommended default that I'll carry into
`specs/requirements.md` unless you say otherwise.

- **A. Do old builds keep old stats, or take the new balance?** The sharp edge inside
  decision 18. *Recommend:* builds **migrate to current stats** and the point total is
  recalculated, with a clear notice if it changed and a prompt to re-fit. Pinning historical
  stats would put two different versions of the same weapon on one battlefield, which breaks
  both point-buy fairness and the sim. "No loss" means it always loads — not that it's
  frozen in amber.
- **B. Missile magazines.** Never specified, and it matters more now that missiles track.
  *Recommend:* **limited ammo per missile slot**, count set by the component. Unlimited
  missiles plus two-turn tracking is likely the dominant strategy.
- **C. Arena size.** *Recommend:* **scales with point budget** — a 25-point duel and a
  150-point fleet action need different volumes, and it's a single tuning number.
- **D. Residual deadlock.** The boundary resolves drift, but not two engine-dead or
  disarmed survivors sitting inside the zone. *Recommend:* a **concede/resign** action, so
  the player always has an exit without introducing a draw state.
- **E. Does regen work under fire?** *Recommend:* **regen ticks each turn regardless**, for
  legibility. A "only if untouched" rule is more realistic and much harder to read.
- **F. Boundary warning.** *Recommend:* the zone is always visible, and the predicted-path
  ghost turns hostile the moment a plotted arc exits. Lethal *and* invisible is unfair;
  lethal and obvious is tense.

---

## What I'd Build First

Two prototypes, in this order, before any shipyard UI exists:

1. **One turn of blind-commit Newtonian movement** — two ships, real momentum, arc
   plotting, a bounded arena, a collision, and debris that persists into the next turn. If
   that turn is fun with programmer-art wireframes and zero shipyard, the game works. If it
   isn't, no amount of chassis will save it.
2. **A throwaway blind simultaneous 3D movement AI** — one heuristic bot plotting a thrust
   arc against an unknown opponent plan, without flying itself out of bounds. This is the
   highest-risk unknown in the project. Prove it before committing to five of them.
