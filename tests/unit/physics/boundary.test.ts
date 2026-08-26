// boundary — arena containment + exit classification (FR-26).

import { describe, it, expect } from 'vitest';
import {
  isOutsideArena,
  classifyExit,
} from '../../../src/sim/physics/boundary.js';
import { of } from '../../../src/sim/mathx/vec3.js';
import type { Arena, Body } from '../../../src/sim/types.js';

const arena: Arena = { center: of(0, 0, 0), radius: 100 };

describe('isOutsideArena', () => {
  it('center is inside', () => {
    expect(isOutsideArena(of(0, 0, 0), arena)).toBe(false);
  });

  it('a point inside the shell is inside', () => {
    expect(isOutsideArena(of(50, 0, 0), arena)).toBe(false);
  });

  it('a point exactly on the shell is INSIDE (boundary is closed on the inside)', () => {
    expect(isOutsideArena(of(100, 0, 0), arena)).toBe(false);
  });

  it('a point beyond the shell is outside', () => {
    expect(isOutsideArena(of(100.001, 0, 0), arena)).toBe(true);
  });

  it('works with an offset arena center', () => {
    const off: Arena = { center: of(1000, -500, 0), radius: 10 };
    expect(isOutsideArena(of(1000, -500, 0), off)).toBe(false);
    expect(isOutsideArena(of(1005, -500, 0), off)).toBe(false);
    expect(isOutsideArena(of(1020, -500, 0), off)).toBe(true);
  });
});

describe('classifyExit — FR-26', () => {
  const make = (kind: Body['kind']): Body => ({
    kind,
    id: 1,
    position: of(0, 0, 0),
    velocity: of(0, 0, 0),
    mass: 1,
    radius: 1,
  });

  it('ship exit → destroyed', () => {
    expect(classifyExit(make('ship'))).toBe('ship-destroyed');
  });

  it('debris exit → removed silently', () => {
    expect(classifyExit(make('debris'))).toBe('hazard-removed');
  });

  it('missile exit → removed silently', () => {
    expect(classifyExit(make('missile'))).toBe('hazard-removed');
  });
});
