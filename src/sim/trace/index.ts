// Public surface of `src/sim/trace/` — the ResolutionTrace record + combat-log builder (M11).
//
// The trace is the sim → renderer handoff (architecture §6.2, §9). This barrel is what
// the loop (M10, S04) and later the renderer (M13) import from; everything below the
// barrel is implementation. The `sim/trace` module imports:
//   - `../types.js`               — shared combat vocabulary (CombatLogEntry, DestructionEvent, …)
//   - `../physics/index.js`       — StepContact type only, for MovementBeatRecord.contacts
// Nothing else. `sim/rules` (M09) is a sibling — this module does NOT import from it
// (rules PRODUCES the events; trace RECORDS the shapes). Boundary-lint enforces the ban
// on external packages inside `src/sim/**`.

export type {
  ResolutionTrace,
  TurnRecord,
  MovementBeatRecord,
  AttackBeatRecord,
  MatchOutcome,
} from './trace.js';
export { emptyTrace, withTurn, withOutcome } from './trace.js';

export type {
  CombatLog,
  WeaponShotArgs,
  CollisionArgs,
  AoeArgs,
  InterceptArgs,
  BoundaryExitArgs,
} from './combatLog.js';
export {
  emptyLog,
  appendEntries,
  logWeaponShot,
  logCollision,
  logAoe,
  logIntercept,
  logBoundaryExit,
} from './combatLog.js';

export { traceDigest } from './digest.js';
