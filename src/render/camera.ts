// TacticalCamera — the persistent orbit camera (Gate 1 §7.1 mapping).
//
// Gate 1 settled the mapping: stock OrbitControls (LMB orbit, MMB/⌥+LMB pan, wheel
// zoom), damping 0.08, generous min/max distance clamps only, `R` = reset-to-fleet,
// `F` = focus-selected. Camera state PERSISTS across every plan↔resolve↔plan cycle —
// never rebuilt between beats (Gate 1 §1). This module wraps that into the
// `TacticalCamera` contract; `TacticalView` owns its lifetime.
//
// The spherical framing math is split into pure free functions (`orbitToPosition`,
// `fleetViewPosition`, `clampDistance`) so the reset framing + distance clamps are
// unit-tested without a WebGL context (render is outside the sim determinism ban, so
// `Math.sin`/`cos` are fine here).

import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BodyId } from '../sim/index.js';
import type { TacticalCamera } from './types.js';

const DEG = Math.PI / 180;

/** Gate 1 §7.1 neutral framing: 35° elevation, 30° azimuth, 2.4× arena radius out. */
export const FLEET_VIEW = { elevationDeg: 35, azimuthDeg: 30, distanceFactor: 2.4 } as const;

/** Gate 1 §7.1 clamp ratios — the only limits on zoom (FR-14: no artificial wall). */
export const DISTANCE_CLAMP = { minFactor: 0.1, maxFactor: 12 } as const;

/** Orbit angles + distance → world position, orbiting the origin. Pure. */
export const orbitToPosition = (
  elevationDeg: number,
  azimuthDeg: number,
  distance: number,
): readonly [number, number, number] => {
  const elev = elevationDeg * DEG;
  const az = azimuthDeg * DEG;
  const y = distance * Math.sin(elev);
  const planar = distance * Math.cos(elev);
  return [planar * Math.cos(az), y, planar * Math.sin(az)];
};

/** The `R` reset framing for a given arena radius. Pure. */
export const fleetViewPosition = (arenaRadius: number): readonly [number, number, number] =>
  orbitToPosition(
    FLEET_VIEW.elevationDeg,
    FLEET_VIEW.azimuthDeg,
    arenaRadius * FLEET_VIEW.distanceFactor,
  );

/** Min / max orbit distance for an arena radius (Gate 1 §7.1). Pure. */
export const distanceBounds = (arenaRadius: number): { readonly min: number; readonly max: number } => ({
  min: arenaRadius * DISTANCE_CLAMP.minFactor,
  max: arenaRadius * DISTANCE_CLAMP.maxFactor,
});

/** Clamp a distance into the arena's orbit bounds. Pure. */
export const clampDistance = (distance: number, arenaRadius: number): number => {
  const { min, max } = distanceBounds(arenaRadius);
  return Math.min(max, Math.max(min, distance));
};

/**
 * Build the tactical camera over `canvas`. `document`/`window` access is guarded so
 * the module imports cleanly under node (the pure framing math above is what the unit
 * tests touch; the controller itself is exercised by the screen e2e in a real browser).
 */
export const createTacticalCamera = (
  canvas: HTMLCanvasElement,
  arenaRadius: number,
): TacticalCamera => {
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  const camera = new PerspectiveCamera(50, aspect || 1, 1, 40 * arenaRadius);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.zoomSpeed = 0.9;
  controls.rotateSpeed = 0.7;
  controls.panSpeed = 0.9;
  controls.screenSpacePanning = true;
  const bounds = distanceBounds(arenaRadius);
  controls.minDistance = bounds.min;
  controls.maxDistance = bounds.max;

  const resetToFleetView = (): void => {
    const [x, y, z] = fleetViewPosition(arenaRadius);
    camera.position.set(x, y, z);
    controls.target.set(0, 0, 0);
    controls.update();
  };
  resetToFleetView();

  const focus = (at: readonly [number, number, number]): void => {
    controls.target.set(at[0], at[1], at[2]);
    controls.update();
  };

  let focusSource: (() => readonly [number, number, number] | null) | null = null;
  const setFocusSource = (
    source: (() => readonly [number, number, number] | null) | null,
  ): void => {
    focusSource = source;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    if (key === 'r') {
      resetToFleetView();
    } else if (key === 'f' && focusSource !== null) {
      const at = focusSource();
      if (at !== null) focus(at);
    }
  };

  const hasDom = typeof document !== 'undefined' && typeof canvas.addEventListener === 'function';
  if (hasDom) {
    canvas.addEventListener('keydown', onKeyDown);
    // Make the canvas focusable so it can receive key events without extra wiring.
    if (canvas.tabIndex < 0) canvas.tabIndex = 0;
  }

  const resize = (width: number, height: number): void => {
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  };

  const update = (): void => {
    controls.update();
  };

  const dispose = (): void => {
    if (hasDom) canvas.removeEventListener('keydown', onKeyDown);
    focusSource = null;
    controls.dispose();
  };

  return {
    camera,
    controls,
    resetToFleetView,
    focus,
    setFocusSource,
    resize,
    update,
    dispose,
  };
};

/** The `Vec3`-like shape `focusSourceFor` accepts — three's `Vector3` matches
 *  structurally, so `ui` can wire the `F` key from plain sim positions without a
 *  value import of `three`. */
export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Convenience: the world position of a body id, given a `(id) → position` lookup —
 * the shape `TacticalView` hands to `setFocusSource` so `F` tracks the selection.
 * Returns `null` when the id is unknown (selection stale after a kill). The
 * `positionOf` return is loosened from `Vector3` to any `Vec3Like` so screens can
 * pass a plain-object lookup without importing three (arch §5: `ui` stays three-free).
 */
export const focusSourceFor = (
  selectedId: () => BodyId | null,
  positionOf: (id: BodyId) => Vec3Like | null,
): (() => readonly [number, number, number] | null) => () => {
  const id = selectedId();
  if (id === null) return null;
  const p = positionOf(id);
  return p === null ? null : [p.x, p.y, p.z];
};

/**
 * Bind a `positionOf` + `focus` pair into a `(id) → void` "slide-focus-to-body"
 * closure — the shape `TacticalView.focusBody` wraps. Returns a function that
 * no-ops when `positionOf(id)` is `null` (unknown id, selection stale after a kill).
 */
export const focusBodyFor = (
  positionOf: (id: BodyId) => Vec3Like | null,
  focus: (at: readonly [number, number, number]) => void,
): ((id: BodyId) => void) => (id) => {
  const p = positionOf(id);
  if (p === null) return;
  focus([p.x, p.y, p.z]);
};

/**
 * Project a world position through `camera` to CSS-pixel coordinates in a `width`×
 * `height` canvas. Returns `null` when the point sits behind the camera (NDC `z > 1`).
 *
 * Pure of side effects but requires the camera's world / projection matrices to be
 * current (`camera.updateMatrixWorld()` + `camera.updateProjectionMatrix()`); the live
 * view's RAF keeps them fresh, so `TacticalView.worldToScreen` needs no bookkeeping.
 */
export const projectToViewport = (
  pos: readonly [number, number, number],
  camera: PerspectiveCamera,
  width: number,
  height: number,
): { readonly x: number; readonly y: number } | null => {
  const ndc = new Vector3(pos[0], pos[1], pos[2]);
  ndc.project(camera);
  if (ndc.z > 1) return null;
  return {
    x: ((ndc.x + 1) * 0.5) * width,
    y: ((1 - ndc.y) * 0.5) * height,
  };
};
