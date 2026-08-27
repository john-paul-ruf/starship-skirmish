// M14 UI — the match contract every Skirmish screen consumes (D-MATCH-CONTEXT).
//
// This is the ui-owned analog of `appContext.ts`'s D-IOC-SEAM: the contract
// (`MatchPhase`, `MatchController`, `BotSpec`, `MatchSetup`, `MatchContext`,
// `useMatch`, `MatchProvider`) is declared HERE, in `ui`; the VALUE is produced
// by `src/app/match/**` and handed down via `<MatchProvider controller={…}>`.
// `ui` never imports `app` (APP_IMPORT_PATTERN stays green), and the two sim
// capabilities the screens need — hit chance (`sim/rules`) and the movement
// integrator (`sim/physics`) — cross through the controller's `hitChanceFor` /
// `previewArc` seams, never a direct import (both are lint-banned for `ui`).
//
// Import discipline: `ui` MAY import `sim` **types** and `ai` **types** (only
// `sim/physics` + `sim/rules` value/type imports are lint-banned). Everything
// below is `import type` — no sim/ai VALUE is pulled into the ui bundle here.

import { createContext, createElement } from 'preact';
import { useContext } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { ReadonlySignal } from '@preact/signals';

import type { BotTier } from '../ai/index.js';
import type { Build } from '../domain/index.js';
import type {
  AttackBeatRecord,
  AttackPlan,
  BlindMatchView,
  BodyId,
  HitChanceBreakdown,
  MatchOutcome,
  MatchState,
  MovementBeatRecord,
  MovementPlan,
  ResolutionTrace,
  SimFleet,
  Vec3,
} from '../sim/index.js';

// ---- Phase state machine --------------------------------------------------

/**
 * The five states the controller drives a turn through. The player plans
 * against a blind view during the `*-plan` phases; the `*-resolve` phases
 * animate a beat whose outcome is ALREADY final (simulate-then-animate, arch
 * §6.2). `complete` is terminal — the outcome is set and the match is over.
 *
 * Blind commit (FR-17 / §6.3): during `movement-plan` / `attack-plan` no other
 * fleet's plan is observable — the controller collects each fleet's plans
 * against a fresh `makeBlindView`, and plans live only as `const` locals.
 */
export type MatchPhase =
  | 'movement-plan' // player plotting arcs; opponent plans NOT observable
  | 'movement-resolve' // animating the movement beat; outcome already final
  | 'attack-plan' // player assigning fire against post-movement positions
  | 'attack-resolve' // animating the attack beat
  | 'complete'; // outcome set — post-match

// ---- Setup inputs ---------------------------------------------------------

/**
 * One opposition fleet the setup screen configures (FR-11 / design §4.10).
 * `tier` is decision quality only (Custom Rule 4 — never a stat advantage);
 * `rngKey` varies WHICH legal fleet is drawn from the shared catalog, never
 * how strong it is.
 */
export interface BotSpec {
  readonly tier: BotTier;
  readonly rngKey: number;
}

/**
 * Everything the setup screen (S04) hands `startMatch` at LAUNCH. Deliberately
 * high-level: the app side mints the seed (`crypto.getRandomValues` lives in
 * `app` only, arch §7.2), validates + resolves the player builds, and
 * generates + resolves the bot fleets. The setup screen "computes nothing"
 * (domain/ai) — it only gathers selections.
 */
export interface MatchSetup {
  /** Legal match budget (`tuning.match.legalBudgets`). */
  readonly budget: number;
  /** The player's chosen builds (fleetId 0). Validated app-side. */
  readonly playerBuilds: readonly Build[];
  /** One entry per opposition fleet (fleetId 1..N), in display order. */
  readonly botSpecs: readonly BotSpec[];
}

// ---- The controller surface ----------------------------------------------

/**
 * The live match handle the four Skirmish screens consume through `useMatch()`.
 * Produced by `src/app/match/controller.ts` (`createMatchController`) and
 * provided via `MatchProvider`. Every observable is a `ReadonlySignal` so a
 * screen re-renders when the controller advances; every mutation is a method
 * the screen calls (commit / animation-done / concede / rematch).
 */
