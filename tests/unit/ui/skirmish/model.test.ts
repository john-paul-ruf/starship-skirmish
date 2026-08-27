// Skirmish Setup model — node-env unit tests (S04).
//
// Drives the REAL catalog + REAL domain + REAL ai through
// `src/ui/screens/skirmish/model.ts`. The tests intentionally never touch
// `SkirmishSetup.tsx` or any panel `.tsx` (the tsconfig.node JSX trap: a unit
// test that imports a `.tsx` pulls JSX into `tsc --noEmit -p tsconfig.node.json`
// → TS6142). Screen logic lives in this `.ts` model exactly so it can be tested
// here.
//
// CP1: budget defaults, player-fleet cost roll-up, over/under/exact, draft ops.
// CP2: bot-spec list clamp, tier text (exact §4.10 strings), rngKey bump.
// CP3: arena readout, seed label, canLaunch truth table, launchBlockReason,
//      toMatchSetup shape.

import { beforeAll, describe, expect, it } from 'vitest';

import { loadCatalog } from '../../../../src/catalog/index.js';
import type { Catalog } from '../../../../src/catalog/index.js';
import { emptyBuild, pointCost, type Build, type BuildMeta } from '../../../../src/domain/index.js';
import { generateBotFleet } from '../../../../src/ai/index.js';
import type { IndexEntry, LibraryRepo } from '../../../../src/persist/index.js';

import {
  addBot,
  addToDraft,
  arenaReadout,
  budgetStatus,
  canLaunch,
  defaultBudget,
  draftAffordable,
  duplicateInDraft,
  eligibleForDraft,
  formatSeedLabel,
  initialSetupState,
  launchBlockReason,
  legalBudgets,
  playerFleetCost,
  removeBot,
  removeFromDraft,
  rerollBot,
  setBotTier,
  setBudget,
  tierBrief,
  toMatchSetup,
  type SetupState,
} from '../../../../src/ui/screens/skirmish/model.js';

// ---- shared catalog fixture -----------------------------------------------

let catalog: Catalog;

beforeAll(() => {
  catalog = loadCatalog();
});

const META: BuildMeta = {
  id: 'test-build-0000',
  schemaVersion: 1,
  catalogVersion: 1,
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
};

/** A bare (empty-slot) legal build on the given chassis, priced at current catalog. */
const bareBuild = (chassisId: string, id: string): Build => {
  const result = emptyBuild(catalog, chassisId, `Bare ${chassisId}`, { ...META, id });
  if (!result.ok) throw new Error(`fixture build failed: ${chassisId}`);
  const build = result.value;
  return { ...build, storedCost: pointCost(catalog, build) };
};

// ---- CP1 — budget + player draft ------------------------------------------

describe('legalBudgets + defaultBudget (S04 CP1)', () => {
  it('exposes the tuning legal budgets verbatim', () => {
    expect(legalBudgets(catalog)).toEqual([25, 50, 75, 100, 125, 150]);
  });

  it('defaults to 100 (a legal budget)', () => {
    expect(defaultBudget(catalog)).toBe(100);
  });
});

describe('playerFleetCost — roll-up matches pointCost sums (S04 CP1)', () => {
  it('sums pointCost across the drafted builds', () => {
    const a = bareBuild('fig-needle', 'a');
    const b = bareBuild('fig-needle', 'b');
    let state = initialSetupState(catalog);
    state = addToDraft(state, a);
    state = addToDraft(state, b);
    expect(playerFleetCost(state, catalog)).toBe(pointCost(catalog, a) + pointCost(catalog, b));
  });

  it('an empty fleet costs 0', () => {
    expect(playerFleetCost(initialSetupState(catalog), catalog)).toBe(0);
  });
});

describe('budgetStatus — over/under/exact classification (S04 CP1)', () => {
  it('empty fleet is under budget', () => {
    expect(budgetStatus(initialSetupState(catalog), catalog)).toBe('under');
  });

  it('exact when the fleet cost equals the budget', () => {
    const build = bareBuild('fig-needle', 'x');
    const cost = pointCost(catalog, build);
    const state = addToDraft({ ...initialSetupState(catalog), budget: cost }, build);
    // Only meaningful if the chassis has a legal budget-equal path; assert via cost.
    expect(playerFleetCost(state, catalog)).toBe(cost);
    expect(budgetStatus({ ...state, budget: cost }, catalog)).toBe('exact');
  });

  it('over when the fleet cost exceeds the budget', () => {
    const build = bareBuild('cru-meridian', 'y');
    const state = addToDraft({ ...initialSetupState(catalog), budget: 25 }, build);
    expect(pointCost(catalog, build)).toBeGreaterThan(25);
    expect(budgetStatus(state, catalog)).toBe('over');
  });
});

