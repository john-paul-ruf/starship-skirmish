// M14 UI — Tactical Movement marks-interval selector (SESSION-03 CP3, Gate 1
// prototype port).
//
// The `Off / 1s / 2s / 4s` segmented control from `prototypes/gate1/` that
// never made it into the shipping UI. Selects how densely the ghost arc's
// numbered per-second marks paint the ruler:
//   • `0` (Off) — arc line only, no numbered marks
//   • `1s`      — the shipped per-second cadence (default)
//   • `2s` / `4s` — thinned ruler (declutters a long arc)
//
// Threads directly into `render/ghost.ts` `GhostDrawInput.markIntervalSec`
// (S01) — the marks reuse the exact time → index lerp of the uniform-in-time
// preview samples; NEVER a second integrator (§2 "preview must not lie").
//
// A11y: real `<button>` elements per option carry `aria-pressed` so a screen
// reader announces the current selection without color; a text label names the
// full group. Every button label is text — never color alone (design §1.1).
//
// The pure options list + `MarksIntervalValue` live in `./model.ts` so
// vitest's node env can lock the state transitions without touching JSX.

import type { JSX } from 'preact';

import { MARKS_INTERVAL_OPTIONS, type MarksIntervalValue } from './model.js';

export type { MarksIntervalValue };

export interface MarksIntervalProps {
  readonly value: MarksIntervalValue;
  readonly onChange: (value: MarksIntervalValue) => void;
}

/** Segmented `Off / 1s / 2s / 4s` control — text-first, aria-pressed, tokenized. */
export function MarksInterval({ value, onChange }: MarksIntervalProps): JSX.Element {
  return (
    <div class="tm-marks-interval" data-testid="marks-interval" role="group" aria-label="Ghost arc marks interval">
      <span class="t-label" style="letter-spacing:.14em">MARKS</span>
      <span class="tm-marks-interval-buttons">
        {MARKS_INTERVAL_OPTIONS.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              class="tm-marks-interval-btn mono-xs"
              data-testid="marks-interval-option"
              data-value={String(opt.value)}
              aria-pressed={active}
              aria-label={opt.srLabel}
              onClick={() => {
                if (!active) onChange(opt.value);
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </span>
    </div>
  );
}
