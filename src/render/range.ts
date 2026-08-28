// Range shell — three orthogonal great-circle line loops around a shooter, drawn
// while a weapon fire-slot is selected on the Tactical Attack screen (SESSION-02
// of tactical-attack-mock-parity, superseding playtest-feedback-01 SESSION-07).
//
// The pre-SESSION-02 shell drew a translucent `SphereGeometry` volume; at fleet
// scale several stacked shells washed over ship glyphs and the fire-solution
// pills (`mocks/tactical-attack.html:381-389` — the mock shows three concentric
// thin *rings*, not filled bubbles). This module now emits a single `Group`
// containing three `LineLoop`s in the XY / XZ / YZ planes, at unit radius,
// scaled uniformly by `setRadius`. The three orthogonal circles preserve the
// omnidirectional "range envelope" reading regardless of orbit angle without
// occluding anything behind them.
//
// Colour is cyan (`mocks/console.css --cyan`, the player-fleet / primary token —
// hostile-red is reserved for boundary and lethal cues, `specs/design.md §1.1`);
// the value is written literally because render cannot import a stylesheet. The
// shell computes NO to-hit number — it draws a supplied radius at a supplied
// position and nothing more (arch §13.3 — hit chance stays single-sourced
// through `hitChanceFor`).
//
// Screens that need the mock's *concentric* rings instantiate several handles at
// different radii (one per live weapon envelope) — this module owns exactly one
// envelope.

import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineLoop,
  type Object3D,
} from 'three';
import type { RenderQuality } from './types.js';

/** Range cyan (mocks/console.css `--cyan`, `--fleet-0` — player-primary token). */
const RANGE_COLOR = 0x22e3ff;
/** Line-thin envelope opacity — visible without washing over ship glyphs. */
const RANGE_OPACITY_HIGH = 0.6;
/** Reduced-motion / degrade opacity — the ring stays a line but its "presence" drops. */
const RANGE_OPACITY_REDUCED = 0.35;
/** Segment count per great-circle loop. 96 gives the eye a smooth ring at fleet zoom. */
const SEGMENTS_HIGH = 96;
/** Reduced segment count — polygonal but unambiguously circular. */
const SEGMENTS_REDUCED = 48;

export interface RangeShell {
  /**
   * Scene-graph handle the screen adds to its scene root. Widened from `Mesh` (pre-
   * SESSION-02 filled sphere) to `Object3D` — the concrete value is a `Group` of
   * three line loops. Retained under the compatibility name `mesh` so existing
   * consumers do not need to rename.
   */
  readonly mesh: Object3D;
  /** Match the shell to a weapon's range envelope (world units). Non-finite/negative → clamped to 0. */
  setRadius(radius: number): void;
  /** Slide the shell centre onto the shooter's world position. */
  setCenter(x: number, y: number, z: number): void;
  /** Toggle without disposing — cheap between fire-slot selections. */
  setVisible(visible: boolean): void;
  setQuality(quality: RenderQuality): void;
  dispose(): void;
}

/**
 * Precompute the vertex ring for one great circle in the supplied plane. `plane`
 * picks which two axes carry the (cos, sin) coordinates — the third is held at 0.
 * The ring closes because `LineLoop` implicitly connects the last vertex back to
 * the first; no duplicated closing vertex is needed.
 */
const buildRingPositions = (
  plane: 'xy' | 'xz' | 'yz',
  segments: number,
): Float32Array => {
  const out = new Float32Array(segments * 3);
  const tau = Math.PI * 2;
  for (let i = 0; i < segments; i += 1) {
    const theta = (i / segments) * tau;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const j = i * 3;
    if (plane === 'xy') {
      out[j] = c;
      out[j + 1] = s;
      out[j + 2] = 0;
    } else if (plane === 'xz') {
      out[j] = c;
      out[j + 1] = 0;
      out[j + 2] = s;
    } else {
      out[j] = 0;
      out[j + 1] = c;
      out[j + 2] = s;
    }
  }
  return out;
};

/** One great-circle ring — geometry + LineLoop handle, tracked for disposal. */
interface RingHandle {
  readonly loop: LineLoop;
  geometry: BufferGeometry;
}

const buildRing = (
  plane: 'xy' | 'xz' | 'yz',
  segments: number,
  material: LineBasicMaterial,
): RingHandle => {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(buildRingPositions(plane, segments), 3),
  );
  const loop = new LineLoop(geometry, material);
  loop.frustumCulled = false;
  return { loop, geometry };
};

/** Clamp a caller-supplied radius to a finite, non-negative value. */
const clampRadius = (raw: number): number => {
  if (!Number.isFinite(raw)) return 0;
  return raw > 0 ? raw : 0;
};

/** Build the range shell at `radius`; centre defaults to the origin. */
export const createRangeShell = (radius: number): RangeShell => {
  const material = new LineBasicMaterial({
    color: RANGE_COLOR,
    transparent: true,
    opacity: RANGE_OPACITY_HIGH,
    depthWrite: false,
  });

  // Three orthogonal great circles at unit radius; the root group carries the
  // per-shell scale + position so `setRadius` / `setCenter` are single-write.
  let segments = SEGMENTS_HIGH;
  let rings: RingHandle[] = [
    buildRing('xy', segments, material),
    buildRing('xz', segments, material),
    buildRing('yz', segments, material),
  ];

  const root = new Group();
  root.frustumCulled = false;
  // Behind bodies + ahead of the boundary (which sits at renderOrder = -1) so the
  // three layers stack boundary → range envelope → bodies without z-fighting.
  root.renderOrder = -0.5;
  for (const r of rings) root.add(r.loop);

  root.scale.setScalar(clampRadius(radius));

  const setRadius = (next: number): void => {
    root.scale.setScalar(clampRadius(next));
  };

  const setCenter = (x: number, y: number, z: number): void => {
    root.position.set(x, y, z);
  };

  const setVisible = (visible: boolean): void => {
    root.visible = visible;
  };

  const rebuildRings = (nextSegments: number): void => {
    // setQuality may swap segment density — dispose the old geometries so we do
    // not leak GPU buffers, then replace the ring handles with fresh ones sharing
    // the same material (opacity swap already done by the caller).
    for (const r of rings) {
      root.remove(r.loop);
      r.geometry.dispose();
    }
    rings = [
      buildRing('xy', nextSegments, material),
      buildRing('xz', nextSegments, material),
      buildRing('yz', nextSegments, material),
    ];
    for (const r of rings) root.add(r.loop);
    segments = nextSegments;
  };

  const setQuality = (quality: RenderQuality): void => {
    material.opacity = quality === 'reduced' ? RANGE_OPACITY_REDUCED : RANGE_OPACITY_HIGH;
    material.needsUpdate = true;
    const nextSegments = quality === 'reduced' ? SEGMENTS_REDUCED : SEGMENTS_HIGH;
    if (nextSegments !== segments) rebuildRings(nextSegments);
  };

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const r of rings) {
      root.remove(r.loop);
      r.geometry.dispose();
    }
    rings = [];
    material.dispose();
  };

  return { mesh: root, setRadius, setCenter, setVisible, setQuality, dispose };
};
