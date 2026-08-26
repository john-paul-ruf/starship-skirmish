# Gate 2 — Findings

> **Scope.** Gate 2 is the disposable prototype the architecture spec calls the
> project's *"highest-risk unknown"* (FR-32, architecture §12): can a heuristic
> bot plot a blind, simultaneous 3D thrust arc against an unknown opponent plan
> **without flying itself out of bounds through unforced error** (FR-29)?
> The exit criterion is not eyeballed — it is measured by `harnessRun.ts`
> over 100 seeded scenarios, and requires **zero unforced boundary deaths**.
>
> Findings below feed F5 (`sim/ai` — the real `HeuristicCommander`). The code
> here is disposable and not carried forward.

---

## 0. Verdict — the Gate 2 exit criterion

**Verdict: PASS.** The Gate 2 heuristic clears the FR-29 constraint with margin.

Headline numbers, `tsx prototypes/gate2/harnessRun.ts` on the default seed range:

```
scenarios: 100 (seeds 1..100)
beats run: 1500
total contacts: 26
ship boundary exits: 0
  unforced (bot flew self out with a safe alternative): 0
  forced by collision (FR-22 legal shove): 0
  forced by momentum (no candidate could save): 0

verdict: PASS — exit criterion is 0 unforced deaths
```

Confidence check at wider scope (`--seeds 1..200 --beats 25`, 5000 beats total,
68 contacts): **also 0 exits of any kind.**

Adversarial stress (`--adversarial`, 200 spawns × 6 beats = 1200 plans, every
ship placed at 90% of shell radius with an outbound velocity of 100–220 —
beyond the 80/beat delta-V budget so some setups are physically unsalvageable):
of 599 plans that could not stay inside, **every one was confirmed forced** by
cross-checking against a pure toward-center candidate. The hard constraint
held: whenever a safe candidate existed in the search set, the planner
picked one.

---

## 1. What the heuristic actually does

Three moving parts, in the order they matter:

### 1a. Cruise-velocity target (not per-beat impulse)

The single most load-bearing decision. The naïve version of this planner
("thrust at full budget toward the nearest enemy every beat") **fails the
gate** — the diagnostic showed pre-plan velocities of 172–284 by beat 6,
because 80 units of delta-V compound over five beats faster than one beat's
brake can undo. The fix is to make the planner target a *cruise velocity*
rather than a *delta-V*:

```
desired_v      = normalize(toTarget) * cruiseSpeed        // 60 with budget 80
deltaV_command = clamp(desired_v - current_v, budget)
```

Post-plan speed toward the target converges to `cruiseSpeed` regardless of
how many beats the chase runs. `cruiseSpeed = 60 < budget = 80` means one
beat's brake can always fully halt the ship — which is FR-29's "hard
constraint" held over an arbitrary number of beats, not just this beat.

### 1b. Preview-based boundary constraint

Before committing a plan the planner evaluates a small candidate set with
`physics.previewPath` (architecture §9 — preview and resolve share the
integrator, tested in S03 so an in-bounds preview means in-bounds resolve
absent collisions). Candidate order:

| Rank | Candidate | Intent |
|------|-----------|--------|
| 0 | baseline | The plan we *want* to fly. |
| 1 | baseline × 0.5 | Gentler version of the same shape. |
| 2 | baseline × 0.25 | Barely commit. |
| 3 | zero | Coast; let momentum ride out. |
| 4 | brake + toward-center (½ each) | Kill inertia and turn inward. |
| 5 | brake | Kill inertia. |
| 6 | toward-center at full budget | Hardest push back into the arena. |

The first (lowest-rank) candidate whose `previewPath` positions all stay
inside the arena wins. If none is safe (a genuinely forced situation), the
one with the most in-bounds sub-steps is chosen as best-effort. In the
100-seed verdict run, no ship ever hit the best-effort path.

### 1c. Nearest-threat target selection

Trivial — nearest enemy ship, deterministic BodyId tiebreak on tied
`distanceSq`. Threat-quality modelling (mass × speed × angle of approach)
is out of scope; F5's `HeuristicCommander` layers proper threat maps.

---

## 2. Heuristic → F5 tier mapping (`rookie` / `veteran` / `ace`)

F5 will build three difficulty tiers "differing **only** by decision
quality" (FR-30). What survives from this prototype into each:

### rookie

- **Cruise-velocity target with a low `cruiseSpeed`** (½ budget or less).
  Slow, predictable, but structurally FR-29-safe.
- **Nearest-threat target selection** (no lookahead, no threat weighting).
- **Baseline candidate only** with a boundary-safety veto: if baseline
  preview exits, coast (rank 3). No fallback ladder. This intentionally
  keeps `rookie` bad at recovering from a bad setup — coasting into a
  collision is *fine*, that's the tier's flavour.

### veteran

- **Cruise-velocity at ~⅔ budget** — faster closing but still recoverable.
- **Weighted-nearest target** (nearest but bias against high-HP targets).
- **Full 7-candidate ladder from this prototype**, unchanged.
- Add a **2-beat lookahead veto**: for each candidate, also run
  `previewPath` on a *coast beat* immediately after, and reject candidates
  whose end-of-next-beat position would exit. This is the natural next
  strength beyond one-beat safety.

### ace

- **Cruise-velocity capped by wall-distance**: `cruiseSpeed(range,
  wallDistance) = min(baseCruise, wallDistance / dt / safetyFactor)`. A
  ship near the wall cruises slower — this collapses the "forced by
  momentum near wall" surface to zero even before the boundary constraint
  votes.
