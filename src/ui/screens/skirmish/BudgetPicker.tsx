// M14 UI — Skirmish Setup · budget picker (S04 CP1).
//
// Segmented control over `tuning.match.legalBudgets` (FR-10). Changing the
// budget re-rolls the bot fleets + arena — but that is the PARENT's job: this
// panel only reports the selection. The screen re-renders every dependent
// panel off `state.budget`, so a budget change fans out for free.

import { Segmented } from '../../components/index.js';

export interface BudgetPickerProps {
  readonly budgets: readonly number[];
  readonly budget: number;
  readonly onChange: (budget: number) => void;
}

export function BudgetPicker({ budgets, budget, onChange }: BudgetPickerProps) {
  return (
    <div>
      <div class="t-label" style="margin-bottom:var(--s2)">
        Point Budget
      </div>
      <div data-testid="budget-seg">
        <Segmented
          aria-label="Point budget"
          value={String(budget)}
          options={budgets.map((b) => ({ value: String(b), label: String(b) }))}
          onChange={(v) => {
            onChange(Number(v));
          }}
        />
      </div>
    </div>
  );
}
