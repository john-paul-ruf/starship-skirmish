// M14 UI — Tactical Movement camera HUD (SESSION-03 CP2, Gate 1 §7.1 port).
//
// The in-viewport camera control cluster the Gate 1 prototype shipped and this
// screen never wired: a "Reset view" button (R) restores the neutral fleet
// framing, a "Focus selection" button (F) slides the orbit target onto the
// selected ship. Both mirror the render layer's `R` / `F` shortcut keys — the
// buttons and the shortcuts run through the same seams (S01 `focusBody(id)` +
// `camera.resetToFleetView()`), so any change to focus behavior in one place
// carries to the other for free.
//
// The HUD is a real, focusable button cluster (never `role="button"` on a div,
// never a color-only cue): `<button>` elements carry `aria-keyshortcuts` naming
// the R / F bindings, and a text hint below spells out the drag / pan / focus
// mapping in the mock's `DRAG ORBIT · SHIFT PAN · F FOCUS` vocabulary. Reduced-
// motion is honored by the underlying camera (no motion here — the focus slide
// is a target reassignment, not an animation).
//
// The HUD is opinion-free about WHAT is selected — it receives `canFocus` and
// two callbacks (`onReset` / `onFocus`) so the screen decides both. When no
// ship is selected the Focus button disables cleanly with a matching label.

export interface CameraHudProps {
  /** True when a ship is selected — enables the Focus button. */
  readonly canFocus: boolean;
  /** Reset the camera to the neutral fleet framing (mirrors the `R` key). */
  readonly onReset: () => void;
  /** Slide the orbit target onto the selected ship (mirrors the `F` key). */
  readonly onFocus: () => void;
}

/** Absolute-positioned control cluster mounted inside the tactical viewport. */
export function CameraHud({ canFocus, onReset, onFocus }: CameraHudProps) {
  return (
    <div class="tm-cam-hud" data-testid="camera-hud" aria-label="Camera controls">
      <div class="tm-cam-hud-buttons">
        <button
          type="button"
          class="btn btn-sm"
          data-testid="cam-reset"
          aria-keyshortcuts="R"
          onClick={onReset}
        >
          ↺ RESET VIEW · R
        </button>
        <button
          type="button"
          class="btn btn-sm"
          data-testid="cam-focus"
          aria-keyshortcuts="F"
          disabled={!canFocus}
          aria-disabled={!canFocus}
          onClick={onFocus}
        >
          ◎ FOCUS SELECTION · F
        </button>
      </div>
      <div class="mono-xs c-dim tm-cam-hud-hint" data-testid="cam-hud-hint">
        DRAG ORBIT · SHIFT PAN · F FOCUS
      </div>
      <div class="mono-xs c-dim tm-cam-hud-hint">CAM PERSISTS ACROSS PLAN ↔ RESOLVE</div>
    </div>
  );
}
