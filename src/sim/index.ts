// Public surface of `src/sim/` — the deterministic core (architecture §4).
//
// The rest of the app (`render/`, `ai/`, `app/`, `tools/balance`) imports the
// sim through THIS one entry. Reaching into `src/sim/mathx/**`, `sim/physics/**`,
// `sim/rules/**`, `sim/trace/**`, or `sim/loop/**` directly is legal (they're
// public barrels) but this file is the canonical face.
//
// Consumers get: the sim types (Body / MovementPlan / AttackPlan / SimShip /
// SimFleet / Arena / CombatConfig / …), the deterministic math primitives,
// the physics resolver, the combat rulebook, the read-only trace shapes, and
// the loop composition root (createMatch + runMatch + matchDigest).
//
// Two rules the boundary lint enforces on everything reachable from here:
//   1. `src/sim/**` may not import `render` / `ui` / `persist` / `app` or any
//      npm runtime package (architecture §5, §7.1).
//   2. Inside the sim, transcendental math and wall-clock reads are banned;
//      use `mathx/trig.ts` + `mathx/rng.ts` for anything that isn't `+ − · /`.

// ---- Shared vocabulary ------------------------------------------------------
export type {
  Arena,
  AttackPlan,
  Body,
  BodyId,
  CalledShotTarget,
  ChassisClass,
  CombatConfig,
  CombatLogEntry,
  CombatLogResult,
  DamageSourceKind,
  DebrisBody,
  DestructionEvent,
  HitChanceBreakdown,
  MissileBody,
  MovementPlan,
  ShipBody,
  SimDecoy,
  SimFleet,
  SimMissileRack,
  SimPointDefense,
  SimShip,
  SimWeapon,
} from './types.js';

// ---- Deterministic math (mathx) --------------------------------------------
export * from './mathx/index.js';

// ---- Physics (M06) — movement resolution -----------------------------------
export type { PhysicsConfig } from './physics/index.js';
export {
  broadphase,
  classifyExit,
  integrateBody,
  isOutsideArena,
  previewPath,
  resolveCollision,
  resolveMovement,
  subStepCount,
  sweepSphereSphere,
} from './physics/index.js';
export type {
  BoundaryExit,
  BoundaryExitKind,
  CollisionResolve,
  Pair,
  PreviewPath,
  StepContact,
  StepResult,
  SweepHit,
} from './physics/index.js';
export { applyPlan } from './physics/index.js';

// ---- Rules (M09) — combat rulebook -----------------------------------------
export {
  BASE_INTEGRITY,
  CLASS_INTEGRITY_MULT,
  HIT_CEIL,
  HIT_FLOOR,
  RANGE_EXP,
  STREAM_ATTACK,
  STREAM_DEBRIS,
  STREAM_PD,
  VELOCITY_REF,
  aoeFalloff,
  applyDamageBundle,
  calledShotsUnlocked,
  cloneShipCombat,
  detonate,
  detonatesOnContact,
  enforceHazardCap,
  guideMissiles,
  hitChance,
  interceptMissiles,
  launch as launchMissile,
  newShipCombat,
  regenShields,
  resolveAttackBeat,
  resolveCalledShot,
  rollHit,
  spawnDebris,
  specialLayout,
  tickDebrisLifetime,
} from './rules/index.js';
export type {
  AoeHit,
  ApplyDamageResult,
  AttackResolution,
  CalledShotResult,
  ComponentIntegrity,
  Damage,
  DebrisAge,
  DebrisDescriptor,
  DetonationResult,
  HazardCapResult,
  HazardEntry,
  InterceptCandidate,
  LaunchEnv,
  LaunchInput,
  MissileContact,
  MissileGuidance,
  ShipCombat,
  SpecialSubsystemKind,
  SpecialSubsystemRef,
} from './rules/index.js';

// ---- Trace (M11) — sim → renderer handoff ----------------------------------
export type {
  AoeArgs,
  AttackBeatRecord,
  BoundaryExitArgs,
  CollisionArgs,
  CombatLog,
  InterceptArgs,
  MatchOutcome,
  MovementBeatRecord,
  ResolutionTrace,
  TurnRecord,
  WeaponShotArgs,
} from './trace/index.js';
export {
  appendEntries,
  emptyLog,
  emptyTrace,
  logAoe,
  logBoundaryExit,
  logCollision,
  logIntercept,
  logWeaponShot,
  traceDigest,
  withOutcome,
  withTurn,
} from './trace/index.js';

// ---- Loop (M10) — the composition root -------------------------------------
export type {
  AttackBeatOutcome,
  BlindMatchView,
  BlindShipView,
  Commander,
  Match,
  MatchConfig,
  MatchState,
  MovementBeatOutcome,
  RunMatchResult,
  TurnResult,
  VictoryResult,
} from './loop/index.js';
export {
  advanceMatch,
  applyTurnEnd,
  bodiesSorted,
  buildInitialState,
  checkVictory,
  createMatch,
  guidancesSorted,
  makeBlindView,
  matchDigest,
  outcomeOf,
  runAttackBeat,
  runMatch,
  runMovementBeat,
  runTurn,
  shipsSorted,
} from './loop/index.js';
