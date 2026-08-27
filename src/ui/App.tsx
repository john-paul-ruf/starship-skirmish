// M14 UI — the app shell (S03).
//
// Mounts under `src/app/boot.tsx` inside `<AppContext.Provider>`. Never
// imports from `src/app` — D-IOC-SEAM lint-enforced (APP_IMPORT_PATTERN). All
// state comes from `useApp()`.
//
// Responsibilities (design §1.7 / §4.11 / NFR-Accessibility):
//   1. `DesktopGate`: below the min-width fallback, no shell. Viewport
//      observation is a matchMedia signal wired via `useDesktopViewport`.
//   2. `Topbar`: brand + nav + reduced-motion toggle. Nav clicks call
//      `services.navigate`; RM toggles flip `services.reducedMotion`.
//   3. Body class mirror: `document.body.classList.toggle('rm', …)` on every
//      `reducedMotion` change (session.ts also mirrors so bootstrap seeds it
//      before the first commit — this hook keeps it in sync afterwards).
//   4. Routed outlet (D-ROUTE-OUTLET): switch on `route.value.name`; a new
//      screen = a new `Route` variant + a case here, never an app edit.
//   5. Session-mode banner when `durable === false` (FR-7).
//   6. Toast host reading `services.toasts`.

import { useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';

import { useApp } from './appContext.js';
import {
  Banner,
  DesktopGate,
  Toast,
  Topbar,
  type TopbarRoute,
  type ToastTone,
} from './components/index.js';
import { Encyclopedia, ShareImport, Shipyard } from './screens/index.js';

// ---- Constants ------------------------------------------------------------

const DESKTOP_MIN_WIDTH_PX = 1024;

const NAV_ROUTES: readonly TopbarRoute[] = [
  { id: 'encyclopedia', label: 'ENCYCLOPEDIA' },
  { id: 'shipyard', label: 'SHIPYARD' },
  { id: 'share', label: 'SHARE' },
];

const TOAST_TONE: Record<'default' | 'warn' | 'danger', ToastTone> = {
  default: 'info',
  warn: 'warn',
  danger: 'danger',
};

// ---- Viewport ----------------------------------------------------------

interface MediaQueryLike {
  readonly matches: boolean;
  addEventListener?: (
    type: 'change',
    listener: (event: MediaQueryLike) => void,
  ) => void;
  removeEventListener?: (
    type: 'change',
    listener: (event: MediaQueryLike) => void,
  ) => void;
}

/**
 * Observe the desktop viewport query, returning a signal that toggles with
 * matchMedia. Guarded on `window.matchMedia`; when unavailable we assume the
 * viewport is wide enough (SSR/tests) so the shell renders instead of the
 * gate — the DesktopGate component itself never reads `window`, per its
 * contract in `components/chrome.ts`.
 */
const useDesktopViewport = () => {
  const viewportOk = useSignal(true);
  useEffect(() => {
    const win = globalThis as { window?: { matchMedia?: (q: string) => MediaQueryLike } };
    const mm = win.window?.matchMedia?.(`(min-width: ${String(DESKTOP_MIN_WIDTH_PX)}px)`);
    if (mm === undefined) {
      viewportOk.value = true;
      return;
    }
    viewportOk.value = mm.matches;
    const onChange = (event: MediaQueryLike): void => {
      viewportOk.value = event.matches;
    };
    mm.addEventListener?.('change', onChange);
    return () => mm.removeEventListener?.('change', onChange);
  }, [viewportOk]);
  return viewportOk;
};

// ---- Body reduced-motion mirror ------------------------------------------

const useBodyReducedMotionMirror = (rmValue: boolean) => {
  useEffect(() => {
    const doc = (globalThis as { document?: { body?: { classList?: DOMTokenList } } }).document;
    doc?.body?.classList?.toggle('rm', rmValue);
  }, [rmValue]);
};

// ---- Outlet ---------------------------------------------------------------

/**
 * The D-ROUTE-OUTLET switch. A new screen = a new `Route` variant +
 * a new case here. `src/app` never imports individual screens.
 */
const Outlet = () => {
  const { route } = useApp();
  const current = route.value;
  switch (current.name) {
    case 'encyclopedia':
      return <Encyclopedia />;
    case 'shipyard':
      return <Shipyard />;
    case 'share':
      return <ShareImport />;
  }
};

// ---- Toast host -----------------------------------------------------------

const ToastHost = () => {
  const { toasts } = useApp();
  const items = toasts.value;
  if (items.length === 0) return null;
  return (
    <div class="toast-host" data-testid="toast-host">
      {items.map((t) => (
        <Toast
          key={t.id}
          tone={TOAST_TONE[t.kind]}
          role={t.kind === 'danger' ? 'alert' : 'status'}
        >
          {t.msg}
        </Toast>
      ))}
    </div>
  );
};

// ---- Shell ----------------------------------------------------------------

/**
 * The mounted app. Consumes services via `useApp()`; the provider wraps this
 * in `src/app/boot.tsx`.
 */
export function App() {
  const { route, reducedMotion, durable, navigate } = useApp();
  const viewportOk = useDesktopViewport();
  useBodyReducedMotionMirror(reducedMotion.value);

  const currentRoute = route.value;
  const activeRoute = currentRoute.name;
  const rm = reducedMotion.value;

  return (
    <DesktopGate viewportOk={viewportOk.value} minWidth={DESKTOP_MIN_WIDTH_PX}>
      <div class="app-shell" data-testid="app-shell">
        <Topbar
          routes={NAV_ROUTES}
          activeRoute={activeRoute}
          onNavigate={(id) => {
            if (id === 'encyclopedia') navigate({ name: 'encyclopedia' });
            else if (id === 'shipyard') navigate({ name: 'shipyard' });
            else if (id === 'share') navigate({ name: 'share' });
          }}
          reducedMotion={rm}
          onToggleReducedMotion={() => {
            reducedMotion.value = !reducedMotion.value;
          }}
        />
        {!durable ? (
          <Banner tone="warn" role="status" class="session-mode-banner">
            <span data-testid="session-mode-banner">
              STORAGE UNAVAILABLE — SAVES WILL NOT SURVIVE A RELOAD.
            </span>
          </Banner>
        ) : null}
        <main class="app-main" data-testid="app-main">
          <Outlet />
        </main>
        <ToastHost />
      </div>
    </DesktopGate>
  );
}
