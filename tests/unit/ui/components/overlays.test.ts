// M14 UI — overlay vnode tests (S02 checkpoint 3).
//
// The Modal contract this file exercises:
//   1. Esc keydown invokes onClose (design §4.8).
//   2. Scrim click invokes onClose (design §4.8).
//   3. The modal element carries aria-modal + aria-labelledby wiring.
//
// Vitest runs in the node env — no DOM. We invoke the returned handlers
// directly on stubbed event objects. Focus mgmt (Tab trap, opener restore)
// runs only when Preact commits and is out of scope for these unit tests.

import { describe, expect, it, vi } from 'vitest';

import { Modal, Toast, Banner } from '../../../../src/ui/components/index.js';

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

// ---- Modal ----------------------------------------------------------------

describe('Modal — the only blocking affordance (design §4.8)', () => {
  const openModal = (onClose = vi.fn()) => {
    const root = asVNode(Modal({ title: 'DELETE ‘TIN CAN’?', onClose }));
    const [scrim, modal] = childrenOf(root).map(asVNode);
    return { onClose, root, scrim: scrim!, modal: modal! };
  };

  it('renders scrim + modal siblings, both with the right class', () => {
    const { scrim, modal } = openModal();
    expect(scrim.props['class']).toBe('scrim');
    expect(modal.props['class']).toBe('modal');
  });

  it('invokes onClose when the scrim is clicked', () => {
    const { onClose, scrim } = openModal();
    const handler = scrim.props['onClick'] as (event: MouseEvent) => void;
    handler({} as MouseEvent);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('invokes onClose on Escape keydown and stops propagation', () => {
    const { onClose, modal } = openModal();
    const handler = modal.props['onKeyDown'] as (event: KeyboardEvent) => void;
    const stopPropagation = vi.fn();
    handler({ key: 'Escape', stopPropagation } as unknown as KeyboardEvent);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('ignores keys that are not Escape or Tab (does not close on Enter)', () => {
    const { onClose, modal } = openModal();
    const handler = modal.props['onKeyDown'] as (event: KeyboardEvent) => void;
    handler({
      key: 'Enter',
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sets role=dialog by default and role=alertdialog when asked', () => {
    const a = openModal();
    expect(a.modal.props['role']).toBe('dialog');
    const bRoot = asVNode(Modal({ title: 'x', onClose: () => {}, role: 'alertdialog' }));
    const bModal = asVNode(childrenOf(bRoot)[1]);
    expect(bModal.props['role']).toBe('alertdialog');
  });

  it('links aria-labelledby to the header title id', () => {
    const { modal } = openModal();
    const labelledBy = modal.props['aria-labelledby'] as string;
    // The header renders a <span class="t-h2" id={titleId}> — assert they match.
    const modalKids = childrenOf(modal);
    const header = asVNode(modalKids[0]);
    const headerTitleSpan = asVNode(childrenOf(header)[0]);
    expect(headerTitleSpan.props['id']).toBe(labelledBy);
    expect(headerTitleSpan.props['children']).toBe('DELETE ‘TIN CAN’?');
    // aria-modal is a plain string 'true' in the CSS mock; carry the same.
    expect(modal.props['aria-modal']).toBe('true');
  });
});

// ---- Toast ----------------------------------------------------------------

describe('Toast — transient live-region confirmation', () => {
  it('renders `.toast` with role=status/polite by default', () => {
    const v = asVNode(Toast({ children: 'LINK COPIED' }));
    expect(v.props['class']).toBe('toast');
    expect(v.props['role']).toBe('status');
    expect(v.props['aria-live']).toBe('polite');
  });

  it('warn / danger tones add the mock CSS variant class', () => {
    const w = asVNode(Toast({ tone: 'warn', children: 'x' }));
    expect(w.props['class']).toBe('toast toast-warn');
    const d = asVNode(Toast({ tone: 'danger', children: 'x' }));
    expect(d.props['class']).toBe('toast toast-danger');
  });

  it('role=alert switches aria-live to assertive', () => {
    const v = asVNode(Toast({ role: 'alert', children: 'x' }));
    expect(v.props['aria-live']).toBe('assertive');
  });
});

// ---- Banner ---------------------------------------------------------------

describe('Banner — persistent inline notice', () => {
  it('defaults to warn (base `.banner` styling)', () => {
    const v = asVNode(Banner({ children: 'x' }));
    expect(v.props['class']).toBe('banner');
  });

  it('info / danger tones add the correct variant class', () => {
    expect(asVNode(Banner({ tone: 'info', children: 'x' })).props['class']).toBe(
      'banner banner-info',
    );
    expect(asVNode(Banner({ tone: 'danger', children: 'x' })).props['class']).toBe(
      'banner banner-danger',
    );
  });
});
