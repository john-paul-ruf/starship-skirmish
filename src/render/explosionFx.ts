// explosionFx — an animated blast primitive for collisions & detonations (M13).
//
// One reusable primitive drawn wherever the trace already records a blast:
//   • movement-beat detonating destructions (`record.destroyed[i].detonates`)
//   • movement-beat surface contacts (`record.contacts[i].point`)
//   • attack-beat detonating destructions (`AttackBeatRecord.destroyed[i].detonates`)
//
// Composition mirrors the house FX pattern in `TracePlayer.ts` (additive `Sprite` core
// + `Line2` shockwave ring built like `makeAoeRing`/`buildLine`). Self-drives over
// `localT ∈ [0,1]` and lands terminal (opacity ~0) at `localT = 1` — that keeps a
// reduced-motion skip (`renderAt(1)` via `createPlayback.finish`) outcome-invariant
// with a full play (FR-19 spirit): no frozen half-expanded ring on the final frame.
//
// Pure three.js + `interp` helpers; no `sim` value import (types only, FR-33). Wall
// clock does NOT enter — the caller supplies `localT`. Determinism inside `sim/**`
// is not a render concern, but keeping this file allocation-conservative on the hot
// path matches the existing tracer/beam patterns.
//
// The three shape helpers (`blastRingRadius`, `blastRingOpacity`, `blastCoreOpacity`)
// are exported for unit tests — locking the curve shape without a WebGL context.

import {
  AdditiveBlending,
  Color,
  Group,
  type Object3D,
  Sprite,
  SpriteMaterial,
} from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Vec3 } from '../sim/index.js';
import { clamp01 } from './interp.js';

/** A running blast FX. `object` is the group the caller adds to a scene. */
export interface BlastFx {
  readonly object: Object3D;
  /** Drive the blast at its local progress. `localT <= 0` hidden; `1` = spent (terminal). */
  renderAt(localT: number): void;
  dispose(): void;
}

/** Per-blast tuning. `radius` is required so callers can class-scale the read. */
export interface BlastOpts {
  /** Peak world-radius the shockwave ring reaches. */
  readonly radius: number;
  /** 0..1 intensity — scales core brightness + ring width (default 1). */
  readonly intensity?: number;
  /** Blast hue (default warm orange, matching `TracePlayer.AOE_RING_COLOR`). */
  readonly color?: number;
}

/** Warm orange — matches `TracePlayer.AOE_RING_COLOR` so the palette stays one voice. */
export const DEFAULT_BLAST_COLOR = 0xff8a3d;
/** Ring segment count — matches `TracePlayer.RING_SEGMENTS` for a consistent silhouette. */
export const RING_SEGMENTS = 48;
/** Local-t the core reaches its brightness peak; before is a ramp, after is decay. */
export const CORE_PEAK_T = 0.25;

// ---- Pure shape helpers (unit-testable without a WebGL context) --------------

/**
 * Ring shockwave radius at `localT ∈ [0,1]`. Monotone non-decreasing 0 → `peakRadius`.
 * `localT ≤ 0` returns 0 (hidden). `localT ≥ 1` returns `peakRadius`. Linear.
 */
export const blastRingRadius = (peakRadius: number, localT: number): number => {
  const t = clamp01(localT);
  return Math.max(0, peakRadius) * t;
};

/**
 * Ring opacity at `localT ∈ [0,1]`. Peaks near 0 (`0.9 · intensity`) and falls linearly
 * to 0 at `localT = 1`. `localT ≤ 0` returns 0 so the ring is hidden before the beat
 * opens the window. Combined with `blastRingRadius` growing outward, the visual is
 * "bright pop, expanding + fading shockwave". Terminal at 1 keeps skip outcome-invariant.
 */
export const blastRingOpacity = (intensity: number, localT: number): number => {
  if (localT <= 0) return 0;
  const t = clamp01(localT);
  return 0.9 * clamp01(intensity) * (1 - t);
};

/**
 * Core-sprite opacity at `localT ∈ [0,1]`. Triangle: ramp 0 → 1 over `[0, CORE_PEAK_T]`,
 * decay 1 → 0 over `[CORE_PEAK_T, 1]`. Terminal at 1 keeps skip outcome-invariant.
 */
