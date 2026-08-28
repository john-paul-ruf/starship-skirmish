// TracePlayer — the playback state machine, driven by an injected fake clock + fake
// raf so it runs in the node env (no WebGL). The load-bearing property: a skipped
// playback and a fully-played one leave IDENTICAL final positions (FR-19 outcome
// invariance). The three.js buffer pushes are verified against a fake view that just
// records the transforms it is handed.

import { describe, expect, it, vi } from 'vitest';
import {
  attachTracePlayer,
  beamColorFor,
  defaultAttackDurationMs,
  defaultMovementDurationMs,
  MIN_MOVEMENT_MS,
  MS_PER_SUBSTEP,
} from '../../../src/render/TracePlayer.js';
import type { RafSchedule } from '../../../src/render/TracePlayer.js';
import { projectileAt } from '../../../src/render/interp.js';
import type {
  AttackBeatRecord,
  CombatLogEntry,
  MovementBeatRecord,
} from '../../../src/sim/index.js';
import type { Body } from '../../../src/sim/index.js';
import type { TrailLayer } from '../../../src/render/trail.js';
import type { TacticalView } from '../../../src/render/types.js';

// ---- Fakes ------------------------------------------------------------------

/** A single-slot raf scheduler + monotonic clock the test drives frame by frame. */
class FakeScheduler {
  clockMs = 0;
  private pending: ((t: number) => void) | null = null;
  private handle = 0;

  clock = (): number => this.clockMs;

  raf: RafSchedule = (cb) => {
    this.pending = cb;
    this.handle += 1;
    return this.handle;
  };

  cancel = (): void => {
    this.pending = null;
  };

  hasPending(): boolean {
    return this.pending !== null;
  }

  /** Advance the clock and fire the one pending frame callback (if any). */
  tick(advanceMs: number): void {
    this.clockMs += advanceMs;
    const cb = this.pending;
    this.pending = null;
    if (cb !== null) cb(this.clockMs);
  }

  /** Run to completion: keep ticking a fixed slice until no frame is scheduled. */
  runToEnd(sliceMs: number, maxTicks = 1000): void {
    let n = 0;
    while (this.hasPending() && n < maxTicks) {
      this.tick(sliceMs);
      n += 1;
    }
  }
}

interface FakeView {
  readonly view: TacticalView;
  readonly positions: Map<number, { x: number; y: number; z: number }>;
  readonly opacities: Map<number, number>;
  readonly hazardSyncs: number[];
  renderCount: number;
}

const makeFakeView = (): FakeView => {
  const positions = new Map<number, { x: number; y: number; z: number }>();
  const opacities = new Map<number, number>();
  const hazardSyncs: number[] = [];
  const state = { renderCount: 0 };
  const view = {
    scene: {
      context: { scene: { add: vi.fn(), remove: vi.fn() } },
      ships: {
        setPosition: (id: number, x: number, y: number, z: number) => {
          positions.set(id, { x, y, z });
        },
        setOpacity: (id: number, alpha: number) => {
          opacities.set(id, alpha);
        },
        positionOf: () => null,
      },
      hazards: {
        sync: (inputs: readonly unknown[]) => {
          hazardSyncs.push(inputs.length);
        },
      },
      render: () => {
        state.renderCount += 1;
      },
    },
  } as unknown as TacticalView;
  return {
    view,
    positions,
    opacities,
    hazardSyncs,
    get renderCount() {
      return state.renderCount;
    },
  };
};

// ---- Fixtures ---------------------------------------------------------------

