# M13 — Render (`src/render/`)

> three.js tactical view — pixels only. Imports `sim` **types only** (`import type` +
> `verbatimModuleSyntax`) + `three`; imports nothing from `ui`/`app`/`persist`. Reachable
> only via the screens' dynamic `import('../../../render/index.js')`, so `three` stays in its
> own chunk (outside the first-paint budget). New module — first built in `tactical-skirmish`
> (S02 static view; S03 adds playback + plotting ghost).

<!-- SESSION-02 (tactical-skirmish) — static tactical view -->
## SESSION-02 — static tactical view

New module `src/render/` (M13). Imports `sim` **types only** + `three`; reachable only via the
screens' dynamic `import('../../../render/index.js')` — `three` stays in its own chunk (verified:
entry bundle is three-free with no static importer).

### Barrel (`src/render/index.ts`)

```ts
createTacticalView(canvas: HTMLCanvasElement, initialArenaRadius?: number): TacticalView
```

**Public types**
- `TacticalView` — `setState(state: MatchState): void` (reads only, never mutates — FR-33),
  `readonly camera: TacticalCamera`, `readonly scene: SceneHandles`, `pick(x, y): PickResult | null`,
  `resize(w, h, dpr?): void`, `dispose(): void`.
- `TacticalCamera` — persistent orbit camera: `camera` (`PerspectiveCamera`), `controls`
  (`OrbitControls`), `resetToFleetView()`, `focus([x,y,z])`, `setFocusSource(fn|null)`, `resize(w,h)`,
  `update()`, `dispose()`. `R` resets, `F` focuses last-picked body.
- `PickResult` — `{ readonly bodyId: BodyId; readonly kind: Body['kind'] }`.
- `FleetColor` = `0|1|2|3|4`; `RenderQuality` = `'high'|'reduced'`.

### Scene-handle seam (for SESSION-03 playback + ghost)
- `SceneHandles` — `{ context: SceneContext; ships: ShipInstances; hazards: HazardInstances;
  boundary: BoundaryShell; camera: TacticalCamera; render(): void }`. Exposed as `TacticalView.scene`.
  Playback pushes interpolated transforms via `ships.setPosition(id,x,y,z)` / `hazards` and adds its
  ghost `Line` + time-marks to `context.scene`, then drives its own RAF with `scene.render()` — no
  CP1–CP5 edits.
- `SceneContext` (`scene.ts`) — `renderer`, `scene`, `grid`, `arenaRadius`, `syncStalks(StalkInput[])`,
  `setArenaRadius(r)`, `setQuality(q)`, `resize(w,h,dpr?)`, `render(camera)`, `dispose()`.
- `ShipInstances` (`wireframes.ts`) — `group`, `sync(ShipInput[])`, `setPosition(id,x,y,z)`,
  `positionOf(id): Vector3|null`, `setResolution(w,h)`, `setQuality(q)`, `dispose()`. Also exports
  `fleetColorOf(fleetId): FleetColor` and `FLEET_PALETTE` (`0:#22e3ff 1:#ff3d7f 2:#ffb020 3:#a45bff 4:#7cff4f`).
- `HazardInstances` (`hazards.ts`) — `mesh` (`InstancedMesh`, 1 draw call/300 bodies), `sync(HazardInput[])`,
  `faceCamera(camera)`, `setQuality(q)`, `dispose()`. Also exports `HazardGlyph`
  (`Debris|TrackingMissile|SpentMissile`) + `bodyKindToGlyph(kind)`.
- `BoundaryShell` (`boundary.ts`) — `mesh`, `setRadius(r)`, `setQuality(q)`, `dispose()`.

### Notes for downstream
- `@types/three@0.171.0` added to devDependencies (three ships no bundled `.d.ts`).
- Render chunk (three surface: core + `OrbitControls` + `LineSegments2`/`LineSegmentsGeometry`/`LineMaterial`)
  ≈ **72.5 KB gz** — outside the first-paint entry (dynamic import), so it does not count against the
  arch §11 ≤650 KB gz first-paint gate.
