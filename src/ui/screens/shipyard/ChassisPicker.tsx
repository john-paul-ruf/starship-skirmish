// M14 UI — Shipyard chassis picker (S05, CP1).
//
// The LEFT column's "CHASSIS" tab pane. A class-grouped list — one `.grp`
// header per ship class, then a `.row` per chassis with hull/mass/evasion
// mono-xs + the point cost. Mirrors `mocks/shipyard.html` §CHASSIS-PANE.
//
// Stateless: reads groups from the shared model layer + calls back on pick.
// The parent (`Shipyard.tsx`) owns the working-Build signal.

import type { ChassisClass, ChassisDef } from '../../../catalog/index.js';
import { InfoTip } from '../../components/index.js';

import { infoFor } from './catalogInfo.js';
import type { ChassisGroup } from './model.js';

// Decorative class-letter tag (mock uses the `.tag-slot` visual language for
// chassis class glyphs — F/G/C/D). Not a SlotTag: SlotTag is strictly for slot
// types (W/S/M/E/X) with an accessible name; the class glyph is aria-hidden
// decoration paired with the class header text.
const CLASS_GLYPH: Record<ChassisClass, { letter: string; color: string }> = {
  fighter: { letter: 'F', color: 'var(--cyan)' },
  frigate: { letter: 'G', color: 'var(--green)' },
  cruiser: { letter: 'C', color: 'var(--amber)' },
  'mega-destroyer': { letter: 'D', color: 'var(--red)' },
};

interface ChassisPickerProps {
  readonly groups: readonly ChassisGroup[];
  /** Currently-selected chassis id (from the working build). Empty ⇒ nothing selected. */
  readonly selectedId: string;
  readonly onPick: (chassis: ChassisDef) => void;
}

/**
 * A concise per-chassis summary — hull, mass, evasion, permanent id. Uses
 * the same tabular figures + `mono-xs` treatment as the mock.
 */
function ChassisMeta({ chassis }: { chassis: ChassisDef }) {
  const ev = chassis.baseEvasion.toFixed(2);
  return (
    <span class="mono-xs" style="display:block">
      HULL {chassis.hullPoints} · MASS {chassis.mass} · EV {ev} · {chassis.id}
    </span>
  );
}

/** Layout hint on the class header — `3W / 2S / 2M / 1E / 1X`. */
function layoutHint(layout: readonly ChassisGroup['layout'][number][]): string {
  let w = 0;
  let s = 0;
  let m = 0;
  let e = 0;
  let x = 0;
  for (const t of layout) {
    if (t === 'weapon') w += 1;
    else if (t === 'shield') s += 1;
    else if (t === 'missile') m += 1;
    else if (t === 'engine') e += 1;
    else if (t === 'special') x += 1;
  }
  return `${w}W / ${s}S / ${m}M / ${e}E / ${x}X`;
}

export function ChassisPicker(props: ChassisPickerProps) {
  const { groups, selectedId, onPick } = props;
  return (
    <div class="tabpane" id="pane-chassis" data-testid="shipyard-chassis-pane">
      {groups.map((group) => (
        <div key={group.classId} data-testid={`shipyard-chassis-group-${group.classId}`}>
          <div
            class="grp"
            style="padding:6px 12px 4px;background:var(--panel-in);border-bottom:1px solid var(--line);border-top:1px solid var(--line);display:flex;align-items:baseline;justify-content:space-between;gap:8px"
          >
            <span class="t-label">{group.className.toUpperCase()}</span>
            <span class="mono-xs">{layoutHint(group.layout)}</span>
          </div>
          {group.chassis.map((chassis) => {
            const isSelected = chassis.id === selectedId;
            const glyph = CLASS_GLYPH[group.classId];
            // As in ComponentPicker: the row is a `<div role="button">` so
            // the InfoTip's own <button> can nest inside as valid HTML
            // (nested <button> is illegal). Keyboard: Enter / Space fires
            // onPick, matching the previous button semantics.
            return (
              <div
                key={chassis.id}
                class={isSelected ? 'row is-selected' : 'row'}
                role="button"
                aria-current={isSelected ? 'true' : undefined}
                tabIndex={0}
                data-testid={`shipyard-chassis-${chassis.id}`}
                onClick={() => onPick(chassis)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    onPick(chassis);
                  }
                }}
                style="width:100%;text-align:left"
              >
                <span
                  class="tag-slot"
                  aria-hidden="true"
                  style={`color:${glyph.color}`}
                >
                  {glyph.letter}
                </span>
                <span class="grow">
                  <span class="c-hi" style="font-size:12px;font-weight:700">
                    {chassis.name.toUpperCase()}
                  </span>
                  <ChassisMeta chassis={chassis} />
                </span>
                <span
                  class="row-cost"
                  style="font-size:12px;font-weight:700;color:var(--amber);flex:none;width:40px;text-align:right"
                >
                  {chassis.pointCost}
                  <span class="mono-xs c-dim">pt</span>
                </span>
                {/*
                  See ComponentPicker's InfoTip block: stopPropagation
                  keeps a tip-glyph click from bubbling up to onPick.
                */}
                <span
                  onClick={(ev) => {
                    ev.stopPropagation();
                  }}
                  onKeyDown={(ev) => {
                    ev.stopPropagation();
                  }}
                  style="flex:none"
                >
                  <InfoTip
                    id={`tip-${chassis.id}`}
                    label={infoFor(chassis.id) ?? chassis.name}
                  />
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
