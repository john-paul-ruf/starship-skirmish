// M14 UI — Tactical Movement viewport (S05 CP2/CP3; SESSION-03 CP2 adds
// click-to-focus + `F`-key + camera HUD + `R`-key reset).
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
//     honoring reduced-motion by skipping to the final frame,
//   • picks a ship on canvas click (S01 `pick(x,y)`) and reports the bodyId
//     up so the screen can move selection to any fleet (FR-15),
//   • wires the render layer's `focusBody(id)` + `setFocusSource(positionOf)`
//     so the `F` key + Focus HUD button track the selection without a `three`
//     import (S01 loosened `focusSourceFor` to a `Vec3`-like — arch §5).
//
// The imperative handle (`viewHandleRef`) lets the parent screen invoke
// `resetView()` / `focusSelected()` from the sibling CameraHud without piercing
// this component's WebGL abstraction. Every method is a no-op when the render
// import failed or the view has not mounted yet — the degraded (numeric-only)
// fallback stays fully functional (NFR-Accessibility).
//
// If the render import fails or WebGL is unavailable, the viewport DEGRADES to
// a text notice — numeric arc entry (the sibling ArcPlotter) stays fully
// functional (NFR-Accessibility).

import { useSignal } from '@preact/signals';
import { useEffect, useImperativeHandle, useRef } from 'preact/hooks';
import type { Ref } from 'preact';

import type { BodyId, MatchState, MovementBeatRecord, Vec3 } from '../../../sim/index.js';
import type { GhostLayer, TacticalView, TracePlayer, TrailLayer } from '../../../render/index.js';

type RenderModule = typeof import('../../../render/index.js');

/** The predicted arc to draw for the selected ship. `null` clears the ghost. */
export interface GhostArc {
  readonly positions: readonly Vec3[];
  readonly endsOutsideArena: boolean;
  readonly deltaVMag: number;
  readonly beatSeconds: number;
  readonly hullRadius: number;
  /** SESSION-03: passed through to S01's ghost draw for Off / 1s / 2s / 4s marks. */
  readonly markIntervalSec?: number;
}

