// M14 UI — overlays & notices (S02 checkpoint 3).
//
//   - `Modal`  — the ONLY blocking affordance the app uses (design §4.8 delete
//                confirm; §4.9 collision confirm). Scrim + focus-trap + Esc.
//   - `Toast`  — transient confirmation (design §2 · .toast, §4.11 share link).
//   - `Banner` — persistent inline notice (design §2 · .banner; backup nudge,
//                needs-refit receipt, storage-degraded warning).
//
// See `primitives.ts` for the shape-note on why these components use `h()`
// rather than JSX syntax. Modal ships with focus mgmt via a callback ref that
// runs only when Preact commits (no-op in the node unit-test env), plus an
// onKeyDown that's inspectable on the returned vnode — so the "Esc closes"
// contract can be exercised without a DOM.

import { h } from 'preact';
import type { ComponentChildren } from 'preact';

import { cx } from './internal.js';

// ---- Modal ----------------------------------------------------------------

export type ModalRole = 'dialog' | 'alertdialog';

export interface ModalProps {
  /** Rendered inside the `.panel-hd` as a `.t-h2`. */
  readonly title: string;
  /** Called on scrim click and on Esc keydown. */
  readonly onClose: () => void;
  readonly children?: ComponentChildren;
  /** Rendered inside the `.panel-ft`; omit for a headless modal. */
  readonly footer?: ComponentChildren;
  /** `dialog` (default) or `alertdialog` for destructive confirms. */
  readonly role?: ModalRole;
  readonly 'aria-describedby'?: string;
  readonly class?: string;
}

/**
 * The delete-confirm modal is the whole design justification for this
 * component (design §4.8): "Delete is the only destructive action in the app
 * and it is the only action behind a modal confirmation." Focus is trapped
 * inside the modal via a callback ref; the ref is a no-op when preact hasn't
 * committed (i.e. in vitest's node env), so component-level tests can still
 * inspect the returned vnode without a DOM.
 */
export function Modal(props: ModalProps) {
  const {
    title,
    onClose,
    children,
    footer,
    role = 'dialog',
    class: extra,
  } = props;
  const titleId = 'modal-title';

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === 'Tab') {
      const modal = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
      if (modal === null) return;
      const focusables = modal.querySelectorAll<HTMLElement>(
        [
          'a[href]',
          'button:not([disabled])',
          'input:not([disabled])',
          'select:not([disabled])',
          'textarea:not([disabled])',
          '[tabindex]:not([tabindex="-1"])',
        ].join(', '),
      );
      if (focusables.length === 0) {
        event.preventDefault();
        modal.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  // Callback ref: capture the opener on mount, restore focus on unmount. Runs
  // only when Preact commits — in node unit tests this reference is never
  // invoked, so no DOM globals are touched during vnode inspection.
  let opener: HTMLElement | null = null;
  const modalRef = (el: HTMLDivElement | null) => {
    if (el !== null) {
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      opener = active instanceof HTMLElement ? active : null;
      el.focus();
    } else if (opener !== null) {
      opener.focus();
    }
  };

  return h('div', { class: 'ss-modal-root' }, [
    h('div', {
      class: 'scrim',
      onClick: onClose,
      'aria-hidden': 'true',
    }),
    h(
      'div',
      {
        class: cx('modal', extra),
        role,
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        'aria-describedby': props['aria-describedby'],
        tabIndex: -1,
        ref: modalRef,
        onKeyDown,
      },
      [
        h('div', { class: 'panel-hd' }, h('span', { class: 't-h2', id: titleId }, title)),
        h('div', { class: 'panel-bd' }, children),
        footer !== undefined ? h('div', { class: 'panel-ft' }, footer) : null,
      ],
    ),
  ]);
}

// ---- Toast ----------------------------------------------------------------

export type ToastTone = 'info' | 'warn' | 'danger';

const TOAST_TONE_CLASS: Record<ToastTone, string | false> = {
  info: false, // base .toast is cyan-left already
  warn: 'toast-warn',
  danger: 'toast-danger',
};

export interface ToastProps {
  readonly tone?: ToastTone;
  /**
   * Live-region politeness. Confirmations use `status`/`polite` (share-copy
   * toast, design §4.11); errors use `alert`/`assertive`. Default is `status`.
   */
  readonly role?: 'status' | 'alert';
  readonly class?: string;
  readonly children?: ComponentChildren;
}

export function Toast(props: ToastProps) {
  const { tone = 'info', role = 'status', class: extra, children } = props;
  return h(
    'div',
    {
      class: cx('toast', TOAST_TONE_CLASS[tone], extra),
      role,
      'aria-live': role === 'alert' ? 'assertive' : 'polite',
    },
    children,
  );
}

// ---- Banner ---------------------------------------------------------------

export type BannerTone = 'info' | 'warn' | 'danger';

const BANNER_TONE_CLASS: Record<BannerTone, string | false> = {
  info: 'banner-info',
  warn: false, // base .banner is the warn (amber) style
  danger: 'banner-danger',
};

export interface BannerProps {
  /** Default is `warn` — the base `.banner` styling in `mocks/console.css`. */
  readonly tone?: BannerTone;
  readonly role?: 'status' | 'alert';
  readonly class?: string;
  readonly children?: ComponentChildren;
}

export function Banner(props: BannerProps) {
  const { tone = 'warn', role = 'status', class: extra, children } = props;
  return h(
    'div',
    {
      class: cx('banner', BANNER_TONE_CLASS[tone], extra),
      role,
      'aria-live': role === 'alert' ? 'assertive' : 'polite',
    },
    children,
  );
}
