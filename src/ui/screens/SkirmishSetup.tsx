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

import { BudgetPicker } from './skirmish/BudgetPicker.js';
import { FleetDraft } from './skirmish/FleetDraft.js';
import {
  addToDraft,
  eligibleForDraft,
  initialSetupState,
  legalBudgets,
  removeFromDraft,
  setBudget,
  type SetupState,
} from './skirmish/model.js';

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
  const { catalog, repo } = useApp();

  const state = useSignal<SetupState>(initialSetupState(catalog, mintPreviewSeed()));

  // The library is static for the life of this screen (setup never mutates the
  // repo), so the eligible source list is computed once.
  const entries = useMemo(() => eligibleForDraft(repo), [repo]);
  const budgets = useMemo(() => legalBudgets(catalog), [catalog]);

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

  const current = state.value;

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

      <FleetDraft
        catalog={catalog}
        state={current}
        entries={entries}
        onAddEntry={onAddEntry}
        onRemove={onRemove}
      />
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

  .skm-draft { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr);
               gap: var(--s3); align-items: start; }

  .skm-source-list, .skm-fleet-list { display: flex; flex-direction: column; }
  .skm-row-name { display: block; font-size: 12px; font-weight: 700;
                  letter-spacing: .06em; color: var(--ink-hi); }
  .skm-total-row { display: flex; align-items: center; gap: var(--s2); }
  .skm-budget-headline { font-size: 11px; font-weight: 700; letter-spacing: .12em;
                         color: var(--ink-hi); }
`;

function SkirmishSetupStyles() {
  return <style>{SKM_STYLES}</style>;
}
