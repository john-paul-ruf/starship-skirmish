# Gate 1 — Findings

> **Scope.** Gate 1 is the disposable prototype the architecture spec calls for
> (FR-32, architecture §12). Its only job is to answer *"is that turn fun?"* by
> playing the real deterministic `sim/physics` through cheap wireframes, and to
> settle three design-doc open questions the mocks couldn't touch:
> §7.1 camera mapping, §7.2 arc-plotting input, §7.4 marker/label density.
>
> Findings below feed F6 (render) and F7/F8 (ui). The code itself is not
> carried forward.

---

## 0. Fun verdict — the Gate 1 exit criterion

**Verdict: fun enough to build.** The core loop — plot a blind arc, watch it
resolve into someone else's blind arc, and either miss theatrically or crash
theatrically — reads as tense and legible even at prototype-scale wireframes.
Two moments made the verdict:

- **Blind-plot commit → simultaneous resolve** feels like a decision, not a
  poll. Because both ships' plans lock and animate together at ~55 ms/keyframe,
  the resolution reads as a beat that *happened*, not a step through the
  planner's math. The chunky playback rate (deliberate, prototype-scale) is
  right; a smoother interpolation in M13 should preserve the same "beat lands
  with a thud" cadence.
- **Contact carrying into next turn as debris** is where the fun *earns
  its physics engine*. Head-on preset: two ships collide at origin, both bounce
  outward, and the two shards ride along their bounces. Next turn — even both
  ships coasting — the shards are still there, still moving. Chase preset
  produces a contact that leaves a debris cloud in the trailing ship's future
  path; the moment you realise "that shrapnel is in my next arc" is what a
  playtester should have.

Where the fun bar drops:

- **Turn beat length feels short** with the current `dt = 8 s` and Δv scale.
  A single beat carries a ship ~15–25% of the arena width. That's readable, but
  a whole 3–4-ship engagement fits in ~10 turns — the tactical range feels
  compressed. F4 tuning (`catalog/tuning.json`) should probably lengthen dt or
  narrow the Δv-to-arena ratio so an engagement plays out over ~15–25 turns.
- **Elastic collisions with `restitution = 0.35`** produce a nice deflection but
  no dramatic decel. Real hull damage (F4) will make contact feel *bad* on top
  of feel *interesting* — the missing consequence at prototype-scale is
  something the harness in F4 should reveal, not something to tune here.
- **No sound.** The absence is felt even at prototype quality. Not a Gate 1
  concern, but flagged for the polish phase.

---

## 1. Design §7.1 — Camera control mapping

The mocks left this open. Prototype answer:

- **Stock OrbitControls-derived mapping is the right baseline.** LMB drag →
  orbit, MMB (or ⌥+LMB) → pan, mouse-wheel → zoom. These are the industry
  defaults a player already knows; no keybinding tutorial required.
- **`R` = reset-to-fleet-view** is essential. In the prototype it snaps back to
  a 35° elevation / 30° azimuth angle at ~2.4× arena radius. Being able to
  bail out of a bad orbit and re-frame the whole engagement is what makes free
  orbit tolerable at all.
- **`F` = focus selected ship** is a strong second — it slides the orbit target
  onto the ship without changing distance, so you can spin around a specific
  hull without hunting. Recommended.
- **No artificial clamps needed on distance or angle** past a very generous
  min/max — FR-14 was right. `minDistance = arenaRadius × 0.1` / `maxDistance =
  arenaRadius × 12` in the prototype felt like the whole range was reachable
  without ever hitting a "you can't zoom past this" wall.
- **Camera state MUST persist across the plan↔resolve↔plan cycle.** The
  prototype does not tear the camera down between beats; that felt correct at
  every commit. M16 (app state) owns this in the real build.
- **Damping (`enableDamping: true`, factor ≈ 0.08)** is worth it. It removes
  the jitter of small mouse noise without adding perceptible lag.

**M13 (render) recommendation:** carry the OrbitControls-derived mapping
forward; wire `R` and `F` shortcuts globally; forbid tearing the camera state
down inside beat transitions.

---

## 2. Design §7.2 — Arc-plotting input

The mocks proposed numeric bearing / pitch / magnitude entry with a
"maybe a 3D drag handle?" open question. Prototype answer:

- **Numeric entry is the right primary input, not a fallback.** NFR-Accessibility
  requires keyboard reachability regardless, so numeric was going to exist. But
  the prototype revealed that numeric is *also* the fastest way to iterate a
  plan — `Tab` between bearing / pitch / magnitude, edit a value, watch the
  ghost snap, repeat. It reads like editing a spreadsheet cell (which design
  §5 Flow 1 says the Shipyard should feel like — the same principle applies
  here). A drag handle would add graceful direct-manipulation for casual
  players, but for repeat players numeric wins on iteration speed.
- **Live ghost is non-negotiable.** Every input change re-runs `previewPath()`
  and repaints. Because previewPath shares its integrator with resolveMovement
  (verified by the S03 test), the ghost cannot lie — what it draws is what
  will happen (absent contact). That trust is where all the tension lives.
- **Boundary-exit signal must be three-channel** (design §4.1). The prototype
  turns the ghost line red, drops an ✕ EXIT sprite at the crash point, and
  updates the status text to "✕ Predicted exit — arc leaves the arena." Any
  one of the three alone was ambiguous during play; the trio was instant to
  read every time. Do NOT drop any of them.
- **Δv budget is enforced at both the slider and at plan construction.** The
  slider's `max` attribute + the JS clamp in `clampMag` are redundant on
  purpose — over-spend is structurally impossible from this UI, matching the
  design §4.4 "no free stop" mandate.