- **Threat map**: score enemies by DPS × survivability × angle-to-fire.
- **3-beat lookahead** with velocity-and-position projection.
- **AoE friendly-fire check** on candidate directions (FR-29 acceptance
  criterion "bots account for their own AoE friendly fire").

All three tiers share this file's `planShip` shape: pick target, pick
baseline arc, evaluate candidate set with `previewPath`, choose safest-that-
matches-preference. That's the `Commander` interface F5 promotes into
`src/ai/HeuristicCommander.ts`.

---

## 3. Blind-commit structural check

`BlindView` in this prototype is a `readonly { arena, bodies }` — no
`plans` field, no `pendingPlans` field, no back-reference to the coordinator.
`makeBlindView` `Object.freeze`s the wrapper and the bodies slice, so a
misbehaved planner cannot even mutate its own input. This mirrors, at
prototype scope, the structural guarantee `sim/loop` will provide in F4
(architecture §6.2, §6.3): pending plans exist ONLY as a closure `const`
inside `TurnCoordinator.runTurn()`, unreachable from the view.

`harnessRun.ts` re-emphasises this by collecting all fleets' plans against
the SAME view before feeding any of them to `runScenario`. A bot cannot
observe another bot's plan for the current beat — there is nothing to
observe.

---

## 4. Surprises / notes for F5 and F4 tuning

Not bugs — signals the real build should use.

- **The cruise-velocity refactor was the fix.** The first draft of this
  planner (per-beat impulse toward target, capped by budget) FAILED the
  gate with 276+ forced-by-momentum exits across 100 seeds. Root cause was
  velocity accumulation, not the boundary check. F5's tiered planners MUST
  target a cruise velocity, not an impulse — otherwise the FR-29 constraint
  degrades over long engagements even with correct per-beat safety votes.
- **The 7-candidate ladder is enough.** With cruise-velocity targeting in
  place, the vast majority of beats resolve on rank 0 (baseline). The
  fallback ladder exists for collision aftermath (a ship shoved to
  high velocity in beat K uses ranks 4–6 in beat K+1 to recover), but the
  simple presence of "toward center at full budget" as the last option
  suffices to keep the constraint held.
- **Initial-state design of the harness matters.** The first harness
  version placed ships in a cube of half-side 700 (max magnitude ~1212)
  inside an 800-radius arena — most ships started OUTSIDE the arena and
  died on beat 0 as forced-momentum exits, muddying the verdict. Corrected
  to half-side 450 (inscribed in a 780-radius ball) so every ship starts
  comfortably inside. Velocity bounds ±40/axis (max mag ~69 < budget 80)
  guarantees every initial state is fully brakable in one beat, so no seed
  hands the planner an unrecoverable inheritance.
- **`runScenario` reuse is *literal* — one Scenario per beat.** S04's
  `runScenario` pre-computes `plansPerBeat`, which is the wrong shape for
  a match where each beat's plans depend on that beat's state. The gate
  harness invokes `runScenario` with `beats: 1` per beat and threads
  `finalBodies` forward. F4's `MatchScenario` (the discriminated-union
  sibling S04 anticipated) can either lean into this per-beat replan
  pattern or add a `commander` field the runner drives internally.
- **Contacts stayed rare (26 contacts across 1500 beats).** The cruise-
  velocity heuristic collides less than the impulse heuristic because
  ships don't overshoot and end up trading passes. F5's veteran/ace tiers
  need to *actively seek* collisions (or fire ranges) as engagement
  goals — the current heuristic gets *near* the target and hovers at
  standoff, which reads as timid at play scope. Not a Gate 2 concern
  (which is about not-dying, not about winning); flagged for F5.
- **No wall-clock, no `Math.random` in the planner.** The whole harness is
  reproducible seed-for-seed — same seed range → same tally on every
  invocation. This is not required (`prototypes/**` is outside the sim
  ban-list) but was chosen so any future "gate 2 regressed" claim can be
  reproduced without ambient noise.
- **`planPreviewExits` is a real API for F4.** F4's `ResolutionTrace` will
  want to record "planner classification of this exit" for post-match
  reporting; the ground-truth ("preview said unsafe") calculation used
  here transfers directly. Consider exposing it from the real
  `HeuristicCommander` as a per-plan annotation.

---

## 5. How to run this (for a future reader)

```
# Gate 2 verdict — 100 seeds × 15 beats, must print PASS
tsx prototypes/gate2/harnessRun.ts

# Wider confidence run
tsx prototypes/gate2/harnessRun.ts --seeds 1..200 --beats 25

# Per-seed breakdown
tsx prototypes/gate2/harnessRun.ts --verbose

# FR-29 hard-constraint stress (worst-case spawns)
tsx prototypes/gate2/harnessRun.ts --adversarial

# All of the above
tsx prototypes/gate2/harnessRun.ts --seeds 1..200 --beats 25 --verbose --adversarial
```

Exit code is `0` on PASS, `1` on FAIL — usable directly in CI if F5 wants a
regression harness against this file's numbers.

The whole prototype lives under `prototypes/gate2/` and imports the real
deterministic sim from `../../src/sim/**` + S04's runner from
`../../tools/balance/scenario.js`, both read-only. Nothing under `src/` or
`tools/` was modified. The prototype is disposable (FR-32) and excluded
from `npm run build` / `npm run lint` (SESSION-01's `tsconfig` + eslint
`ignores`).

**Both gates now have verdicts. Per FORGE-CONFIG.md Custom Rule 1 the
downstream program build (F2 onward) is unblocked.** F5's real
`HeuristicCommander` builds against the `Commander` interface, promoting
the cruise-velocity + candidate-ladder shape into three tiers per §2.
