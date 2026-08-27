// M14 UI — Shipyard point ledger + budget meter (S05, CP3).
//
// The sticky right-column readout — POINT TOTAL (FR-5), the fit-legality
// chip, chassis vs components breakdown, an OPTIONAL vs-budget meter, and
// the *leftover-points-are-wasted* plain-text statement (design §4.4 —
// Decision 9 / FR-5). Deliberately renders NO affordance implying unspent
// points do anything.

import type { FitSnapshot } from './model.js';

interface LedgerPanelProps {
  readonly snap: FitSnapshot | null;
  readonly chassisCost: number;
  readonly componentCount: number;
  readonly emptySlotCount: number;
  /** Optional reference budget the player set; null → no budget meter. */
  readonly budget: number | null;
  readonly onBudgetChange: (v: number | null) => void;
}

/** The plain-text corollary of design §4.4 — over-budget vs under-budget. */
function budgetLine(cost: number, budget: number): {
  chipTone: 'green' | 'amber';
  chipText: string;
  detail: string;
} {
  if (cost <= budget) {
    const unspent = budget - cost;
    return {
      chipTone: 'green',
      chipText: `✓ FITS ${budget} BUDGET`,
      detail: `✓ ${cost} / ${budget} · ${unspent} UNSPENT`,
    };
  }
  const over = cost - budget;
  return {
    chipTone: 'amber',
    chipText: `▲ OVER ${budget} BUDGET`,
    detail: `▲ ${cost} / ${budget} · ${over} OVER`,
  };
}

export function LedgerPanel(props: LedgerPanelProps) {
  const {
    snap,
    chassisCost,
    componentCount,
    emptySlotCount,
    budget,
    onBudgetChange,
  } = props;
  const cost = snap?.cost ?? 0;
  const errors = snap?.errors ?? [];

  const budgetInfo =
    budget !== null && snap !== null ? budgetLine(cost, budget) : null;

  // Fit chip: NO BUILD / VALID FIT / ✕ N ISSUES.
  let chip: { tone: 'neutral' | 'green' | 'red'; text: string };
  if (snap === null) chip = { tone: 'neutral', text: 'NO BUILD' };
  else if (errors.length === 0) chip = { tone: 'green', text: '✓ VALID FIT' };
  else
    chip = {
      tone: 'red',
      text: `✕ ${errors.length} ISSUE${errors.length === 1 ? '' : 'S'}`,
    };

  const chipClass =
    chip.tone === 'green'
      ? 'chip chip-green'
      : chip.tone === 'red'
        ? 'chip chip-red'
        : 'chip';

  return (
    <div
      class="ledger"
      style="background:var(--panel);border-bottom:1px solid var(--line);padding:10px 14px"
    >
      <div style="display:flex;align-items:baseline;justify-content:space-between">
        <span class="t-label">POINT TOTAL</span>
        <span class={chipClass} data-testid="shipyard-validation-badge">
          {chip.text}
        </span>
      </div>
      <div style="display:flex;align-items:flex-end;gap:8px;margin-top:4px">
        <span
          class="t-num-xl c-cyan"
          data-testid="shipyard-point-total"
          style="text-shadow:0 0 18px rgba(34,227,255,.45)"
        >
          {snap === null ? '—' : String(cost)}
        </span>
        <span class="t-h2" style="padding-bottom:3px">PTS</span>
      </div>

      {snap === null ? null : (
        <>
          <div class="stat" style="margin-top:8px">
            <span class="stat-k">CHASSIS</span>
            <span class="stat-v" data-testid="shipyard-ledger-chassis">
              {chassisCost}
            </span>
          </div>
          <div class="stat">
            <span class="stat-k">
              COMPONENTS · {componentCount} FITTED
            </span>
            <span class="stat-v" data-testid="shipyard-ledger-components">
              {cost - chassisCost}
            </span>
          </div>
          <div class="stat">
            <span class="stat-k">OPEN BAYS · {emptySlotCount}</span>
            <span class="stat-v c-dim">0</span>
          </div>
        </>
      )}

      {/* Optional player-set budget. */}
      <div
        style="display:flex;align-items:center;gap:8px;margin-top:8px"
        data-testid="shipyard-budget-row"
      >
        <label class="t-label" for="shipyard-budget-input">
          BUDGET
        </label>
        <input
          id="shipyard-budget-input"
          class="field"
          type="number"
          min={0}
          max={9999}
          inputMode="numeric"
          style="width:80px;height:26px;font-size:12px"
          value={budget === null ? '' : String(budget)}
          onInput={(ev) => {
            const raw = (ev.currentTarget as HTMLInputElement).value.trim();
            if (raw === '') {
              onBudgetChange(null);
              return;
            }
            const n = Number(raw);
            if (!Number.isFinite(n) || n < 0) {
              onBudgetChange(null);
              return;
            }
            onBudgetChange(Math.floor(n));
          }}
          placeholder="—"
          data-testid="shipyard-budget-input"
        />
        <span class="mono-xs c-dim">OPTIONAL · GATED IN SKIRMISH SETUP</span>
      </div>

      {budgetInfo !== null && budget !== null ? (
        <div style="margin-top:9px" data-testid="shipyard-budget-status">
          <div class="mono-xs" style="display:flex;justify-content:space-between">
            <span>VS {budget}-PT BUDGET</span>
            <span
              class={budgetInfo.chipTone === 'green' ? 'c-green' : 'c-amber'}
            >
              {budgetInfo.detail}
            </span>
          </div>
          <BudgetMeter cost={cost} budget={budget} />
        </div>
      ) : null}

      <p
        class="mono-xs"
        style="margin:9px 0 0;line-height:1.5;color:var(--ink-dim)"
        data-testid="shipyard-leftover-note"
      >
        <span class="c-amber">!</span> LEFTOVER POINTS ARE WASTED — THERE IS NO
        CONVERSION.
      </p>
    </div>
  );
}

/**
 * Bar meter — capped at `budget`. Over-budget snaps to 100% and flips to the
 * hot palette so the "▲ OVER" chip is triple-encoded (color + shape + words).
 */
function BudgetMeter(props: { cost: number; budget: number }) {
  const { cost, budget } = props;
  const over = cost > budget;
  const pct = budget === 0 ? 0 : Math.min(100, Math.round((cost / budget) * 100));
  const fill = over ? 'f-hot' : 'f-ok';
  return (
    <div class="meter" style="margin-top:3px">
      <span
        class={`meter-fill ${fill}`}
        style={`width: ${String(pct)}%`}
      />
    </div>
  );
}