describe('draft ops — add / remove / duplicate (duplicates allowed) (S04 CP1)', () => {
  it('addToDraft appends; duplicates are allowed', () => {
    const build = bareBuild('fig-needle', 'd');
    let state = initialSetupState(catalog);
    state = addToDraft(state, build);
    state = addToDraft(state, build);
    expect(state.playerBuilds).toHaveLength(2);
  });

  it('removeFromDraft removes exactly one by index; out-of-range is a no-op', () => {
    const a = bareBuild('fig-needle', 'a');
    const b = bareBuild('fig-wasp', 'b');
    let state = addToDraft(addToDraft(initialSetupState(catalog), a), b);
    state = removeFromDraft(state, 0);
    expect(state.playerBuilds.map((x) => x.id)).toEqual(['b']);
    expect(removeFromDraft(state, 9)).toBe(state);
  });

  it('duplicateInDraft inserts a second copy right after the source', () => {
    const a = bareBuild('fig-needle', 'a');
    const b = bareBuild('fig-wasp', 'b');
    let state = addToDraft(addToDraft(initialSetupState(catalog), a), b);
    state = duplicateInDraft(state, 0);
    expect(state.playerBuilds.map((x) => x.id)).toEqual(['a', 'a', 'b']);
  });
});

describe('setBudget — only legal budgets are accepted (S04 CP1)', () => {
  it('accepts a legal budget', () => {
    expect(setBudget(initialSetupState(catalog), catalog, 150).budget).toBe(150);
  });

  it('ignores an illegal budget', () => {
    const state = initialSetupState(catalog);
    expect(setBudget(state, catalog, 137)).toBe(state);
  });
});

describe('eligibleForDraft + draftAffordable (S04 CP1)', () => {
  const entryOf = (over: Partial<IndexEntry>): IndexEntry => ({
    id: 'e',
    name: 'BUILD',
    nameKey: 'build',
    tags: [],
    chassisId: 'fig-needle',
    classId: 'fighter',
    storedCost: 10,
    currentCost: 10,
    needsRefit: false,
    pricedAtCatalogVersion: 1,
    schemaVersion: 1,
    catalogVersion: 1,
    createdAt: '',
    updatedAt: '',
    bytes: 0,
    status: 'ok',
    ...over,
  });

  const repoWith = (entries: readonly IndexEntry[]): LibraryRepo =>
    ({ entries: () => entries }) as unknown as LibraryRepo;

  it('keeps only status:ok entries and sorts highest-cost-first', () => {
    const repo = repoWith([
      entryOf({ id: 'ok-cheap', currentCost: 10 }),
      entryOf({ id: 'failed', status: 'failed', currentCost: 99 }),
      entryOf({ id: 'ok-dear', currentCost: 40 }),
    ]);
    expect(eligibleForDraft(repo).map((e) => e.id)).toEqual(['ok-dear', 'ok-cheap']);
  });

  it('draftAffordable reflects remaining budget', () => {
    const state = { ...initialSetupState(catalog), budget: 25 };
    expect(draftAffordable(entryOf({ currentCost: 20 }), state, catalog)).toBe(true);
    expect(draftAffordable(entryOf({ currentCost: 30 }), state, catalog)).toBe(false);
  });
});

// ---- CP2 — opposition + tiers ---------------------------------------------

describe('opposition list — clamps to [minBots, maxBots] (S04 CP2)', () => {
  it('starts with one ROOKIE opponent', () => {
    const state = initialSetupState(catalog);
    expect(state.bots).toHaveLength(1);
    expect(state.bots[0]?.tier).toBe('rookie');
  });

  it('addBot clamps at maxBots (4)', () => {
    let state = initialSetupState(catalog);
    for (let i = 0; i < 10; i += 1) state = addBot(state, catalog);
    expect(state.bots).toHaveLength(4);
  });

  it('removeBot clamps at minBots (1)', () => {
    let state = initialSetupState(catalog);
    for (let i = 0; i < 10; i += 1) state = removeBot(state, catalog);
    expect(state.bots).toHaveLength(1);
  });

  it('setBotTier changes a single opponent tier', () => {
    let state = addBot(initialSetupState(catalog), catalog);
    state = setBotTier(state, 1, 'ace');
    expect(state.bots[0]?.tier).toBe('rookie');
    expect(state.bots[1]?.tier).toBe('ace');
  });
});

