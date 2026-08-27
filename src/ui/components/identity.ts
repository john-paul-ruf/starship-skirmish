// M14 UI — identity components (S02 checkpoint 2).
//
// ⛓ LOAD-BEARING for FR-13 / NFR-Accessibility. Fleet ownership, slot type,
// and body class are each carried by color + glyph + text — never color alone
// (design §1.1). A colorblind player must lose zero information; the pair of
// visible glyph + accessible label defends that guarantee at the component
// level so screen sessions inherit it for free.
//
// See `primitives.ts` for the shape-note on why these components use `h()`
// rather than JSX syntax.

import { h } from 'preact';

import type { SlotType } from '../../catalog/index.js';

import { cx } from './internal.js';

// ---- FleetGlyph -----------------------------------------------------------

/** Five fleets (Decision 2). Ordinal doubles as `.fl-N` suffix. */
export type FleetId = 0 | 1 | 2 | 3 | 4;

interface FleetMeta {
  readonly glyph: string;
  readonly label: string;
}

/**
 * Fleet identity table (design §1.1). Colors live in `--fleet-N` CSS tokens
 * (S01); the component only names the glyph + label pair. Order is permanent.
 */
export const FLEET_META: Readonly<Record<FleetId, FleetMeta>> = {
  0: { glyph: '▲', label: 'YOU' },
  1: { glyph: '●', label: 'BOT-01' },
  2: { glyph: '■', label: 'BOT-02' },
  3: { glyph: '◆', label: 'BOT-03' },
  4: { glyph: '✚', label: 'BOT-04' },
};

export interface FleetGlyphProps {
  readonly fleetId: FleetId;
  /** Override the default label (e.g. a custom fleet name from setup). */
  readonly label?: string;
  readonly class?: string;
}

/**
 * The `.glyph.fl-N` badge. Renders the visible glyph plus an `.sr-only` label
 * so screen readers announce the fleet even when the badge appears without a
 * visible caption. Pair it with a visible caption in list rows (see mocks).
 */
export function FleetGlyph(props: FleetGlyphProps) {
  const { fleetId, label, class: extra } = props;
  const meta = FLEET_META[fleetId];
  const finalLabel = label ?? meta.label;
  return h(
    'span',
    { class: cx('glyph', `fl-${fleetId}`, extra), title: finalLabel },
    [
      h('span', { 'aria-hidden': 'true' }, meta.glyph),
      h('span', { class: 'sr-only' }, finalLabel),
    ],
  );
}

// ---- SlotTag --------------------------------------------------------------

/** Slot-type letter table (design §2.1). FR-4: slot type is never color-only. */
export const SLOT_LETTER: Readonly<Record<SlotType, string>> = {
  weapon: 'W',
  shield: 'S',
  missile: 'M',
  engine: 'E',
  special: 'X',
};

const SLOT_NAME: Readonly<Record<SlotType, string>> = {
  weapon: 'Weapon',
  shield: 'Shield',
  missile: 'Missile',
  engine: 'Engine',
  special: 'Special',
};

export interface SlotTagProps {
  readonly type: SlotType;
  readonly class?: string;
}

export function SlotTag(props: SlotTagProps) {
  const { type, class: extra } = props;
  return h(
    'span',
    {
      class: cx('tag-slot', `tag-${type}`, extra),
      'aria-label': `${SLOT_NAME[type]} slot`,
    },
    SLOT_LETTER[type],
  );
}

// ---- SlotPips -------------------------------------------------------------

/** Fixed render order for `SlotPips` — matches the mock readout W S M E X. */
export const SLOT_ORDER: readonly SlotType[] = [
  'weapon',
  'shield',
  'missile',
  'engine',
  'special',
];

export interface SlotPipsProps {
  /**
   * The class-frozen slot layout (`catalog.slotLayout(classId)`). Positional —
   * pips are grouped by type in `SLOT_ORDER`, preserving the count-per-type
   * from the layout (a Meridian's `3W/2S/2M/1E/2X` renders exactly that).
   */
  readonly layout: readonly SlotType[];
  /**
   * Boolean fill state aligned with `layout` by index. Values missing from the
   * array are treated as empty. FR-4 legality: an empty slot is valid.
   */
  readonly filled: readonly boolean[];
  readonly class?: string;
}

export interface SlotPipsGroup {
  readonly type: SlotType;
  readonly count: number;
  readonly filled: number;
  readonly pips: readonly boolean[];
}

