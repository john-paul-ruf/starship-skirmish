# M11 Sim: Trace — public surface (as built)

<!-- sim-combat SESSION-03 -->
### M11 — Sim: Trace (`src/sim/trace/`)

New module. Owns the read-only record the loop (M10) hands the renderer (M13),
plus an append-only combat-log accumulator and typed event constructors.

**Files**

- `combatLog.ts` — append-only accumulator + per-kind typed constructors
- `trace.ts` — `ResolutionTrace` + `TurnRecord` + `MovementBeatRecord` + `AttackBeatRecord` + `MatchOutcome` + builders
- `digest.ts` — arithmetic-only FNV-1a-32 hash of a whole trace
- `index.ts` — public barrel

**Imports (in-tree only; boundary-lint enforced)**

- `../types.js` — `BodyId`, `Body`, `ChassisClass`, `CalledShotTarget`, `CombatLogEntry`, `CombatLogResult`, `DamageSourceKind`, `DestructionEvent`
- `../physics/index.js` — **type only**: `StepContact`
- `../mathx/index.js` — **type only**: `Vec3` (digest.ts)

No import from `../rules` (M09 is a sibling — rules PRODUCES events, trace RECORDS the shapes; no cross-edge). No npm package. Determinism ban-list obeyed: `Math.imul` + `DataView` little-endian only.

**Public surface (what M10 imports from the barrel)**

*Types*
```
ResolutionTrace, TurnRecord, MovementBeatRecord, AttackBeatRecord, MatchOutcome
CombatLog
WeaponShotArgs, CollisionArgs, AoeArgs, InterceptArgs, BoundaryExitArgs
```

*Trace builders* (frozen output, non-mutating)
```
emptyTrace(seedHi: number, seedLo: number): ResolutionTrace
withTurn(trace, turn: TurnRecord): ResolutionTrace
withOutcome(trace, outcome: MatchOutcome): ResolutionTrace
```

*Log accumulator + event constructors* (frozen output, non-mutating; each constructor
hardcodes `source`/`beat`/(when fixed)`result` and requires only per-event fields)
```
emptyLog(): CombatLog
appendEntries(log, more): CombatLog                    // append-only, never reorders
logWeaponShot(WeaponShotArgs): CombatLogEntry          // attack + weapon
logCollision(CollisionArgs): CombatLogEntry            // movement + collision, no roll
logAoe(AoeArgs): CombatLogEntry                        // movement + aoe, no roll
logIntercept(InterceptArgs): CombatLogEntry            // beat param; source=weapon
logBoundaryExit(BoundaryExitArgs): CombatLogEntry      // movement + boundary
```

*Digest*
```
traceDigest(trace: ResolutionTrace): string            // 8-char lowercase hex
```

**Contract for M10 (S04)**

- `Seed` is stored as `seedHi`/`seedLo` plain numbers on `ResolutionTrace`, NOT as an
  imported `Seed` type — keeps this module's import surface at `sim/types` + physics
  types + `Vec3`. Callers with a `Seed` pass `seed.hi, seed.lo`.
- `MovementBeatRecord.log` records collision + AoE + boundary-exit events; `AttackBeatRecord.log`
  records weapon + intercept events. The loop composes these per beat.
- `MatchOutcome` has exactly TWO variants: `victory | mutual-destruction` (Custom Rule 5 —
  no draw, no turn-cap, no points-tiebreak).
- The accumulator NEVER reorders; canonical `(sourceId, shotIndex)` sort is the loop's job
  BEFORE `appendEntries` is called (determinism §7.3).
- `traceDigest` is a convenience over a recorded trace; the authoritative match-state digest
  remains the loop's `matchDigest` (S04).

**Cost**: +645 non-test LOC (`combatLog.ts` 234 + `trace.ts` 139 + `digest.ts` 232 + `index.ts` 40) across the 3 files. Every entry frozen; every builder pure.
