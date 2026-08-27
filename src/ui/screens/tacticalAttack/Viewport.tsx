// M14 UI — Tactical Attack viewport (S06 CP3).
//
// Hosts the three.js tactical canvas and plays the attack beat. Render is
// reached by a DYNAMIC import (D-RENDER-DYNAMIC, arch §11) so the rest of the
// app never pulls three.js; the value import lives in an effect, the type
// imports below are erased. Responsibilities:
//   • createTacticalView(canvas, arenaRadius) then setState(state) on every
//     post-movement state change (render mutates nothing — FR-33);
//   • on `attack-resolve`, attachTracePlayer(view).playAttack(beat) → when the
//     animation finishes, call `onResolveDone` so the controller advances;
//   • reduced motion (or render unavailable) skips straight to the final frame
//     and fires `onResolveDone` — the match never stalls on missing WebGL.
// The AoE-preview ring is an informational overlay for the selected missile; the
// authoritative friendly-fire geometry lives in `aoeOverlapsFriendly` (banner).

import { useEffect, useRef } from 'preact/hooks';
import { useSignal } from '@preact/signals';

import type { AttackBeatRecord, MatchState } from '../../../sim/index.js';
import type { TacticalView, TracePlayer } from '../../../render/index.js';
import type { MatchPhase } from '../../matchContext.js';

export interface AoePreview {
  readonly label: string;
  readonly radius: number;
}

export interface ViewportProps {
  readonly state: MatchState;
  readonly phase: MatchPhase;
  readonly attackBeat: AttackBeatRecord | null;
  readonly reducedMotion: boolean;
  readonly onResolveDone: () => void;
  readonly aoePreview: AoePreview | null;
}

export function Viewport(props: ViewportProps) {
  const { state, phase, attackBeat, reducedMotion, onResolveDone, aoePreview } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<TacticalView | null>(null);
  const playerRef = useRef<TracePlayer | null>(null);
  /** 'pending' until the dynamic import settles; 'ready' | 'failed' after. */
  const status = useSignal<'pending' | 'ready' | 'failed'>('pending');

  // Mount: create the view + trace player from the dynamically-imported render
  // layer. Disposed on unmount. A `cancelled` guard covers an unmount that races
  // the async import.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let cancelled = false;

    void (async () => {
      try {
        const render = await import('../../../render/index.js');
        if (cancelled) return;
        const view = render.createTacticalView(canvas, state.arena.radius);
        view.setState(state);
        viewRef.current = view;
        playerRef.current = render.attachTracePlayer(view);
        status.value = 'ready';
      } catch {
        if (!cancelled) status.value = 'failed';
      }
    })();

    return () => {
      cancelled = true;
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

  return (
    <div class="viewport" style="position:relative;min-height:360px" data-testid="attack-viewport">
      <canvas ref={canvasRef} style="display:block;width:100%;height:100%" />

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