- **A 3D drag handle is a "yes, later" — not a Gate 1 blocker.** F7 (ui) can
  add it as an alternate input driving the same `MovementPlan`. Architecturally
  irrelevant (per architecture §13 open Q1). If added, it MUST leave numeric
  entry intact for keyboard/accessibility.

**F7/F8 recommendation:** implement numeric entry first, exactly as here.
Bearing / pitch as `<input type="number">`, magnitude as slider clamped to
budget. Ghost repaint on every `input` event. Add drag handle as an alternate
input in polish if playtesters ask.

---

## 3. Design §7.4 — Marker / label density at scale

The mocks show ~14 bodies; the design budget is 60 ships + 300 hazard bodies.
Prototype probe: a `+ 60 hazards` toggle scatters 60 inert orange sprites
across the arena (using a deterministic integer-hash placement, so A/B is
stable). Observations:

- **Point-sprite hazards at ~60 bodies remain legible** at fleet-scale zoom.
  Individual sprites don't clump into unreadable blobs; ships and hazards read
  as distinct classes at silhouette-only distance. Extrapolating: 300 hazards
  (5× the probe) should still be tractable *provided the render uses a single
  InstancedMesh with a glyph atlas* — as architecture §9 already specifies —
  rather than one draw call per hazard.
- **Labels do not scale.** The prototype omits per-body labels entirely (only
  the field-count HUD reads out counts). Any per-body label pass at 300 bodies
  would collapse into a wall of overlapping text. Architecture §9's decision
  — "ships only get DOM labels, hazards carry identity in glyph sprite" — is
  the right one, and this probe confirms the hazard glyph is enough to
  distinguish them from ships. Don't relax that rule.
- **Boundary sphere wireframe accumulates brightness against additive
  blending** — the prototype had to drop the boundary opacity from 0.22 to
  0.14 so magenta-fleet ghosts still read across it. M13's shader-based
  hex-grid boundary should design for the same problem: the boundary must be
  legible from every angle *and* not compete with per-body glyphs / paths.
  A hex-grid pattern is inherently sparser than a wireframe sphere at the same
  visual weight, so the shader path should improve here.
- **Ceiling ratified conditionally.** The design budget of 60 ships + 300
  hazards looks achievable *at fleet-scale zoom*. What this probe cannot
  answer, and F6 must: legibility of the same 360 bodies at close-in zoom,
  where dense clusters near a capital ship could overlap. Screenshot capture
  the same set at 3–4 zoom levels during F6.

**F6/F7 recommendation:**
- Ships get DOM labels (≤ 60 at ceiling).
- Hazards carry identity in a single-InstancedMesh glyph atlas, NO per-body
  DOM label.
- Boundary uses a hex-grid shader at low alpha; measure against per-body
  glyphs to keep the two visually independent.
- Ship silhouette-by-class (design §1.1 ⛓) is the load-bearing legibility
  cue; F6 must actually distinguish the four chassis classes by outline.

---

## 4. Surprises / tuning notes for F4

Not bugs — signals the tuning phase should use.

- **subStepCount clamps at 64 at high Δv.** With `dt = 8, Δv = 200,
  minRadius = 60`, subStepCount picks 64 (the max). That means at the *highest*
  end of the Δv budget, the sim runs at the outer edge of its precision
  envelope. F4 should either lower the Δv ceiling in `catalog/tuning.json` or
  raise `subStepMax`. The physics tests already lock in tunneling behavior at
  N=4; N=64 sound is proven by the S03 CCD regressions.
- **`restitution = 0.35`** produces a satisfying deflection at head-on
  contact, but the deflection is too clean — momentum is largely preserved.
  Real combat rules (F4 sim/rules) will add hull damage on top of physics
  damage, which should feel like "bad but survivable." Watch this at F4.
- **Contact damage magnitude reported** — for head-on at 200 m/s closing speed,
  `damage = 2400` (k · reducedMass · relSpeedNormal² = 0.0012 · 50 · 40000).
  That's plenty of headroom for the rules layer to translate into hull points
  and component damage; the coefficient can shrink if F4 finds it dominates.
- **Boundary-exit destruction is unforgiving** — a plotted arc that ends
  outside is dead-on-arrival. The mocks already carry a second-confirmation
  modal for it (design §4.1); F7/F8 must implement that modal, not just the
  hostile ghost. The prototype elides the modal for brevity — noted so F7 does
  not skip it thinking Gate 1 covered it.
- **The prototype's fleet-color palette is *bearable* against the red
  boundary** but only after tuning the boundary opacity down. F6 should verify
  the same interaction against the real shader boundary at every fleet color
  (the palette has 5 fleet colors, not 2). The magenta-vs-red near-miss
  motivated adding a `magentaHi` sibling token for ghost paths; the same
  problem may exist for `fleet-3` violet against `--hazard` orange.

---

## 5. How to run this (for a future reader)

```
npx vite --config prototypes/gate1/vite.gate1.config.ts
# → http://127.0.0.1:8082/
```

Presets in the top bar reproduce a head-on collision, a graze, and a chase
setup that leaves debris in the follower's path. `+ 60 HAZARDS` toggles the
marker-density probe. `R` resets the camera. `F` focuses the selected ship.
`[1]` / `[2]` swap the plan tabs.

The whole prototype lives under `prototypes/gate1/`. It imports the real
deterministic sim from `../../src/sim/**` read-only — nothing under `src/` is
modified. The prototype is disposable (FR-32) and excluded from `npm run
build` / `npm run lint` (SESSION-01's `tsconfig` + eslint `ignores`).
