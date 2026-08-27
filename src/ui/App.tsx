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
import { MatchProvider, useMatch } from './matchContext.js';
import {
  Banner,
  Button,
  DesktopGate,
  Modal,
  Toast,
  Topbar,
  type TopbarRoute,
  type ToastTone,
} from './components/index.js';
import {
  Encyclopedia,
  PostMatch,
  ShareImport,
  Shipyard,
  SkirmishSetup,
  TacticalAttack,
  TacticalMove,
} from './screens/index.js';

// ---- Constants ------------------------------------------------------------

const DESKTOP_MIN_WIDTH_PX = 1024;

const NAV_ROUTES: readonly TopbarRoute[] = [
  { id: 'encyclopedia', label: 'ENCYCLOPEDIA' },
  { id: 'shipyard', label: 'SHIPYARD' },
  { id: 'share', label: 'SHARE' },
  { id: 'skirmish', label: 'SKIRMISH' },
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
    case 'skirmish-setup':
      // Setup CREATES a match (via `startMatch`); it is not inside a match, so
      // it renders plainly — no MatchProvider, no match-chrome.
      return <SkirmishSetup />;
    case 'tactical-move':
    case 'tactical-attack':
    case 'post-match':
      // The three in-match routes share one `MatchRouteShell` instance, so the
      // MatchProvider + CONCEDE chrome survive phase transitions (move → attack
      // → result) without re-mounting (S01 CP5).
      return <MatchRouteShell />;
  }
};

// ---- Match route shell (provider + chrome + redirect) --------------------

/**
 * Mounts the active `MatchController` for the three in-match routes. With no
 * active match (deep-link, reload) it redirects to setup and renders a
 * fallback meanwhile — the active match lives on `AppServices.activeMatch`, not
 * the URL, so a cold match route has nothing to show.
 */
const MatchRouteShell = () => {
  const { activeMatch, navigate } = useApp();
  const controller = activeMatch.value;

  useEffect(() => {
    if (controller === null) navigate({ name: 'skirmish-setup' });
  }, [controller, navigate]);

  if (controller === null) {
    return (
      <section class="panel" data-testid="match-no-active">
        NO ACTIVE MATCH — RETURN TO SETUP
      </section>
    );
  }

  return (
    <MatchProvider controller={controller}>
      <MatchChrome />
      <MatchRouteScreen />
    </MatchProvider>
  );
};

/** The current in-match screen, switched by route (inside the provider). */
const MatchRouteScreen = () => {
  const { route } = useApp();
  switch (route.value.name) {
    case 'tactical-move':
      return <TacticalMove />;
    case 'tactical-attack':
      return <TacticalAttack />;
    case 'post-match':
      return <PostMatch />;
    default:
      return null;
  }
};

// ---- Match chrome (owns CONCEDE — Flow 6, Ruling D) ----------------------

/**
 * The persistent match-chrome header: turn counter, seed label, and the single
 * CONCEDE affordance (behind a confirm Modal). Present in every in-progress
 * phase; hidden once the match is `complete` (the post-match screen is
 * CONCEDE's destination, not its home). Bots never concede; there is no draw
 * (Custom Rule 5). Kept here — not per-screen — so it survives move↔attack
 * transitions without re-mounting.
 */
const MatchChrome = () => {
  const match = useMatch();
  const confirmOpen = useSignal(false);

  if (match.phase.value === 'complete') return null;

  return (
    <header
      class="match-chrome"
      data-testid="match-chrome"
      style="display:flex;align-items:center;gap:12px;padding:8px 14px;border-bottom:1px solid var(--line);background:var(--panel)"
    >
      <span class="mono-xs" data-testid="match-turn">
        TURN {match.turn.value}
      </span>
      <span class="mono-xs c-dim" data-testid="match-seed">
        {match.seedLabel}
      </span>
      <span class="grow" style="flex:1 1 auto" />
      <button
        type="button"
        class="btn btn-danger"
        data-testid="concede-btn"
        onClick={() => {
          confirmOpen.value = true;
        }}
      >
        CONCEDE
      </button>
      {confirmOpen.value ? (
        <Modal
          title="CONCEDE MATCH?"
          role="alertdialog"
          onClose={() => {
            confirmOpen.value = false;
          }}
          footer={
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  confirmOpen.value = false;
                }}
              >
                CANCEL
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  match.concede();
                  confirmOpen.value = false;
                }}
              >
                CONFIRM CONCEDE
              </Button>
            </>
          }
        >
          <p class="t-prose">
            Conceding is an immediate loss — there is no draw (Custom Rule 5).
          </p>
        </Modal>
      ) : null}
    </header>
  );
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
            else if (id === 'skirmish') navigate({ name: 'skirmish-setup' });
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
