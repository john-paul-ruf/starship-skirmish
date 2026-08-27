// M14 UI — Tactical Attack friendly-fire banner (S06 CP3, §4.6 / FR-20).
//
// An AoE assignment overlapping a friendly WARNS but never blocks. Each warning
// names the missile (shooter · slot), its blast radius, and every friendly
// caught inside — the trade is the player's to make on purpose. The banner is
// `role="alert"` so a screen reader announces it the moment it appears; commit
// stays enabled regardless (the gate is elsewhere and this never touches it).

import type { AoeOverlap } from './model.js';

/** One overlapping missile assignment, labelled for display. */
export interface FriendlyFireWarning {
  /** e.g. `HARRIER-2 · M1` — shooter name + missile slot. */
  readonly missileLabel: string;
  readonly overlap: AoeOverlap;
}

export interface FriendlyFireBannerProps {
  readonly warnings: readonly FriendlyFireWarning[];
}

export function FriendlyFireBanner(props: FriendlyFireBannerProps) {
  const { warnings } = props;
  if (warnings.length === 0) return null;

  return (
    <div class="stack" data-testid="ff-banner" role="alert">
      {warnings.map((w) => {
        const names = w.overlap.hits.map((h) => h.friendly.name).join(', ');
        const r = Math.round(w.overlap.aoeRadius);
        return (
          <div
            key={w.missileLabel}
            class="banner banner-danger"
            style="align-items:flex-start"
          >
            <span class="c-red" style="font-size:15px;line-height:1">⚠</span>
            <div style="font-size:11px;line-height:1.65">
              <strong class="c-hi">
                {`${w.missileLabel} AoE (r${String(r)}) OVERLAPS ${names}.`}
              </strong>{' '}
              <span class="c-dim">Friendly fire is live. This will not be blocked.</span>
              <div class="mono-xs" style="margin-top:4px">
                {w.overlap.hits
                  .map((h) => `${h.friendly.name} AT ${String(Math.round(h.distance))}u INSIDE RADIUS ${String(r)}`)
                  .join(' · ')}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