- Node unit tests cover **pure helpers only** (color-id codec, camera spherical math, ship vertex tables,
  hazard atlas UV + kind→glyph, label projection + declutter); the WebGL scene is a screen-e2e concern (S04+).
- Pick color-space caveat: `instanceColor` readback assumes linear passthrough (`material.toneMapped=false`)
  — verify exact id decode in the first screen e2e; a color-managed renderer may need output-space tuning.

<!-- SESSION-03 (tactical-skirmish) — playback + ghost -->
### M13 Render — playback + ghost layer (SESSION-03)

Extends M13 (built static in SESSION-02). Two new public surfaces, both attached to a
live `TacticalView` over its `.scene` seam. `render` imports `sim` **types only**; the
ghost DRAWS a supplied path and never integrates one (single-integrator invariant stays
in `sim/physics/previewPath`).

**Trace playback — `src/render/TracePlayer.ts`**
```ts
attachTracePlayer(view: TacticalView): TracePlayer

interface TracePlayer {
  playMovement(record: MovementBeatRecord, opts?: PlaybackOpts): Playback;
  playAttack(record: AttackBeatRecord, opts?: PlaybackOpts): Playback;
  dispose(): void;
}
interface Playback { skip(): void; replay(): void; onDone(cb: () => void): void; dispose(): void; }
interface PlaybackOpts {
  durationMs?: number;          // default: movement = max(120, (keyframes.length-1)·48ms); attack = max(160, shots·90ms)
  clock?: () => number;         // ms; default Date.now — the ONLY wall-clock read in render
  raf?: (cb: (t: number) => void) => number;
  cancelRaf?: (h: number) => void;
  onDone?: () => void;
}
```
`skip()` and a full play leave identical final transforms (FR-19 outcome-invariant).
Wall clock never enters `sim` — playback consumes an already-final record.

**Plotting ghost — `src/render/ghost.ts`**
```ts
attachGhost(view: TacticalView): GhostLayer
interface GhostLayer { draw(input: GhostDrawInput): void; clear(): void; dispose(): void; }

interface GhostDrawInput {
  positions: readonly Vec3[];   // from controller.previewArc (a PreviewPath) — REQUIRED
  endsOutsideArena: boolean;    // from previewArc — REQUIRED
  deltaVMag: number;            // plotted |Δv| — REQUIRED
  beatSeconds?: number;         // = physicsConfig.dt → true per-second numbered marks
  hullRadius?: number;          // firing ship radius → exact §2a low-Δv merge threshold
}
fromPreviewPath(preview, deltaVMag, { beatSeconds?, hullRadius? }): GhostDrawInput  // 1:1 adapter

// Pure, exported for the screens: sampleAtIndex, computeMarks, exitStateFor,
// ghostLineColor, isLowDeltaVArc. Palette tokens: GHOST_CYAN, GHOST_MAGENTA_HI,
// GHOST_AMBER, GHOST_EXIT_RED, EXIT_STATUS ('PREDICTED EXIT — SHIP DESTROYED').
```
Three-channel exit (FR-16): `endsOutsideArena` fires all three together — red line
(`ghostLineColor`), ✕ EXIT sprite at the crossing endpoint, and the `EXIT_STATUS`
callout string. All exported from `src/render/index.ts`.

---

<!-- SESSION-01 (skirmish-tactical-parity) — M13 Render public-API delta -->
### M13 Render — S01 (skirmish-tactical-parity): opacity fade · projection · trail · marks-interval

Extends the S02/S03 M13 surface. Render still imports `sim` **types only** (FR-33); the
entry chunk stays three-free (arch §11 / D-RENDER-DYNAMIC, verified: 0 three symbols
in the entry bundle after `vite build`).

**Ship instances (`wireframes.ts`)** — per-instance mid-beat fade seam:
```ts
interface ShipInstances {
  // ...existing surface...
  /** Playback: presence alpha for one ship (0 = gone, 1 = solid).
   *  Multiplied against SHIP_DEFAULT_OPACITY so alpha = 1 matches a freshly-synced ship. */
  setOpacity(id: BodyId, alpha: number): void;
}
export const SHIP_DEFAULT_OPACITY = 0.95;
```
Each ship now owns its own `LineMaterial` clone so `setOpacity` fades one ship without
touching fleetmates. `sync()` resets any live ship back to the default (fade is transient).

