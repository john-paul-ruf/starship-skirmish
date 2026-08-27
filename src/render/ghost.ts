// ghost — the plotting ghost: draw a SUPPLIED predicted path (arch §9, Gate 1 §2a).
//
// IMPORT RULE (arch §4): render imports `sim` TYPES ONLY. The ghost must NOT compute a
// trajectory — that would mean a second integrator, and "preview must not lie" requires
// exactly one (in `sim/physics/previewPath`). So the caller (the Movement screen via the
// controller's `previewArc`) integrates the path and hands the ghost its `positions[]`
// + `endsOutsideArena` to DRAW. `PreviewPath` / `Vec3` are imported as TYPES only; there
// is no value import of `sim/physics` here (`verbatimModuleSyntax` would make one a build
// error).
//
// The placement math (per-second marks, exit channels, low-Δv merge) is pure and
// node-testable; the three.js `Line2` + sprites are screen-e2e, mirroring SESSION-02.

import { Color, Group, Sprite, SpriteMaterial, Texture } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { PreviewPath, Vec3 } from '../sim/index.js';
import { lerp } from './interp.js';
import type { TacticalView } from './types.js';

// ---- Gate 1 §2a palette tokens (the screens reference these names) ----------

/** Own-fleet ghost line (fleet-0 cyan). */
export const GHOST_CYAN = 0x22e3ff;
/** Sibling of fleet-1 magenta, brightened — used when the line is drawn OVER the
 *  boundary shell so it stays legible against the hex glow (Gate 1 §2a). */
export const GHOST_MAGENTA_HI = 0xff5db1;
/** Numbered per-second arc marks — amber keeps them ORTHOGONAL to the exit signal. */
export const GHOST_AMBER = 0xffb020;
/** Three-channel boundary-exit red (+ glow). */
export const GHOST_EXIT_RED = 0xff2d2d;

/** §2a: marks closer than `1.2 · hullRadius` read as merged (too slow to separate). */
export const MERGE_RADIUS_FACTOR = 1.2;

/** The callout string the screen renders for channel 3 of the exit signal (FR-16). */
export const EXIT_STATUS = 'PREDICTED EXIT — SHIP DESTROYED';

/**
 * What the Movement screen supplies to `draw()`. `positions` + `endsOutsideArena` come
 * verbatim from the controller's `previewArc` (a `PreviewPath`), so the ghost never
 * integrates. `deltaVMag` is the plotted delta-V magnitude (drives the low-Δv guard).
 *
 * `beatSeconds` (= `physicsConfig.dt`, which the caller already holds to call
 * `previewArc`) and `hullRadius` (the firing ship's collider radius) are OPTIONAL: with
 * them the marks are true per-second placements + the exact §2a merge threshold; without
 * them the ghost degrades to one mark per interior sample and no merge flag. The screen
 * SHOULD pass both for Gate-1-faithful marks.
 *
 * `markIntervalSec` (S01, prototype `Off/1s/2s/4s` selector) tunes ruler density on the
 * impulsive arc: `undefined` or `0` = one mark per whole sim-second (the existing
 * behavior); `> 0` = one mark every `markIntervalSec` sim-seconds. Marks reuse the
 * same exact time → index lerp (NEVER a second integrator — the §2 "preview must not
 * lie" invariant).
 */
export interface GhostDrawInput {
  readonly positions: readonly Vec3[];
  readonly endsOutsideArena: boolean;
  readonly deltaVMag: number;
  readonly beatSeconds?: number;
  readonly hullRadius?: number;
  readonly markIntervalSec?: number;
}

/**
 * Adapt a controller `previewArc` result (a `PreviewPath`, or its `{positions,
 * endsOutsideArena}` subset) into a `GhostDrawInput`. Convenience for the screen so the
 * field mapping stays 1:1 and in one place — the ghost still only DRAWS the supplied path.
 */
export const fromPreviewPath = (
  preview: Pick<PreviewPath, 'positions' | 'endsOutsideArena'>,
  deltaVMag: number,
  opts: {
    readonly beatSeconds?: number;
    readonly hullRadius?: number;
    readonly markIntervalSec?: number;
  } = {},
): GhostDrawInput => ({
  positions: preview.positions,
  endsOutsideArena: preview.endsOutsideArena,
  deltaVMag,
  ...(opts.beatSeconds !== undefined ? { beatSeconds: opts.beatSeconds } : {}),
  ...(opts.hullRadius !== undefined ? { hullRadius: opts.hullRadius } : {}),
  ...(opts.markIntervalSec !== undefined ? { markIntervalSec: opts.markIntervalSec } : {}),
});