const ship = (id: number, x: number): Body => ({
  id,
  kind: 'ship',
  position: { x, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  mass: 100,
  radius: 5,
});

const debris = (id: number, x: number): Body => ({
  id,
  kind: 'debris',
  position: { x, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  mass: 10,
  radius: 2,
});

const record = (): MovementBeatRecord => ({
  subStepCount: 3,
  keyframes: [
    [ship(1, 0), ship(2, 100), debris(3, 50)],
    [ship(1, 10), ship(2, 100), debris(3, 50)],
    [ship(1, 20), ship(2, 100), debris(3, 50)],
    [ship(1, 30), ship(2, 100), debris(3, 50)],
  ],
  contacts: [],
  log: [],
  destroyed: [],
  removedHazardIds: [],
});

// ---- Tests ------------------------------------------------------------------

describe('defaultMovementDurationMs', () => {
  it('scales with sub-steps but never below the floor', () => {
    expect(defaultMovementDurationMs(1)).toBe(MIN_MOVEMENT_MS); // 0 sub-steps
    expect(defaultMovementDurationMs(11)).toBe(10 * MS_PER_SUBSTEP);
  });
});

describe('playMovement state machine', () => {
  it('play → done fires onDone once and lands on the final keyframe', () => {
    const sched = new FakeScheduler();
    const fake = makeFakeView();
    const player = attachTracePlayer(fake.view);
    const onDone = vi.fn();

    player.playMovement(record(), {
      durationMs: 100,
      clock: sched.clock,
      raf: sched.raf,
      cancelRaf: sched.cancel,
      onDone,
    });

    sched.runToEnd(20);

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(fake.positions.get(1)).toEqual({ x: 30, y: 0, z: 0 }); // last frame
    expect(fake.positions.get(2)).toEqual({ x: 100, y: 0, z: 0 });
    // Debris routed to the hazard buffer, not the ship buffer.
    expect(fake.positions.has(3)).toBe(false);
    expect(fake.hazardSyncs.length).toBeGreaterThan(0);
  });

  it('skip() jumps to the final frame immediately and stops the loop', () => {
    const sched = new FakeScheduler();
    const fake = makeFakeView();
    const player = attachTracePlayer(fake.view);
    const onDone = vi.fn();

    const playback = player.playMovement(record(), {
      durationMs: 100,
      clock: sched.clock,
      raf: sched.raf,
      cancelRaf: sched.cancel,
      onDone,
    });

    playback.skip();

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(fake.positions.get(1)).toEqual({ x: 30, y: 0, z: 0 });
    expect(sched.hasPending()).toBe(false); // loop cancelled
  });

  it('skip and full-play leave IDENTICAL final positions (outcome invariance)', () => {
    // Full play.
    const schedA = new FakeScheduler();
    const fakeA = makeFakeView();
    attachTracePlayer(fakeA.view).playMovement(record(), {
      durationMs: 100,
      clock: schedA.clock,
      raf: schedA.raf,
      cancelRaf: schedA.cancel,
    });
    schedA.runToEnd(7); // irregular slice — must not change the endpoint

    // Skip.
    const schedB = new FakeScheduler();
    const fakeB = makeFakeView();
    attachTracePlayer(fakeB.view)
      .playMovement(record(), {
        durationMs: 100,
        clock: schedB.clock,
        raf: schedB.raf,
        cancelRaf: schedB.cancel,
      })
      .skip();

    expect(fakeA.positions.get(1)).toEqual(fakeB.positions.get(1));
    expect(fakeA.positions.get(2)).toEqual(fakeB.positions.get(2));
  });

  it('replay() re-runs the record and re-emits onDone', () => {
    const sched = new FakeScheduler();
    const fake = makeFakeView();
    const player = attachTracePlayer(fake.view);
    const onDone = vi.fn();

    const playback = player.playMovement(record(), {
      durationMs: 100,
      clock: sched.clock,
      raf: sched.raf,
      cancelRaf: sched.cancel,
      onDone,
    });

    sched.runToEnd(20);
    expect(onDone).toHaveBeenCalledTimes(1);

    playback.replay();
    sched.runToEnd(20);
    expect(onDone).toHaveBeenCalledTimes(2);
    expect(fake.positions.get(1)).toEqual({ x: 30, y: 0, z: 0 });
  });

  it('onDone() registered after completion fires immediately', () => {
    const sched = new FakeScheduler();
    const fake = makeFakeView();
    const playback = attachTracePlayer(fake.view).playMovement(record(), {
      durationMs: 100,
      clock: sched.clock,
      raf: sched.raf,
      cancelRaf: sched.cancel,
    });
    sched.runToEnd(20);

    const late = vi.fn();
    playback.onDone(late);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('a ship destroyed mid-beat fades at its last position (S01 opacity seam)', () => {
    // Ship 1 present in both keyframes; ship 2 present in frame 0 only (destroyed by hi).
    const rec: MovementBeatRecord = {
      subStepCount: 1,
      keyframes: [
        [ship(1, 0), ship(2, 100)],
        [ship(1, 10)],
      ],
      contacts: [],
      log: [],
      destroyed: [],
      removedHazardIds: [],
    };
    const sched = new FakeScheduler();
    const fake = makeFakeView();
    attachTracePlayer(fake.view).playMovement(rec, {
      durationMs: 100,
      clock: sched.clock,
      raf: sched.raf,
      cancelRaf: sched.cancel,
    });

    // Advance one intermediate frame — inside the beat, `alpha < 1` for ship 2.
    sched.tick(50);
    expect(fake.opacities.get(2)).toBeGreaterThan(0);
    expect(fake.opacities.get(2)).toBeLessThan(1);
    expect(fake.opacities.get(1)).toBe(1); // live all beat → solid

    // Final frame lands on the last keyframe; ship 2 is gone entirely.
    sched.runToEnd(20);
    expect(fake.opacities.has(2)).toBe(true); // last-seen fade was written…
    // …but the last recorded position for ship 2 stays at its last-seen keyframe.
    expect(fake.positions.get(2)).toEqual({ x: 100, y: 0, z: 0 });
    // Ship 1 lands solid at the final keyframe.
    expect(fake.opacities.get(1)).toBe(1);
    expect(fake.positions.get(1)).toEqual({ x: 10, y: 0, z: 0 });
  });

  it('records one trail point per NEW keyframe when a TrailLayer is attached (S01)', () => {
    // Fake trail — captures every push call.
    const pushes: Array<{ id: number; at: [number, number, number]; simTime: number }> = [];
    const trail: TrailLayer = {
      push: (id, at, simTime) => {
        pushes.push({ id, at: [at[0]!, at[1]!, at[2]!], simTime });
      },
      tick: () => undefined,
      clear: () => undefined,
      dispose: () => undefined,
    };

    const sched = new FakeScheduler();
    const fake = makeFakeView();
    attachTracePlayer(fake.view).playMovement(record(), {
      durationMs: 100,
      clock: sched.clock,
      raf: sched.raf,
      cancelRaf: sched.cancel,
      trail,
      beatSeconds: 4,
      startSimTime: 10,
    });

    sched.runToEnd(5);

    // 4 keyframes × 2 ships (id 1, id 2) = 8 ship pushes. Debris (id 3) is skipped.
    expect(pushes).toHaveLength(8);
    expect(pushes.every((p) => p.id === 1 || p.id === 2)).toBe(true);
    // Sim-time = startSimTime + keyframeIdx · beatSeconds → 10, 14, 18, 22.
    const times = Array.from(new Set(pushes.map((p) => p.simTime))).sort((a, b) => a - b);
    expect(times).toEqual([10, 14, 18, 22]);
    // Ship 1 flies from x=0 to x=30 across the four keyframes.
    const ship1 = pushes.filter((p) => p.id === 1).sort((a, b) => a.simTime - b.simTime);
    expect(ship1.map((p) => p.at[0])).toEqual([0, 10, 20, 30]);
  });

  it('skip() flushes every missed keyframe to the trail (outcome invariance)', () => {
    // Skip should push the same total keyframes as a full play — the flown trail
    // must not have gaps because the beat was skipped.
    const pushesFull: number[] = [];
    const pushesSkip: number[] = [];
    const mkTrail = (sink: number[]): TrailLayer => ({
      push: (id) => {
        sink.push(id);
      },
      tick: () => undefined,
      clear: () => undefined,
      dispose: () => undefined,
    });

    const runFull = (): void => {
      const sched = new FakeScheduler();
      const fake = makeFakeView();
      attachTracePlayer(fake.view).playMovement(record(), {
        durationMs: 100,
        clock: sched.clock,
        raf: sched.raf,
        cancelRaf: sched.cancel,
        trail: mkTrail(pushesFull),
        beatSeconds: 4,
      });
      sched.runToEnd(5);
    };
    const runSkip = (): void => {
      const sched = new FakeScheduler();
      const fake = makeFakeView();
      attachTracePlayer(fake.view)
        .playMovement(record(), {
          durationMs: 100,
          clock: sched.clock,
          raf: sched.raf,
          cancelRaf: sched.cancel,
          trail: mkTrail(pushesSkip),
          beatSeconds: 4,
        })
        .skip();
    };

    runFull();
    runSkip();
    expect(pushesSkip.length).toBe(pushesFull.length);
  });

  it('no trail attached → no trail-related work happens (regression guard)', () => {
    const sched = new FakeScheduler();
    const fake = makeFakeView();
    // Nothing to assert on the trail directly — just make sure the untrailed path
    // still lands the record on the final keyframe (identical to the pre-S01 shape).
    attachTracePlayer(fake.view).playMovement(record(), {
      durationMs: 100,
      clock: sched.clock,
      raf: sched.raf,
      cancelRaf: sched.cancel,
    });
    sched.runToEnd(20);
    expect(fake.positions.get(1)).toEqual({ x: 30, y: 0, z: 0 });
  });

  it('dispose() cancels the loop without firing onDone', () => {
    const sched = new FakeScheduler();
    const fake = makeFakeView();
    const onDone = vi.fn();
    const playback = attachTracePlayer(fake.view).playMovement(record(), {
      durationMs: 100,
      clock: sched.clock,
      raf: sched.raf,
      cancelRaf: sched.cancel,
      onDone,
    });

    sched.tick(20); // one frame in
    playback.dispose();
    sched.runToEnd(20);

    expect(onDone).not.toHaveBeenCalled();
    expect(sched.hasPending()).toBe(false);
  });
});

// ---- CP1: beam palette + projectile helper + attack outcome invariance -------

describe('beamColorFor palette (CP1 lock)', () => {
  // Locking the exact palette so the "beam color reads the result" cue never drifts
  // silently. If a hue moves, this test forces the change to be explicit.
  it('returns the exact per-result hues', () => {
    expect(beamColorFor('crit')).toBe(0xffef6b);
    expect(beamColorFor('kill')).toBe(0xff2d2d);
    expect(beamColorFor('hit')).toBe(0xff6b6b);
    expect(beamColorFor('intercept')).toBe(0x6bd7ff);
    expect(beamColorFor('miss')).toBe(0x51637a);
    expect(beamColorFor('boundary-exit')).toBe(0x51637a);
  });
});

describe('projectileAt (CP1 sweep helper)', () => {
  const from = { x: 0, y: 0, z: 0 };
  const to = { x: 100, y: 20, z: -40 };

  it('anchors on the endpoints exactly', () => {
    expect(projectileAt(from, to, 0)).toEqual(from);
    expect(projectileAt(from, to, 1)).toEqual(to);
  });

  it('is monotonic per axis across tNorm 0 → 1 (beam endpoint never regresses)', () => {
    // Sweep endpoint must NEVER retreat; the visual read of "beam growing" depends on it.
    let prev = projectileAt(from, to, 0);
    for (let i = 1; i <= 10; i += 1) {
      const t = i / 10;
      const cur = projectileAt(from, to, t);
      // Each axis is monotone in the sign of (to - from).
      expect(cur.x).toBeGreaterThanOrEqual(prev.x); // to.x > from.x
      expect(cur.y).toBeGreaterThanOrEqual(prev.y); // to.y > from.y
      expect(cur.z).toBeLessThanOrEqual(prev.z); // to.z < from.z (going more negative)
      prev = cur;
    }
  });

  it('clamps tNorm outside [0,1] to the endpoints', () => {
    expect(projectileAt(from, to, -0.5)).toEqual(from);
    expect(projectileAt(from, to, 1.5)).toEqual(to);
  });
});

describe('defaultAttackDurationMs (CP1 sequencing lock)', () => {
  it('scales with shot count but never below the floor', () => {
    // If either constant changes, the per-shot sequencing "reads as motion" tuning
    // it was picked for shifts — force the change to be explicit.
    expect(defaultAttackDurationMs(0)).toBe(160); // MIN_ATTACK_MS
    expect(defaultAttackDurationMs(1)).toBe(160); // 1 · 90 = 90 → floor
    expect(defaultAttackDurationMs(4)).toBe(360); // 4 · 90
  });
});

describe('playAttack state machine', () => {
  // Attack playback exercises the record end-to-end via the fake scheduler. The
  // fake view's `positionOf` returns real Vector3-shaped points so `makeBeam` builds
  // beams (empty otherwise).
  interface AttackFakeView extends FakeView {
    setShipPosition(id: number, at: { x: number; y: number; z: number }): void;
  }
  const makeAttackFake = (): AttackFakeView => {
    const shipXY = new Map<number, { x: number; y: number; z: number }>();
    const positions = new Map<number, { x: number; y: number; z: number }>();
    const opacities = new Map<number, number>();
    const hazardSyncs: number[] = [];
    const state = { renderCount: 0 };
    const view = {
      scene: {
        context: { scene: { add: vi.fn(), remove: vi.fn() } },
        ships: {
          setPosition: (id: number, x: number, y: number, z: number) => {
            positions.set(id, { x, y, z });
          },
          setOpacity: (id: number, alpha: number) => {
            opacities.set(id, alpha);
          },
          positionOf: (id: number) => shipXY.get(id) ?? null,
        },
        hazards: {
          sync: (inputs: readonly unknown[]) => {
            hazardSyncs.push(inputs.length);
          },
        },
        render: () => {
          state.renderCount += 1;
        },
      },
    } as unknown as TacticalView;
    return {
      view,
      positions,
      opacities,
      hazardSyncs,
      get renderCount() {
        return state.renderCount;
      },
      setShipPosition: (id, at) => {
        shipXY.set(id, at);
      },
    };
  };

  const shot = (sourceId: number, targetId: number, result: CombatLogEntry['result']): CombatLogEntry => ({
    turn: 1,
    beat: 'attack',
    source: 'weapon',
    sourceId,
    targetId,
    result,
    chance: 0.5,
    roll: result === 'miss' ? 0.9 : 0.1,
    damage: result === 'miss' ? 0 : 10,
    shieldBefore: 0,
    shieldAfter: 0,
    hullBefore: 100,
    hullAfter: result === 'kill' ? 0 : 90,
  });

  const attackRecord = (log: readonly CombatLogEntry[]): AttackBeatRecord => ({
    log,
    destroyed: [],
    launchedMissileIds: [],
  });

  it('fires onDone once and lands on the final frame (fade-out)', () => {
    const sched = new FakeScheduler();
    const fake = makeAttackFake();
    fake.setShipPosition(1, { x: 0, y: 0, z: 0 });
    fake.setShipPosition(2, { x: 100, y: 0, z: 0 });
    const player = attachTracePlayer(fake.view);
    const onDone = vi.fn();

    player.playAttack(attackRecord([shot(1, 2, 'hit'), shot(1, 2, 'miss')]), {
      durationMs: 200,
      clock: sched.clock,
      raf: sched.raf,
      cancelRaf: sched.cancel,
      onDone,
    });

    sched.runToEnd(20);

    expect(onDone).toHaveBeenCalledTimes(1);
    // The RAF ran, therefore the scene rendered — otherwise the beam FX would be
    // asserted directly, but our fakes don't expose Group internals.
    expect(fake.renderCount).toBeGreaterThan(0);
  });

  it('skip() and a full play both settle to onDone once, no pending raf (FR-19 spirit)', () => {
    // We can't inspect Three material opacity through the fake view (no scene tree),
    // so the outcome-invariance lock here is on the PLAYBACK contract: both paths
    // must fire onDone exactly once and end with the raf loop stopped. Combined with
    // the projectile-monotonic + palette locks, this pins the visible-final state
    // reachable by skip and full-play to the same terminal frame (both call
    // renderAt(1) via createPlayback.finish).
    const runFull = () => {
      const sched = new FakeScheduler();
      const fake = makeAttackFake();
      fake.setShipPosition(1, { x: 0, y: 0, z: 0 });
      fake.setShipPosition(2, { x: 50, y: 0, z: 0 });
      const onDone = vi.fn();
      attachTracePlayer(fake.view).playAttack(
        attackRecord([shot(1, 2, 'crit'), shot(1, 2, 'miss')]),
        {
          durationMs: 200,
          clock: sched.clock,
          raf: sched.raf,
          cancelRaf: sched.cancel,
          onDone,
        },
      );
      sched.runToEnd(15);
      return { onDone, sched };
    };
    const runSkip = () => {
      const sched = new FakeScheduler();
      const fake = makeAttackFake();
      fake.setShipPosition(1, { x: 0, y: 0, z: 0 });
      fake.setShipPosition(2, { x: 50, y: 0, z: 0 });
      const onDone = vi.fn();
      attachTracePlayer(fake.view)
        .playAttack(attackRecord([shot(1, 2, 'crit'), shot(1, 2, 'miss')]), {
          durationMs: 200,
          clock: sched.clock,
          raf: sched.raf,
          cancelRaf: sched.cancel,
          onDone,
        })
        .skip();
      return { onDone, sched };
    };

    const full = runFull();
    const skip = runSkip();
    expect(full.onDone).toHaveBeenCalledTimes(1);
    expect(skip.onDone).toHaveBeenCalledTimes(1);
    expect(full.sched.hasPending()).toBe(false);
    expect(skip.sched.hasPending()).toBe(false);
  });

  it('a shot whose shooter or target has no known position is silently skipped', () => {
    // makeBeam returns null when either endpoint is missing — the beam array shrinks
    // but the beat still resolves cleanly. Regression guard for stale-id shots.
    const sched = new FakeScheduler();
    const fake = makeAttackFake();
    // Only ship 1 has a known position; ship 2 is absent → the beam is dropped.
    fake.setShipPosition(1, { x: 0, y: 0, z: 0 });
    const player = attachTracePlayer(fake.view);
    const onDone = vi.fn();
    player.playAttack(attackRecord([shot(1, 2, 'hit')]), {
      durationMs: 100,
      clock: sched.clock,
      raf: sched.raf,
      cancelRaf: sched.cancel,
      onDone,
    });
    sched.runToEnd(20);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
