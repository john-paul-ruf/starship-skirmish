// trail — a flown-path trail primitive (Gate 1 FINDINGS §2a, S01 port).
//
// The prototype's "last ~16 s" fading trail never left `prototypes/gate1/`. This
// module lifts it into `src/render/` as a small handle a screen can attach to a
// live `TacticalView`: `push` a flown position (once per new keyframe, not per RAF
// tick), `tick` to advance the fade to a new sim-time, and old points past the
// window drop out. `render` imports `sim` **types only** (FR-33) and mutates
// nothing — trails are drawn from positions the caller supplies.
//
// playtest-feedback-02 SESSION-01: the visual primitive is now an **additive**,
// size-attenuated `Points` cloud (prototype `pushTrail`, `AdditiveBlending`,
// `sizeAttenuation: true`) instead of the barely-visible 1 px `Line` the shipping
// build had. Public surface is unchanged — `attachTrail` / `TrailLayer` / `push` /
// `tick` / `clear` / `dispose` keep their signatures; the barrel is untouched. An
// optional `pointSize` on `attachTrail` opts a caller into a non-default world size
// (the prototype scales by ship hull radius; the shipping layer does not have that
// per-ship datum, so callers pass the size or accept the default).
//
// The fade math (`trailAlphaFor` monotonically decreasing to 0 at the window edge)
// and the window drop (`pruneTrail`) are pure exported helpers so a node unit test
// can lock the shape without a WebGL context.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Points,
  PointsMaterial,
} from 'three';
import type { BodyId } from '../sim/index.js';
import type { TacticalView } from './types.js';

/** Default fade window in sim-seconds (FINDINGS §2a note: "last ~16 s"). */
export const DEFAULT_TRAIL_WINDOW_SECONDS = 16;

/** Cyan mirroring the ghost's own-fleet line — the "traced path" cue reads consistently. */
export const TRAIL_COLOR = 0x22e3ff;

/**
 * Default world-space point size when the caller does not supply one. Matches the
 * prototype's `Math.max(4, hullRadius * 0.5)` at typical fighter/frigate hulls
 * (~12 units) so the shipping visual reads the same at fleet zoom.
 */
export const DEFAULT_TRAIL_POINT_SIZE = 6;

/**
 * Per-ship particle cap — mirrors the prototype's `TRAIL_MAX`. At `DEFAULT_
 * TRAIL_WINDOW_SECONDS` (16) this is generous headroom for typical keyframe rates
 * (≈ 60 ships × ≤ 20 keyframes/beat well within the cap).
 */
export const TRAIL_MAX_POINTS = 300;

/** One recorded flown position, timestamped in sim-seconds. */
export interface TrailPoint {
  readonly id: BodyId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Sim-time (seconds) the point was flown at — NOT wall-clock. */
  readonly at: number;
}

/**
 * Fade alpha for a point of age `age` (sim-seconds) in a `window`-second window.
 * Monotonically decreasing from 1 (fresh) to 0 (at or past the window edge). Pure.
 */
export const trailAlphaFor = (age: number, window: number): number => {
  if (window <= 0) return 0;
  if (age <= 0) return 1;
  if (age >= window) return 0;
  return 1 - age / window;
};

/**
 * Drop trail points older than `window` sim-seconds relative to `nowSimTime`.
 * A point survives iff `nowSimTime - at <= window`. Pure — returns a fresh array.
 */
export const pruneTrail = <T extends { readonly at: number }>(
  points: readonly T[],
  nowSimTime: number,
  window: number,
): T[] => {
  const out: T[] = [];
  for (const p of points) if (nowSimTime - p.at <= window) out.push(p);
  return out;
};

/** The trail-render handle a screen (or TracePlayer) drives. */
export interface TrailLayer {
  /**
   * Record one flown position for `id` at `simTime` (sim-seconds). Older points past
   * the window drop out; the visual updates immediately.
   */
  push(id: BodyId, at: readonly [number, number, number], simTime: number): void;
  /**
   * Advance the fade horizon to `nowSimTime` — drops points past the window and
   * re-attenuates the surviving tail. Call when sim-time advances without a new push
   * (e.g. between beats, so idle ships fade out).
   */
  tick(nowSimTime: number): void;
  /** Drop every recorded point — leaves an empty canvas until the next `push`. */
  clear(): void;
  dispose(): void;
}

