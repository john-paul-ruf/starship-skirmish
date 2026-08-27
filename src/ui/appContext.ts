// M14 UI — the ui-owned service contract every screen consumes (D-IOC-SEAM).
//
// ESLint (APP_IMPORT_PATTERN) forbids anything except `src/main.tsx` from
// importing `src/app/**`. Therefore `ui` never imports `app`. The contract
// (`Route`, `AppServices`, `AppContext`, `useApp`) lives HERE, in ui —
// `src/app/**` (bootstrap + session + boot) produces the `AppServices` value
// and provides it via `<AppContext.Provider>`. Screens `useApp()`, never reach
// into `src/app`.
//
// The IoC graph after S03:  main.tsx → app → ui → { components, domain,
// persist, io, catalog }. No `ui → app` edge exists, so the lint stays green
// by construction.

import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { ReadonlySignal, Signal } from '@preact/signals';

import type { Catalog } from '../catalog/index.js';
import type { LibraryRepo } from '../persist/index.js';

// ---- Route ----------------------------------------------------------------

/**
 * The three routes the shipyard-suite feature exposes. `share.token` is the
 * raw share-token string as it arrived in the URL hash — bootstrap does NOT
 * decode it (S06 owns the preview + `decodeShareToken`). Missing token means
 * the user landed on `#/share` with nothing to paste-preview yet.
 *
 * `Route` is a discriminated union on `name` — the outlet switch in `App.tsx`
 * (D-ROUTE-OUTLET) narrows on that field. A new screen = a new variant here
 * and a new case there; `src/app` never touches the outlet.
 */
export type Route =
  | { readonly name: 'encyclopedia' }
  | { readonly name: 'shipyard'; readonly buildId?: string }
  | { readonly name: 'share'; readonly token?: string };

// ---- Toast surface --------------------------------------------------------

/**
 * The three tones the `Toast` component supports (see `ui/components/overlays.ts`).
 * `default` is the informational tone; `warn` maps to the session-mode banner
 * severity; `danger` is reserved for the "save failed" / "quota exhausted"
 * class of surface.
 */
export type ToastKind = 'default' | 'warn' | 'danger';

/**
 * One entry in the toast queue. `id` is a monotonically-incrementing string
 * so preact's keyed diff picks up churn cleanly. The shell renders the
 * current entries via `toasts` (a ReadonlySignal on `AppServices`); screens
 * only ever call `toast(msg, kind)` — they never construct these directly.
 */
export interface ToastItem {
  readonly id: string;
  readonly msg: string;
  readonly kind: ToastKind;
}

// ---- Services -------------------------------------------------------------

/**
 * The full contract screens consume. Every field is either a stable reference
 * (catalog, repo, callbacks) or a `Signal` — screens subscribe by reading
 * `.value` inside a Preact render and get automatic re-renders.
 *
 * `durable` (§3.7, FR-7): `false` means the boot fell back to session mode —
 * the shell surfaces the reduced-durability banner. `catalog` and `repo` are
 * frozen after boot; screens should never attempt to swap them.
 *
 * `route` is a `ReadonlySignal` — mutation goes through `navigate()` so the
 * `hashchange` listener remains the single writer (back/forward navigation
 * cannot desync the signal).
 */
export interface AppServices {
  readonly catalog: Catalog;
  readonly repo: LibraryRepo;
  /** `false` ⇒ session-mode degrade banner (FR-7). */
  readonly durable: boolean;
  /** Current route — mutated only via `navigate()`. */
  readonly route: ReadonlySignal<Route>;
  /** Reduced-motion preference — toggled via the topbar; persisted to prefs. */
  readonly reducedMotion: Signal<boolean>;
  /** Current toast queue — the shell renders it; screens never read this. */
  readonly toasts: ReadonlySignal<readonly ToastItem[]>;
  /** Push a new route to `location.hash`. `hashchange` writes the signal. */
  navigate(to: Route): void;
  /** Enqueue a toast. Duration + host lifecycle belong to the shell. */
  toast(msg: string, kind?: ToastKind): void;
}

// ---- Context + hook -------------------------------------------------------

/**
 * The Preact context that carries `AppServices` down to every screen. The
 * default value is `null` so a screen mounted outside `<AppContext.Provider>`
 * throws in `useApp()` rather than reading a phantom services object.
 */
export const AppContext = createContext<AppServices | null>(null);

/**
 * The one hook every screen reaches for. Throws if the caller mounted outside
 * `<AppContext.Provider>` — that would mean `boot()` skipped its provider
 * wrapper, which is a boot-level bug the shell should surface as an
 * ErrorBoundary trip.
 */
export const useApp = (): AppServices => {
  const services = useContext(AppContext);
  if (services === null) {
    throw new Error(
      'useApp() called outside <AppContext.Provider>. src/app/boot must wrap App in the provider.',
    );
  }
  return services;
};