/** One numbered arc mark, placed at a fractional index into `positions`. */
export interface GhostMark {
  /** The label the sprite shows (per-second ordinal, or sample ordinal in the fallback). */
  readonly second: number;
  /** Fractional index into `positions` this mark sits at. */
  readonly index: number;
  /** Interpolated world position at `index`. */
  readonly position: Vec3;
  /** True when this mark is within `1.2 · hullRadius` of the previous — a merge flag. */
  readonly merged: boolean;
}

/** The three-channel exit signal state derived from an input (FR-16, §4.1). */
export interface GhostExitState {
  readonly active: boolean;
  /** Where to drop the ✕ EXIT sprite (the predicted-outside endpoint). */
  readonly crossing: Vec3 | null;
  /** The status callout for the screen (empty when not exiting). */
  readonly status: string;
}

/** Sample `positions` at a fractional index with endpoint clamping. Pure. */
export const sampleAtIndex = (positions: readonly Vec3[], index: number): Vec3 => {
  const n = positions.length;
  if (n === 0) return { x: 0, y: 0, z: 0 };
  if (n === 1) return positions[0]!;
  const clamped = index < 0 ? 0 : index > n - 1 ? n - 1 : index;
  const lo = Math.floor(clamped);
  const hi = Math.min(lo + 1, n - 1);
  const frac = clamped - lo;
  const a = positions[lo]!;
  const b = positions[hi]!;
  return { x: lerp(a.x, b.x, frac), y: lerp(a.y, b.y, frac), z: lerp(a.z, b.z, frac) };
};

const dist = (a: Vec3, b: Vec3): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

/**
 * The numbered per-interval marks for an arc. With `beatSeconds`, mark `k` sits at
 * fractional index `(k · interval) / beatSeconds · (n − 1)` — an exact time → index
 * lerp of the uniform-in-time samples (NOT a second integrator). `interval` is
 * `markIntervalSec` when positive, else `1` (the current per-second cadence). Without
 * `beatSeconds`, falls back to one mark per interior sample. A mark within
 * `1.2 · hullRadius` of its predecessor is flagged `merged` (§2a).
 */
export const computeMarks = (input: GhostDrawInput): GhostMark[] => {
  const { positions, beatSeconds, hullRadius, markIntervalSec } = input;
  const n = positions.length;
  if (n < 2) return [];

  const slots: Array<{ readonly second: number; readonly index: number }> = [];
  if (beatSeconds !== undefined && beatSeconds > 0) {
    const interval =
      markIntervalSec !== undefined && markIntervalSec > 0 ? markIntervalSec : 1;
    const count = Math.floor(beatSeconds / interval);
    for (let k = 1; k <= count; k += 1) {
      const t = k * interval;
      slots.push({ second: t, index: (t / beatSeconds) * (n - 1) });
    }
  } else {
    for (let i = 1; i <= n - 2; i += 1) slots.push({ second: i, index: i });
  }

  const mergeThreshold = (hullRadius ?? 0) * MERGE_RADIUS_FACTOR;
  const marks: GhostMark[] = [];
  let prev: Vec3 = positions[0]!;
  for (const slot of slots) {
    const position = sampleAtIndex(positions, slot.index);
    const merged = mergeThreshold > 0 && dist(position, prev) < mergeThreshold;
    marks.push({ second: slot.second, index: slot.index, position, merged });
    prev = position;
  }
  return marks;
};

/**
 * The three-channel exit signal (FR-16, §4.1). When `endsOutsideArena`, ALL THREE
 * channels fire together — the line goes red (channel 1, via `ghostLineColor`), the ✕
 * EXIT sprite drops at `crossing` (channel 2), and `status` carries the callout
 * (channel 3). Never drop a channel.
 */
export const exitStateFor = (input: GhostDrawInput): GhostExitState => {
  if (!input.endsOutsideArena) return { active: false, crossing: null, status: '' };
  const last = input.positions.length > 0 ? input.positions[input.positions.length - 1]! : null;
  return { active: true, crossing: last, status: EXIT_STATUS };
};

