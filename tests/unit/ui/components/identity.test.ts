// M14 UI — identity component vnode tests (S02 checkpoint 2).
//
// Vitest runs in the node env — no jsdom. We call the component function
// directly and assert on the returned Preact vnode's `type` / `props`. Never
// render to DOM here; nothing here needs it.

import { describe, expect, it } from 'vitest';

import type { SlotType } from '../../../../src/catalog/index.js';
import {
  FleetGlyph,
  FLEET_META,
  SlotTag,
  SLOT_LETTER,
  SlotPips,
  groupSlotPips,
  BodyStateTag,
} from '../../../../src/ui/components/index.js';

// Preact vnodes carry their children inside `props.children`; a helper keeps
// the assertions concise and type-safe against inevitable `unknown` narrowing.
type VNodeLike = { type: unknown; props: Record<string, unknown> };

const asVNode = (v: unknown): VNodeLike => {
  if (typeof v !== 'object' || v === null) throw new Error('expected a vnode');
  const rec = v as Record<string, unknown>;
  return { type: rec['type'], props: (rec['props'] as Record<string, unknown>) ?? {} };
};

const childrenOf = (v: VNodeLike): unknown[] => {
  const c = v.props['children'];
  return Array.isArray(c) ? c : c === undefined ? [] : [c];
};

// ---- FleetGlyph -----------------------------------------------------------

describe('FleetGlyph — color + glyph + label (design §1.1 never-color-alone)', () => {
  it('renders the glyph badge with `.fl-N` and the default label as sr-only text', () => {
    const v = asVNode(FleetGlyph({ fleetId: 2 }));
    expect(v.type).toBe('span');
    expect(v.props['class']).toBe('glyph fl-2');
    expect(v.props['title']).toBe(FLEET_META[2].label);
    const kids = childrenOf(v);
    // [ visible-glyph span, sr-only label span ]
    expect(kids).toHaveLength(2);
    const glyphSpan = asVNode(kids[0]);
    expect(glyphSpan.props['aria-hidden']).toBe('true');
    expect(glyphSpan.props['children']).toBe(FLEET_META[2].glyph);
    const labelSpan = asVNode(kids[1]);
    expect(labelSpan.props['class']).toBe('sr-only');
    expect(labelSpan.props['children']).toBe(FLEET_META[2].label);
  });

  it('honors a custom label override', () => {
    const v = asVNode(FleetGlyph({ fleetId: 0, label: 'ALPHA WING' }));
    expect(v.props['title']).toBe('ALPHA WING');
    const kids = childrenOf(v);
    const labelSpan = asVNode(kids[1]);
    expect(labelSpan.props['children']).toBe('ALPHA WING');
  });

  it('emits every fleet id 0..4 with its published glyph', () => {
    const glyphs = [0, 1, 2, 3, 4].map((id) => {
      const v = asVNode(FleetGlyph({ fleetId: id as 0 | 1 | 2 | 3 | 4 }));
      const kids = childrenOf(v);
      return asVNode(kids[0]).props['children'];
    });
    expect(glyphs).toEqual(['▲', '●', '■', '◆', '✚']);
  });
});

// ---- SlotTag --------------------------------------------------------------

describe('SlotTag — letter carries slot type when color fails (FR-4)', () => {
  it.each<[SlotType, string]>([
    ['weapon', 'W'],
    ['shield', 'S'],
    ['missile', 'M'],
    ['engine', 'E'],
    ['special', 'X'],
  ])('type=%s renders letter %s with .tag-%s class', (type, letter) => {
    const v = asVNode(SlotTag({ type }));
    expect(v.type).toBe('span');
    expect(v.props['class']).toBe(`tag-slot tag-${type}`);
    expect(v.props['children']).toBe(letter);
    expect(SLOT_LETTER[type]).toBe(letter);
  });

  it('carries an accessible label naming the slot type', () => {
    const v = asVNode(SlotTag({ type: 'engine' }));
    expect(v.props['aria-label']).toBe('Engine slot');
  });
});

// ---- SlotPips -------------------------------------------------------------