describe('tierBrief — exact §4.10 wording (S04 CP2)', () => {
  it('renders the ROOKIE / VETERAN / ACE lines verbatim', () => {
    expect(tierBrief('rookie')).toBe(
      '1-TURN HORIZON · NEAREST-TARGET PRIORITY · NO EVASION MODELLING',
    );
    expect(tierBrief('veteran')).toBe(
      '2-TURN HORIZON · THREAT-WEIGHTED TARGETING · BREAKS SHIELDS THEN KILLS THE GENERATOR',
    );
    expect(tierBrief('ace')).toBe(
      '3-TURN HORIZON · PREDICTIVE INTERCEPTS · WILLING TO OVERBURN AND TO RAM',
    );
  });
});

describe('rerollBot — rngKey bump redraws a different legal fleet (S04 CP2)', () => {
  it('bumps the opponent rngKey', () => {
    const state = initialSetupState(catalog);
    const before = state.bots[0]?.rngKey ?? -1;
    const after = rerollBot(state, 0).bots[0]?.rngKey ?? -1;
    expect(after).toBe(before + 1);
  });

  it('the drawn fleet changes when the rngKey changes', () => {
    const a = generateBotFleet(catalog, 100, 'rookie', 0);
    const b = generateBotFleet(catalog, 100, 'rookie', 1);
    const sig = (fleet: readonly Build[]): string =>
      fleet.map((s) => `${s.chassisId}:${s.slots.join(',')}`).join('|');
    expect(sig(a)).not.toBe(sig(b));
  });

  it('every generated bot fleet is legal and within budget (FR-11 / FR-31)', () => {
    for (const tier of ['rookie', 'veteran', 'ace'] as const) {
      const fleet = generateBotFleet(catalog, 100, tier, 3);
      expect(fleet.length).toBeGreaterThan(0);
      const total = fleet.reduce((sum, s) => sum + pointCost(catalog, s), 0);
      expect(total).toBeLessThanOrEqual(100);
    }
  });
});

// ---- CP3 — arena + seed + launch ------------------------------------------

describe('arenaReadout — radius via resolveArena; fleet count = bots + 1 (S04 CP3)', () => {
  it('radius comes from resolveArena and fleetCount counts the player', () => {
    const state = addBot(initialSetupState(catalog), catalog); // 2 bots
    const readout = arenaReadout(state, catalog);
    expect(readout.radius).toBe(catalog.tuning.arena.radiusByBudget['100']);
    expect(readout.fleetCount).toBe(3);
  });
});

describe('formatSeedLabel — SK-XXXX-XXXX-XXXX (S04 CP3)', () => {
  it('formats a 48-bit value into three hex groups', () => {
    expect(formatSeedLabel(0x7f3a9c21d4e8)).toBe('SK-7F3A-9C21-D4E8');
  });

  it('zero-pads a small value', () => {
    expect(formatSeedLabel(0)).toBe('SK-0000-0000-0000');
  });
});

describe('canLaunch + launchBlockReason — the §4.4 corollary (S04 CP3)', () => {
  const legalDraft = (): SetupState =>
    addToDraft(initialSetupState(catalog), bareBuild('fig-needle', 's'));

  it('a legal under-budget draft with 1 bot CAN launch', () => {
    const state = legalDraft();
    expect(canLaunch(state, catalog)).toBe(true);
    expect(launchBlockReason(state, catalog)).toBeNull();
  });

  it('an empty fleet cannot launch and says so', () => {
    const state = initialSetupState(catalog);
    expect(canLaunch(state, catalog)).toBe(false);
    expect(launchBlockReason(state, catalog)).toBe('ADD AT LEAST ONE SHIP');
  });

  it('an over-budget fleet cannot launch and reports the overage', () => {
    const state = addToDraft({ ...initialSetupState(catalog), budget: 25 }, bareBuild('cru-meridian', 'o'));
    const over = pointCost(catalog, state.playerBuilds[0]!) - 25;
    expect(canLaunch(state, catalog)).toBe(false);
    expect(launchBlockReason(state, catalog)).toBe(`OVER BUDGET (+${String(over)})`);
  });

  it('under-budget (leftover points) still launches — §4.4', () => {
    const state = addToDraft({ ...initialSetupState(catalog), budget: 150 }, bareBuild('fig-needle', 'u'));
    expect(budgetStatus(state, catalog)).toBe('under');
    expect(canLaunch(state, catalog)).toBe(true);
  });
});

describe('toMatchSetup — the startMatch payload shape (S04 CP3)', () => {
  it('carries budget, playerBuilds, and botSpecs', () => {
    let state = addToDraft(initialSetupState(catalog), bareBuild('fig-needle', 'p'));
    state = setBotTier(addBot(state, catalog), 1, 'ace');
    const setup = toMatchSetup(state);
    expect(setup.budget).toBe(state.budget);
    expect(setup.playerBuilds).toBe(state.playerBuilds);
    expect(setup.botSpecs).toBe(state.bots);
    expect(setup.botSpecs.map((b) => b.tier)).toEqual(['rookie', 'ace']);
  });
});
