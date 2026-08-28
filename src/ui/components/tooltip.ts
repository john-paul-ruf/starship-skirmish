// M14 UI — InfoTip primitive (playtest-feedback-01 · S06).
//
// The "what does this mean?" affordance for label-only readouts (the DERIVED
// stats panel first; the plan is to extend to other screens in later leases).
//
// STATELESS BY CONSTRUCTION — this file MUST NOT import from `preact/hooks`.
// The component library forbids hooks (primitives.ts SHAPE NOTE) so the whole
// surface can be exercised in the node unit-test env by direct function
// invocation. The reveal is therefore CSS-driven: `.tip:hover .tip-pop` +
// `.tip:focus-within .tip-pop` in components.css both switch visibility on.
// Never-color-alone + a11y hygiene (design §1.1, NFR-Accessibility):
//   - the trigger is a real focusable `<button type="button">` — keyboard
//     reveal comes for free via `:focus-within`
//   - `aria-describedby` links the trigger to the popup, which carries
//     `role="tooltip"`, so AT users hear the definition when the trigger
//     receives focus
//   - `aria-label` on the trigger names what the icon is (an icon-only
//     button without a label is a WCAG failure)
// Neighbour caveat: the caller passes a unique `id` per InfoTip on the page —
// duplicate `aria-describedby` targets would collapse the AT association.
//
// ── Escape from scroll clipping (playtest-feedback-04 · S03) ────────────
// The previous shape put `.tip-pop` at `position: absolute` inside `.tip`,
// so the Shipyard's `.col-scroll { overflow-y:auto; overflow-x:hidden }`
// (and any other scroll or overflow ancestor a future consumer sits inside)
// clipped the popup at the column edge. On short rows near the top of a
// scrolled list, the whole tip disappeared. That is a shared-primitive
// defect: every current and future InfoTip consumer inherits it.
//
// D-INFOTIP-TOPLAYER: the fix lives entirely in `components.css` §19. The
// vnode SHAPE IS UNCHANGED — this file's markup carries no `popover`,
// `popovertarget`, or `anchor-name` attribute. `.tip-pop` moves to
// `position: fixed`, escaping every scroll/overflow clip (its containing
// block becomes the initial containing block / viewport, not the nearest
// scroll ancestor). CSS Anchor Positioning (`anchor-name` on `.tip-dot`,
// `position-anchor` on `.tip-pop`, `anchor-scope: --tip-anchor` on `.tip`
// so per-instance uniqueness costs no per-call prop) pins the popup 6px
// above the trigger, left-aligned to the ⓘ.
//
// Why not the Popover API. `popover="hint"` opens in the top layer (which
// would also fix the clip) but has no declarative CSS-only hover trigger:
// it must be invoked via `popovertarget` click or a JS `showPopover()`
// call, neither of which is available under the stateless-primitive
// contract. `interesttarget` (the proposed declarative hover invoker) has
// not shipped in the evergreen browsers we target. Keeping the fix in CSS
// preserves the `:hover` / `:focus-within` reveal exactly as it was.
//
// Why not just widen the ancestor's overflow. The Shipyard columns MUST
// clip to scroll (they hold long benches and pickers); making `.col-scroll`
// non-clipping breaks the whole screen layout. Not viable.
//
// Fallback for browsers without CSS Anchor Positioning (Firefox as of
// 2025-08 has the machinery behind a flag). `bottom: calc(anchor(...))`
// and `left: anchor(...)` resolve to invalid → all four offsets become
// `auto` → the fixed-layer static position places the popup where its
// natural inline flow would have put it (immediately after `.tip-dot`),
// but rendered in the fixed layer and therefore NOT clipped by any
// scroll ancestor. Legibility, never `display:none`.

import { h } from 'preact';
import type { ComponentChildren } from 'preact';

import { cx } from './internal.js';

export interface InfoTipProps {
  /**
   * Unique element id linking the trigger's `aria-describedby` to the popup.
   * Callers derive it from their row's stable testid (e.g. `tip-<testid>`);
   * duplicates on the same page break the AT association.
   */
  readonly id: string;
  /**
   * The definition text — rendered inside the popup verbatim, and also
   * prefixes the trigger's `aria-label` so screen readers announce the
   * concept before the button role.
   */
  readonly label: string;
  readonly class?: string;
  /**
   * Optional custom trigger content. Defaults to the info glyph (`ⓘ`) —
   * matching the mock's convention of a dim glyph that tints on hover/focus.
   */
  readonly children?: ComponentChildren;
}

/**
 * Stateless info-tooltip. See file header for the a11y contract.
 *
 * Markup shape (verbatim, so tests can inspect vnodes without a DOM):
 *
 *   <span class="tip">
 *     <button class="tip-dot" type="button"
 *             aria-describedby={id}
 *             aria-label={`What is this? ${label}`}>ⓘ</button>
 *     <span id={id} role="tooltip" class="tip-pop">{label}</span>
 *   </span>
 */
export function InfoTip(props: InfoTipProps) {
  const { id, label, class: extra, children } = props;
  return h('span', { class: cx('tip', extra) }, [
    h(
      'button',
      {
        type: 'button',
        class: 'tip-dot',
        'aria-describedby': id,
        'aria-label': `What is this? ${label}`,
      },
      children ?? 'ⓘ',
    ),
    h('span', { id, role: 'tooltip', class: 'tip-pop' }, label),
  ]);
}
