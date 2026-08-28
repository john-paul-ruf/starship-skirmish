// DOM label overlay — ships + hazards + missiles, semantic + legible (SESSION-02, arch §9).
//
// Labels are absolutely-positioned children driven by `transform: translate3d`, projected
// world→screen each tick at ~15 Hz (decoupled from the render loop). Every label carries a
// closed `TacticalLabelKind` — `presentationFor(kind, fleet?)` produces the glyph, color,
// background, shadow, and offset each kind renders with, so the DOM writer never invents a
// look. Text is always written as a real text node (`textContent`) — XSS-safe by construction,
// no `innerHTML`.
//
// The 300-body hazard ceiling (arch §9) is enforced BEFORE declutter via `capHazardLabels`
// (nearest-first, deterministic by id) so a debris/missile swarm cannot spawn a DOM cloud.
// Declutter is priority-first (ship > missile-tracking > missile-spent > debris), then depth,
// then id — ship glyphs win collisions against hazards, tracking missiles beat spent debris.
//
// Everything except the DOM sync is a pure function unit-tested under node; the DOM plumbing
// is guarded so the module imports cleanly without a `document`. Nothing mutates state.

import type { Matrix4 } from 'three';
import type { BodyId } from '../sim/index.js';
import type { FleetColor } from './types.js';

/** The four label kinds render distinguishes on the tactical field. */
export type TacticalLabelKind = 'ship' | 'debris' | 'missile-tracking' | 'missile-spent';

/**
 * Ranks used to break declutter collisions. Higher wins. Ships beat every hazard;
 * a tracking missile beats a spent missile beats a piece of debris. Consumers may
 * override per-datum (e.g. a called-out debris the player selected).
 */
export const LABEL_PRIORITY: Readonly<Record<TacticalLabelKind, number>> = {
  ship: 4,
  'missile-tracking': 3,
  'missile-spent': 2,
  debris: 1,
};

/**
 * Cap on visible non-ship (debris + missile) labels — keeps the 300-body arena
 * ceiling readable. Ships are never capped (≤60 at the ceiling). Deterministic:
 * nearest-first by (depth, id), so a re-render with the same state picks the same
 * survivors regardless of `Map` insertion order.
 */
export const MAX_HAZARD_LABELS = 24;

// Fleet glyphs — the session's authoritative list (▲ ● ■ ◆ ✦). Design §1.1 requires
// shape identity in addition to color; this is the sole owner of the render-side
// fleet→glyph mapping so tests can pin it in one place.
const FLEET_GLYPH: Readonly<Record<FleetColor, string>> = {
  0: '▲',
  1: '●',
  2: '■',
  3: '◆',
  4: '✦',
};

/** Glyph for the fleet slot. Pure lookup, exported so `TacticalView` builds label text. */
export const fleetGlyphOf = (fleet: FleetColor): string => FLEET_GLYPH[fleet];

// Design-token colors mirrored from mocks/console.css (render cannot import a stylesheet;
// this is the same discipline used in wireframes.ts / boundary.ts / hazards.ts).
const COLOR_FLEET: Readonly<Record<FleetColor, string>> = {
  0: '#22E3FF', // --fleet-0
  1: '#FF3D7F', // --fleet-1
  2: '#FFB020', // --fleet-2
  3: '#A45BFF', // --fleet-3
  4: '#7CFF4F', // --fleet-4
};
const COLOR_HAZARD = '#FF7A1A'; // --hazard
const COLOR_MISSILE = '#FF2E63'; // --missile
const COLOR_SPENT = '#8A6A4F'; // --spent

// Panel-alpha backing so the label survives the perspective grid + selective bloom
// without pushing another CSS token into M13. Mirrors mocks/console.css `.boundary-label`.
const LABEL_BACKGROUND = 'rgba(5,7,10,0.78)';
// Multi-direction 1px stroke + a soft 3px blur — belt-and-suspenders legibility for the
// (reduced-motion) case where the backing alone is not enough against a bright wireframe.
const LABEL_SHADOW =
  '0 0 3px rgba(0,0,0,0.9), 1px 0 0 rgba(0,0,0,0.9), -1px 0 0 rgba(0,0,0,0.9), 0 1px 0 rgba(0,0,0,0.9), 0 -1px 0 rgba(0,0,0,0.9)';
/** CSS-pixel offset applied AFTER the horizontal centering translate — nudges the label
 *  below its ship glyph so the two never overlap. */
const LABEL_OFFSET_Y_PX = 14;

