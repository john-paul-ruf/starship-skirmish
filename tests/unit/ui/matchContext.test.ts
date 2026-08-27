// M14 UI — MatchContext / useMatch / MatchProvider contract (S01 CP2).
//
// Vitest runs in the node env — no DOM, no renderer (STATE.md "Test-env
// reality"). We therefore exercise the contract the same way the component
// suite does (`overlays.test.ts`): invoke the hook/provider directly and
// inspect the result, rather than mounting a tree.
//
//   1. `useMatch()` throws when there is no active `<MatchProvider>` — a screen
//      that reaches for the controller outside the provider fails loudly
//      instead of reading a phantom value.
//   2. `MatchProvider` returns a `MatchContext.Provider` vnode whose `value`
//      is exactly the supplied controller — the value the app produces flows
//      down to the subtree unchanged.

import { describe, expect, it } from 'vitest';

import {
  MatchContext,
  MatchProvider,
  useMatch,
  type MatchController,
} from '../../../src/ui/matchContext.js';

// A reference-identity sentinel — the provider test only compares the value by
// reference, so the controller need not be a working instance.
const stubController = { playerFleetId: 0 } as unknown as MatchController;

describe('useMatch — throws outside <MatchProvider>', () => {
  it('throws when invoked with no active provider', () => {
    // No provider / no active render → the hook cannot resolve a controller.
    expect(() => useMatch()).toThrow();
  });
});

describe('MatchProvider — supplies the controller value', () => {
  it('returns a MatchContext.Provider vnode carrying the controller', () => {
    const vnode = MatchProvider({ controller: stubController, children: 'child' }) as {
      type: unknown;
      props: Record<string, unknown>;
    };
    expect(vnode.type).toBe(MatchContext.Provider);
    expect(vnode.props['value']).toBe(stubController);
    expect(vnode.props['children']).toBe('child');
  });
});