export interface MatchController {
  /** Player's current blind view for the active plan phase, or null mid-resolve. */
  readonly view: ReadonlySignal<BlindMatchView | null>;
  readonly phase: ReadonlySignal<MatchPhase>;
  readonly turn: ReadonlySignal<number>;
  /** The just-resolved movement beat to animate (set entering 'movement-resolve'). */
  readonly movementBeat: ReadonlySignal<MovementBeatRecord | null>;
  readonly attackBeat: ReadonlySignal<AttackBeatRecord | null>;
  /** Full current state — screens read ships/bodies/arena for HUD + render.setState. */
  readonly state: ReadonlySignal<MatchState>;
  /** Set only in 'complete'. */
  readonly outcome: ReadonlySignal<MatchOutcome | null>;
  readonly trace: ReadonlySignal<ResolutionTrace>;
  readonly seedLabel: string; // 'SK-7F3A-9C21-D4E8' formatting (§4.11)
  readonly playerFleetId: number;
  /**
   * The immutable rosters every fleet STARTED with (post-`resolveFleet`), keyed
   * by `fleetId`. Post-match fates (S07) need this to name a destroyed ship:
   * `state` holds only survivors and a `DestructionEvent` carries no name /
   * buildId, so the initial `SimShip` profiles are the sole source of a dead
   * ship's identity. Stable across `rematch` (the fleets never change; only the
   * seed does).
   */
  readonly initialFleets: readonly SimFleet[];

  /** Resolve the player's movement promise → controller advances into resolve+animate. */
  commitMovement(plans: readonly MovementPlan[]): void;
  commitAttack(plans: readonly AttackPlan[]): void;
  /** Screen calls this when its resolve animation finishes → controller enters next plan phase. */
  resolveAnimationDone(): void;
  /** Published hit-chance breakdown — attack screen reads this, NEVER recomputes (arch §13.3). */
  hitChanceFor(shooterId: BodyId, targetId: BodyId, weaponIndex: number): HitChanceBreakdown;
  /** Movement ghost seam — the ONE integrator (`sim/physics.previewPath`) behind the
   *  controller, so `ui` never value-imports `sim/physics`. The Movement screen (S05)
   *  calls this on every arc edit; the returned `positions` are what render draws. */
  previewArc(
    bodyId: BodyId,
    deltaV: Vec3,
  ): { readonly positions: readonly Vec3[]; readonly endsOutsideArena: boolean };
  /** Player-facing exit (Ruling D, Flow 6) — immediate loss → 'complete'. */
  concede(): void;
  /** Post-match: re-run with the SAME fleets; newSeed=false replays identically (§4.11). */
  rematch(opts: { readonly newSeed: boolean }): void;
}

// ---- Context + hook + provider -------------------------------------------

/**
 * The Preact context that carries a `MatchController` down to the four match
 * screens. Default `null` so a screen mounted outside `<MatchProvider>` throws
 * in `useMatch()` rather than reading a phantom controller.
 */
export const MatchContext = createContext<MatchController | null>(null);

/**
 * The hook the four Skirmish screens reach for. Throws when mounted outside a
 * `<MatchProvider>` — mirrors `useApp()`. In practice the shell only mounts a
 * match screen inside the provider once a match exists; a match route entered
 * cold redirects to setup before any screen calls this.
 */
export const useMatch = (): MatchController => {
  const controller = useContext(MatchContext);
  if (controller === null) {
    throw new Error(
      'useMatch() called outside <MatchProvider>. A match screen mounted without an active controller.',
    );
  }
  return controller;
};

/**
 * Props for `MatchProvider`. `controller` is the app-produced value; `children`
 * are the match screens + shell match-chrome.
 */
export interface MatchProviderProps {
  readonly controller: MatchController;
  readonly children?: ComponentChildren;
}

/**
 * Supplies a `MatchController` to its subtree. A thin wrapper over
 * `MatchContext.Provider` so screens depend on the ui-owned symbol, never the
 * raw context object.
 *
 * Authored with `createElement` rather than JSX because this contract lives in
 * a `.ts` file (`matchContext.ts`, per the module's write-set) — TS only parses
 * JSX in `.tsx`. The result is identical: a `MatchContext.Provider` vnode whose
 * `value` is the supplied controller.
 */
export function MatchProvider(props: MatchProviderProps) {
  return createElement(
    MatchContext.Provider,
    { value: props.controller },
    props.children,
  );
}