/**
 * Presentation triples for one label kind. The DOM sync reads glyph/color/etc from here;
 * the same pure function backs the test that pins the visual treatment so a future edit
 * cannot silently return to invisible labels.
 */
export interface LabelPresentation {
  readonly glyph: string;
  /** CSS color for the label text. */
  readonly color: string;
  /** CSS background — dark translucent backing so labels survive the grid + bloom. */
  readonly background: string;
  /** Multi-direction text shadow (belt-and-suspenders legibility). */
  readonly shadow: string;
  /** CSS pixel offset applied on top of the projected anchor after centering. */
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * Presentation for a label kind (with fleet slot for ships). Pure — no DOM,
 * no imports of CSS. Tests read this to prove the visible treatment is authored.
 */
export const presentationFor = (
  kind: TacticalLabelKind,
  fleet?: FleetColor,
): LabelPresentation => {
  switch (kind) {
    case 'ship': {
      const slot: FleetColor = fleet ?? 0;
      return {
        glyph: FLEET_GLYPH[slot],
        color: COLOR_FLEET[slot],
        background: LABEL_BACKGROUND,
        shadow: LABEL_SHADOW,
        offsetX: 0,
        offsetY: LABEL_OFFSET_Y_PX,
      };
    }
    case 'debris':
      return {
        glyph: '✳',
        color: COLOR_HAZARD,
        background: LABEL_BACKGROUND,
        shadow: LABEL_SHADOW,
        offsetX: 0,
        offsetY: LABEL_OFFSET_Y_PX,
      };
    case 'missile-tracking':
      return {
        glyph: '➤',
        color: COLOR_MISSILE,
        background: LABEL_BACKGROUND,
        shadow: LABEL_SHADOW,
        offsetX: 0,
        offsetY: LABEL_OFFSET_Y_PX,
      };
    case 'missile-spent':
      return {
        glyph: '◇',
        color: COLOR_SPENT,
        background: LABEL_BACKGROUND,
        shadow: LABEL_SHADOW,
        offsetX: 0,
        offsetY: LABEL_OFFSET_Y_PX,
      };
  }
};

// ---- Pure text builders ----------------------------------------------------
// The exact wording of each label kind lives here (not in TacticalView) so unit
// tests can pin the formats without instantiating WebGL. Mirrors the mock's
// `.mk-lbl` strings in mocks/tactical-attack.html.

/**
 * Build the text of a ship label: fleet glyph + build name, with the trailing
 * `· SHLD 0` shield-down cue appended only when the ship actually has a shield
 * generator that has dropped to zero (silent for shieldless ships so the cue
 * never becomes noise).
 */
export const shipLabelText = (
  name: string,
  fleet: FleetColor,
  shieldsDown: boolean,
): string => {
  const glyph = fleetGlyphOf(fleet);
  const base = `${glyph} ${name}`;
  return shieldsDown ? `${base} · SHLD 0` : base;
};

/** `✳ DEBRIS D-{bodyId}` — mirrors mocks/tactical-attack.html:466-470. */
export const debrisLabelText = (id: BodyId): string => `✳ DEBRIS D-${id}`;

/** `➤ MISSILE {id} · T{n} ↦ {target}` — mirrors mocks/tactical-attack.html:472-475. */
export const trackingMissileLabelText = (
  id: BodyId,
  trackingBeatsLeft: number,
  targetName: string,
): string => `➤ MISSILE ${id} · T${trackingBeatsLeft} ↦ ${targetName}`;

/** `◇ MISSILE {id} · SPENT · ARMED` — mirrors mocks/tactical-attack.html:476-477. */
export const spentMissileLabelText = (id: BodyId): string =>
  `◇ MISSILE ${id} · SPENT · ARMED`;

/** A world-anchored label to place this frame. */
export interface LabelDatum {
  readonly id: BodyId;
  readonly kind: TacticalLabelKind;
  /** Rendered text (e.g. "▲ WIDOWMAKER · SHLD 0"). Placed as a text node, never HTML. */
  readonly text: string;
  readonly world: readonly [number, number, number];
  /** Fleet slot for ship kinds. Ignored for hazard/missile kinds. */
  readonly fleet?: FleetColor;
  /** Higher wins declutter collisions. See `LABEL_PRIORITY` for defaults. */
  readonly priority: number;
}

/** A projected label in screen space, carrying the semantics declutter + cap read. */
export interface ScreenLabel {
  readonly id: BodyId;
  readonly kind: TacticalLabelKind;
  readonly sx: number;
  readonly sy: number;
  /** NDC depth (−1 near … +1 far); smaller is nearer the camera. */
  readonly depth: number;
  readonly inFront: boolean;
  readonly priority: number;
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
 * Cap the visible non-ship labels at `maxHazards`. Ships are always kept in full; hazards
 * (debris + missile-tracking + missile-spent) are ordered nearest-first (depth ASC, id ASC)
 * and truncated. Deterministic — the returned set does not depend on `Map` iteration order.
 */
export const capHazardLabels = (
  labels: readonly ScreenLabel[],
  maxHazards: number,
): ScreenLabel[] => {
  const ships: ScreenLabel[] = [];
  const hazards: ScreenLabel[] = [];
  for (const l of labels) {
    if (l.kind === 'ship') ships.push(l);
    else hazards.push(l);
  }
  hazards.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.id - b.id;
  });
  const cap = maxHazards > 0 ? maxHazards : 0;
  const keptHazards = hazards.slice(0, cap);
  return [...ships, ...keptHazards];
};

