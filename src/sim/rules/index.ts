// Public surface of `src/sim/rules/` — the complete combat rules (M09).
//
// The loop (M10, S04) imports this barrel. Everything the loop needs to compose
// a match state transition is re-exported here. Nothing outside `src/sim/**`
// may import from this file (the module-boundary lint enforces it).
//
// Design defaults set by this module (see STATE.md, "SESSION-02 handoff"):
//   D-HITCHANCE  — hit-chance formula in `damage.ts`; coefficients RANGE_EXP,
//                  VELOCITY_REF, HIT_FLOOR, HIT_CEIL. Publishes `HitChanceBreakdown`.
//   D-INTEGRITY — component integrity in `combatState.ts`; BASE_INTEGRITY
//                  per slot type × CLASS_INTEGRITY_MULT per chassis class.
// Both have PROMOTION SEAM comments where they will move to catalog/tuning if
// the harness settles a different home in v1.x.

// ---- Combat state -----------------------------------------------------------------
export {
  BASE_INTEGRITY,
  CLASS_INTEGRITY_MULT,
  cloneShipCombat,
  newShipCombat,
  specialLayout,
  type ComponentIntegrity,
  type Damage,
  type ShipCombat,
  type SpecialSubsystemKind,
  type SpecialSubsystemRef,
} from './combatState.js';

// ---- Damage (hit chance, seeded rolls, damage bundles, AoE falloff) ---------------
export {
  HIT_CEIL,
  HIT_FLOOR,
  RANGE_EXP,
  STREAM_ATTACK,
  VELOCITY_REF,
  aoeFalloff,
  applyDamageBundle,
  hitChance,
  rollHit,
  type ApplyDamageResult,
} from './damage.js';

// ---- Shields (regen + called-shot legality gate) ----------------------------------
export { calledShotsUnlocked, regenShields } from './shields.js';

// ---- Called shot (integrity + knockout) -------------------------------------------
export { resolveCalledShot, type CalledShotResult } from './calledShot.js';

// ---- Attack beat (FR-21 snapshot resolver) ----------------------------------------
export {
  resolveAttackBeat,
  type AttackResolution,
  type LaunchEnv,
} from './attack.js';

// ---- Missiles (launch, guidance, PD interception) ---------------------------------
export {
  STREAM_PD,
  detonatesOnContact,
  guideMissiles,
  interceptMissiles,
  launch,
  type InterceptCandidate,
  type LaunchInput,
  type MissileContact,
  type MissileGuidance,
} from './missiles.js';

// ---- Debris (spawn, lifetime, hazard cap) -----------------------------------------
export {
  STREAM_DEBRIS,
  enforceHazardCap,
  spawnDebris,
  tickDebrisLifetime,
  type DebrisAge,
  type DebrisDescriptor,
  type HazardCapResult,
  type HazardEntry,
} from './debris.js';

// ---- Destruction (AoE application, ownership-blind) -------------------------------
export {
  detonate,
  type AoeHit,
  type DetonationResult,
} from './destruction.js';
