// M14 UI — Tactical Attack viewport (tactical-attack-mock-parity SESSION-03).
//
// Hosts the three.js tactical canvas, plays the attack beat, and hosts the plan-
// time field overlay. Render is reached by a DYNAMIC import (D-RENDER-DYNAMIC,
// arch §11) so the rest of the app never pulls three.js; the value import lives
// in an effect, the type imports below are erased. Responsibilities:
//   • createTacticalView(canvas, arenaRadius) then setState(state) on every
//     post-movement state change (render mutates nothing — FR-33);
//   • wire canvas click → `pick(x,y)` → `onPickBody(id)` and set the camera's
//     focus source over the screen's current selection so `F` slides onto the
//     roster's chosen ship — the render seams from S01;
//   • reconcile ONE `RangeShell` per live weapon envelope of the active shooter
//     against a keyed map (create on new key, update centre/radius, dispose
//     stale) so the mock's concentric rings appear without per-frame recreation;
//   • each frame, project the firing solutions, range labels, selected callout,
//     and AoE ring into CSS pixels and feed `FieldOverlay` — a `null` projection
//     HIDES the element rather than drawing a stale artifact; the friendly-fire
//     banner remains the authoritative AoE geometry (§4.6);
//   • on `attack-resolve`, attachTracePlayer(view).playAttack(beat) → when the
//     animation finishes, call `onResolveDone` so the controller advances;
//   • reduced motion (or render unavailable) skips straight to the final frame
//     and fires `onResolveDone` — the match never stalls on missing WebGL.
//
// The outer `.viewport` div carries no inline min-height of its own — sizing is
// the HOSTING SCREEN's call in every phase (plan / resolve / boot).

import { useEffect, useRef } from 'preact/hooks';
import { useSignal } from '@preact/signals';

import type { AttackBeatRecord, BodyId, MatchState, Vec3 } from '../../../sim/index.js';
import type { RangeShell, TacticalView, TracePlayer } from '../../../render/index.js';
import type { MatchPhase } from '../../matchContext.js';

import { CameraHud } from './CameraHud.js';
import {
  FieldOverlay,
  type FieldCallout,
  type FieldLegendFleet,
  type FieldRangeLabel,
  type FieldSolutionMark,
} from './FieldOverlay.js';
import {
  aoeRingProjection,
  projectPoint,
  projectSegment,
  type AoeRingProjection,
  type FireSolution,
  type RangePreview,
} from './model.js';

export interface AoePreview {
  readonly label: string;
  readonly radius: number;
  /** Blast center in world coordinates — projected via `view.worldToScreen`. */
  readonly center: Vec3;
}

/** The plan-time overlay geometry, all projected to CSS pixels (recomputed each
 *  frame as the camera orbits). `null` fields are hidden. */
interface OverlayProjection {
  readonly solutions: readonly FieldSolutionMark[];
  readonly rangeLabels: readonly FieldRangeLabel[];
  readonly selected: FieldCallout | null;
  readonly aoeRing: AoeRingProjection | null;
  readonly aoeCallout: FieldCallout | null;
  readonly aoeFriendlies: readonly FieldCallout[];
}

const EMPTY_OVERLAY: OverlayProjection = {
  solutions: [],
  rangeLabels: [],
  selected: null,
  aoeRing: null,
  aoeCallout: null,
  aoeFriendlies: [],
};