/**
 * Declutter projected labels: drop anything behind the camera, then greedily keep labels
 * priority-first (ships beat hazards, tracking missiles beat spent/debris), then nearest,
 * then lowest-id — discarding any within `minGapPx` of one already kept. Pure and
 * deterministic. Returns the survivors in the greedy-kept order.
 */
export const declutterLabels = (
  labels: readonly ScreenLabel[],
  minGapPx: number,
): ScreenLabel[] => {
  const ordered = labels
    .filter((l) => l.inFront)
    .slice()
    .sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority; // higher priority first
      if (a.depth !== b.depth) return a.depth - b.depth; // then nearer first
      return a.id - b.id; // then lowest id (stable, deterministic)
    });
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

interface LabelData {
  readonly text: string;
  readonly kind: TacticalLabelKind;
  readonly fleet: FleetColor | undefined;
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
    const dataById = new Map<BodyId, LabelData>();
    for (const label of labels) {
      const p = projectToScreen(e, label.world[0], label.world[1], label.world[2], width, height);
      if (!p.inFront || p.depth > MAX_LABEL_DEPTH) continue;
      projected.push({
        id: label.id,
        kind: label.kind,
        sx: p.sx,
        sy: p.sy,
        depth: p.depth,
        inFront: p.inFront,
        priority: label.priority,
      });
      dataById.set(label.id, { text: label.text, kind: label.kind, fleet: label.fleet });
    }
    const capped = capHazardLabels(projected, MAX_HAZARD_LABELS);
    const visible = declutterLabels(capped, MIN_LABEL_GAP_PX);
    const shown = new Set<BodyId>();
    for (const label of visible) {
      shown.add(label.id);
      const data = dataById.get(label.id);
      if (data === undefined) continue;
      const pres = presentationFor(data.kind, data.fleet);
      let el = pool.get(label.id);
      if (el === undefined) {
        el = document.createElement('div');
        el.className = 'tactical-label';
        el.style.position = 'absolute';
        el.style.left = '0';
        el.style.top = '0';
        el.style.pointerEvents = 'none';
        el.style.willChange = 'transform';
        // Type + rhythm ride the JetBrains Mono / system-monospace fallback the mocks use
        // (mocks/console.css `--mono`). 10px + compact tracking = the mock's `.mk-lbl` scale.
        el.style.font = "500 10px/1.2 'JetBrains Mono', ui-monospace, monospace";
        el.style.letterSpacing = '0.08em';
        el.style.textTransform = 'uppercase';
        el.style.whiteSpace = 'nowrap';
        el.style.padding = '1px 5px';
        el.style.borderRadius = '2px';
        container.appendChild(el);
        pool.set(label.id, el);
      }
      // Presentation — colour + backing + shadow live in `presentationFor`, so the DOM
      // writer never invents a look. `textContent` is the only text path (XSS-safe).
      el.style.color = pres.color;
      el.style.background = pres.background;
      el.style.textShadow = pres.shadow;
      el.dataset['kind'] = data.kind;
      if (data.fleet !== undefined) {
        el.dataset['fleet'] = String(data.fleet);
      } else if (el.dataset['fleet'] !== undefined) {
        delete el.dataset['fleet'];
      }
      el.textContent = data.text;
      // Anchor the label's centre-top on the projected world point, then nudge down by
      // `pres.offsetY` so the glyph and its label never overlap the ship silhouette.
      el.style.transform = `translate3d(${label.sx}px, ${label.sy}px, 0) translate(-50%, ${pres.offsetY}px)`;
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
