// M16 App — router parse/serialize + createRouter behaviour.
//
// The parse/serialize half is a pure round-trip: every `Route` variant must
// serialise to a hash whose reparse produces the same discriminant + payload.
// The runtime half exercises `createRouter` with injected `applyHash` /
// `attachHashChange` stubs so no `window` global is required.

import { describe, expect, it, vi } from 'vitest';

import {
  createRouter,
  parseHash,
  serializeRoute,
} from '../../../src/app/router.js';
import type { Route } from '../../../src/ui/appContext.js';

// ---- Round-trip fixtures --------------------------------------------------

const ROUND_TRIP_ROUTES: readonly Route[] = [
  { name: 'encyclopedia' },
  { name: 'shipyard' },
  { name: 'shipyard', buildId: 'a1b2-c3d4' },
  { name: 'shipyard', buildId: 'contains spaces & slash/oops' },
  { name: 'share' },
  { name: 'share', token: 'SbYzYWxpZ25tZW50' },
  { name: 'share', token: 'has=weird&chars?' },
];

describe('parseHash + serializeRoute — round-trip every Route variant', () => {
  for (const route of ROUND_TRIP_ROUTES) {
    it(`round-trips ${JSON.stringify(route)}`, () => {
      const hash = serializeRoute(route);
      const back = parseHash(hash);
      expect(back).toEqual(route);
    });
  }
});

describe('parseHash — unrecognised inputs land on encyclopedia (safe default)', () => {
  it.each([
    '',
    '#',
    '#/',
    '#/unknown',
    '#/shipYARD', // case-sensitive on purpose — the tokens are literals
    '#foo=bar',
  ])('parses %s → encyclopedia', (hash) => {
    expect(parseHash(hash)).toEqual({ name: 'encyclopedia' });
  });

  it('drops an empty shipyard buildId', () => {
    expect(parseHash('#/shipyard/')).toEqual({ name: 'shipyard' });
  });

  it('drops an empty share token', () => {
    expect(parseHash('#/share?t=')).toEqual({ name: 'share' });
  });

  it('accepts a hash without the leading #', () => {
    expect(parseHash('/shipyard/xyz')).toEqual({
      name: 'shipyard',
      buildId: 'xyz',
    });
  });
});

// ---- createRouter runtime -------------------------------------------------

describe('createRouter — signal writes on navigate + hashchange', () => {
  it('initial route reflects the injected initialHash', () => {
    const router = createRouter({
      initialHash: '#/shipyard/abc',
      applyHash: () => {},
      attachHashChange: () => () => {},
    });
    expect(router.initial).toEqual({ name: 'shipyard', buildId: 'abc' });
    expect(router.route.value).toEqual({ name: 'shipyard', buildId: 'abc' });
    router.dispose();
  });

  it('navigate writes the signal AND calls applyHash', () => {
    const applyHash = vi.fn<(hash: string) => void>();
    const router = createRouter({
      initialHash: '',
      applyHash,
      attachHashChange: () => () => {},
    });
    router.navigate({ name: 'share', token: 'HELLO' });
    expect(applyHash).toHaveBeenCalledWith('#/share?t=HELLO');
    expect(router.route.value).toEqual({ name: 'share', token: 'HELLO' });
    router.dispose();
  });

  it('dispose() detaches the hashchange listener', () => {
    const detach = vi.fn();
    const attachHashChange = vi.fn<
      (handler: () => void) => () => void
    >(() => detach);
    const router = createRouter({
      initialHash: '',
      applyHash: () => {},
      attachHashChange,
    });
    expect(attachHashChange).toHaveBeenCalledTimes(1);
    router.dispose();
    expect(detach).toHaveBeenCalledTimes(1);
  });
});