interface ShipTrail {
  points: TrailPoint[];
  readonly cloud: Points;
  readonly geometry: BufferGeometry;
  readonly material: PointsMaterial;
  readonly positions: Float32Array;
  readonly colors: Float32Array;
}

/**
 * Attach a flown-path trail to `view`. Points added to the view's scene (rides the
 * existing RAF via `view.scene.render()`). The layer keeps per-ship additive
 * particle clouds and fades their tails by age — the sim-time model is entirely the
 * caller's, we just receive timestamps and window-prune against them.
 */
export const attachTrail = (
  view: TacticalView,
  opts: { readonly windowSeconds?: number; readonly pointSize?: number } = {},
): TrailLayer => {
  const window = opts.windowSeconds ?? DEFAULT_TRAIL_WINDOW_SECONDS;
  const pointSize = opts.pointSize ?? DEFAULT_TRAIL_POINT_SIZE;
  const scene = view.scene.context.scene;
  const group = new Group();
  scene.add(group);

  const trails = new Map<BodyId, ShipTrail>();
  let now = 0;
  const baseColor = new Color(TRAIL_COLOR);

  const rebuild = (trail: ShipTrail): void => {
    const n = trail.points.length;
    if (n < 1) {
      trail.geometry.setDrawRange(0, 0);
      trail.cloud.visible = false;
      return;
    }
    const posAttr = trail.geometry.getAttribute('position') as BufferAttribute;
    const colAttr = trail.geometry.getAttribute('color') as BufferAttribute;
    for (let i = 0; i < n; i += 1) {
      const p = trail.points[i]!;
      posAttr.setXYZ(i, p.x, p.y, p.z);
      const alpha = trailAlphaFor(now - p.at, window);
      colAttr.setXYZ(i, baseColor.r * alpha, baseColor.g * alpha, baseColor.b * alpha);
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    trail.geometry.setDrawRange(0, n);
    trail.cloud.visible = true;
  };

  const ensureTrail = (id: BodyId): ShipTrail => {
    let trail = trails.get(id);
    if (trail !== undefined) return trail;
    // Pre-sized buffers — allocated ONCE at TRAIL_MAX_POINTS so `push` never
    // reallocates a Float32Array on the hot path (a per-push allocation was the
    // prototype's biggest carry-forward risk; capping + pooling here matches it).
    const positions = new Float32Array(TRAIL_MAX_POINTS * 3);
    const colors = new Float32Array(TRAIL_MAX_POINTS * 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.setDrawRange(0, 0);
    const material = new PointsMaterial({
      size: pointSize,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const cloud = new Points(geometry, material);
    cloud.visible = false;
    cloud.frustumCulled = false; // per-cloud extents grow as points push
    group.add(cloud);
    trail = { points: [], cloud, geometry, material, positions, colors };
    trails.set(id, trail);
    return trail;
  };

  const capToBuffer = (points: TrailPoint[]): TrailPoint[] => {
    // Prefer the newest tail if the window-pruned list still exceeds the cap.
    if (points.length <= TRAIL_MAX_POINTS) return points;
    return points.slice(points.length - TRAIL_MAX_POINTS);
  };

  const push = (id: BodyId, at: readonly [number, number, number], simTime: number): void => {
    if (simTime > now) now = simTime;
    const trail = ensureTrail(id);
    trail.points.push({ id, x: at[0], y: at[1], z: at[2], at: simTime });
    trail.points = capToBuffer(pruneTrail(trail.points, now, window));
    rebuild(trail);
  };

  const tick = (nowSimTime: number): void => {
    if (nowSimTime > now) now = nowSimTime;
    for (const trail of trails.values()) {
      trail.points = capToBuffer(pruneTrail(trail.points, now, window));
      rebuild(trail);
    }
  };

  const clear = (): void => {
    for (const trail of trails.values()) {
      trail.points = [];
      trail.geometry.setDrawRange(0, 0);
      trail.cloud.visible = false;
    }
  };

  const dispose = (): void => {
    for (const trail of trails.values()) {
      group.remove(trail.cloud);
      trail.geometry.dispose();
      trail.material.dispose();
    }
    trails.clear();
    scene.remove(group);
  };

  return { push, tick, clear, dispose };
};
