// M14 UI — Tactical Movement viewport (S05 CP2/CP3).
//
// Hosts the three.js tactical view, reached ONLY through a dynamic import
// (D-RENDER-DYNAMIC / arch §11 — three stays in its own chunk). It:
//   • diffs the live `MatchState` into the scene (`setState`, render mutates
//     nothing — FR-33),
//   • draws the selected ship's live ghost arc (§4.1 three-channel exit via
//     the render layer's red line + ✕ EXIT sprite; the text callout is the
//     ArcPlotter's third channel), sourced from `controller.previewArc` so the
//     ghost cannot lie (D-PREVIEW-SEAM — no `sim/physics` value import here),
//   • plays the resolved movement beat during `movement-resolve` (CP3),
//     honoring reduced-motion by skipping to the final frame.
//
// If the render import fails or WebGL is unavailable, the viewport DEGRADES to
// a text notice — numeric arc entry (the sibling ArcPlotter) stays fully
// functional (NFR-Accessibility).

import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';

import type { MatchState, MovementBeatRecord, Vec3 } from '../../../sim/index.js';
import type { GhostLayer, TacticalView, TracePlayer } from '../../../render/index.js';

type RenderModule = typeof import('../../../render/index.js');

/** The predicted arc to draw for the selected ship. `null` clears the ghost. */
export interface GhostArc {
  readonly positions: readonly Vec3[];
  readonly endsOutsideArena: boolean;
  readonly deltaVMag: number;
  readonly beatSeconds: number;
  readonly hullRadius: number;
}

export interface ViewportProps {
  readonly state: MatchState;
  readonly arenaRadius: number;
  /** The selected ship's ghost arc (plan phase), or `null` to clear it. */
  readonly ghostArc: GhostArc | null;
  /** A stable signature of `ghostArc` so the redraw effect fires only on change. */
  readonly ghostKey: string;
  /** Set entering `movement-resolve` — the beat to animate (CP3). */
  readonly movementBeat: MovementBeatRecord | null;
  /** Skip the animation to its final frame (reduced motion). */
  readonly reducedMotion: boolean;
  /** Called when the resolve animation finishes (or is skipped). */
  readonly onResolveDone: () => void;
}


export function Viewport({
  state,
  arenaRadius,
  ghostArc,
  ghostKey,
  movementBeat,
  reducedMotion,
  onResolveDone,
}: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<TacticalView | null>(null);
  const ghostRef = useRef<GhostLayer | null>(null);
  const fromPreviewRef = useRef<RenderModule['fromPreviewPath'] | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const playbackRef = useRef<ReturnType<TracePlayer['playMovement']> | null>(null);

  // Latest inputs, read by the async loader once the view is live.
  const latest = useRef({ state, ghostArc });
  latest.current = { state, ghostArc };

  const failed = useSignal(false);

  const drawGhost = (mod: RenderModule, ghost: GhostLayer, arc: GhostArc | null): void => {
    if (arc === null) {
      ghost.clear();
      return;
    }
    ghost.draw(
      mod.fromPreviewPath(
        { positions: arc.positions, endsOutsideArena: arc.endsOutsideArena },
        arc.deltaVMag,
        { beatSeconds: arc.beatSeconds, hullRadius: arc.hullRadius },
      ),
    );
  };

  // ---- Mount: dynamic-import render, build the view, degrade on failure ----
  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (canvas === null) return;

    void (async () => {
      try {
        const mod = await import('../../../render/index.js');
        if (cancelled) return;
        const view = mod.createTacticalView(canvas, arenaRadius);
        const ghost = mod.attachGhost(view);
        viewRef.current = view;
        ghostRef.current = ghost;
        fromPreviewRef.current = mod.fromPreviewPath;

        const parent = canvas.parentElement;
        if (parent !== null && typeof ResizeObserver !== 'undefined') {
          const ro = new ResizeObserver(() => {
            const w = parent.clientWidth;
            const h = parent.clientHeight;
            if (w > 0 && h > 0) view.resize(w, h);
          });
          ro.observe(parent);
          roRef.current = ro;
          if (parent.clientWidth > 0 && parent.clientHeight > 0) {
            view.resize(parent.clientWidth, parent.clientHeight);
          }
        }

        view.setState(latest.current.state);
        drawGhost(mod, ghost, latest.current.ghostArc);
      } catch {
        if (!cancelled) failed.value = true;
      }
    })();

    return () => {
      cancelled = true;
      roRef.current?.disconnect();
      roRef.current = null;
      playbackRef.current?.dispose();
      playbackRef.current = null;
      ghostRef.current?.dispose();
      ghostRef.current = null;
      viewRef.current?.dispose();
      viewRef.current = null;
    };
    // Mount once; `arenaRadius` is fixed for the life of a match.
  }, []);

  // ---- Diff live state into the scene (render mutates nothing) -------------
  useEffect(() => {
    viewRef.current?.setState(state);
  }, [state]);

  // ---- Redraw the ghost when the plotted arc changes ----------------------
  useEffect(() => {
    const view = viewRef.current;
    const ghost = ghostRef.current;
    const from = fromPreviewRef.current;
    if (view === null || ghost === null || from === null) return;
    if (ghostArc === null) {
      ghost.clear();
      return;
    }
    ghost.draw(
      from(
        { positions: ghostArc.positions, endsOutsideArena: ghostArc.endsOutsideArena },
        ghostArc.deltaVMag,
        { beatSeconds: ghostArc.beatSeconds, hullRadius: ghostArc.hullRadius },
      ),
    );
  }, [ghostKey]);

  // ---- Play the resolved movement beat (CP3) ------------------------------
  useEffect(() => {
    const view = viewRef.current;
    if (view === null || movementBeat === null) return;
    // Clear any plotting ghost before the beat animates.
    ghostRef.current?.clear();
    void (async () => {
      const mod = await import('../../../render/index.js');
      if (viewRef.current === null) return;
      const player = mod.attachTracePlayer(view);
      const playback = player.playMovement(movementBeat, { onDone: onResolveDone });
      playbackRef.current = playback;
      if (reducedMotion) playback.skip();
    })();
    return () => {
      playbackRef.current?.dispose();
      playbackRef.current = null;
    };
  }, [movementBeat]);

  if (failed.value) {
    return (
      <div class="tm-viewport tm-viewport-degraded" data-testid="viewport-degraded">
        <div class="t-label c-amber">3D VIEW UNAVAILABLE</div>
        <p class="t-prose">
          The tactical render could not start. Numeric arc entry stays fully functional — plot,
          coast, and commit from the panel on the right.
        </p>
      </div>
    );
  }

  return (
    <div class="tm-viewport" data-testid="viewport">
      <canvas class="tm-canvas" ref={canvasRef} />
    </div>
  );
}
