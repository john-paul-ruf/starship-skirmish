// M14 UI — Tactical Attack viewport (skirmish-tactical-parity S04 CP1+CP2).
//
// Hosts the three.js tactical canvas and plays the attack beat. Render is
// reached by a DYNAMIC import (D-RENDER-DYNAMIC, arch §11) so the rest of the
// app never pulls three.js; the value import lives in an effect, the type
// imports below are erased. Responsibilities:
//   • createTacticalView(canvas, arenaRadius) then setState(state) on every
//     post-movement state change (render mutates nothing — FR-33);
//   • wire canvas click → `pick(x,y)` → `onPickBody(id)` and set the camera's
//     focus source over the screen's current selection so `F` slides onto the
//     roster's chosen ship (S04 CP1) — the render seams from S01;
//   • project the AoE preview through `view.worldToScreen(blastCenter)` and
//     draw an SVG ring over the canvas (S04 CP2) — `null` projection HIDES the
//     ring; the friendly-fire banner remains the authoritative geometry (§4.6);
//   • on `attack-resolve`, attachTracePlayer(view).playAttack(beat) → when the
//     animation finishes, call `onResolveDone` so the controller advances;
//   • reduced motion (or render unavailable) skips straight to the final frame
//     and fires `onResolveDone` — the match never stalls on missing WebGL.

import { useEffect, useRef } from 'preact/hooks';
import { useSignal } from '@preact/signals';

import type { AttackBeatRecord, BodyId, MatchState, Vec3 } from '../../../sim/index.js';
import type { TacticalView, TracePlayer } from '../../../render/index.js';
import type { MatchPhase } from '../../matchContext.js';

import { CameraHud } from './CameraHud.js';
import { aoeRingProjection, type AoeRingProjection } from './model.js';

export interface AoePreview {
  readonly label: string;
  readonly radius: number;
  /** Blast center in world coordinates — projected via `view.worldToScreen`. */
  readonly center: Vec3;
}

export interface ViewportProps {
  readonly state: MatchState;
  readonly phase: MatchPhase;
  readonly attackBeat: AttackBeatRecord | null;
  readonly reducedMotion: boolean;
  readonly onResolveDone: () => void;
  readonly aoePreview: AoePreview | null;
  /** The roster's current selection — drives the F-key focus source (S04 CP1). */
  readonly selectedId: BodyId | null;
  /** Position lookup for the selected body — pure sim read, no render leakage. */
  readonly positionOf: (id: BodyId) => Vec3 | null;
  /** Canvas click → `pick` → this callback (roster + inspector follow the pick). */
  readonly onPickBody: (id: BodyId | null) => void;
  /** Label the camera-HUD shows next to FOCUS — the selected ship's name or `—`. */
  readonly focusLabel: string;
}

/** Read the canvas-local (x, y) of a pointer event so `pick(x,y)` gets pixel
 *  coordinates in the same rect the render layer draws into. */
const canvasCoords = (canvas: HTMLCanvasElement, e: MouseEvent): { x: number; y: number } => {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
};

