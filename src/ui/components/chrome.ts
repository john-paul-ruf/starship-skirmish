// M14 UI — app chrome (S02 checkpoint 3).
//
//   - `Topbar`         — the brand + nav + reduced-motion toggle. FULLY prop-
//                        driven: no state, no signals, no `src/app/**` reach.
//                        S03 wires it from the app session (D-IOC-SEAM).
//   - `DesktopGate`    — the `< 1024px` fallback (design §1.7 / NFR-Platform).
//                        Also prop-driven; S03 supplies `viewportOk` from a
//                        matchMedia signal so the check is testable in isolation.
//   - `ErrorFallback`  — a `.panel` presentational fallback for S03's error
//                        boundary. Renders the error message as a text node
//                        (never `innerHTML`, per the repo-wide XSS ban).
//
// See `primitives.ts` for the shape-note on why these components use `h()`
// rather than JSX syntax.

import { h } from 'preact';
import type { ComponentChildren } from 'preact';

import { cx } from './internal.js';

// ---- Topbar ---------------------------------------------------------------

export interface TopbarRoute {
  readonly id: string;
  readonly label: string;
}

export interface TopbarProps {
  /** Nav items, in display order. Match `.nav a` styling in S01. */
  readonly routes: readonly TopbarRoute[];
  /** The currently active route id — marks the matching item `.is-active`. */
  readonly activeRoute: string;
  /**
   * Called when the player clicks a nav item. Receives the route id.
   * Anchor default is prevented; hash routing is S03's concern.
   */
  readonly onNavigate: (routeId: string) => void;
  /** Whether reduced-motion mode is currently active (drives label + aria). */
  readonly reducedMotion: boolean;
  /** Toggles reduced-motion mode. S03 mirrors this into a signal + `body.rm`. */
  readonly onToggleReducedMotion: () => void;
  /** Brand text. Defaults to the game name; kept overridable for prototypes. */
  readonly brandName?: string;
  /** Right-side content (storage meter, catalog chip, etc.). */
  readonly right?: ComponentChildren;
  readonly class?: string;
}

/**
 * `<header class="topbar">` matching `mocks/console.css` §16. Nav items are
 * `<a>` (not `<button>`) because `.nav a` is the styled selector; `href` is
 * synthesized as `#/{routeId}` for graceful degradation, but click delegation
 * runs `onNavigate` and preventDefault's the browser navigation so hash routing
 * stays under app control.
 */
export function Topbar(props: TopbarProps) {
  const {
    routes,
    activeRoute,
    onNavigate,
    reducedMotion,
    onToggleReducedMotion,
    brandName = 'STARSHIP SKIRMISH',
    right,
    class: extra,
  } = props;
  return h('header', { class: cx('topbar', extra) }, [
    h('div', { class: 'brand' }, [
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }),
      brandName,
    ]),
    h(
      'nav',
      { class: 'nav', 'aria-label': 'Primary' },
      routes.map((r) => {
        const active = r.id === activeRoute;
        return h(
          'a',
          {
            key: r.id,
            href: `#/${r.id}`,
            class: cx(active && 'is-active'),
            'aria-current': active ? 'page' : undefined,
            onClick: (event: MouseEvent) => {
              event.preventDefault();
              onNavigate(r.id);
            },
          },
          r.label,
        );
      }),
    ),
    h('div', { class: 'grow' }),
    right,
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn-sm btn-ghost',
        'aria-pressed': reducedMotion,
        onClick: onToggleReducedMotion,
      },
      reducedMotion ? '◉ REDUCED MOTION ON' : '◐ REDUCED MOTION',
    ),
  ]);
}

// ---- DesktopGate ----------------------------------------------------------

export interface DesktopGateProps {
  /**
   * `true` when the viewport meets the desktop minimum — S03 wires this from a
   * matchMedia signal. `false` renders the `.mobile-gate` panel and the app
   * stays reachable-but-not-usable (design §1.7 · degradation, not breakage).
   */
  readonly viewportOk: boolean;
  /** Displayed in the gate copy. Default `1024` (NFR-Platform). */
  readonly minWidth?: number;
  readonly children?: ComponentChildren;
}

/**
 * Renders `children` when `viewportOk` holds, otherwise the DESKTOP REQUIRED
 * fallback panel. The check itself is not performed here — that would couple
 * the component to `window.matchMedia` and break testability. Callers observe
 * the media-query signal and pass the boolean.
 */
export function DesktopGate(props: DesktopGateProps) {
  const { viewportOk, minWidth = 1024, children } = props;
  if (viewportOk) return h('div', { class: 'desktop-only' }, children);
  return h('div', { class: 'mobile-gate' }, [
    h(
      'div',
      { class: 'panel ticks', style: 'max-width:520px' },
      [
        h('div', { class: 'panel-hd' }, h('span', { class: 't-h2 c-red' }, 'DESKTOP REQUIRED')),
        h(
          'div',
          { class: 'panel-bd stack' },
          [
            h(
              'p',
              { class: 't-prose', style: 'margin:0' },
              `Starship Skirmish needs a viewport of at least ${minWidth}×720.`,
            ),
            h(
              'p',
              { class: 'mono-xs', style: 'margin:0' },
              'THE SHIPYARD IS A SPREADSHEET WITH GUNS. IT DOES NOT FIT ON A PHONE.',
            ),
          ],
        ),
      ],
    ),
  ]);
}

// ---- ErrorFallback --------------------------------------------------------

export interface ErrorFallbackProps {
  /** The thrown value from the error boundary. `Error`, string, or unknown. */
  readonly error?: unknown;
  /** Optional retry hook. Renders a `.btn` when provided. */
  readonly onReset?: () => void;
  readonly class?: string;
}

/**
 * Presentational `.panel.ticks` shell. String messages are rendered as text
 * children — never `innerHTML` (repo-wide XSS ban, architecture §10). S03's
 * error boundary imports this to surface a caught error.
 */
export function ErrorFallback(props: ErrorFallbackProps) {
  const { error, onReset, class: extra } = props;
  const message =
    error instanceof Error
      ? error.message
      : error === undefined
        ? 'An unknown error occurred.'
        : String(error);
  const kids: ComponentChildren[] = [
    h('div', { class: 'panel-hd' }, [
      h('span', { class: 'dot c-red', 'aria-hidden': 'true' }),
      h('span', { class: 't-h2 c-red' }, 'SIGNAL LOST'),
    ]),
    h('div', { class: 'panel-bd stack' }, [
      h('p', { class: 't-prose' }, 'Something went wrong. The last action was not applied.'),
      h('p', { class: 'mono-xs c-dim' }, message),
    ]),
  ];
  if (onReset !== undefined) {
    kids.push(
      h(
        'div',
        { class: 'panel-ft' },
        h(
          'button',
          { type: 'button', class: 'btn btn-sm', onClick: onReset },
          '⟳ RETRY',
        ),
      ),
    );
  }
  return h(
    'div',
    { class: cx('panel ticks', extra), role: 'alert' },
    kids,
  );
}
