// M14 UI — Skirmish Setup screen (S04 body over the S01 placeholder).
//
// Flow 2's front door (design §5-Flow2). The player picks a BUDGET, drafts
// builds from the Encyclopedia (duplicates allowed), configures 1–4 opponents
// each with a difficulty tier + reroll, reviews the generated bot fleets in
// full (FR-11), sees the arena (radius from budget) + a seed (§4.11), and hits
// LAUNCH → `services.startMatch(setup)`.
//
// D-PLACEHOLDER: this REPLACES the S01 placeholder body. The `SkirmishSetup`
// export name + `data-testid="screen-skirmish-setup"` root are contracted — the
// screens barrel + `App.tsx` outlet import them and MUST NOT be re-edited.
//
// THE SCREEN COMPUTES NOTHING (S04 review gate): cost/legality via `domain`,
// bot fleets via `ai`, arena via `domain.resolveArena` — all through
// `skirmish/model.ts`. The seed shown here is a display-only preview; the
// authoritative match seed is minted app-side by `startMatch` (arch §7.2).

import { useSignal } from '@preact/signals';
import { useMemo } from 'preact/hooks';

import { useApp } from '../appContext.js';

import { ArenaPanel } from './skirmish/ArenaPanel.js';
import { BudgetPicker } from './skirmish/BudgetPicker.js';
import { FleetDraft } from './skirmish/FleetDraft.js';
import { LaunchBar } from './skirmish/LaunchBar.js';
import { Opposition } from './skirmish/Opposition.js';
import {
  addToDraft,
  arenaReadout,
  canLaunch,
  eligibleForDraft,
  formatSeedLabel,
  initialSetupState,
  launchBlockReason,
  legalBudgets,
  removeFromDraft,
  rerollBot,
  setBotCount,
  setBotTier,
  setBudget,
  setSeed,
  standardFleet,
  toMatchSetup,
  type DraftSource,
  type SetupState,
} from './skirmish/model.js';
import type { BotTier } from '../../ai/index.js';
import type { Build } from '../../domain/index.js';
import { mintUniqueName } from '../../persist/index.js';

/** Mint a 48-bit preview seed (§4.11). UI-only randomness — the determinism
 *  ban-list scopes to `sim`/`ai`, not `ui`. Falls back to 0 with no crypto. */
const mintPreviewSeed = (): number => {
  const g = globalThis as {
    crypto?: { getRandomValues?: <T extends ArrayBufferView>(array: T) => T };
  };
  const getRandomValues = g.crypto?.getRandomValues?.bind(g.crypto);
  if (getRandomValues === undefined) return 0;
  const buf = getRandomValues(new Uint32Array(2));
  const hi = (buf[0] ?? 0) % 0x10000; // 16 high bits
  const lo = buf[1] ?? 0; // 32 low bits
  return hi * 0x100000000 + lo; // a 48-bit value
};

