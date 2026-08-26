// Public surface of `src/sim/loop/` — the sim composition root (M10).
//
// The loop imports rules (M09), trace (M11), physics (M06), and mathx (M04);
// nothing outside `src/sim/**` imports from those siblings directly (boundary
// lint enforces it). Consumers of the sim reach through THIS barrel and the
// sim's top-level index (`src/sim/index.ts`).
//
// Design guarantees promoted from the module implementations:
//   • Blind commit is UNREACHABLE (§6.3) — see `blindView.ts` + `turnCoordinator.ts`.
//   • Determinism end-to-end (§7) — see `matchDigest`, sorted iteration.
//   • Victory has EXACTLY three branches (Custom Rule 5) — see `victory.ts`.

// ---- Match state + config ---------------------------------------------------
export type { Match, MatchConfig, MatchState } from './matchState.js';
export { bodiesSorted, guidancesSorted, shipsSorted } from './matchState.js';

// ---- Initialisation ---------------------------------------------------------
export { buildInitialState, createMatch } from './createMatch.js';

// ---- Blind view + Commander interface (FR-17) ------------------------------
export type { BlindMatchView, BlindShipView } from './blindView.js';
export { makeBlindView } from './blindView.js';
export type { Commander } from './commander.js';

// ---- Pure beat resolvers (S05 + F5 harness drive these) --------------------
export type { AttackBeatOutcome, MovementBeatOutcome } from './resolveBeat.js';
export { applyTurnEnd, runAttackBeat, runMovementBeat } from './resolveBeat.js';

// ---- Async coordination (UI + player match drive this) ---------------------
export type { RunMatchResult, TurnResult } from './turnCoordinator.js';
export { advanceMatch, runMatch, runTurn } from './turnCoordinator.js';

// ---- Victory (FR-27, Custom Rule 5) ----------------------------------------
export type { VictoryResult } from './victory.js';
export { checkVictory, outcomeOf } from './victory.js';

// ---- Match-state digest (authoritative determinism gate) -------------------
export { matchDigest } from './digest.js';
