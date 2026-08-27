// M16 App — hash router (D-ROUTE-OUTLET: the router only produces the Route
// signal + `navigate`; it never imports a screen).
//
// Hash format — copy-pasteable, token-safe, three variants:
//
//   `#/encyclopedia`
//   `#/shipyard`
//   `#/shipyard/<buildId>`
//   `#/share`
//   `#/share?t=<token>`
//
// Anything else parses to the `encyclopedia` route (the safe landing surface).
// `parseHash` and `serializeRoute` are total pure functions — every `Route`
// variant round-trips (`serializeRoute` → `parseHash` produces the same
// discriminant + payload). The router unit test exhausts every variant.
//
// The `hashchange` DOM listener is the SINGLE writer of the `route` signal,
// so `navigate()` sets `location.hash` and lets the browser dispatch the
// event — back/forward buttons then work automatically and cannot desync
// the signal from the URL. In non-browser environments (Vitest node env)
// the listener is a no-op and `navigate()` still writes the signal
// synchronously so tests can drive it directly.

import { signal, type ReadonlySignal, type Signal } from '@preact/signals';

import type { Route } from '../ui/appContext.js';

// ---- Serialisation --------------------------------------------------------

/**
 * Turn a `Route` into a hash string (including the leading `#`). Round-trips
 * with `parseHash`. Values are `encodeURIComponent`'d so exotic buildIds /
 * tokens survive intact through a copy-pasted URL.
 */
export const serializeRoute = (route: Route): string => {
  switch (route.name) {
    case 'encyclopedia':
      return '#/encyclopedia';
    case 'shipyard':
      return route.buildId !== undefined && route.buildId.length > 0
        ? `#/shipyard/${encodeURIComponent(route.buildId)}`
        : '#/shipyard';
    case 'share':
      return route.token !== undefined && route.token.length > 0
        ? `#/share?t=${encodeURIComponent(route.token)}`
        : '#/share';
  }
};

/**
 * Parse a hash string (with or without the leading `#`) to a `Route`. TOTAL:
 * unrecognised hashes fall to `encyclopedia` — the safe landing screen. An
 * empty hash (fresh visit) also lands on encyclopedia.
 *
 * Recognised shapes:
 *   `#/encyclopedia`               → { name: 'encyclopedia' }
 *   `#/shipyard`                   → { name: 'shipyard' }
 *   `#/shipyard/<id>`              → { name: 'shipyard', buildId: <id> }
 *   `#/share`                      → { name: 'share' }
 *   `#/share?t=<token>`            → { name: 'share', token: <token> }
 */
export const parseHash = (hash: string): Route => {
  const stripped = hash.startsWith('#') ? hash.slice(1) : hash;
  const withoutSlash = stripped.startsWith('/') ? stripped.slice(1) : stripped;
  if (withoutSlash === '') return DEFAULT_ROUTE;

  const [pathRaw, queryRaw = ''] = splitOnce(withoutSlash, '?');
  const segments = pathRaw.split('/');
  const head = segments[0];

  if (head === 'encyclopedia') {
    return { name: 'encyclopedia' };
  }
  if (head === 'shipyard') {
    const buildIdRaw = segments[1];
    if (buildIdRaw !== undefined && buildIdRaw.length > 0) {
      const decoded = tryDecode(buildIdRaw);
      return { name: 'shipyard', buildId: decoded };
    }
    return { name: 'shipyard' };
  }
  if (head === 'share') {
    const tokenRaw = queryParam(queryRaw, 't');
    if (tokenRaw !== undefined && tokenRaw.length > 0) {
      const decoded = tryDecode(tokenRaw);
      return { name: 'share', token: decoded };
    }
    return { name: 'share' };
  }

  return DEFAULT_ROUTE;
};

const DEFAULT_ROUTE: Route = { name: 'encyclopedia' };

const splitOnce = (s: string, sep: string): [string, string?] => {
  const i = s.indexOf(sep);
  if (i < 0) return [s];
  return [s.slice(0, i), s.slice(i + 1)];
};

const queryParam = (query: string, key: string): string | undefined => {
  if (query === '') return undefined;
  for (const part of query.split('&')) {
    const [k, v = ''] = splitOnce(part, '=');
    if (k === key) return v;
  }
  return undefined;
};

const tryDecode = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch {
    // Malformed percent-escape → keep the raw string; parse never throws.
    return raw;
  }
};

// ---- Router runtime -------------------------------------------------------

/**
 * The public surface `bootstrap()` uses. `route` is the ReadonlySignal every
 * consumer subscribes to; `navigate()` is the only mutation entry point;
 * `dispose()` detaches the `hashchange` listener (used by the ErrorBoundary
 * reset + tests). `initial` is the route the boot pipeline observed at
 * startup so downstream code (e.g. share preview) can react without racing
 * the `hashchange` event.
 */
export interface Router {
  readonly route: ReadonlySignal<Route>;
  readonly initial: Route;
  navigate(to: Route): void;
  dispose(): void;
}

/**
 * Options for `createRouter`. `initialHash` overrides `location.hash` at
 * construction (unit tests inject a stable value). `applyHash` is the writer
 * the tests can swap for a stub so `navigate()` does not touch the ambient
 * DOM. `attachHashChange` returns a detach fn — `dispose()` calls it. Both
 * default to no-op / real-DOM behaviour based on `globalThis.window`.
 */
export interface RouterOptions {
  readonly initialHash?: string;
  readonly applyHash?: (hash: string) => void;
  readonly attachHashChange?: (handler: () => void) => () => void;
}

interface WindowLike {
  readonly location: { hash: string };
  addEventListener?: (
    type: 'hashchange',
    handler: () => void,
  ) => void;
  removeEventListener?: (
    type: 'hashchange',
    handler: () => void,
  ) => void;
}

const ambientWindow = (): WindowLike | undefined => {
  const g = globalThis as { window?: WindowLike };
  return g.window;
};

const defaultApplyHash = (hash: string): void => {
  const win = ambientWindow();
  if (win === undefined) return;
  win.location.hash = hash;
};

const defaultAttachHashChange = (handler: () => void): (() => void) => {
  const win = ambientWindow();
  if (win === undefined || win.addEventListener === undefined) return () => {};
  win.addEventListener('hashchange', handler);
  return () => {
    win.removeEventListener?.('hashchange', handler);
  };
};

/**
 * Build a router around a fresh signal. The `hashchange` listener is the
 * single writer of the signal — `navigate()` writes to `location.hash` and
 * the browser fires the event synchronously; on non-browser hosts we still
 * write the signal immediately so tests can drive it deterministically.
 */
export const createRouter = (options: RouterOptions = {}): Router => {
  const applyHash = options.applyHash ?? defaultApplyHash;
  const attachHashChange = options.attachHashChange ?? defaultAttachHashChange;

  const startingHash =
    options.initialHash !== undefined
      ? options.initialHash
      : (ambientWindow()?.location.hash ?? '');
  const initial = parseHash(startingHash);
  const route: Signal<Route> = signal(initial);

  const detach = attachHashChange(() => {
    const win = ambientWindow();
    if (win === undefined) return;
    route.value = parseHash(win.location.hash);
  });

  const navigate = (to: Route): void => {
    const hash = serializeRoute(to);
    // Set the signal first so screens re-render even on non-browser hosts.
    route.value = to;
    // Then update the URL. If we are inside the browser, the hashchange event
    // will re-parse and write the signal again — harmless (same value).
    applyHash(hash);
  };

  const dispose = (): void => detach();

  return {
    get route() {
      return route;
    },
    initial,
    navigate,
    dispose,
  };
};