export function Viewport(props: ViewportProps) {
  const {
    state,
    phase,
    attackBeat,
    reducedMotion,
    onResolveDone,
    aoePreview,
    selectedId,
    positionOf,
    onPickBody,
    focusLabel,
  } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<TacticalView | null>(null);
  const playerRef = useRef<TracePlayer | null>(null);
  /** 'pending' until the dynamic import settles; 'ready' | 'failed' after. */
  const status = useSignal<'pending' | 'ready' | 'failed'>('pending');
  /** Ring geometry driven by RAF while an AoE preview is live (CP2). Signal so
   *  the DOM re-renders when the camera orbits; not part of controller state. */
  const ring = useSignal<AoeRingProjection | null>(null);

  // Latest reactive inputs the async mount + RAF loops read through a ref —
  // avoids stale closures in the camera focus source + ring reprojection
  // without spinning up an effect per input.
  const latest = useRef({ selectedId, positionOf, aoePreview });
  latest.current = { selectedId, positionOf, aoePreview };

  // Mount: create the view + trace player from the dynamically-imported render
  // layer. Disposed on unmount. A `cancelled` guard covers an unmount that races
  // the async import.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let cancelled = false;
    let ringRaf = 0;
    const hasRaf = typeof requestAnimationFrame === 'function';

    void (async () => {
      try {
        const render = await import('../../../render/index.js');
        if (cancelled) return;
        const view = render.createTacticalView(canvas, state.arena.radius);
        view.setState(state);
        viewRef.current = view;
        playerRef.current = render.attachTracePlayer(view);
        // Override the render's default focus source (last-picked) so the F key
        // slides to the ROSTER'S selection — CP1 wiring per the S01 followUp.
        view.camera.setFocusSource(() => {
          const id = latest.current.selectedId;
          if (id === null) return null;
          const p = latest.current.positionOf(id);
          return p === null ? null : [p.x, p.y, p.z];
        });
        // CP2 ring: reproject every frame while a preview is live so the ring
        // stays glued to the world as the camera orbits. Compare against the
        // last value before writing to the signal — else every RAF thrashes
        // Preact's re-render pass.
        const reprojectRing = (): void => {
          const preview = latest.current.aoePreview;
          const prev = ring.value;
          const next =
            preview === null
              ? null
              : aoeRingProjection(view.worldToScreen, preview.center, preview.radius);
          const same =
            (prev === null && next === null) ||
            (prev !== null &&
              next !== null &&
              prev.cx === next.cx &&
              prev.cy === next.cy &&
              prev.r === next.r);
          if (!same) ring.value = next;
          if (hasRaf) ringRaf = requestAnimationFrame(reprojectRing);
        };
        if (hasRaf) ringRaf = requestAnimationFrame(reprojectRing);
        else reprojectRing();
        status.value = 'ready';
      } catch {
        if (!cancelled) status.value = 'failed';
      }
    })();

    return () => {
      cancelled = true;
      if (ringRaf !== 0 && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(ringRaf);
      }
      playerRef.current?.dispose();
      viewRef.current?.dispose();
      playerRef.current = null;
      viewRef.current = null;
    };
    // Mount-only (empty deps): the [state] effect below handles subsequent
    // state pushes; render is created + disposed exactly once.
  }, []);

  // Push every post-movement state into the (already-mounted) view.
  useEffect(() => {
    viewRef.current?.setState(state);
  }, [state]);

  // Resolve: play the attack beat, then advance. Reduced motion (or a render
  // layer that never came up) jumps straight to the final frame.
  useEffect(() => {
    if (phase !== 'attack-resolve' || attackBeat === null) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onResolveDone();
    };
    const player = playerRef.current;
    if (reducedMotion || player === null) {
      finish();
      return;
    }
    const playback = player.playAttack(attackBeat, { onDone: finish });
    return () => {
      playback.dispose();
    };
  }, [phase, attackBeat, reducedMotion, onResolveDone]);

  const onCanvasClick = (e: MouseEvent): void => {
    const canvas = canvasRef.current;
    const view = viewRef.current;
    if (canvas === null || view === null) return;
    const { x, y } = canvasCoords(canvas, e);
    const result = view.pick(x, y);
    onPickBody(result === null ? null : result.bodyId);
  };

  const onReset = (): void => {
    viewRef.current?.camera.resetToFleetView();
  };
  const onFocus = (): void => {
    const view = viewRef.current;
    const id = selectedId;
    if (view === null || id === null) return;
    view.focusBody(id);
  };

  const currentRing = ring.value;

  return (
    <div class="viewport" style="position:relative;min-height:360px" data-testid="attack-viewport">
      <canvas
        ref={canvasRef}
        onClick={onCanvasClick}
        style="display:block;width:100%;height:100%;cursor:crosshair"
      />

      {aoePreview !== null && phase === 'attack-plan' && currentRing !== null ? (
        <svg
          data-testid="aoe-ring"
          data-ring-cx={String(currentRing.cx)}
          data-ring-cy={String(currentRing.cy)}
          data-ring-r={String(currentRing.r)}
          aria-hidden="true"
          style="position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:visible"
        >
          <circle
            cx={currentRing.cx}
            cy={currentRing.cy}
            r={currentRing.r}
            fill="none"
            stroke="var(--red)"
            stroke-width="1.5"
            stroke-dasharray="6 4"
            opacity="0.85"
          />
        </svg>
      ) : null}

      {aoePreview !== null && phase === 'attack-plan' ? (
        <div
          data-testid="aoe-preview"
          style="position:absolute;left:12px;top:12px;padding:6px 10px;border:1px solid var(--red);background:rgba(5,7,10,.82);border-radius:var(--r)"
        >
          <span class="mono-xs c-red" style="letter-spacing:.14em">
            {`◉ MISSILE AoE PREVIEW · ${aoePreview.label} · r${String(Math.round(aoePreview.radius))}`}
          </span>
        </div>
      ) : null}

      {phase === 'attack-plan' ? (
        <CameraHud
          onReset={onReset}
          onFocus={onFocus}
          focusLabel={focusLabel}
          focusDisabled={selectedId === null}
        />
      ) : null}

      {status.value === 'failed' ? (
        <div
          class="mono-xs c-dim"
          style="position:absolute;right:12px;bottom:12px"
          data-testid="viewport-fallback"
        >
          TACTICAL RENDER UNAVAILABLE — ASSIGNMENT STILL LIVE.
        </div>
      ) : null}
    </div>
  );
}
