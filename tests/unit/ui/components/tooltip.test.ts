// M14 UI — InfoTip vnode tests (playtest-feedback-01 · S06).
//
// The component is stateless — every guarantee it makes is visible on the
// returned vnode, so the node-env unit tests fully cover the a11y wiring:
//   1. trigger is a real focusable <button type="button">
//   2. `aria-describedby` on the trigger equals the popup element `id`
//   3. popup carries `role="tooltip"` and renders the definition text as a
//      text node (not markup — XSS-safe by construction)
//   4. `aria-label` on the trigger names the concept ("What is this? …")
//   5. barrel re-exports InfoTip + GLOSSARY + GlossaryKey
//   6. GLOSSARY covers every DerivedStats field the Shipyard renders

import { describe, expect, it } from 'vitest';

// CP1 imports the primitive + glossary directly from their source files so
// the checkpoint is verifiable without touching the barrel yet. CP2's barrel
// commit is what unifies the public surface; screens then import from there.
import { InfoTip, type InfoTipProps } from '../../../../src/ui/components/tooltip.js';
import {
  GLOSSARY,
  type GlossaryKey,
} from '../../../../src/ui/components/glossary.js';

// The barrel re-exports InfoTip + GLOSSARY (S06 CP2). Screens must be able to
// reach both from the components index — a stray `import from './tooltip.js'`
// in a screen bypasses the M14 D-IOC-SEAM. This alias assertion is here so
// the barrel wiring is exercised by the same suite that owns the primitive.
import {
  InfoTip as InfoTipFromBarrel,
  GLOSSARY as GlossaryFromBarrel,
} from '../../../../src/ui/components/index.js';

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

// ---- Stateless authoring contract ----------------------------------------

describe('InfoTip — stateless CSS-revealed tip (S06 CP1)', () => {
  const props: InfoTipProps = {
    id: 'tip-shipyard-stat-maxHull',
    label: 'Hull points. Ship is destroyed at 0.',
  };

  it('renders a `.tip` wrapper containing a `.tip-dot` button and a `.tip-pop` span', () => {
    const root = asVNode(InfoTip(props));
    expect(root.type).toBe('span');
    expect(root.props['class']).toBe('tip');
    const [trigger, popup] = childrenOf(root).map(asVNode);
    expect(trigger?.type).toBe('button');
    expect(trigger?.props['class']).toBe('tip-dot');
    expect(popup?.type).toBe('span');
    expect(popup?.props['class']).toBe('tip-pop');
  });

  it('trigger is a real <button type="button"> (keyboard-focusable, not <div>)', () => {
    const root = asVNode(InfoTip(props));
    const trigger = asVNode(childrenOf(root)[0]);
    expect(trigger.type).toBe('button');
    expect(trigger.props['type']).toBe('button');
  });

  it('`aria-describedby` on the trigger matches the popup `id` (screen-reader linkage)', () => {
    const root = asVNode(InfoTip(props));
    const [trigger, popup] = childrenOf(root).map(asVNode);
    expect(trigger?.props['aria-describedby']).toBe(props.id);
    expect(popup?.props['id']).toBe(props.id);
  });

  it('popup carries role="tooltip" and renders the label as a text child (XSS-safe)', () => {
    const root = asVNode(InfoTip(props));
    const popup = asVNode(childrenOf(root)[1]);
    expect(popup.props['role']).toBe('tooltip');
    // The label is a text node — never dangerouslySetInnerHTML.
    expect(popup.props['children']).toBe(props.label);
  });

  it('`aria-label` on the trigger names the concept ("What is this? <label>")', () => {
    const root = asVNode(InfoTip(props));
    const trigger = asVNode(childrenOf(root)[0]);
    expect(trigger.props['aria-label']).toBe(`What is this? ${props.label}`);
  });

  it('default trigger content is the info glyph ⓘ (no custom children)', () => {
    const root = asVNode(InfoTip(props));
    const trigger = asVNode(childrenOf(root)[0]);
    expect(trigger.props['children']).toBe('ⓘ');
  });

  it('custom children replace the default glyph verbatim', () => {
    const root = asVNode(InfoTip({ ...props, children: '?' }));
    const trigger = asVNode(childrenOf(root)[0]);
    expect(trigger.props['children']).toBe('?');
  });

  it('extra class merges after the base class (caller specificity wins ties)', () => {
    const root = asVNode(InfoTip({ ...props, class: 'stat-tip' }));
    expect(root.props['class']).toBe('tip stat-tip');
  });
});

// ---- GLOSSARY coverage ----------------------------------------------------

describe('GLOSSARY — one entry per DerivedStats field, keyed by concept (S06 CP1)', () => {
  it('provides a non-empty definition for every derived-stats field', () => {
    // Names match the DerivedStats interface (src/domain/derivedStats.ts) so a
    // future rename over there surfaces here as a stale key.
    const required: readonly GlossaryKey[] = [
      'maxHull',
      'shieldCapacity',
      'shieldRegenPerTurn',
      'deltaVPerTurn',
      'totalMass',
      'effectiveAcceleration',
      'totalMissileAmmo',
      'baseEvasion',
      'perTurnHullRepair',
      'expectedDpt',
      'weaponSpec',
    ];
    for (const key of required) {
      expect(GLOSSARY[key]).toBeDefined();
      expect(GLOSSARY[key].length).toBeGreaterThan(10);
    }
  });

  it('every value is a plain string (no markup embedded)', () => {
    for (const value of Object.values(GLOSSARY)) {
      expect(typeof value).toBe('string');
      expect(value).not.toContain('<');
      expect(value).not.toContain('>');
    }
  });
});

// ---- Barrel re-export (CP2) ----------------------------------------------

describe('components barrel — InfoTip + GLOSSARY are on the public surface (S06 CP2)', () => {
  it('re-exports InfoTip as the same function reference', () => {
    expect(InfoTipFromBarrel).toBe(InfoTip);
  });

  it('re-exports GLOSSARY as the same object reference', () => {
    expect(GlossaryFromBarrel).toBe(GLOSSARY);
  });
});
