// M14 UI — Shipyard component picker (S05, CP2).
//
// The LEFT column's per-slot-type tab pane. Lists every component fittable
// in the currently-selected slot type via `catalog.componentsForSlot(type)`,
// with cost + key stats + a "▸ FITTED" chip on entries already fitted in the
// working build. Click → apply via `withSlot(build, index, componentId)`.
//
// Stateless: parent (`Shipyard.tsx`) owns the working Build and the
// selected-bay signal.

import type {
  Catalog,
  ComponentDef,
  EngineDef,
  MissileDef,
  ShieldDef,
  SlotType,
  SpecialDef,
  WeaponDef,
} from '../../../catalog/index.js';
import type { Build } from '../../../domain/index.js';
import { SlotTag } from '../../components/index.js';

interface ComponentPickerProps {
  readonly catalog: Catalog;
  readonly build: Build;
  readonly slotType: SlotType;
  /** Bay to fit into; -1 or null means no bay selected → picker is display-only. */
  readonly targetBay: number | null;
  readonly onPick: (component: ComponentDef) => void;
}

/** Per-slot-type formatter — the mock's mono-xs sub-line. */
function statsLine(c: ComponentDef): string {
  switch (c.slotType) {
    case 'weapon': {
      const w = c as WeaponDef;
      return `R ${w.stats.range} · D ${w.stats.damage} · ×${w.stats.shotsPerTurn} · ACC ${w.stats.accuracy.toFixed(2)}`;
    }
    case 'shield': {
      const s = c as ShieldDef;
      return `CAP ${s.stats.capacity} · REGEN ${s.stats.regenPerTurn}/T`;
    }
    case 'missile': {
      const m = c as MissileDef;
      return `AMMO ${m.stats.ammo} · DMG ${m.stats.damage} · AOE ${m.stats.aoeRadius} · BOOST ${m.stats.boostVelocity}`;
    }
    case 'engine': {
      const e = c as EngineDef;
      return `ΔV IMPULSE ${e.stats.thrustImpulse}`;
    }
    case 'special': {
      const sp = c as SpecialDef;
      switch (sp.stats.effect) {
        case 'armor-plating':
          return `+${sp.stats.bonusHull} HULL`;
        case 'thrust-booster':
          return `+${sp.stats.thrustImpulseBonus} ΔV IMPULSE`;
        case 'damage-control':
          return `REPAIRS ${sp.stats.hullRepairPerTurn} HULL / TURN`;
        case 'decoy-launcher':
          return `${sp.stats.charges} CHARGE(S) · +${sp.stats.evasionBonus.toFixed(2)} EV · ${sp.stats.durationTurns} TURN(S)`;
        case 'point-defense':
          return `RANGE ${sp.stats.interceptRange} · ${(sp.stats.interceptChance * 100).toFixed(0)}% · ${sp.stats.interceptsPerTurn}/T`;
      }
    }
  }
}

const TYPE_TITLE: Record<SlotType, string> = {
  weapon: 'WEAPON',
  shield: 'SHIELD',
  missile: 'MISSILE',
  engine: 'ENGINE',
  special: 'SPECIAL',
};

export function ComponentPicker(props: ComponentPickerProps) {
  const { catalog, build, slotType, targetBay, onPick } = props;
  const components = catalog.componentsForSlot(slotType);
  // Which components are ALREADY in the build (for the "▸ FITTED" chip)?
  const fittedIds = new Set<string>();
  for (const s of build.slots) if (s !== null) fittedIds.add(s);
  const bayFittedId =
    targetBay !== null ? (build.slots[targetBay] ?? null) : null;

  return (
    <div class="tabpane" data-testid={`shipyard-picker-pane-${slotType}`}>
      <div
        class="grp"
        style="padding:6px 12px 4px;background:var(--panel-in);border-bottom:1px solid var(--line);border-top:1px solid var(--line);display:flex;align-items:baseline;justify-content:space-between;gap:8px"
      >
        <span class="t-label">
          {TYPE_TITLE[slotType]} · {components.length} ENTRIES
        </span>
        <span class="mono-xs">
          {targetBay === null ? 'SELECT A BAY BELOW' : `FIT INTO BAY #${targetBay + 1}`}
        </span>
      </div>
      {components.map((c) => {
        const isFitted = fittedIds.has(c.id);
        const isBayFit = bayFittedId === c.id;
        return (
          <button
            key={c.id}
            type="button"
            class={isBayFit ? 'row is-selected' : 'row'}
            aria-current={isBayFit ? 'true' : undefined}
            data-testid={`shipyard-component-${c.id}`}
            disabled={targetBay === null}
            onClick={() => onPick(c)}
            style="width:100%;text-align:left"
          >
            <SlotTag type={slotType} />
            <span class="grow">
              <span class="c-hi" style="font-size:12px;font-weight:700">
                {c.name.toUpperCase()}
                {isFitted ? (
                  <span
                    class="chip chip-cyan"
                    style="height:15px;padding:0 6px;font-size:9px;margin-left:6px"
                  >
                    ▸ FITTED
                  </span>
                ) : null}
              </span>
              <span class="mono-xs" style="display:block">
                {statsLine(c)} · {c.id}
              </span>
            </span>
            <span
              class="row-cost"
              style="font-size:12px;font-weight:700;color:var(--amber);flex:none;width:40px;text-align:right"
            >
              {c.pointCost}
              <span class="mono-xs c-dim">pt</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