export const blastCoreOpacity = (intensity: number, localT: number): number => {
  if (localT <= 0) return 0;
  const t = clamp01(localT);
  const raw = t < CORE_PEAK_T ? t / CORE_PEAK_T : 1 - (t - CORE_PEAK_T) / (1 - CORE_PEAK_T);
  return Math.max(0, raw) * clamp01(intensity);
};

// ---- The assembly -----------------------------------------------------------

/** Core sprite base-scale — a legibility choice tied to blast radius (billboarded). */
const coreScaleFor = (peakRadius: number): number => Math.max(4, peakRadius * 0.35);

/** Ring linewidth — nudged by intensity so gentle blasts read thinner than rams. */
const ringLinewidthFor = (intensity: number): number => 1.4 * (0.5 + 0.5 * clamp01(intensity));

/**
 * Build one blast at `center` with the given peak `radius`. The returned handle owns a
 * `Group` (core `Sprite` + shockwave `Line2` ring), self-drives over `localT` in
 * `renderAt`, and disposes its own geometry + materials on `dispose()`.
 *
 * Add `handle.object` to a scene and call `renderAt(localT)` per frame; call `dispose()`
 * exactly once when done. `localT = 1` leaves the blast terminal (opacity ~0) so
 * `skip()`/reduced-motion (which lands on `renderAt(1)`) never freezes a half-expanded
 * ring on the final frame.
 */
export const makeBlast = (center: Vec3, opts: BlastOpts): BlastFx => {
  const color = opts.color ?? DEFAULT_BLAST_COLOR;
  const intensity = clamp01(opts.intensity ?? 1);
  const peakRadius = Math.max(0, opts.radius);

  const group = new Group();
  group.position.set(center.x, center.y, center.z);
  group.visible = false;

  const coreMat = new SpriteMaterial({
    color: new Color(color),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const core = new Sprite(coreMat);
  const baseCoreScale = coreScaleFor(peakRadius);
  core.scale.setScalar(baseCoreScale);
  core.visible = false;
  group.add(core);

  // Pre-compute the unit ring (RING_SEGMENTS + 1 vertices, horizontal plane) once so the
  // per-frame path only scales-and-copies — no trig on the hot path. Line2 needs the
  // segment loop closed, hence `<= RING_SEGMENTS` (same shape as `makeAoeRing`).
  const unit = new Array<number>((RING_SEGMENTS + 1) * 3);
  for (let i = 0; i <= RING_SEGMENTS; i += 1) {
    const a = (i / RING_SEGMENTS) * Math.PI * 2;
    unit[i * 3] = Math.cos(a);
    unit[i * 3 + 1] = 0;
    unit[i * 3 + 2] = Math.sin(a);
  }
  const scratch = new Array<number>((RING_SEGMENTS + 1) * 3).fill(0);

  const ringGeom = new LineGeometry();
  ringGeom.setPositions(scratch);
  const ringMat = new LineMaterial({
    color,
    linewidth: ringLinewidthFor(intensity),
    transparent: true,
    opacity: 0,
    depthTest: true,
  });
  const ring = new Line2(ringGeom, ringMat);
  ring.visible = false;
  group.add(ring);

  return {
    object: group,
    renderAt: (localT: number) => {
      if (localT <= 0) {
        group.visible = false;
        core.visible = false;
        ring.visible = false;
        coreMat.opacity = 0;
        ringMat.opacity = 0;
        return;
      }
      const t = clamp01(localT);

      // Ring: grow radius outward; fade opacity toward 0.
      const r = blastRingRadius(peakRadius, t);
      for (let i = 0; i < scratch.length; i += 1) scratch[i] = unit[i]! * r;
      ringGeom.setPositions(scratch);
      const ringAlpha = blastRingOpacity(intensity, t);
      ringMat.opacity = ringAlpha;

      // Core: ramp in fast, decay; expand slightly through the blast for a small "puff".
      const coreAlpha = blastCoreOpacity(intensity, t);
      coreMat.opacity = coreAlpha;
      core.scale.setScalar(baseCoreScale * (0.6 + 0.6 * t));

      // Visibility gates keep zero-opacity FX out of the draw list.
      group.visible = true;
      core.visible = coreAlpha > 0.005;
      ring.visible = ringAlpha > 0.005 && r > 0;
    },
    dispose: () => {
      coreMat.dispose();
      ringGeom.dispose();
      ringMat.dispose();
    },
  };
};