/**
 * Group a positional layout by slot type in the mock's fixed render order.
 * Preserves per-type positional fill state so the pip strip reads out truthfully.
 * Exported for tests; consumers should stick to `SlotPips`.
 */
export function groupSlotPips(
  layout: readonly SlotType[],
  filled: readonly boolean[],
): readonly SlotPipsGroup[] {
  const perType: Record<SlotType, boolean[]> = {
    weapon: [],
    shield: [],
    missile: [],
    engine: [],
    special: [],
  };
  for (let i = 0; i < layout.length; i++) {
    const t = layout[i];
    if (t === undefined) continue;
    perType[t].push(filled[i] === true);
  }
  const groups: SlotPipsGroup[] = [];
  for (const type of SLOT_ORDER) {
    const pips = perType[type];
    if (pips.length === 0) continue;
    let filledCount = 0;
    for (const p of pips) if (p) filledCount += 1;
    groups.push({ type, count: pips.length, filled: filledCount, pips });
  }
  return groups;
}

/**
 * One-line fit readout: `W ●●● S ●○ M ●● E ● X ●○` (design §2.1). Filled pips
 * use `.c-cyan`; empty pips use `.c-dim` — both classes are token-backed in
 * S01. A per-type `.sr-only` summary carries the exact counts for readers.
 */
export function SlotPips(props: SlotPipsProps) {
  const { layout, filled, class: extra } = props;
  const groups = groupSlotPips(layout, filled);
  return h(
    'span',
    { class: cx('slots', extra) },
    groups.map((g) =>
      h('span', { class: 'slotgrp', key: g.type }, [
        SlotTag({ type: g.type }),
        h(
          'span',
          { class: 'pips', 'aria-hidden': 'true' },
          g.pips.map((f, idx) =>
            h('span', { key: idx, class: f ? 'c-cyan' : 'c-dim' }, f ? '●' : '○'),
          ),
        ),
        h(
          'span',
          { class: 'sr-only' },
          `${SLOT_NAME[g.type]} slots: ${g.filled} filled of ${g.count}.`,
        ),
      ]),
    ),
  );
}

// ---- BodyStateTag ---------------------------------------------------------

/**
 * Body-class identity (design §1.1). Ships carry `FleetGlyph`; everything else
 * in space — debris and missiles — is a different body class with its own
 * color + glyph + text label. Present here to keep the never-color-alone
 * vocabulary complete in one place; used by later Skirmish sessions.
 */
export type BodyStateKind = 'debris' | 'missile-tracking' | 'missile-spent';

interface BodyStateMeta {
  readonly glyph: string;
  readonly baseLabel: string;
  /** CSS token name (without `var()` wrap) that owns this body's color. */
  readonly colorToken: string;
}

const BODY_STATE_META: Readonly<Record<BodyStateKind, BodyStateMeta>> = {
  debris: { glyph: '✳', baseLabel: 'DEBRIS', colorToken: '--hazard' },
  'missile-tracking': { glyph: '➤', baseLabel: 'TRACKING', colorToken: '--missile' },
  'missile-spent': { glyph: '◇', baseLabel: 'SPENT · ARMED', colorToken: '--spent' },
};

export interface BodyStateTagProps {
  readonly kind: BodyStateKind;
  /**
   * For `missile-tracking`: beats of guidance left (`T2` / `T1`). Ignored for
   * other kinds. Undefined renders the neutral `TRACKING` label.
   */
  readonly guidanceLeft?: number;
  readonly class?: string;
}

/**
 * Text-first status pill for non-ship bodies. Color comes from the reserved
 * `--hazard` / `--missile` / `--spent` tokens (design §1.1, `mocks/console.css`);
 * no palette class exists for these three because the token IS the palette rule.
 */
export function BodyStateTag(props: BodyStateTagProps) {
  const { kind, guidanceLeft, class: extra } = props;
  const meta = BODY_STATE_META[kind];
  const label =
    kind === 'missile-tracking' && guidanceLeft !== undefined
      ? `T${guidanceLeft}`
      : meta.baseLabel;
  return h(
    'span',
    {
      class: cx('chip', extra),
      style: `color: var(${meta.colorToken})`,
      'aria-label': label,
    },
    [h('span', { 'aria-hidden': 'true' }, meta.glyph), h('span', {}, label)],
  );
}

// ---- Re-exports for consumer convenience ----------------------------------

// Re-exporting `SlotType` from identity keeps screen sessions from having to
// import both the domain slot-type primitive and the identity components in
// separate statements — the whole identity vocabulary lands from one file.
export type { SlotType } from '../../catalog/index.js';
