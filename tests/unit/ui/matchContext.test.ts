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
import type { Vec3 } from '../../../src/sim/index.js';
import type { WaypointBurn } from '../../../src/sim/types.js';

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

// ---- previewArc — the segmented-arc contract (`finite-thrust-movement` S04)
//
// TYPE-level lock for the seam signature. Vitest runs in node with no DOM, so
// we cannot construct a real controller here — but we CAN prove the contract
// type accepts both arc shapes and exposes `markPositions` by writing calls
// that would fail `tsc` if the union widened, narrowed, or dropped the
// optional key. Runtime behaviour is verified in `tests/unit/app/match/`.
describe('MatchController.previewArc — accepts Vec3 | { segments } (contract)', () => {
  it('type-checks both arc forms and exposes an optional markPositions', () => {
    // A minimal stub matching the seam signature only. If the contract changes
    // shape (previewArc drops the union, or removes `markPositions?`), this
    // stub either fails to assign or the reads below fail to type-check.
    const previewArc: MatchController['previewArc'] = (bodyId, arc) => {
      // Discriminate on `segments` presence — mirrors the controller impl and
      // proves the union is genuinely discriminated at compile time.
      const marks: readonly Vec3[] = 'segments' in arc ? [] : [];
      void bodyId;
      void arc;
      return { positions: [], endsOutsideArena: false, markPositions: marks };
    };
    const zero: Vec3 = { x: 0, y: 0, z: 0 };
    // Impulsive form — a plain Vec3 (regression, pre-SESSION-04 shape).
    const impulsive = previewArc(1, zero);
    expect(impulsive.positions).toEqual([]);
    expect(impulsive.endsOutsideArena).toBe(false);
    // Segmented form — the new finite-thrust shape.
    const segments: readonly WaypointBurn[] = [{ deltaV: zero }, { deltaV: zero }];
    const finite = previewArc(1, { segments });
    // `markPositions` is optional in the contract; asserting it's an array
    // (either surfaced or absent) proves the caller reads it defensively.
    expect(finite.markPositions ?? []).toEqual([]);
  });
});
