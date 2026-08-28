// SceneContext — the WebGL renderer + scene graph scaffold (arch §9).
//
// This owns the renderer, the `Scene`, the ground-plane reference grid, and the
// per-body altitude stalks (the mandatory depth cue, FR-14 — a vertical line from
// each tracked body to the ground plane so its height reads at every camera angle).
// Ship silhouettes, hazard glyphs, and the boundary shell are built by their own
// modules and added into `.scene` by `TacticalView`; this file is deliberately just
// the stage they stand on.
//
// The renderer never runs in the node unit env (no WebGL) — this module's proof is
// `vite build` + the screen e2e. Nothing here mutates `MatchState`.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  GridHelper,
  LineBasicMaterial,
  LineSegments,
  Scene,
  WebGLRenderer,
} from 'three';
import type { PerspectiveCamera } from 'three';
import type { BodyId } from '../sim/index.js';
import { createBloomComposer, type BloomComposer } from './postfx.js';
import type { RenderQuality } from './types.js';

// Palette mirrors mocks/console.css §1 (the CSS is the source of truth; render mirrors
// the literal values because it cannot import a stylesheet). Kept minimal — fleet
// colors live in wireframes.ts, hazard/boundary hues in their own modules.
const BACKGROUND = 0x000205;
const GRID_COLOR = 0x1e2c3c;
const STALK_COLOR = 0x2b3d52;

/** Design budget ceiling: 60 ships + 300 hazard bodies, with headroom (arch §9). */
const MAX_STALK_BODIES = 512;

/** One body's world position for the altitude-stalk pass. */
export interface StalkInput {
  readonly id: BodyId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The stage the render subsystems stand on. `TacticalView` composes ships / hazards /
 * boundary into `.scene`; playback (SESSION-03) reuses `.renderer` + `.render(camera)`.
 */
export interface SceneContext {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly grid: GridHelper;
  /** The half-extent of the arena; the ground plane sits at `y = -arenaRadius`. */
  readonly arenaRadius: number;
  /** Rewrite the altitude stalks for the current body set (FR-14 depth cue). */
  syncStalks(bodies: readonly StalkInput[]): void;
  /** Reframe the ground plane when a new match's arena radius differs. */
  setArenaRadius(radius: number): void;
  /** Degrade hook — `reduced` is a visual-only downgrade (never touches sim). */
  setQuality(quality: RenderQuality): void;
  readonly quality: RenderQuality;
  resize(width: number, height: number, dpr?: number): void;
  render(camera: PerspectiveCamera): void;
  dispose(): void;
}

const clampDpr = (dpr?: number): number => {
  const raw =
    dpr ??
    (typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1);
  return Math.min(raw, 2); // DPR cap 2 (arch §9)
};

const buildGrid = (arenaRadius: number): GridHelper => {
  const grid = new GridHelper(arenaRadius * 4, 24, GRID_COLOR, GRID_COLOR);
  const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
  for (const m of mats) {
    const lm = m as LineBasicMaterial;
    lm.transparent = true;
    lm.opacity = 0.55;
  }
  grid.position.y = -arenaRadius;
  return grid;
};

/** Assemble the renderer + scene + grid + altitude-stalk buffer. */
export const createSceneContext = (
  canvas: HTMLCanvasElement,
  arenaRadius: number,
): SceneContext => {
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(clampDpr());

  const scene = new Scene();
  scene.background = new Color(BACKGROUND);

  let currentArenaRadius = arenaRadius;
  let grid = buildGrid(arenaRadius);
  scene.add(grid);

  // One LineSegments holding every body's altitude stalk (2 verts/body). Pre-allocated
  // to the body ceiling so the buffer never reallocates mid-match; draw range gates it.
  const stalkPositions = new Float32Array(MAX_STALK_BODIES * 2 * 3);
  const stalkGeom = new BufferGeometry();
  stalkGeom.setAttribute('position', new BufferAttribute(stalkPositions, 3));
  stalkGeom.setDrawRange(0, 0);
  const stalkMat = new LineBasicMaterial({ color: STALK_COLOR, transparent: true, opacity: 0.42 });
  const stalks = new LineSegments(stalkGeom, stalkMat);
  stalks.frustumCulled = false;
  scene.add(stalks);

  let quality: RenderQuality = 'high';

  // Bloom composer lives INSIDE the scene context so every caller of `render(camera)`
  // — the live view AND SESSION-03 playback via `view.scene.render()` — inherits the
  // glow with no barrel/API change (arch §9 half-res selective bloom).
  const bloom: BloomComposer = createBloomComposer(renderer, scene, quality);

  const syncStalks = (bodies: readonly StalkInput[]): void => {
    const groundY = -currentArenaRadius;
    const n = Math.min(bodies.length, MAX_STALK_BODIES);
    const posAttr = stalkGeom.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < n; i += 1) {
      const b = bodies[i]!;
      posAttr.setXYZ(i * 2, b.x, b.y, b.z);
      posAttr.setXYZ(i * 2 + 1, b.x, groundY, b.z);
    }
    posAttr.needsUpdate = true;
    stalkGeom.setDrawRange(0, n * 2);
  };

  const setArenaRadius = (radius: number): void => {
    if (radius === currentArenaRadius) return;
    currentArenaRadius = radius;
    scene.remove(grid);
    grid.geometry.dispose();
    const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const m of mats) (m as LineBasicMaterial).dispose();
    grid = buildGrid(radius);
    scene.add(grid);
  };

  const setQuality = (next: RenderQuality): void => {
    quality = next;
    // Visual-only degrade: stalks are a supporting cue, so fade them under `reduced`.
    stalkMat.opacity = next === 'reduced' ? 0.28 : 0.42;
    stalkMat.needsUpdate = true;
    bloom.setQuality(next);
  };

  const resize = (width: number, height: number, dpr?: number): void => {
    renderer.setPixelRatio(clampDpr(dpr));
    renderer.setSize(width, height, false);
    bloom.setSize(width, height);
  };

  const render = (camera: PerspectiveCamera): void => {
    // `reduced` bypasses the composer so the degraded path is byte-equivalent to the
    // original direct render (no post-processing cost when quality drops).
    if (bloom.enabled) {
      bloom.render(camera);
    } else {
      renderer.render(scene, camera);
    }
  };

  const dispose = (): void => {
    scene.remove(grid);
    scene.remove(stalks);
    grid.geometry.dispose();
    const gridMats = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const m of gridMats) (m as LineBasicMaterial).dispose();
    stalkGeom.dispose();
    stalkMat.dispose();
    bloom.dispose();
    renderer.dispose();
  };

  return {
    renderer,
    scene,
    get grid() {
      return grid;
    },
    get arenaRadius() {
      return currentArenaRadius;
    },
    syncStalks,
    setArenaRadius,
    setQuality,
    get quality() {
      return quality;
    },
    resize,
    render,
    dispose,
  };
};
