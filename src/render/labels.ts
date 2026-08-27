// DOM label overlay — ships only (+ the hovered/selected hazard), arch §9, §7.4.
//
// Gate 1 §3 confirmed per-body labels don't scale to 300 hazards; ships (≤60 at the
// ceiling) get DOM labels, hazards carry identity in their glyph. Labels are absolutely
// positioned children driven by `transform: translate3d`, projected world→screen each
// tick at ~15 Hz (decoupled from the render loop), then decluttered by screen-space
// collision + a nearest-wins rule. Text is written as real text nodes (`textContent`) —
// XSS-safe by construction, no `innerHTML`.
//
// The projection + declutter are pure functions (unit-tested under node); the DOM plumbing
// is guarded so the module imports cleanly without a `document`. Nothing mutates state.

import type { Matrix4 } from 'three';
import type { BodyId } from '../sim/index.js';

/** A world-anchored label to place this frame. */
export interface LabelDatum {
  readonly id: BodyId;
  /** Rendered text (e.g. "WIDOWMAKER · cruiser"). Placed as a text node, never HTML. */
  readonly text: string;
  readonly world: readonly [number, number, number];
}

/** A projected label in screen space. */
export interface ScreenLabel {
  readonly id: BodyId;
  readonly sx: number;
  readonly sy: number;
  /** NDC depth (−1 near … +1 far); smaller is nearer the camera. */
  readonly depth: number;
  readonly inFront: boolean;
}

/**
 * Project a world point through a column-major view-projection matrix (three's
 * `Matrix4.elements` order) to screen pixels. Pure — no three, no DOM.
 */
export const projectToScreen = (
  e: ArrayLike<number>,
  wx: number,
  wy: number,
  wz: number,
  width: number,
  height: number,
): { readonly sx: number; readonly sy: number; readonly depth: number; readonly inFront: boolean } => {
  const cx = e[0]! * wx + e[4]! * wy + e[8]! * wz + e[12]!;
  const cy = e[1]! * wx + e[5]! * wy + e[9]! * wz + e[13]!;
  const cz = e[2]! * wx + e[6]! * wy + e[10]! * wz + e[14]!;
  const cw = e[3]! * wx + e[7]! * wy + e[11]! * wz + e[15]!;
  const inFront = cw > 0;
  const invW = cw === 0 ? 0 : 1 / cw;
  const ndcX = cx * invW;
  const ndcY = cy * invW;
  return {
    sx: (ndcX * 0.5 + 0.5) * width,
    sy: (1 - (ndcY * 0.5 + 0.5)) * height,
    depth: cz * invW,
    inFront,
  };
};

/**
 * Declutter projected labels: drop anything behind the camera, then greedily keep
 * labels nearest-first, discarding any that fall within `minGapPx` of one already kept.
 * Pure and deterministic (stable order by depth then id). Returns the survivors.
 */
export const declutterLabels = (
  labels: readonly ScreenLabel[],
  minGapPx: number,
): ScreenLabel[] => {
  const ordered = labels
    .filter((l) => l.inFront)
    .slice()
    .sort((a, b) => (a.depth === b.depth ? a.id - b.id : a.depth - b.depth));
  const kept: ScreenLabel[] = [];
  const gapSq = minGapPx * minGapPx;
  for (const label of ordered) {
    let collides = false;
    for (const k of kept) {
      const dx = label.sx - k.sx;
      const dy = label.sy - k.sy;
      if (dx * dx + dy * dy < gapSq) {
        collides = true;
        break;
      }
    }
    if (!collides) kept.push(label);
  }
  return kept;
};

/** Distance LOD: labels beyond this NDC depth are dropped as too-far to read. */
const MAX_LABEL_DEPTH = 0.9995;
const MIN_LABEL_GAP_PX = 26;

export interface LabelOverlay {
  readonly element: HTMLElement | null;
  /** Reproject + reposition labels for the current camera. No-op without a DOM. */
  sync(labels: readonly LabelDatum[], viewProjection: Matrix4, width: number, height: number): void;
  dispose(): void;
}

/**
 * Build the overlay inside `container` (an absolutely-positioned box overlapping the
 * canvas). Passing `null` (or running under node) yields a no-op overlay.
 */
export const createLabelOverlay = (container: HTMLElement | null): LabelOverlay => {
  const active = container !== null && typeof document !== 'undefined';
  const pool = new Map<BodyId, HTMLElement>();

  const sync = (
    labels: readonly LabelDatum[],
    viewProjection: Matrix4,
    width: number,
    height: number,
  ): void => {
    if (!active || container === null) return;
    const e = viewProjection.elements;
    const projected: ScreenLabel[] = [];
    const textById = new Map<BodyId, string>();
    for (const label of labels) {
      const p = projectToScreen(e, label.world[0], label.world[1], label.world[2], width, height);
      if (!p.inFront || p.depth > MAX_LABEL_DEPTH) continue;
      projected.push({ id: label.id, sx: p.sx, sy: p.sy, depth: p.depth, inFront: p.inFront });
      textById.set(label.id, label.text);
    }
    const visible = declutterLabels(projected, MIN_LABEL_GAP_PX);
    const shown = new Set<BodyId>();
    for (const label of visible) {
      shown.add(label.id);
      let el = pool.get(label.id);
      if (el === undefined) {
        el = document.createElement('div');
        el.className = 'tactical-label';
        el.style.position = 'absolute';
        el.style.left = '0';
        el.style.top = '0';
        el.style.pointerEvents = 'none';
        el.style.willChange = 'transform';
        container.appendChild(el);
        pool.set(label.id, el);
      }
      el.textContent = textById.get(label.id) ?? '';
      el.style.transform = `translate3d(${label.sx}px, ${label.sy}px, 0)`;
      el.style.display = '';
    }
    for (const [id, el] of pool) {
      if (!shown.has(id)) el.style.display = 'none';
    }
  };

  const dispose = (): void => {
    if (active && container !== null) {
      for (const el of pool.values()) container.removeChild(el);
    }
    pool.clear();
  };

  return { element: active ? container : null, sync, dispose };
};
