// boundary — arena-containment test + exit classification (FR-26).
//
// The arena is a sphere. A body is INSIDE iff its center lies within the arena radius
// of the arena center. Crossing the shell is:
//   - ship          → destroyed (visible event; rules layer decides what happens next)
//   - debris|missile → removed silently (they are hazards; leaving the field is fine)
//
// The check runs at each sub-step boundary in `resolveMovement`. Using `distanceSq`
// (both operands `+ − · /`) avoids a needless sqrt and keeps the boundary test in the
// deterministic-only-arithmetic subset.

import type { Vec3 } from '../mathx/index.js';
import { distanceSq } from '../mathx/index.js';
import type { Arena, Body, BodyId } from '../types.js';

export type BoundaryExitKind = 'ship-destroyed' | 'hazard-removed';

export interface BoundaryExit {
  readonly bodyId: BodyId;
  readonly kind: BoundaryExitKind;
  /** Sub-step at whose end the body was found outside the arena. */
  readonly subStep: number;
}

/** True when `position` sits strictly outside the arena's shell. */
export const isOutsideArena = (position: Vec3, arena: Arena): boolean =>
  distanceSq(position, arena.center) > arena.radius * arena.radius;

/** Ship = destruction event; debris/missile = silent removal (FR-26). */
export const classifyExit = (body: Body): BoundaryExitKind =>
  body.kind === 'ship' ? 'ship-destroyed' : 'hazard-removed';
