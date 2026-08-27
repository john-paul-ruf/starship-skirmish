// M16 App — bootstrap pipeline behaviour.
//
// The pipeline is boot-critical, so we exhaustively verify:
//   - catalog loads (assertLock succeeds against the shipped v1 lockfile)
//   - an in-memory (non-durable) store yields `durable: false`
//   - a #/share?t=… hash yields a `share` route with the token preserved
//   - the reduced-motion signal seeds from `PrefsRecord` and persists via
//     `repo.savePrefs` on change
//   - the toast queue enqueues, exposes items via `toasts.value`, and clears
//     after the auto-dismiss timeout

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootstrap } from '../../../src/app/bootstrap.js';
import { memoryStore } from '../../../src/persist/storageAdapter.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const buildOpts = (initialHash: string) => ({
  store: memoryStore(),
  durable: false as const,
  initialHash,
  routerOptions: {
    applyHash: () => {},
    attachHashChange: () => () => {},
  },
});

describe('bootstrap — catalog + persist + initial hash', () => {
  it('loads the shipped v1 catalog without throwing', () => {
    const result = bootstrap(buildOpts(''));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.services.catalog.catalogVersion).toBe(1);
    result.session.dispose();
  });

  it('non-durable store surfaces durable:false + session-mode banner cue', () => {
    const result = bootstrap(buildOpts(''));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.durable).toBe(false);
    expect(result.session.services.durable).toBe(false);
    result.session.dispose();
  });

  it('lands on encyclopedia when the hash is empty', () => {
    const result = bootstrap(buildOpts(''));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.services.route.value).toEqual({ name: 'encyclopedia' });
    result.session.dispose();
  });

  it('preserves a #/share?t=<token> hash verbatim into the share route', () => {
    const result = bootstrap(buildOpts('#/share?t=BASE64PAYLOAD'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.services.route.value).toEqual({
      name: 'share',
      token: 'BASE64PAYLOAD',
    });
    result.session.dispose();
  });

  it('does not attempt to decode the token during bootstrap (S06 owns preview)', () => {
    // A malformed base64 hash should still route — decoding is not bootstrap's job.
    const result = bootstrap(buildOpts('#/share?t=%%%not-valid-base64%%%'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.services.route.value.name).toBe('share');
    result.session.dispose();
  });
});

describe('bootstrap — reduced-motion signal + persistence', () => {
  it('seeds reducedMotion from prefs.loadPrefs (default false)', () => {
    const result = bootstrap(buildOpts(''));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.services.reducedMotion.value).toBe(false);
    result.session.dispose();
  });

  it('persists reducedMotion via repo.savePrefs when toggled', () => {
    const store = memoryStore();
    const result = bootstrap({
      store,
      durable: false,
      initialHash: '',
      routerOptions: { applyHash: () => {}, attachHashChange: () => () => {} },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { services } = result.session;
    services.reducedMotion.value = true;
    // savePrefs writes the :prefs blob to the store.
    const prefsRaw = store.getItem('starship-skirmish:prefs');
    expect(prefsRaw).not.toBeNull();
    expect(prefsRaw!).toContain('"reducedMotion":true');
    result.session.dispose();
  });
});

describe('bootstrap — toast queue', () => {
  it('toast(msg) pushes an item and clears it after the timeout', () => {
    const result = bootstrap(buildOpts(''));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { services } = result.session;
    expect(services.toasts.value).toEqual([]);
    services.toast('hello', 'warn');
    expect(services.toasts.value).toHaveLength(1);
    expect(services.toasts.value[0]).toMatchObject({ msg: 'hello', kind: 'warn' });
    vi.advanceTimersByTime(5000);
    expect(services.toasts.value).toEqual([]);
    result.session.dispose();
  });
});
