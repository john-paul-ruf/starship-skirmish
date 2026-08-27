// Public type surface of M13 render (architecture §4, §9).
//
// `render` is a pixels-only leaf: it imports `sim` as **types only** (`import type`
// + `verbatimModuleSyntax` makes a stray value import a build error) and never holds
// a write path to `MatchState` — "deleting `src/render/` must leave a working headless
// game" (FR-33). It may import `three` freely (the boundary lint's `render` default is
// `allow`); the screens reach render through a dynamic `import()` so three.js stays in
// its own chunk (arch §11).
//
// The concrete `TacticalCamera` / `SceneHandles` values are produced by `camera.ts`
// and the `TacticalView` assembly; here they are the interface contracts so `types.ts`
// stays a self-contained leaf the rest of the module compiles against.

import type { PerspectiveCamera } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Body, BodyId, MatchState } from '../sim/index.js';

/** The five fleet colors (design §1.1, `mocks/console.css` `--fleet-0..4`). */
export type FleetColor = 0 | 1 | 2 | 3 | 4;

/** `reduced` drops bloom / fat-line width / billboard animation (reduced-motion, degrade). */
export type RenderQuality = 'high' | 'reduced';

/** What `pick(x,y)` resolves a screen coordinate to, or `null` for empty space. */
export interface PickResult {
  readonly bodyId: BodyId;
  readonly kind: Body['kind'];
}

/**
 * The persistent tactical camera (Gate 1 §7.1). Wraps a `PerspectiveCamera` +
 * `OrbitControls`; its state survives every plan↔resolve↔plan cycle (never rebuilt
 * between beats). `R` resets to the fleet framing; `F` focuses the selected body.
 */
export interface TacticalCamera {
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  /** Snap back to the neutral fleet-scale framing (35° elev / 30° az at ~2.4× arena R). */
  resetToFleetView(): void;
  /** Slide the orbit target onto `at`, keeping the current distance. */
  focus(at: readonly [number, number, number]): void;
  /**
   * Supply the world position of the currently-selected body so the `F` shortcut
   * can focus it. `null` clears the source (F becomes a no-op).
   */
  setFocusSource(source: (() => readonly [number, number, number] | null) | null): void;
  /** Re-fit the projection after the container resizes. */
  resize(width: number, height: number): void;
  /** Advance orbit damping — call once per rendered frame. */
  update(): void;
  dispose(): void;
}

/**
 * The public face of the render module (arch §4). `createTacticalView(canvas)`
 * returns this; the screens hold it across a whole match and call `setState` after
 * every beat resolve. `setState` **reads** `MatchState` and never mutates it.
 */
export interface TacticalView {
  /** Diff a frozen `MatchState` into ship / hazard instances + labels. Never mutates. */
  setState(state: MatchState): void;
  readonly camera: TacticalCamera;
  pick(x: number, y: number): PickResult | null;
  resize(width: number, height: number, dpr?: number): void;
  dispose(): void;
}
