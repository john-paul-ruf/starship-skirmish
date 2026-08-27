// M16 App — session factory. The one place `AppServices` is assembled.
//
// Wires together:
//   - the router (produces `route` signal + `navigate`)
//   - the reduced-motion signal (seeded from `PrefsRecord`, persisted back via
//     `repo.savePrefs`, mirrored onto `body.rm` on every change)
//   - the toast queue (a signal the shell reads + a `toast(msg, kind)` pusher
//     that auto-dismisses after a fixed duration)
//
// Kept independent of DOM in its factory boundary — bootstrap tests can drive
// `createSession` in Vitest's node env without stubbing `window`. Any DOM
// interaction (`document.body.classList`) is guarded on `globalThis.document`
// so it no-ops under Node.

import { signal } from '@preact/signals';

import type { Catalog } from '../catalog/index.js';
import type { LibraryRepo } from '../persist/index.js';
import {
  AppContext,
  type AppServices,
  type Route,
  type ToastItem,
  type ToastKind,
} from '../ui/appContext.js';
import { createRouter, type Router } from './router.js';

// Re-export the context symbol so `boot.tsx` provides via the same reference
// the ui/appContext hook consumes.
export { AppContext };

// ---- Toast timing ---------------------------------------------------------

/**
 * How long a toast is visible before it self-dismisses. Design §4.11 does not
 * name a specific duration; 4.5 seconds is the standard "long enough to
 * read, short enough not to clutter" span used repo-wide.
 */
const TOAST_DURATION_MS = 4500;

// ---- Session inputs -------------------------------------------------------

/**
 * What `createSession` needs at construction time. `bootstrap.ts` collects
 * these; tests pass them directly. `initialReducedMotion` is stamped from
 * the prefs record so a reloaded page honours the last toggle before the
 * shell has committed the first render.
 *
 * `initialHash` and the router-injection options let tests drive routing
 * without touching `window.location`.
 */
export interface SessionInputs {
  readonly catalog: Catalog;
  readonly repo: LibraryRepo;
  readonly durable: boolean;
  readonly initialReducedMotion: boolean;
  readonly initialHash?: string;
  readonly routerOptions?: {
    readonly applyHash?: (hash: string) => void;
    readonly attachHashChange?: (handler: () => void) => () => void;
  };
}

// ---- Session handle -------------------------------------------------------

/**
 * `bootstrap()` returns a `Session` (not a bare `AppServices`) so callers who
 * need to tear the app down (error boundary reset, tests) can. Screens see
 * `services` via `useApp()` — nothing else.
 */
export interface Session {
  readonly services: AppServices;
  readonly router: Router;
  /** Detach the hashchange listener + drop any pending toast timers. */
  dispose(): void;
}

// ---- DOM mirror (guarded on globalThis) -----------------------------------

/**
 * Toggle `document.body.classList` for reduced-motion. No-ops when `document`
 * is undefined (Vitest node env). Called once at session build with the
 * initial value, then on every signal change.
 */
const applyReducedMotionClass = (reducedMotion: boolean): void => {
  const g = globalThis as { document?: { body?: { classList?: DOMTokenList } } };
  const cls = g.document?.body?.classList;
  if (cls === undefined) return;
  cls.toggle('rm', reducedMotion);
};

// ---- Factory --------------------------------------------------------------

/**
 * Build a `Session` around the boot inputs. Wires the router, the
 * reduced-motion signal (seeded + persisted + DOM-mirrored), the toast queue,
 * and returns both the `AppServices` for `<AppContext.Provider>` and a
 * `dispose()` hook.
 *
 * NEVER throws. A `repo.savePrefs` failure inside a subscription is swallowed
 * per its own TOTAL contract; this factory is boot-critical and cannot fail.
 */
export const createSession = (inputs: SessionInputs): Session => {
  const router = createRouter({
    ...(inputs.initialHash !== undefined ? { initialHash: inputs.initialHash } : {}),
    ...(inputs.routerOptions?.applyHash !== undefined
      ? { applyHash: inputs.routerOptions.applyHash }
      : {}),
    ...(inputs.routerOptions?.attachHashChange !== undefined
      ? { attachHashChange: inputs.routerOptions.attachHashChange }
      : {}),
  });

  const reducedMotion = signal(inputs.initialReducedMotion);
  applyReducedMotionClass(inputs.initialReducedMotion);

  // Persist + mirror on every change. `.subscribe()` calls the handler once
  // synchronously with the current value — we skip that redundant persist by
  // tracking the last-persisted value.
  let lastPersisted = inputs.initialReducedMotion;
  const unsubReducedMotion = reducedMotion.subscribe((rm) => {
    applyReducedMotionClass(rm);
    if (rm === lastPersisted) return;
    lastPersisted = rm;
    const currentPrefs = inputs.repo.loadPrefs();
    inputs.repo.savePrefs({ ...currentPrefs, reducedMotion: rm });
  });

  // ---- Toast queue -------------------------------------------------------
  const toasts = signal<readonly ToastItem[]>([]);
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  let toastCounter = 0;

  const dismiss = (id: string): void => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  };

  const enqueueToast = (msg: string, kind: ToastKind = 'default'): void => {
    toastCounter += 1;
    const id = `t${String(toastCounter)}`;
    toasts.value = [...toasts.value, { id, msg, kind }];
    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      dismiss(id);
    }, TOAST_DURATION_MS);
    pendingTimers.add(timer);
  };

  const services: AppServices = {
    catalog: inputs.catalog,
    repo: inputs.repo,
    durable: inputs.durable,
    route: router.route,
    reducedMotion,
    toasts,
    navigate: (to: Route) => {
      router.navigate(to);
    },
    toast: enqueueToast,
  };

  const dispose = (): void => {
    unsubReducedMotion();
    router.dispose();
    for (const timer of pendingTimers) clearTimeout(timer);
    pendingTimers.clear();
  };

  return { services, router, dispose };
};
