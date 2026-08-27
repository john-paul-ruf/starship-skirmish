// M14 UI — Skirmish Setup · launch bar (S04 CP3).
//
// The §4.4 corollary gate: LAUNCH is enabled iff `canLaunch` — ≥1 player ship,
// every player build legal, NOT over budget (under-budget CAN launch — leftover
// points are wasted), and 1–4 opponents. A DISABLED LAUNCH explains itself
// (design §4.3 — a disabled button that stays silent is a bug): the reason from
// the model is appended, e.g. `LAUNCH · OVER BUDGET (+12)`.

export interface LaunchBarProps {
  readonly enabled: boolean;
  /** The reason LAUNCH is blocked, or `null` when it is enabled. */
  readonly reason: string | null;
  readonly onLaunch: () => void;
}

export function LaunchBar({ enabled, reason, onLaunch }: LaunchBarProps) {
  const label = enabled ? 'LAUNCH SKIRMISH' : `LAUNCH · ${reason ?? 'NOT READY'}`;
  // Raw <button> (not the Button primitive) so the `launch-btn` testid + the
  // native `disabled` attribute reach the DOM — the e2e asserts both, and the
  // primitive drops unknown props. Same pattern as the shell's `concede-btn`.
  return (
    <section class="skm-launch" style="flex:none">
      <button
        type="button"
        class="btn btn-primary btn-commit skm-launch-btn"
        disabled={!enabled || undefined}
        onClick={onLaunch}
        data-testid="launch-btn"
        aria-label={label}
      >
        {label}
      </button>
      <div class="mono-xs" style="margin-top:var(--s2);line-height:1.7">
        ONE SKIRMISH = ONE POINT-BUY, ONE FLEET. NO REINFORCEMENTS, NO CARRYOVER. LAST FLEET
        STANDING WINS.
      </div>
    </section>
  );
}
