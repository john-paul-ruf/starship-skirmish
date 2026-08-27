// M14 UI — chrome vnode tests (S02 checkpoint 3).
//
//   - `DesktopGate` branch selection (viewportOk true → children; false → gate).
//   - `Topbar` renders the active route with `.is-active` + aria-current=page
//     and its click handlers call the injected callbacks.
//   - `ErrorFallback` renders a string message as a text child (never markup).

import { describe, expect, it, vi } from 'vitest';

import {
  DesktopGate,
  ErrorFallback,
  Topbar,
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

// ---- DesktopGate ----------------------------------------------------------

describe('DesktopGate — degradation below 1024px, not breakage (design §1.7)', () => {
  it('renders the mobile-gate fallback when viewportOk is false', () => {
    const v = asVNode(DesktopGate({ viewportOk: false, children: 'HIDDEN' }));
    expect(v.props['class']).toBe('mobile-gate');
    // The fallback text names the requirement explicitly.
    const flatText = JSON.stringify(v);
    expect(flatText).toContain('DESKTOP REQUIRED');
    expect(flatText).toContain('1024');
    expect(flatText).not.toContain('HIDDEN');
  });

  it('renders children under the desktop-only shell when viewportOk is true', () => {
    const v = asVNode(DesktopGate({ viewportOk: true, children: 'VISIBLE' }));
    expect(v.props['class']).toBe('desktop-only');
    expect(v.props['children']).toBe('VISIBLE');
  });

  it('honours a custom minWidth in the gate copy', () => {
    const v = asVNode(DesktopGate({ viewportOk: false, minWidth: 1280 }));
    const flatText = JSON.stringify(v);
    expect(flatText).toContain('1280');
  });
});

// ---- Topbar ---------------------------------------------------------------

describe('Topbar — nav is prop-driven; no state, no app import', () => {
  const routes = [
    { id: 'encyclopedia', label: 'ENCYCLOPEDIA' },
    { id: 'shipyard', label: 'SHIPYARD' },
    { id: 'share', label: 'SHARE' },
  ] as const;

  const renderBar = (activeRoute = 'shipyard', reducedMotion = false) => {
    const onNavigate = vi.fn();
    const onToggleReducedMotion = vi.fn();
    const root = asVNode(
      Topbar({
        routes,
        activeRoute,
        onNavigate,
        reducedMotion,
        onToggleReducedMotion,
      }),
    );
    return { onNavigate, onToggleReducedMotion, root };
  };

  it('marks the active route with .is-active and aria-current=page; others get neither', () => {
    const { root } = renderBar('shipyard');
    const kids = childrenOf(root);
    const nav = asVNode(kids[1]);
    const links = childrenOf(nav).map(asVNode);
    const active = links.find((l) => l.props['href'] === '#/shipyard')!;
    const inactive = links.find((l) => l.props['href'] === '#/encyclopedia')!;
    expect(active.props['class']).toBe('is-active');
    expect(active.props['aria-current']).toBe('page');
    expect(inactive.props['class']).toBe('');
    expect(inactive.props['aria-current']).toBeUndefined();
  });

  it('nav-link onClick prevents default and invokes onNavigate with the route id', () => {
    const { onNavigate, root } = renderBar();
    const nav = asVNode(childrenOf(root)[1]);
    const encyclopedia = childrenOf(nav)
      .map(asVNode)
      .find((l) => l.props['href'] === '#/encyclopedia')!;
    const handler = encyclopedia.props['onClick'] as (e: MouseEvent) => void;
    const preventDefault = vi.fn();
    handler({ preventDefault } as unknown as MouseEvent);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('encyclopedia');
  });

  it('reduced-motion toggle exposes aria-pressed + a label that names the current state', () => {
    const off = renderBar('shipyard', false);
    const btnOff = asVNode(childrenOf(off.root).at(-1));
    expect(btnOff.props['aria-pressed']).toBe(false);
    expect(String(btnOff.props['children'])).toContain('◐ REDUCED MOTION');

    const on = renderBar('shipyard', true);
    const btnOn = asVNode(childrenOf(on.root).at(-1));
    expect(btnOn.props['aria-pressed']).toBe(true);
    expect(String(btnOn.props['children'])).toContain('◉ REDUCED MOTION ON');
  });

  it('clicking the reduced-motion button invokes the toggle callback', () => {
    const { onToggleReducedMotion, root } = renderBar();
    const btn = asVNode(childrenOf(root).at(-1));
    const handler = btn.props['onClick'] as () => void;
    handler();
    expect(onToggleReducedMotion).toHaveBeenCalledTimes(1);
  });
});

// ---- ErrorFallback --------------------------------------------------------

describe('ErrorFallback — error text renders as a text node (no innerHTML)', () => {
  it('surfaces Error.message as text', () => {
    const v = asVNode(ErrorFallback({ error: new Error('LibraryRepo write failed') }));
    const flatText = JSON.stringify(v);
    expect(flatText).toContain('LibraryRepo write failed');
    expect(v.props['role']).toBe('alert');
  });

  it('coerces non-Error values to strings', () => {
    const v = asVNode(ErrorFallback({ error: 'plain string' }));
    expect(JSON.stringify(v)).toContain('plain string');
  });

  it('handles missing error with a neutral message', () => {
    const v = asVNode(ErrorFallback({}));
    expect(JSON.stringify(v)).toContain('unknown error');
  });

  it('renders a retry button only when onReset is supplied', () => {
    const withoutReset = asVNode(ErrorFallback({ error: 'x' }));
    expect(JSON.stringify(withoutReset)).not.toContain('RETRY');
    const onReset = vi.fn();
    const withReset = asVNode(ErrorFallback({ error: 'x', onReset }));
    const flat = JSON.stringify(withReset);
    expect(flat).toContain('RETRY');
    // The reset handler is exposed on the retry button vnode.
    // Locate it: last child (the .panel-ft), whose only child is the button.
    const kids = childrenOf(withReset);
    const footer = asVNode(kids.at(-1));
    const button = asVNode(childrenOf(footer)[0]);
    const handler = button.props['onClick'] as () => void;
    handler();
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