describe('SlotPips — one pip per layout slot; filled count is truthful', () => {
  const cruiserLayout: readonly SlotType[] = [
    'weapon',
    'weapon',
    'weapon',
    'shield',
    'shield',
    'missile',
    'missile',
    'engine',
    'special',
    'special',
  ];

  it('emits one group per slot type present in the layout, in W S M E X order', () => {
    const filled = [true, true, true, true, false, true, false, true, false, false];
    const groups = groupSlotPips(cruiserLayout, filled);

    expect(groups.map((g) => g.type)).toEqual([
      'weapon',
      'shield',
      'missile',
      'engine',
      'special',
    ]);
    expect(groups.map((g) => g.count)).toEqual([3, 2, 2, 1, 2]);
    expect(groups.map((g) => g.filled)).toEqual([3, 1, 1, 1, 0]);
    // Total pip count equals layout length — no slot is dropped.
    const totalPips = groups.reduce((sum, g) => sum + g.count, 0);
    expect(totalPips).toBe(cruiserLayout.length);
  });

  it('skips slot types absent from the layout (fighter has no missile bay)', () => {
    const fighter: readonly SlotType[] = ['weapon', 'engine', 'special'];
    const groups = groupSlotPips(fighter, [true, true, false]);
    expect(groups.map((g) => g.type)).toEqual(['weapon', 'engine', 'special']);
    // No 'missile' or 'shield' groups appear at all.
    expect(groups.find((g) => g.type === 'missile')).toBeUndefined();
    expect(groups.find((g) => g.type === 'shield')).toBeUndefined();
  });

  it('treats missing / non-true entries in `filled` as empty', () => {
    const groups = groupSlotPips(['weapon', 'weapon'], []);
    expect(groups[0]?.filled).toBe(0);
    expect(groups[0]?.count).toBe(2);
  });

  it('renders a slotgrp per present type, each with a SlotTag + one pip per slot', () => {
    const filled = [true, false, true, false];
    const layout: readonly SlotType[] = ['weapon', 'weapon', 'shield', 'shield'];
    const v = asVNode(SlotPips({ layout, filled }));
    const groups = childrenOf(v).map(asVNode);
    expect(groups).toHaveLength(2);

    // Weapon group: 1 tag + 2 pips + 1 sr-only summary.
    const weaponKids = childrenOf(groups[0]!);
    expect(weaponKids).toHaveLength(3);
    const weaponPips = childrenOf(asVNode(weaponKids[1]));
    expect(weaponPips).toHaveLength(2);
    expect(asVNode(weaponPips[0]).props['children']).toBe('●');
    expect(asVNode(weaponPips[1]).props['children']).toBe('○');
    // sr-only summary text is truthful (1 filled of 2).
    const weaponSummary = asVNode(weaponKids[2]);
    expect(weaponSummary.props['class']).toBe('sr-only');
    expect(String(weaponSummary.props['children'])).toContain('1 filled of 2');
  });
});

// ---- BodyStateTag ---------------------------------------------------------

describe('BodyStateTag — completes the never-color-alone vocabulary', () => {
  it('debris carries the ✳ glyph and DEBRIS label with hazard token color', () => {
    const v = asVNode(BodyStateTag({ kind: 'debris' }));
    expect(v.props['class']).toBe('chip');
    expect(v.props['style']).toBe('color: var(--hazard)');
    expect(v.props['aria-label']).toBe('DEBRIS');
    const kids = childrenOf(v);
    expect(asVNode(kids[0]).props['children']).toBe('✳');
    expect(asVNode(kids[1]).props['children']).toBe('DEBRIS');
  });

  it('missile-tracking with guidance beats renders T{n}', () => {
    const v = asVNode(BodyStateTag({ kind: 'missile-tracking', guidanceLeft: 2 }));
    expect(v.props['style']).toBe('color: var(--missile)');
    const kids = childrenOf(v);
    expect(asVNode(kids[0]).props['children']).toBe('➤');
    expect(asVNode(kids[1]).props['children']).toBe('T2');
  });

  it('missile-tracking without guidanceLeft falls back to TRACKING', () => {
    const v = asVNode(BodyStateTag({ kind: 'missile-tracking' }));
    expect(asVNode(childrenOf(v)[1]).props['children']).toBe('TRACKING');
  });

  it('missile-spent renders the SPENT · ARMED label with spent token color', () => {
    const v = asVNode(BodyStateTag({ kind: 'missile-spent' }));
    expect(v.props['style']).toBe('color: var(--spent)');
    const kids = childrenOf(v);
    expect(asVNode(kids[0]).props['children']).toBe('◇');
    expect(asVNode(kids[1]).props['children']).toBe('SPENT · ARMED');
  });
});
