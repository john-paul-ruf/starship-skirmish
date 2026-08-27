// M14 UI — Tactical Attack called-shot picker (S06 CP2, §4.5 / FR-25).
//
// A called shot is legal ONLY while the target's shields are at zero. While they
// hold, the picker is LOCKED and shows `SHIELDS n/N — HOLDING · CALLED SHOTS
// LOCKED`. At zero it UNLOCKS with emphasis (`SHIELDS 0/N — DOWN`) and the
// subsystem list becomes selectable. Every subsystem comes from the target's
// `BlindShipView` (no fog — Decision 6, so this holds for bot ships too): a
// DESTROYED component renders struck-through + red with a text marker and is
// unselectable, everywhere. The shield-generator option carries the verbatim
// warning that killing it removes the pool permanently.

import type { BlindShipView, CalledShotTarget } from '../../../sim/index.js';

import {
  calledShotEquals,
  calledShotOptions,
  calledShotUnlocked,
  shieldReadout,
} from './model.js';

export interface CalledShotPickerProps {
  readonly target: BlindShipView;
  readonly selected: CalledShotTarget | undefined;
  readonly onPick: (target: CalledShotTarget | null) => void;
}

export function CalledShotPicker(props: CalledShotPickerProps) {
  const { target, selected, onPick } = props;
  const unlocked = calledShotUnlocked(target);
  const readout = shieldReadout(target);

  if (!unlocked) {
    // Locked: the readout is the whole story. The list is not rendered — there
    // is nothing to choose until the shields fall.
    return (
      <div class="panel-in locked-note" data-testid="called-shot-picker" data-locked="true">
        <div class="acard-hd">
          <span class="t-label grow">CALLED SHOT</span>
          <span class="chip">LOCKED</span>
        </div>
        <div class="mono-xs c-amber" style="margin-top:5px;letter-spacing:.14em">
          {`🔒 ${readout}`}
        </div>
      </div>
    );
  }

  const options = calledShotOptions(target);

  return (
    <div class="panel-in" data-testid="called-shot-picker" data-locked="false">
      <div class="acard-hd">
        <span class="t-label grow">CALLED SHOT</span>
        <span class="chip chip-amber">UNLOCKED</span>
      </div>
      <div class="mono-xs c-red" style="margin-top:5px;letter-spacing:.14em">
        {readout}
      </div>
      <div class="mono-xs c-dim" style="margin-top:3px">
        {`${target.name} · COMPONENT TARGET:`}
      </div>

      <div
        role="group"
        aria-label={`Called-shot subsystem for ${target.name}`}
        style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:8px"
      >
        {options.map((opt) => {
          const on = calledShotEquals(selected, opt.target);
          const cls = ['comp-btn', on ? 'is-on' : '', opt.alive ? '' : 'is-x']
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={opt.label}
              type="button"
              class={cls}
              disabled={!opt.alive}
              aria-pressed={opt.alive ? on : undefined}
              aria-disabled={opt.alive ? undefined : true}
              title={opt.alive ? undefined : 'Destroyed — cannot be targeted'}
              onClick={() => (on ? onPick(null) : onPick(opt.target))}
            >
              {opt.alive ? opt.label : `${opt.label} · DESTROYED`}
            </button>
          );
        })}
      </div>

      <div class="banner banner-info" style="margin-top:8px;align-items:flex-start">
        <span class="c-cyan" style="font-size:14px;line-height:1">◎</span>
        <div class="mono-xs c-hi" style="line-height:1.7">
          Killing the generator removes the pool permanently. It does not restore depleted shields.
        </div>
      </div>
    </div>
  );
}