/** Imperative handle the sibling CameraHud + parent screen drive. */
export interface ViewportHandle {
  /** Reset the orbit camera to the neutral fleet framing (mirrors `R`). */
  resetView(): void;
  /** Slide the orbit target onto the selected ship id (mirrors `F`). */
  focusSelected(): void;
  /** Drop every recorded trail point (called on a new plan turn). */
  clearTrail(): void;
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
  /** SESSION-03: `physicsConfig.dt` — passed through to the trail as the
   *  per-keyframe sim-time step (matches S01's `TracePlayer` contract). */
  readonly beatSeconds: number;
  /** SESSION-03: sim-time (seconds) this beat starts at — the trail's per-push
   *  timestamp is `startSimTime + keyframeIdx · beatSeconds` (S01 wiring). */
  readonly beatStartSimTime: number;
  /** SESSION-03: currently-selected ship id (any fleet), for `F`-focus + focus HUD. */
  readonly selectedId: BodyId | null;
  /** SESSION-03: live position lookup — the `focusSourceFor` payload, `Vec3`-like. */
  readonly positionOf: (id: BodyId) => Vec3 | null;
  /** SESSION-03: canvas click → picked body id. Absent → click is a no-op. */
  readonly onPick?: (id: BodyId) => void;
  /** SESSION-03: parent-driven imperative handle for the camera HUD buttons. */
  readonly handleRef?: Ref<ViewportHandle | null>;
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
  beatSeconds,
  beatStartSimTime,
  selectedId,
  positionOf,
  onPick,
  handleRef,
  onResolveDone,
}: ViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<TacticalView | null>(null);
  const ghostRef = useRef<GhostLayer | null>(null);
  const trailRef = useRef<TrailLayer | null>(null);
  const fromPreviewRef = useRef<RenderModule['fromPreviewPath'] | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const playbackRef = useRef<ReturnType<TracePlayer['playMovement']> | null>(null);

  // Latest inputs, read by the async loader once the view is live. `selectedId`
  // + `positionOf` live here so the render layer's focus source and the click
  // handler always read fresh values without re-wiring on every prop change.
  const latest = useRef({ state, ghostArc, selectedId, positionOf, onPick });
  latest.current = { state, ghostArc, selectedId, positionOf, onPick };

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
        {
          beatSeconds: arc.beatSeconds,
          hullRadius: arc.hullRadius,
          ...(arc.markIntervalSec !== undefined ? { markIntervalSec: arc.markIntervalSec } : {}),
        },
      ),
    );
  };

  // ---- Imperative handle for the sibling camera HUD ------------------------
  useImperativeHandle(
    handleRef ?? { current: null },
    () => ({
      resetView: () => {
        viewRef.current?.camera.resetToFleetView();
      },
      focusSelected: () => {
        const id = latest.current.selectedId;
        if (id === null) return;
        viewRef.current?.focusBody(id);
      },
      clearTrail: () => {
        trailRef.current?.clear();
      },
    }),
    [],
  );

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
        const trail = mod.attachTrail(view);
        viewRef.current = view;
        ghostRef.current = ghost;
        trailRef.current = trail;
        fromPreviewRef.current = mod.fromPreviewPath;

        // Wire the `F`-key focus source so `positionOf(selectedId)` tracks the
        // roster selection (S01's internal auto-wire tracks only the last-picked
        // body). A plain closure over the ui's `selectedId` + `positionOf`
        // covers roster clicks too; the render layer's `Vec3`-like tuple shape
        // is the contract — no `three` value import needed here.
        view.camera.setFocusSource(() => {
          const id = latest.current.selectedId;
          if (id === null) return null;
          const p = latest.current.positionOf(id);
          return p === null ? null : [p.x, p.y, p.z];
        });

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
      trailRef.current?.dispose();
      trailRef.current = null;
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
        {
          beatSeconds: ghostArc.beatSeconds,
          hullRadius: ghostArc.hullRadius,
          ...(ghostArc.markIntervalSec !== undefined
            ? { markIntervalSec: ghostArc.markIntervalSec }
            : {}),
        },
      ),
    );
  }, [ghostKey]);

  // ---- Play the resolved movement beat (CP3) ------------------------------
  //
  // If the render layer is unavailable (degraded / WebGL absent) the beat cannot
  // animate — but the resolve MUST still complete, or the match stalls. So the
  // no-view path advances immediately (the state is already final; only the
  // interpolation is skipped). Reduced motion skips to the final frame the same
  // way.
  useEffect(() => {
    if (movementBeat === null) return;
    let cancelled = false;
    ghostRef.current?.clear();
    void (async () => {
      const view = viewRef.current;
      if (view !== null) {
        try {
          const mod = await import('../../../render/index.js');
          if (cancelled || viewRef.current === null) return;
          const player = mod.attachTracePlayer(view);
          const trail = trailRef.current;
          const playback = player.playMovement(movementBeat, {
            onDone: () => {
              if (!cancelled) onResolveDone();
            },
            ...(trail !== null
              ? { trail, beatSeconds, startSimTime: beatStartSimTime }
              : {}),
          });
          playbackRef.current = playback;
          if (reducedMotion) playback.skip();
          return;
        } catch {
          /* fall through to the degraded advance */
        }
      }
      if (!cancelled) onResolveDone();
    })();
    return () => {
      cancelled = true;
      playbackRef.current?.dispose();
      playbackRef.current = null;
    };
  }, [movementBeat]);

  // ---- Canvas click → pick → onPick(id) ------------------------------------
  //
  // The click is a plain DOM event on the `<canvas>` — the render layer's `pick`
  // does the GPU read. A hit reports the body id up to the screen (which moves
  // selection + focuses via the camera source). A miss is a no-op — the roster
  // remains the authoritative selection UI (FR-15) and this is a convenience.
  const onCanvasClick = (event: Event): void => {
    const view = viewRef.current;
    const pick = latest.current.onPick;
    if (view === null || pick === undefined) return;
    const mouse = event as MouseEvent;
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const rect = canvas.getBoundingClientRect();
    const x = mouse.clientX - rect.left;
    const y = mouse.clientY - rect.top;
    const hit = view.pick(x, y);
    if (hit !== null) pick(hit.bodyId);
  };

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
      <canvas class="tm-canvas" ref={canvasRef} onClick={onCanvasClick} />
      {movementBeat !== null ? (
        <button
          type="button"
          class="btn btn-sm tm-skip"
          data-testid="resolve-skip"
          onClick={() => playbackRef.current?.skip()}
        >
          SKIP ▸▸
        </button>
      ) : null}
    </div>
  );
}