export interface ViewportProps {
  readonly state: MatchState;
  readonly phase: MatchPhase;
  readonly attackBeat: AttackBeatRecord | null;
  readonly reducedMotion: boolean;
  readonly onResolveDone: () => void;
  readonly aoePreview: AoePreview | null;
  /** Friendly world positions inside the previewed missile's blast — projected
   *  to `⚠ FRIENDLY IN AoE` callouts. */
  readonly aoeFriendlies: readonly Vec3[];
  /** All live weapon envelopes for the active shooter (D-TA-WIRE-RANGE). The
   *  viewport draws one wire `RangeShell` per `key`; the overlay labels each. */
  readonly rangePreviews: readonly RangePreview[];
  /** The player's staged firing solutions (blind commit — never opponent plans);
   *  projected to lines + midpoint pills. */
  readonly fireSolutions: readonly FireSolution[];
  /** Per-fleet living-ship counts for the body-class legend. */
  readonly legendFleets: readonly FieldLegendFleet[];
  /** Current turn (post-movement) — the overlay's `TURN {n}` HUD. */
  readonly turn: number;
  /** The roster's current selection — drives the F-key focus source + callout. */
  readonly selectedId: BodyId | null;
  /** Position lookup for a body — pure sim read, no render leakage. */
  readonly positionOf: (id: BodyId) => Vec3 | null;
  /** Canvas click → `pick` → this callback (roster + inspector follow the pick). */
  readonly onPickBody: (id: BodyId | null) => void;
  /** Label the camera-HUD + selected callout show — the selected ship's name or `—`. */
  readonly focusLabel: string;
  /** Current immersive-mode state; the CameraHud reports it via `aria-pressed`. */
  readonly fullscreen: boolean;
  /** Flip the immersive-mode toggle. */
  readonly onToggleFullscreen: () => void;
}

/** D-ATK-RESOLVE-MIN-HOLD — the minimum time `attack-resolve` stays on screen
 *  before handing off, so a zero-fire (or reduced-motion) turn still reads as a
 *  resolved beat instead of an instant bounce back to movement. */
const MIN_RESOLVE_MS = 1200;

/** Read the canvas-local (x, y) of a pointer event so `pick(x,y)` gets pixel
 *  coordinates in the same rect the render layer draws into. */
const canvasCoords = (canvas: HTMLCanvasElement, e: MouseEvent): { x: number; y: number } => {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
};

/** A cheap change signature over the projected overlay so the RAF only writes
 *  the signal (and re-renders the overlay) when the projection actually moves —
 *  avoids thrashing Preact 60 times a second on a still camera. Coords rounded
 *  to whole pixels (sub-pixel jitter is invisible). */
const overlaySignature = (o: OverlayProjection): string => {
  const seg = o.solutions
    .map((m) => `${m.solution.key}:${Math.round(m.seg.x1)},${Math.round(m.seg.y1)},${Math.round(m.seg.x2)},${Math.round(m.seg.y2)}`)
    .join('|');
  const lab = o.rangeLabels
    .map((l) => `${l.key}:${Math.round(l.point.x)},${Math.round(l.point.y)},${l.active ? 1 : 0}`)
    .join('|');
  const sel = o.selected === null ? '-' : `${Math.round(o.selected.point.x)},${Math.round(o.selected.point.y)},${o.selected.text}`;
  const ring = o.aoeRing === null ? '-' : `${Math.round(o.aoeRing.cx)},${Math.round(o.aoeRing.cy)},${Math.round(o.aoeRing.r)}`;
  const fr = o.aoeFriendlies.map((c) => `${c.key}:${Math.round(c.point.x)},${Math.round(c.point.y)}`).join('|');
  return `${seg}#${lab}#${sel}#${ring}#${fr}`;
};

