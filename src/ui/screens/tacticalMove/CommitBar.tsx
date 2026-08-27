// M14 UI — Tactical Movement commit bar (S05 CP3, §4.1 / §4.2 / §4.3).
//
// The full-width commit dock. Three review gates converge here:
//   • §4.3 fleet gate — the button reads `fleetGateStatus`: disabled while any
//     ship is UNPLANNED, labelled `COMMIT MOVEMENT · N/M PLANNED` so a disabled
//     button explains itself.
//   • §4.1 boundary exit — if any committed arc leaves the arena the button
//     turns `is-hostile` (red) and clicking opens an explicit SECOND
//     confirmation (an `alertdialog`) naming the doomed ship(s). Flying out is
//     NEVER blocked — it is a legal choice, just never an accident.
//   • §4.2 blind commit — the visible contract "OPPONENT PLANS ARE NOT
//     OBSERVABLE UNTIL RESOLUTION." plus the dim NO TIMER label (the absence of
//     a clock is a feature).
//
// A raw `<button class="btn btn-commit">` (not the shared `Button`): the commit
// styling is a distinct shipped class and the button carries a `data-testid`
// the shared component does not forward — mirrors the Tactical Attack commit bar.

import { useSignal } from '@preact/signals';

import { Modal } from '../../components/index.js';
import type { FleetGate } from './model.js';

export interface CommitBarProps {
  readonly gate: FleetGate;
  /** True when at least one committed arc ends outside the arena (§4.1). */
  readonly hostile: boolean;
  /** Names of the ships whose committed arc exits — for the confirm copy. */
  readonly doomedNames: readonly string[];
  /** Perform the commit (assemble + hand the plans to the controller). */
  readonly onCommit: () => void;
}

export function CommitBar({ gate, hostile, doomedNames, onCommit }: CommitBarProps) {
  const confirmOpen = useSignal(false);
  const canCommit = gate.canCommit;
  const isHostile = canCommit && hostile;

  const label = isHostile
    ? '✕ COMMIT MOVEMENT · BOUNDARY EXIT'
    : `COMMIT MOVEMENT · ${String(gate.plannedCount)}/${String(gate.total)} PLANNED`;

  const cls = `btn btn-commit${!canCommit ? ' is-disabled' : isHostile ? ' is-hostile' : ''}`;

  const onClick = (): void => {
    if (!canCommit) return;
    if (isHostile) {
      confirmOpen.value = true;
      return;
    }
    onCommit();
  };

  const doomed = doomedNames.join(', ');

  return (
    <div class="tm-commit-dock panel-ft" data-testid="commit-dock">
      {isHostile ? (
        <div class="banner banner-danger" role="alert" data-testid="commit-hostile-banner">
          <span class="c-red">⚠</span>
          <span>
            <strong class="c-red">{doomed}</strong> will leave the arena and be destroyed. Legal —
            not blocked — but commit requires a second confirmation.
          </span>
        </div>
      ) : null}

      <button
        type="button"
        class={cls}
        disabled={!canCommit}
        aria-disabled={!canCommit}
        data-testid="commit-btn"
        onClick={onClick}
      >
        {label}
      </button>

      <div class="tm-blind-contract mono-xs">
        <span class="tm-no-timer" data-testid="no-timer">
          <span class="tm-no-timer-dot" aria-hidden="true" />
          NO TIMER
        </span>
        <span class="tm-blind-line" data-testid="blind-commit">
          OPPONENT PLANS ARE NOT OBSERVABLE UNTIL RESOLUTION.
        </span>
      </div>

      {confirmOpen.value ? (
        <Modal
          title="Confirm Boundary Exit"
          role="alertdialog"
          aria-describedby="tm-exit-desc"
          onClose={() => {
            confirmOpen.value = false;
          }}
          footer={
            <>
              <button
                type="button"
                class="btn"
                onClick={() => {
                  confirmOpen.value = false;
                }}
              >
                Cancel — Re-plot
              </button>
              <button
                type="button"
                class="btn btn-danger"
                data-testid="exit-confirm-accept"
                onClick={() => {
                  confirmOpen.value = false;
                  onCommit();
                }}
              >
                ✕ Confirm Exit &amp; Commit
              </button>
            </>
          }
        >
          <p class="t-prose" id="tm-exit-desc">
            <strong class="c-hi">{doomed}</strong> crosses the arena boundary and is{' '}
            <strong class="c-red">destroyed immediately</strong> — no grace period, no warning turn,
            no wrap, no bounce.
          </p>
          <p class="t-prose" style="font-size:11px;color:var(--ink-dim);margin-top:8px">
            This is <span class="c-hi">not blocked</span>. Deliberately leaving the arena is a legal
            move — sometimes the better of two bad outcomes.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
