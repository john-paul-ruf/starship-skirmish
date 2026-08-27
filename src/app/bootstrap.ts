// M16 App — the boot pipeline (architecture §6.1).
//
// Steps, in order:
//   1. `loadCatalog()` — reads the static v1 content, integrity-asserts against
//      the shipped lockfile. Failure surfaces as a `bootstrap` error and lets
//      the ErrorBoundary render — never crashes past the top-level render.
//   2. `openLibrary(catalog)` — feature-detects `localStorage`, migrates + heals
//      the index, degrades to session mode when the store is unavailable or
//      full (FR-7). Never throws across its boundary. `durable === false`
//      surfaces in the session-mode banner.
//   3. `initialHash = location.hash` — a `#/share?t=…` hash routes into the
//      share preview screen (S06). Bootstrap does NOT decode the token here.
//   4. `loadPrefs()` seeds the reducedMotion signal; `createSession` applies
//      it to `body.classList` on init and subscribes for persistence on
//      subsequent changes.
//
// Bootstrap is BOOT-CRITICAL: it must return a usable `Session` OR a
// `BootstrapError`. NEVER throws past its `bootstrap()` boundary; `boot.tsx`
// checks the discriminant and renders `ErrorFallback` on failure.

import { loadCatalog } from '../catalog/index.js';
import { openLibrary, type LibraryRepo } from '../persist/index.js';
import type { KeyValueStore } from '../persist/storageAdapter.js';
import { createSession, type Session } from './session.js';

// ---- Options --------------------------------------------------------------

/**
 * Boot-time injection points. Production `boot()` passes nothing — the
 * defaults hit the real catalog + `localStorage` probe. Unit tests inject
 * an in-memory store + a specific `initialHash` so the pipeline is
 * deterministic.
 *
 * `store` + `durable` mirror `OpenLibraryOptions` — when both are supplied,
 * `openLibrary` uses them verbatim.
 */
export interface BootstrapOptions {
  readonly store?: KeyValueStore;
  readonly durable?: boolean;
  readonly initialHash?: string;
  readonly routerOptions?: {
    readonly applyHash?: (hash: string) => void;
    readonly attachHashChange?: (handler: () => void) => () => void;
  };
}

// ---- Result ---------------------------------------------------------------

/**
 * Bootstrap outcome. `ok:false` means the pipeline hit an unrecoverable
 * failure (typically catalog lock mismatch) — `boot.tsx` renders
 * `ErrorFallback` with the message rather than mounting the shell.
 */
export type BootstrapResult =
  | { readonly ok: true; readonly session: Session; readonly durable: boolean }
  | { readonly ok: false; readonly error: Error };

// ---- Ambient location hash --------------------------------------------------

const ambientHash = (): string => {
  const g = globalThis as { location?: { hash?: string } };
  return g.location?.hash ?? '';
};

// ---- Boot pipeline --------------------------------------------------------

/**
 * Run the boot pipeline. Any synchronous throw inside is caught + returned as
 * `{ ok: false, error }` — the top-level `boot()` never lets an exception
 * escape into the DOM.
 */
export const bootstrap = (opts: BootstrapOptions = {}): BootstrapResult => {
  try {
    // Step 1 — catalog + integrity lock.
    const catalog = loadCatalog();

    // Step 2 — library repo. Always injects the store when one is provided;
    // otherwise `openLibrary` runs its own boot probe.
    const opened = openLibrary(
      catalog,
      opts.store !== undefined
        ? { store: opts.store, ...(opts.durable !== undefined ? { durable: opts.durable } : {}) }
        : {},
    );
    const repo: LibraryRepo = opened.repo;
    const durable = opened.durable;

    // Step 3 — initial hash. `share` route with `token` is preserved verbatim;
    // decoding is S06's concern.
    const initialHash = opts.initialHash !== undefined ? opts.initialHash : ambientHash();

    // Step 4 — reduced-motion seed. Prefs is TOTAL-with-default (parse never
    // returns null) — never fails.
    const prefs = repo.loadPrefs();

    const session = createSession({
      catalog,
      repo,
      durable,
      initialReducedMotion: prefs.reducedMotion,
      initialHash,
      ...(opts.routerOptions !== undefined ? { routerOptions: opts.routerOptions } : {}),
    });

    return { ok: true, session, durable };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    return { ok: false, error };
  }
};
