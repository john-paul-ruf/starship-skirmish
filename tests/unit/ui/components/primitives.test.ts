// M14 UI — primitives vnode tests (S02).
//
// Focused on the pure logic each primitive owns:
//   - Delta   → sign class + text always carries an arrow + explicit sign (FR-6)
//   - Meter   → clamp `value` to `[0, max]`; NaN and out-of-range are safe
//   - Chip    → tone → variant class mapping
//   - Button  → variant + size → class assembly; disabled coerces to undefined
//   - Segmented → the clicked option's value flows through onChange
//   - Tabs    → aria-selected + tabindex both hinge on activeId
//   - StatRow → label + value are placed in the mock's `.stat-k` / `.stat-v`

import { describe, expect, it, vi } from 'vitest';

import {
  Button,
  Chip,
  Delta,
  deltaSign,
  Meter,
  Segmented,
  StatRow,
  Tabs,
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

// ---- Delta (FR-6) ---------------------------------------------------------

describe('Delta — sign + arrow always accompany color (FR-6, design §1.1)', () => {
  it('positive diff → delta-up, prefixed with ▲ +', () => {
    const v = asVNode(Delta({ from: 60, to: 63 }));
    expect(v.props['class']).toBe('delta delta-up');
    expect(v.props['children']).toBe('▲ +3');
  });

  it('negative diff → delta-down, prefixed with ▼ − (U+2212)', () => {
    const v = asVNode(Delta({ from: 108, to: 70 }));
    expect(v.props['class']).toBe('delta delta-down');
    expect(v.props['children']).toBe('▼ −38');
  });

  it('zero diff → delta-none, "— 0" (never blank)', () => {
    const v = asVNode(Delta({ from: 42, to: 42 }));
    expect(v.props['class']).toBe('delta delta-none');
    expect(v.props['children']).toBe('— 0');
  });

  it('honours a unit and a precision', () => {
    const v = asVNode(Delta({ from: 1.06, to: 0.68, unit: '', precision: 2 }));
    expect(v.props['children']).toBe('▼ −0.38');
    const w = asVNode(Delta({ from: 95, to: 70, unit: '/T' }));
    expect(w.props['children']).toBe('▼ −25/T');
  });

  it('deltaSign — internal helper is deterministic for NaN + finite input', () => {
    expect(deltaSign(0)).toBe('none');
    expect(deltaSign(NaN)).toBe('none');
    expect(deltaSign(1)).toBe('up');
    expect(deltaSign(-1)).toBe('down');
  });
});

// ---- Meter ----------------------------------------------------------------

describe('Meter — clamps value to [0, max]; safe for NaN + zero max', () => {
  const fillWidth = (props: Parameters<typeof Meter>[0]): string => {
    const v = asVNode(Meter(props));
    const fill = asVNode(childrenOf(v)[0]);
    return String(fill.props['style']);
  };

  it('renders width as `value/max` percentage', () => {
    expect(fillWidth({ value: 3, max: 4 })).toBe('width: 75%');
    expect(fillWidth({ value: 63, max: 75 })).toBe('width: 84%');
  });

  it('clamps a value above max to 100%', () => {
    expect(fillWidth({ value: 99, max: 50 })).toBe('width: 100%');
  });

  it('clamps a value below zero to 0%', () => {
    expect(fillWidth({ value: -8, max: 100 })).toBe('width: 0%');
  });

  it('handles NaN as zero (no runtime crash from cascade recalcs)', () => {
    expect(fillWidth({ value: Number.NaN, max: 10 })).toBe('width: 0%');
  });

  it('renders an empty fill (never divide by zero) when max ≤ 0', () => {
    expect(fillWidth({ value: 5, max: 0 })).toBe('width: 0%');
    expect(fillWidth({ value: 5, max: -2 })).toBe('width: 0%');
  });

  it('applies the requested fill palette class', () => {
    const v = asVNode(Meter({ value: 1, max: 1, fill: 'shield' }));
    const fillSpan = asVNode(childrenOf(v)[0]);
    expect(fillSpan.props['class']).toBe('meter-fill f-shield');
  });

  it('renders a notch per entry with its position clamped to the same axis', () => {
    const v = asVNode(Meter({ value: 2, max: 5, notches: [1, 4, 999] }));
    const kids = childrenOf(v).slice(1).map(asVNode);
    expect(kids).toHaveLength(3);
    expect(kids[0]!.props['style']).toBe('left: 20%');
    expect(kids[1]!.props['style']).toBe('left: 80%');
    expect(kids[2]!.props['style']).toBe('left: 100%');
  });

  it('adopts role=img when an aria-label is provided; nothing otherwise', () => {
    const withLabel = asVNode(Meter({ value: 1, max: 4, 'aria-label': 'hull 25%' }));
    expect(withLabel.props['role']).toBe('img');
    expect(withLabel.props['aria-label']).toBe('hull 25%');
    const noLabel = asVNode(Meter({ value: 1, max: 4 }));
    expect(noLabel.props['role']).toBeUndefined();
  });
});

// ---- Chip -----------------------------------------------------------------

describe('Chip — tone → variant class', () => {
  it('neutral renders bare `.chip`', () => {
    expect(asVNode(Chip({ children: 'alpha' })).props['class']).toBe('chip');
  });

  it.each(['cyan', 'amber', 'red', 'green'] as const)(
    'tone=%s adds chip-%s',
    (tone) => {
      const v = asVNode(Chip({ tone, children: 'x' }));
      expect(v.props['class']).toBe(`chip chip-${tone}`);
    },
  );
});

// ---- Button ---------------------------------------------------------------

describe('Button — variant + size assemble into the mock class string', () => {
  it('default variant, md size → plain `.btn`', () => {
    const v = asVNode(Button({ children: 'x' }));
    expect(v.props['class']).toBe('btn');
    expect(v.props['type']).toBe('button');
  });

  it('primary + sm → `.btn .btn-primary .btn-sm`', () => {
    const v = asVNode(Button({ variant: 'primary', size: 'sm', children: 'SAVE' }));
    expect(v.props['class']).toBe('btn btn-primary btn-sm');
  });

  it('danger, warn, ghost each get their variant class', () => {
    expect(asVNode(Button({ variant: 'danger', children: 'x' })).props['class']).toBe(
      'btn btn-danger',
    );
    expect(asVNode(Button({ variant: 'warn', children: 'x' })).props['class']).toBe(
      'btn btn-warn',
    );
    expect(asVNode(Button({ variant: 'ghost', children: 'x' })).props['class']).toBe(
      'btn btn-ghost',
    );
  });

  it('disabled=true renders the `disabled` attribute; false collapses to undefined', () => {
    expect(asVNode(Button({ disabled: true, children: 'x' })).props['disabled']).toBe(true);
    expect(asVNode(Button({ disabled: false, children: 'x' })).props['disabled']).toBeUndefined();
  });

  it('onClick is placed on the returned vnode verbatim', () => {
    const onClick = vi.fn();
    const v = asVNode(Button({ onClick, children: 'x' }));
    expect(v.props['onClick']).toBe(onClick);
  });
});

// ---- Segmented ------------------------------------------------------------

describe('Segmented — aria-pressed reflects the value; onChange fires the clicked value', () => {
  const options = [
    { value: 'recent', label: 'RECENT' },
    { value: 'name', label: 'NAME' },
    { value: 'points', label: 'POINTS' },
  ] as const;

  it('sets aria-pressed=true on the active option, false on the others', () => {
    const v = asVNode(
      Segmented({
        options,
        value: 'name',
        onChange: () => {},
        'aria-label': 'Sort builds',
      }),
    );
    expect(v.props['role']).toBe('group');
    const buttons = childrenOf(v).map(asVNode);
    expect(buttons.map((b) => b.props['aria-pressed'])).toEqual([false, true, false]);
  });

  it('clicking a button invokes onChange with that option value', () => {
    const onChange = vi.fn();
    const v = asVNode(
      Segmented({ options, value: 'recent', onChange, 'aria-label': 'Sort builds' }),
    );
    const pointsBtn = asVNode(childrenOf(v)[2]);
    const handler = pointsBtn.props['onClick'] as () => void;
    handler();
    expect(onChange).toHaveBeenCalledWith('points');
  });
});

// ---- Tabs -----------------------------------------------------------------

describe('Tabs — aria-selected + roving tabindex track the active id', () => {
  const tabs = [
    { id: 'chassis', label: 'CHASSIS' },
    { id: 'weapon', label: 'WEAPON' },
    { id: 'shield', label: 'SHIELD' },
  ] as const;

  it('marks the active tab with `.is-active`, aria-selected=true, tabindex=0', () => {
    const v = asVNode(
      Tabs({ tabs, activeId: 'weapon', onChange: () => {}, 'aria-label': 'Slot type' }),
    );
    expect(v.props['role']).toBe('tablist');
    const buttons = childrenOf(v).map(asVNode);
    const [chassis, weapon, shield] = buttons;
    expect(weapon!.props['class']).toBe('tab is-active');
    expect(weapon!.props['aria-selected']).toBe(true);
    expect(weapon!.props['tabIndex']).toBe(0);
    // Inactive tabs step out of tab-order via tabindex=-1.
    expect(chassis!.props['aria-selected']).toBe(false);
    expect(chassis!.props['tabIndex']).toBe(-1);
    expect(shield!.props['tabIndex']).toBe(-1);
  });
});

// ---- StatRow --------------------------------------------------------------

describe('StatRow — label + value land in the mock spans', () => {
  it('places label in `.stat-k` and value in `.stat-v`', () => {
    const v = asVNode(StatRow({ label: 'DELTA-V', value: '70/T' }));
    expect(v.props['class']).toBe('stat');
    const kids = childrenOf(v).map(asVNode);
    expect(kids[0]!.props['class']).toBe('stat-k');
    expect(kids[0]!.props['children']).toBe('DELTA-V');
    expect(kids[1]!.props['class']).toBe('stat-v');
    expect(kids[1]!.props['children']).toBe('70/T');
  });
});