**Interp / TracePlayer** — no new interp math (the `LerpedBody.alpha` already existed).
`TracePlayer.playMovement` now:
- Applies `sample.alpha` via `ships.setOpacity(id, sample.alpha)` each RAF frame — a ship
  destroyed mid-beat fades at its last position instead of freezing (closes S03 gap).
- Extends `PlaybackOpts` with `trail?: TrailLayer`, `beatSeconds?: number`,
  `startSimTime?: number`. When both `trail` and `beatSeconds` are supplied, records one
  trail point per NEW keyframe transition (not per RAF frame), at `startSimTime +
  keyframeIdx · beatSeconds`. `skip()` flushes every missed keyframe so full-play and
  skip leave the trail in the same state (FR-19 outcome-invariance).

**TacticalView (`types.ts` + `TacticalView.ts`)** — two new methods:
```ts
interface TacticalView {
  // ...existing surface...
  /** World → CSS-px in the current canvas rect. Returns null when behind the camera. */
  worldToScreen(pos: readonly [number, number, number]): { readonly x: number; readonly y: number } | null;
  /** Slide the camera focus onto a body by id; no-op for unknown ids (roster click-to-focus). */
  focusBody(id: BodyId): void;
}
```

**Camera (`camera.ts`)** — pure helpers added; `focusSourceFor` loosened:
```ts
export interface Vec3Like { readonly x: number; readonly y: number; readonly z: number; }
export const focusSourceFor: (
  selectedId: () => BodyId | null,
  positionOf: (id: BodyId) => Vec3Like | null,   // was: Vector3 | null
) => (() => readonly [number, number, number] | null);
export const focusBodyFor: (positionOf, focus) => (id: BodyId) => void;
export const projectToViewport: (pos, camera, width, height) => { x: number; y: number } | null;
```
The `Vec3Like` loosening lets `ui` wire the `F` key from plain sim positions without
importing `three` (arch §5: `ui` stays three-free).

**Ghost (`ghost.ts`)** — one new optional field:
```ts
interface GhostDrawInput {
  // ...existing...
  /** Off/1s/2s/4s selector (S01, prototype port). undefined or 0 = per-second; > 0 =
   *  one mark every markIntervalSec sim-seconds. */
  readonly markIntervalSec?: number;
}
```
`computeMarks` reuses the existing exact time→index lerp — mark `k` sits at
`(k · interval / beatSeconds) · (n − 1)`. NEVER a second integrator (§2 "preview must
not lie"). `fromPreviewPath` threads `markIntervalSec` through.

**New primitive — `trail.ts`** (Gate 1 FINDINGS §2a port):
```ts
attachTrail(view: TacticalView, opts?: { readonly windowSeconds?: number }): TrailLayer
interface TrailLayer {
  push(id: BodyId, at: readonly [number, number, number], simTime: number): void;
  tick(nowSimTime: number): void;
  clear(): void;
  dispose(): void;
}
// Pure helpers (node-testable):
export const trailAlphaFor: (age: number, window: number) => number;
export const pruneTrail: <T extends { at: number }>(points, nowSimTime, window) => T[];
export const DEFAULT_TRAIL_WINDOW_SECONDS = 16;
export const TRAIL_COLOR = 0x22e3ff;
```

**Barrel (`index.ts`)** — appended (no reorder / no existing export removed):
- `attachTrail`, `TrailLayer`, `TrailPoint`, `DEFAULT_TRAIL_WINDOW_SECONDS`,
  `TRAIL_COLOR`, `trailAlphaFor`, `pruneTrail`.

**Known scope note (for S03/S04 handoff):**
- `setOpacity` is ship-only. Hazards (debris / missiles) still re-sync per RAF from the
  interp'd hazard set — they don't fade mid-beat. If a mid-beat hazard fade is wanted
  later, it belongs on a `HazardInstances.setOpacity` seam, not here.
- `worldToScreen` reads the live viewport width/height cached inside `TacticalView`;
  screens need no manual refresh — `resize()` already updates the cache.
