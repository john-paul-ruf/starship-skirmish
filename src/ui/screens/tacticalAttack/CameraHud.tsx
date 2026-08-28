// M14 UI — Tactical Attack camera HUD (skirmish-tactical-parity S04 CP1).
//
// The bottom-right camera overlay from `mocks/tactical-attack.html` (~L497–L508):
// RESET (⟲) snaps back to the fleet framing (`camera.resetToFleetView`); FOCUS
// (◎) slides onto the selected ship (`view.focusBody(id)`); the mono hint spells
// out `DRAG ORBIT · SHIFT PAN · F FLEET VIEW` — the interaction is discoverable
// without color, key labels carried on shipped `.kbd` chrome (never-color-alone).
//
// playtest-feedback-02 SESSION-03 CP2 adds a movement-keys hint line so the
// WASD / arrow / Q-E translation shipped in camera.ts is discoverable without a
// tutorial. Text-only, matches this screen's existing `.kbd` chip vocabulary,
// and does not extend the prop contract — the hosting Viewport.tsx (owned by
// neither session) needs no edit.
//
// A pure presentational island: it never touches the render layer itself. The
// hosting Viewport passes down `onReset` / `onFocus` closures that live over the
// dynamically-imported render — this HUD stays reachable in the degraded (no
// WebGL) path with the callbacks becoming no-ops.

export interface CameraHudProps {
  readonly onReset: () => void;
  readonly onFocus: () => void;
  /** Display label for the current focus target (ship name or `—`). */
  readonly focusLabel: string;
  /** Focus button is disabled when no ship is selected. */
  readonly focusDisabled: boolean;
}

export function CameraHud(props: CameraHudProps) {
  const { onReset, onFocus, focusLabel, focusDisabled } = props;
  return (
    <div
      class="hud"
      data-testid="camera-hud"
      style="position:absolute;right:12px;bottom:12px;padding:10px 12px;background:rgba(5,7,10,.82);border:1px solid var(--line);border-radius:var(--r);display:flex;flex-direction:column;gap:6px;min-width:180px"
    >
      <div class="t-label">CAMERA</div>
      <div class="mono-xs" style="display:flex;align-items:baseline;gap:6px">
        <span class="c-dim" style="letter-spacing:.14em">FOCUS</span>
        <span class="grow" />
        <span class="c-cyan" data-testid="camera-focus-label" style="letter-spacing:.06em">
          {focusLabel}
        </span>
      </div>
      <div style="display:flex;gap:4px">
        <button
          type="button"
          class="btn btn-sm grow"
          data-testid="cam-reset"
          onClick={onReset}
          title="Reset to fleet view"
          aria-label="Reset camera to fleet view"
        >
          ⟲ RESET
        </button>
        <button
          type="button"
          class="btn btn-sm grow"
          data-testid="cam-focus"
          onClick={onFocus}
          disabled={focusDisabled}
          aria-disabled={focusDisabled ? true : undefined}
          title={focusDisabled ? 'Select a ship to focus' : `Focus on ${focusLabel}`}
          aria-label={focusDisabled ? 'Focus (select a ship first)' : `Focus on ${focusLabel}`}
        >
          ◎ FOCUS
        </button>
      </div>
      <div class="mono-xs c-dim" style="letter-spacing:.06em">
        <span class="kbd">WASD</span> / <span class="kbd">⭤</span> MOVE · <span class="kbd">Q</span> <span class="kbd">E</span> ELEV
      </div>
      <div class="mono-xs c-dim" style="letter-spacing:.06em">
        DRAG ORBIT · <span class="kbd">SHIFT</span> PAN · <span class="kbd">F</span> FLEET VIEW
      </div>
    </div>
  );
}
