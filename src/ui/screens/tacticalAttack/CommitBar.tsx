// M14 UI — Tactical Attack commit bar (S06 CP3, §4.2 / §4.3).
//
// `COMMIT FIRE · N/M ASSIGNED` plus the blind-commit + NO-TIMER chrome. An
// unassigned slot is a legal choice (hold fire) — the gate SHOWS the count but
// never forces full assignment, and the friendly-fire banner never disables
// this button (§4.6). COMMIT resolves the attack beat via the controller seam.
//
// A raw `<button class="btn btn-commit">` (not the shared `Button`): the commit
// styling is a distinct shipped class and the button carries a `data-testid`
// the shared component does not forward.
//
// SESSION-03 (tactical-attack-mock-parity): this is explicitly the RIGHT fire
// rail's pinned footer — the root `.panel-ft` carries `data-testid=
// "ta-fire-footer"`, and the scoped `.ta-col-fire > .panel-ft { flex: none }`
// keeps it a non-stretching footer of the 344px rail, never a page-wide bottom
// bar (D-TA-NO-BOTTOM-PLAN). Semantics + all-hold legality are unchanged.

export interface CommitBarProps {
  readonly gate: import('./model.js').FireGate;
  readonly onCommit: () => void;
}

export function CommitBar(props: CommitBarProps) {
  const { gate, onCommit } = props;
  return (
    <div class="panel-ft" data-testid="ta-fire-footer">
      <button
        type="button"
        class="btn btn-commit grow"
        onClick={onCommit}
        data-testid="commit-fire-btn"
      >
        {`COMMIT FIRE · ${String(gate.assigned)}/${String(gate.total)} ASSIGNED`}
      </button>
      <div class="mono-xs c-dim" style="margin-top:8px;line-height:1.7">
        ALL FIRE RESOLVES SIMULTANEOUSLY AGAINST A PRE-DAMAGE SNAPSHOT. A SHIP YOU DESTROY STILL
        LANDS ITS SHOTS.
      </div>
      <div class="mono-xs c-dim" style="margin-top:6px">
        {`HOLDING FIRE ON EVERY SLOT IS A LEGAL PLAN — 0/${String(gate.total)} STILL COMMITS.`}
      </div>
      <div
        class="mono-xs c-dim"
        style="margin-top:6px;border-top:1px solid var(--line);padding-top:6px"
      >
        OPPONENT FIRE ASSIGNMENTS ARE NOT OBSERVABLE UNTIL RESOLUTION · NO TIMER.
      </div>
    </div>
  );
}