/** Channel 1 of the exit signal: the line color. Red on exit, else own-fleet cyan. */
export const ghostLineColor = (input: GhostDrawInput): number =>
  input.endsOutsideArena ? GHOST_EXIT_RED : GHOST_CYAN;

/** §2a convenience for the screen: a plotted arc too slow to separate its per-second
 *  marks (`|Δv| · 1s < 1.2 · hullRadius`). Pure. */
export const isLowDeltaVArc = (deltaVMag: number, hullRadius: number): boolean =>
  deltaVMag * 1 < hullRadius * MERGE_RADIUS_FACTOR;

// ---- The three.js layer (screen-e2e; unit tests target the pure helpers) ----

/** The ghost-render handle the Movement screen drives. */
export interface GhostLayer {
  /** Draw a supplied predicted path — line + numbered marks + (on exit) the three-channel signal. */
  draw(input: GhostDrawInput): void;
  /** Remove the ghost, its marks, and any exit sprite. */
  clear(): void;
  dispose(): void;
}

const LINE_WIDTH = 2.0;
const MARK_CELL = 64;

const flatten = (positions: readonly Vec3[]): number[] => {
  const out: number[] = [];
  for (const p of positions) out.push(p.x, p.y, p.z);
  return out;
};

/** Build a numbered (or ✕) sprite texture. Guarded so the module imports under node. */
const makeLabelSprite = (label: string, color: number, merged: boolean): Sprite => {
  const material = new SpriteMaterial({ color: new Color(color), transparent: true, depthTest: false });
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = MARK_CELL;
    canvas.height = MARK_CELL;
    const ctx = canvas.getContext('2d');
    if (ctx !== null) {
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.floor(MARK_CELL * (merged ? 0.4 : 0.6))}px 'JetBrains Mono', ui-monospace, monospace`;
      ctx.fillText(label, MARK_CELL / 2, MARK_CELL / 2);
      const tex = new Texture(canvas);
      tex.needsUpdate = true;
      material.map = tex;
    }
  }
  return new Sprite(material);
};

/**
 * Attach a ghost layer to a live view. The layer adds its own `Group` to the scene and
 * rebuilds the line + marks on each `draw()`; the view's own RAF renders it. Pure
 * renderer of a supplied path — it never integrates one.
 */
export const attachGhost = (view: TacticalView): GhostLayer => {
  const scene = view.scene.context.scene;
  const group = new Group();
  scene.add(group);

  let line: Line2 | null = null;
  let lineGeometry: LineGeometry | null = null;
  let lineMaterial: LineMaterial | null = null;
  const sprites: Sprite[] = [];

  const clear = (): void => {
    if (line !== null) group.remove(line);
    lineGeometry?.dispose();
    lineMaterial?.dispose();
    line = null;
    lineGeometry = null;
    lineMaterial = null;
    for (const s of sprites) {
      group.remove(s);
      s.material.map?.dispose();
      s.material.dispose();
    }
    sprites.length = 0;
  };

  const draw = (input: GhostDrawInput): void => {
    clear();
    if (input.positions.length < 2) return;

    lineGeometry = new LineGeometry();
    lineGeometry.setPositions(flatten(input.positions));
    lineMaterial = new LineMaterial({
      color: ghostLineColor(input),
      linewidth: LINE_WIDTH,
      transparent: true,
      opacity: input.endsOutsideArena ? 1 : 0.85,
      depthTest: false,
    });
    line = new Line2(lineGeometry, lineMaterial);
    group.add(line);

    for (const mark of computeMarks(input)) {
      const sprite = makeLabelSprite(String(mark.second), GHOST_AMBER, mark.merged);
      sprite.position.set(mark.position.x, mark.position.y, mark.position.z);
      group.add(sprite);
      sprites.push(sprite);
    }

    const exit = exitStateFor(input);
    if (exit.active && exit.crossing !== null) {
      const cross = makeLabelSprite('✕', GHOST_EXIT_RED, false);
      cross.position.set(exit.crossing.x, exit.crossing.y, exit.crossing.z);
      group.add(cross);
      sprites.push(cross);
    }
  };

  const dispose = (): void => {
    clear();
    scene.remove(group);
  };

  return { draw, clear, dispose };
};
