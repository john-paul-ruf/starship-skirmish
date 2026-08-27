// TracePlayer — the playback state machine, driven by an injected fake clock + fake
// raf so it runs in the node env (no WebGL). The load-bearing property: a skipped
// playback and a fully-played one leave IDENTICAL final positions (FR-19 outcome
// invariance). The three.js buffer pushes are verified against a fake view that just
// records the transforms it is handed.

import { describe, expect, it, vi } from 'vitest';
import {
  attachTracePlayer,
  defaultMovementDurationMs,
  MIN_MOVEMENT_MS,
  MS_PER_SUBSTEP,
} from '../../../src/render/TracePlayer.js';
import type { RafSchedule } from '../../../src/render/TracePlayer.js';
import type { MovementBeatRecord } from '../../../src/sim/index.js';
import type { Body } from '../../../src/sim/index.js';
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