export function Viewport(props: ViewportProps) {
  const {
    state,
    phase,
    attackBeat,
    reducedMotion,
    onResolveDone,
    aoePreview,
    aoeFriendlies,
    rangePreviews,
    fireSolutions,
    legendFleets,
    turn,
    selectedId,
    positionOf,
    onPickBody,
    focusLabel,
    fullscreen,
    onToggleFullscreen,
  } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<TacticalView | null>(null);
  const playerRef = useRef<TracePlayer | null>(null);
  /** One wire range shell per live weapon envelope, keyed by preview key. */
  const rangeShellsRef = useRef<Map<string, RangeShell>>(new Map());
  /** Observes the `.viewport` container so a FULL FIELD grid collapse/restore
   *  (or any other container resize) reaches the renderer/camera/projection —
   *  the same lifecycle `tacticalMove/Viewport.tsx` already runs. */
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  /** 'pending' until the dynamic import settles; 'ready' | 'failed' after. */
  const status = useSignal<'pending' | 'ready' | 'failed'>('pending');
  /** Projected overlay geometry, driven by the RAF loop. */
  const overlay = useSignal<OverlayProjection>(EMPTY_OVERLAY);

  // Latest reactive inputs the async mount + RAF loops read through a ref —
  // avoids stale closures without an effect per input.
  const latest = useRef({
    selectedId,
    positionOf,
    aoePreview,
    aoeFriendlies,
    rangePreviews,
    fireSolutions,
    focusLabel,
  });
  latest.current = {
    selectedId,
    positionOf,
    aoePreview,
    aoeFriendlies,
    rangePreviews,
    fireSolutions,
    focusLabel,
  };

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
        viewRef.current = view;

        // Bind the view to the actual `.viewport` container (D-TA-CONTAINER-
        // IS-SIZE-TRUTH) — an immediate positive-size resize, then a
        // `ResizeObserver` for every later change (grid collapse, restore).
        // Runs BEFORE `setState`/the first label pass and BEFORE the overlay
        // RAF starts, so the renderer, camera projection, and cached
        // `worldToScreen` dimensions are correct from the first frame.
        const container = canvas.parentElement;
        const resizeToContainer = (): void => {
          if (container === null) return;
          const width = container.clientWidth;
          const height = container.clientHeight;
          if (width > 0 && height > 0) view.resize(width, height);
        };
        resizeToContainer();
        if (container !== null && typeof ResizeObserver !== 'undefined') {
          const observer = new ResizeObserver(resizeToContainer);
          observer.observe(container);
          resizeObserverRef.current = observer;
        }

        view.setState(state);
        playerRef.current = render.attachTracePlayer(view);
        // Range-shell factory + scene root (best-effort — a stubbed render
        // module without them just skips the 3D rings; the overlay labels stay).
        const factory = (render as { createRangeShell?: typeof import('../../../render/index.js').createRangeShell }).createRangeShell;
        const sceneRoot = view.scene?.context?.scene;
        const shells = rangeShellsRef.current;
        // Override the render's default focus source (last-picked) so the F key
        // slides to the ROSTER'S selection.
        view.camera.setFocusSource(() => {
          const id = latest.current.selectedId;
          if (id === null) return null;
          const p = latest.current.positionOf(id);
          return p === null ? null : [p.x, p.y, p.z];
        });

        let lastSig = '';
        // Reconcile the range-shell map against the active shooter's envelopes.
        const reconcileShells = (previews: readonly RangePreview[]): void => {
          if (typeof factory !== 'function' || sceneRoot === undefined) return;
          const seen = new Set<string>();
          for (const p of previews) {
            seen.add(p.key);
            let shell = shells.get(p.key);
            if (shell === undefined) {
              shell = factory(p.radius);
              sceneRoot.add(shell.mesh);
              shells.set(p.key, shell);
            }
            shell.setCenter(p.center.x, p.center.y, p.center.z);
            shell.setRadius(p.radius);
            shell.setVisible(true);
          }
          for (const [key, shell] of shells) {
            if (!seen.has(key)) {
              try {
                sceneRoot.remove(shell.mesh);
              } catch {
                // Scene teardown ordering can put the scene beyond reach.
              }
              shell.dispose();
              shells.delete(key);
            }
          }
        };

        // Project the plan overlay each frame so lines/rings/labels stay glued
        // to the world as the camera orbits. Only write the signal when the
        // projection actually changes (see `overlaySignature`).
        const reproject = (): void => {
          const l = latest.current;
          const w2s = view.worldToScreen;

          reconcileShells(l.rangePreviews);

          const solutions: FieldSolutionMark[] = [];
          for (const s of l.fireSolutions) {
            const seg = projectSegment(w2s, s.source, s.target);
            if (seg !== null) solutions.push({ solution: s, seg });
          }

          const rangeLabels: FieldRangeLabel[] = [];
          for (const p of l.rangePreviews) {
            const ring = aoeRingProjection(w2s, p.center, p.radius);
            if (ring === null) continue;
            rangeLabels.push({
              key: p.key,
              text: p.label,
              active: p.active,
              point: { x: ring.cx, y: ring.cy - ring.r },
            });
          }

          let selected: FieldCallout | null = null;
          if (l.selectedId !== null) {
            const pos = l.positionOf(l.selectedId);
            if (pos !== null) {
              const pt = projectPoint(w2s, pos);
              if (pt !== null) {
                selected = { key: 'sel', text: `◈ ${l.focusLabel}`, tone: 'cyan', point: pt };
              }
            }
          }

          let aoeRing: AoeRingProjection | null = null;
          let aoeCallout: FieldCallout | null = null;
          if (l.aoePreview !== null) {
            aoeRing = aoeRingProjection(w2s, l.aoePreview.center, l.aoePreview.radius);
            if (aoeRing !== null) {
              aoeCallout = {
                key: 'aoe',
                text: `◉ ${l.aoePreview.label} · r${String(Math.round(l.aoePreview.radius))}`,
                tone: 'red',
                point: { x: aoeRing.cx, y: aoeRing.cy - aoeRing.r - 10 },
              };
            }
          }

          const aoeFriendliesProj: FieldCallout[] = [];
          l.aoeFriendlies.forEach((pos, i) => {
            const pt = projectPoint(w2s, pos);
            if (pt !== null) {
              aoeFriendliesProj.push({
                key: `frn${String(i)}`,
                text: '⚠ FRIENDLY IN AoE',
                tone: 'amber',
                point: { x: pt.x, y: pt.y + 20 },
              });
            }
          });

          const next: OverlayProjection = {
            solutions,
            rangeLabels,
            selected,
            aoeRing,
            aoeCallout,
            aoeFriendlies: aoeFriendliesProj,
          };
          const sig = overlaySignature(next);
          if (sig !== lastSig) {
            lastSig = sig;
            overlay.value = next;
          }
          if (hasRaf) ringRaf = requestAnimationFrame(reproject);
        };
        if (hasRaf) ringRaf = requestAnimationFrame(reproject);
        else reproject();
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
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      const shells = rangeShellsRef.current;
      const view = viewRef.current;
      for (const shell of shells.values()) {
        try {
          view?.scene?.context?.scene?.remove(shell.mesh);
        } catch {
          // Scene teardown ordering can put the scene beyond reach; dispose()
          // below still releases the shell's own resources.
        }
        shell.dispose();
      }
      shells.clear();
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

  // Resolve: play the attack beat, then advance — held for a minimum readable
  // duration first (D-ATK-RESOLVE-MIN-HOLD) so `attack-resolve` never flashes
  // past, even under reduced motion or an empty beat.
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
      const timer = setTimeout(finish, MIN_RESOLVE_MS);
      return () => {
        clearTimeout(timer);
      };
    }
    let animDone = false;
    let minElapsed = false;
    const tryFinish = () => {
      if (animDone && minElapsed) finish();
    };
    const timer = setTimeout(() => {
      minElapsed = true;
      tryFinish();
    }, MIN_RESOLVE_MS);
    const playback = player.playAttack(attackBeat, {
      onDone: () => {
        animDone = true;
        tryFinish();
      },
    });
    return () => {
      clearTimeout(timer);
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

  const isPlan = phase === 'attack-plan';
  const ov = overlay.value;

  return (
    <div class="viewport" style="position:relative" data-testid="attack-viewport">
      <canvas
        ref={canvasRef}
        onClick={onCanvasClick}
        style="display:block;width:100%;height:100%;cursor:crosshair"
      />

      {isPlan ? (
        <FieldOverlay
          solutions={ov.solutions}
          rangeLabels={ov.rangeLabels}
          selected={ov.selected}
          aoeRing={ov.aoeRing}
          aoeCallout={ov.aoeCallout}
          aoeFriendlies={ov.aoeFriendlies}
          legendFleets={legendFleets}
          turn={turn}
          arenaRadius={state.arena.radius}
        />
      ) : null}

      {isPlan ? (
        <CameraHud
          onReset={onReset}
          onFocus={onFocus}
          focusLabel={focusLabel}
          focusDisabled={selectedId === null}
          fullscreen={fullscreen}
          onToggleFullscreen={onToggleFullscreen}
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
