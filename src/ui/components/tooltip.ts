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
