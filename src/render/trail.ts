// trail — a flown-path trail primitive (Gate 1 FINDINGS §2a, S01 port).
//
// The prototype's "last ~16 s" fading trail never left `prototypes/gate1/`. This
// module lifts it into `src/render/` as a small handle a screen can attach to a
// live `TacticalView`: `push` a flown position (once per new keyframe, not per RAF
// tick), `tick` to advance the fade to a new sim-time, and old points past the
// window drop out. `render` imports `sim` **types only** (FR-33) and mutates
// nothing — trails are drawn from positions the caller supplies.
//
// The fade math (`trailAlphaFor` monotonically decreasing to 0 at the window edge)
// and the window drop (`pruneTrail`) are pure exported helpers so a node unit test
// can lock the shape without a WebGL context.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Line,
  LineBasicMaterial,
} from 'three';
import type { BodyId } from '../sim/index.js';
import type { TacticalView } from './types.js';

/** Default fade window in sim-seconds (FINDINGS §2a note: "last ~16 s"). */
export const DEFAULT_TRAIL_WINDOW_SECONDS = 16;

/** Cyan mirroring the ghost's own-fleet line — the "traced path" cue reads consistently. */
export const TRAIL_COLOR = 0x22e3ff;

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
  readonly line: Line;
  readonly geometry: BufferGeometry;
  readonly material: LineBasicMaterial;
}

/**
 * Attach a flown-path trail to `view`. Points added to the view's scene (rides the
 * existing RAF via `view.scene.render()`). The layer keeps per-ship polylines and
 * fades their tails by age — the sim-time model is entirely the caller's, we just
 * receive timestamps and window-prune against them.
 */
export const attachTrail = (
  view: TacticalView,
  opts: { readonly windowSeconds?: number } = {},
): TrailLayer => {
  const window = opts.windowSeconds ?? DEFAULT_TRAIL_WINDOW_SECONDS;
  const scene = view.scene.context.scene;
  const group = new Group();
  scene.add(group);

  const trails = new Map<BodyId, ShipTrail>();
  let now = 0;
  const baseColor = new Color(TRAIL_COLOR);

  const rebuild = (trail: ShipTrail): void => {
    const n = trail.points.length;
    if (n < 2) {
      trail.line.visible = false;
      return;
    }
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      const p = trail.points[i]!;
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
      const alpha = trailAlphaFor(now - p.at, window);
      colors[i * 3] = baseColor.r * alpha;
      colors[i * 3 + 1] = baseColor.g * alpha;
      colors[i * 3 + 2] = baseColor.b * alpha;
    }
    trail.geometry.setAttribute('position', new BufferAttribute(positions, 3));
    trail.geometry.setAttribute('color', new BufferAttribute(colors, 3));
    trail.geometry.attributes['position']!.needsUpdate = true;
    trail.geometry.attributes['color']!.needsUpdate = true;
    trail.line.visible = true;
  };

  const ensureTrail = (id: BodyId): ShipTrail => {
    let trail = trails.get(id);
    if (trail !== undefined) return trail;
    const geometry = new BufferGeometry();
    const material = new LineBasicMaterial({
      transparent: true,
      vertexColors: true,
      depthTest: true,
    });
    const line = new Line(geometry, material);
    line.visible = false;
    group.add(line);
    trail = { points: [], line, geometry, material };
    trails.set(id, trail);
    return trail;
  };

  const push = (id: BodyId, at: readonly [number, number, number], simTime: number): void => {
    if (simTime > now) now = simTime;
    const trail = ensureTrail(id);
    trail.points.push({ id, x: at[0], y: at[1], z: at[2], at: simTime });
    trail.points = pruneTrail(trail.points, now, window);
    rebuild(trail);
  };

  const tick = (nowSimTime: number): void => {
    if (nowSimTime > now) now = nowSimTime;
    for (const trail of trails.values()) {
      trail.points = pruneTrail(trail.points, now, window);
      rebuild(trail);
    }
  };

  const clear = (): void => {
    for (const trail of trails.values()) {
      trail.points = [];
      trail.line.visible = false;
    }
  };

  const dispose = (): void => {
    for (const trail of trails.values()) {
      group.remove(trail.line);
      trail.geometry.dispose();
      trail.material.dispose();
    }
    trails.clear();
    scene.remove(group);
  };

  return { push, tick, clear, dispose };
};