export function SkirmishSetup() {
  const services = useApp();
  const { catalog, repo } = services;

  const state = useSignal<SetupState>(initialSetupState(catalog, mintPreviewSeed()));
  const source = useSignal<DraftSource>('library');

  // The library is static for the life of this screen (setup never mutates the
  // repo), so the eligible source list is computed once.
  const entries = useMemo(() => eligibleForDraft(repo), [repo]);
  const budgets = useMemo(() => legalBudgets(catalog), [catalog]);
  // The Standard Fleet is a pure function of `(catalog, budget)` (fixed rngKey
  // under the hood, so a re-render never re-rolls it) — recompute only when
  // the budget changes.
  const standardBuilds = useMemo(
    () => standardFleet(catalog, state.value.budget),
    [catalog, state.value.budget],
  );

  const onBudget = (budget: number): void => {
    state.value = setBudget(state.value, catalog, budget);
  };

  const onAddEntry = (id: string): void => {
    const loaded = repo.get(id);
    if (loaded === null) return;
    state.value = addToDraft(state.value, loaded.build);
  };

  const onRemove = (index: number): void => {
    state.value = removeFromDraft(state.value, index);
  };

  const onSetSource = (next: DraftSource): void => {
    source.value = next;
  };

  const onAddStandard = (build: Build): void => {
    state.value = addToDraft(state.value, build);
  };

  /**
   * Copy a standard-fleet ship into the Encyclopedia so it can be edited in
   * the Shipyard. Mirrors `Encyclopedia.tsx::onDuplicate`: mint a fresh
   * `crypto.randomUUID` id + `Date.now`-based ISO timestamps + a collision-
   * free name via `mintUniqueName`, then `repo.put` and toast. Both branches
   * of the `PutResult` are handled — the write can fail on quota / validation
   * and the player deserves to see why.
   *
   * Wall-clock reads live here (D-IOC-SEAM `ui` layer, not `sim`/`ai`), and
   * the generated `Build`'s pre-spread fields (`storedCost`, `slots`, etc.)
   * flow through unchanged — the fresh identity is the only overlay.
   */
  const onSaveStandard = (build: Build): void => {
    const freshId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const baseName = build.name.length > 0 ? build.name : 'STANDARD SHIP';
    const name = mintUniqueName(
      baseName,
      (nk) => repo.findByNameKey(nk).length > 0,
    );
    const result = repo.put({
      ...build,
      id: freshId,
      name,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    if (result.ok) {
      services.toast(`Saved “${name}” to your Encyclopedia — edit it in the Shipyard.`);
    } else {
      services.toast(`Could not save: ${result.reason}`, 'danger');
    }
  };

  const onSetCount = (count: number): void => {
    state.value = setBotCount(state.value, catalog, count);
  };

  const onSetTier = (index: number, tier: BotTier): void => {
    state.value = setBotTier(state.value, index, tier);
  };

  const onReroll = (index: number): void => {
    state.value = rerollBot(state.value, index);
  };

  const onRerollSeed = (): void => {
    state.value = setSeed(state.value, mintPreviewSeed());
  };

  const onCopySeed = (): void => {
    const label = formatSeedLabel(state.value.seed);
    const clipboard = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } })
      .navigator?.clipboard;
    void clipboard?.writeText?.(label);
    services.toast(`Copied seed ${label}.`);
  };

  const onLaunch = (): void => {
    if (!canLaunch(state.value, catalog)) return;
    try {
      // `startMatch` mints the real seed, assembles the config, creates the
      // controller (which navigates into tactical-move), and stores it as
      // `activeMatch`. It throws on an illegal player build — canLaunch already
      // gates that, so this catch is defensive against any other assembly fault.
      services.startMatch(toMatchSetup(state.value));
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'assembly failed';
      services.toast(`Could not launch: ${reason}`, 'danger');
    }
  };

  const current = state.value;
  const match = catalog.tuning.match;
  const arena = arenaReadout(current, catalog);

  return (
    <div class="skm-wrap" data-testid="screen-skirmish-setup">
      <SkirmishSetupStyles />

      <div class="skm-header">
        <h1 class="t-h1">SKIRMISH SETUP</h1>
        <span class="mono-xs c-dim">FLOW 2 — LAST FLEET STANDING WINS</span>
      </div>

      <section class="panel ticks skm-strip">
        <div class="panel-bd">
          <BudgetPicker budgets={budgets} budget={current.budget} onChange={onBudget} />
        </div>
      </section>

      <div class="skm-layout">
        <FleetDraft
          catalog={catalog}
          state={current}
          entries={entries}
          onAddEntry={onAddEntry}
          onRemove={onRemove}
          source={source.value}
          onSetSource={onSetSource}
          standardBuilds={standardBuilds}
          onAddStandard={onAddStandard}
          onSaveStandard={onSaveStandard}
        />

        <div class="skm-right">
          <Opposition
            catalog={catalog}
            bots={current.bots}
            budget={current.budget}
            minBots={match.minBots}
            maxBots={match.maxBots}
            onSetCount={onSetCount}
            onSetTier={onSetTier}
            onReroll={onReroll}
          />

          <ArenaPanel
            radius={arena.radius}
            fleetCount={arena.fleetCount}
            budget={current.budget}
            seedLabel={formatSeedLabel(current.seed)}
            onRerollSeed={onRerollSeed}
            onCopySeed={onCopySeed}
          />

          <LaunchBar
            enabled={canLaunch(current, catalog)}
            reason={launchBlockReason(current, catalog)}
            onLaunch={onLaunch}
          />
        </div>
      </div>
    </div>
  );
}

// ---- Page-scoped styles ---------------------------------------------------
//
// Page-local composition only — never a token redefinition, never a new palette,
// never `!important`. Mirrors the Encyclopedia's single scoped <style> node so
// the S01 stylesheet-count contract (design tokens live in `mocks/console.css`)
// stays intact.

const SKM_STYLES = `
  .skm-wrap { max-width: 1680px; margin: 0 auto; padding: var(--s5) var(--s5) var(--s8);
              display: flex; flex-direction: column; gap: var(--s4); }
  .skm-header { display: flex; align-items: baseline; gap: var(--s3); flex-wrap: wrap; }
  .skm-header .t-h1 { margin: 0; }

  .skm-strip { flex: none; }

  .skm-layout { display: grid; grid-template-columns: minmax(0,2fr) minmax(0,1fr);
                gap: var(--s3); align-items: start; }

  .skm-draft { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr);
               gap: var(--s3); align-items: start; }

  .skm-right { display: flex; flex-direction: column; gap: var(--s3); min-width: 0; }
  .skm-opposition { display: flex; flex-direction: column; gap: var(--s3); min-width: 0; }
  .skm-count-row { display: flex; align-items: center; gap: var(--s3); }
  .skm-fairness { border-left: 3px solid var(--cyan); }
  .skm-fairness-lead { font-size: 11px; font-weight: 700; letter-spacing: .10em;
                       color: var(--ink-hi); line-height: 1.6; }
  .skm-fairness-table { line-height: 1.8; margin-top: var(--s2); }
  .skm-bot-card .panel-hd { flex-wrap: wrap; gap: var(--s2); }
  .skm-bot-fleet { border-top: 1px solid var(--line); }
  .skm-bot-ft { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; }

  .skm-source-list, .skm-fleet-list { display: flex; flex-direction: column; }
  .skm-row-name { display: block; font-size: 12px; font-weight: 700;
                  letter-spacing: .06em; color: var(--ink-hi); }
  .skm-total-row { display: flex; align-items: center; gap: var(--s2); }
  .skm-budget-headline { font-size: 11px; font-weight: 700; letter-spacing: .12em;
                         color: var(--ink-hi); }

  .skm-seed-row { display: flex; align-items: center; gap: var(--s2); }
  .skm-seed-value { font-size: 16px; letter-spacing: .10em; margin-top: var(--s2); }

  .skm-launch { display: flex; flex-direction: column; }
  .skm-launch-btn { width: 100%; }
`;

function SkirmishSetupStyles() {
  return <style>{SKM_STYLES}</style>;
}
