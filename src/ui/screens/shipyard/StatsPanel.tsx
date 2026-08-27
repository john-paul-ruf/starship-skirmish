// M14 UI — Shipyard derived-stats panel (S05, CP3).
//
// FR-6 readout of the working build's derived stats — every field the
// domain module exposes (`maxHull`, `shieldCapacity`, `shieldRegenPerTurn`,
// `deltaVPerTurn`, `effectiveAcceleration`, `totalMissileAmmo`,
// `perTurnHullRepair`, `baseEvasion`, `totalMass`), plus per-weapon
// readouts. Each row carries a `Delta` primitive against the previous fit
// (FR-6: color + arrow + sign, never color alone; design §1.1).
//
// Stateless: parent (`Shipyard.tsx`) owns the previous-stats snapshot and
// hands it in.

import type { DerivedStats } from '../../../domain/index.js';
import { Delta, Panel, PanelHeader, StatRow } from '../../components/index.js';

import type { StatsDelta } from './model.js';

interface StatsPanelProps {
  readonly stats: DerivedStats | null;
  readonly delta: StatsDelta;
}

/** A single stat row: label · Δ · numeric value with optional trailing unit. */
function StatWithDelta(props: {
  label: string;
  from: number;
  to: number;
  precision?: number;
  unit?: string;
  displayUnit?: string;
  testid: string;
}) {
  const {
    label,
    from,
    to,
    precision = 0,
    unit = '',
    displayUnit,
    testid,
  } = props;
  const shown = to.toFixed(precision);
  const trailing = displayUnit ?? '';
  return (
    <div class="stat">
      <span class="stat-k">{label}</span>
      <span
        style="display:flex;align-items:baseline;gap:8px"
        data-testid={testid}
      >
        <Delta from={from} to={to} unit={unit} precision={precision} />
        <span class="stat-v">
          {shown}
          {trailing !== '' ? <span class="mono-xs"> {trailing}</span> : null}
        </span>
      </span>
    </div>
  );
}

export function StatsPanel(props: StatsPanelProps) {
  const { stats, delta } = props;
  return (
    <Panel ticks class="stats-panel">
      <PanelHeader title="DERIVED">
        <span class="grow" />
        <span class="mono-xs">Δ VS PRE-CHANGE</span>
      </PanelHeader>
      <div class="panel-bd" style="padding-top:6px;padding-bottom:6px">
        {stats === null ? (
          <div class="mono-xs c-dim" style="padding:6px 0" data-testid="shipyard-stats-empty">
            NO VALID FIT — RESOLVE FIT ISSUES TO SEE DERIVED STATS.
          </div>
        ) : (
          <>
            <StatWithDelta
              label="TOTAL HULL"
              from={delta.maxHull.from}
              to={delta.maxHull.to}
              testid="shipyard-stat-maxHull"
            />
            <StatWithDelta
              label="SHIELD CAP"
              from={delta.shieldCapacity.from}
              to={delta.shieldCapacity.to}
              testid="shipyard-stat-shieldCapacity"
            />
            <StatWithDelta
              label="SHIELD REGEN"
              from={delta.shieldRegenPerTurn.from}
              to={delta.shieldRegenPerTurn.to}
              displayUnit="/turn"
              testid="shipyard-stat-shieldRegen"
            />
            <StatWithDelta
              label="DELTA-V"
              from={delta.deltaVPerTurn.from}
              to={delta.deltaVPerTurn.to}
              precision={2}
              displayUnit="/turn"
              testid="shipyard-stat-deltaV"
            />
            <StatWithDelta
              label="MASS"
              from={delta.totalMass.from}
              to={delta.totalMass.to}
              testid="shipyard-stat-mass"
            />
            <StatWithDelta
              label="EFFECTIVE ACCEL"
              from={delta.effectiveAcceleration.from}
              to={delta.effectiveAcceleration.to}
              precision={2}
              testid="shipyard-stat-accel"
            />
            <StatWithDelta
              label="MISSILE AMMO"
              from={delta.totalMissileAmmo.from}
              to={delta.totalMissileAmmo.to}
              testid="shipyard-stat-missileAmmo"
            />
            <StatWithDelta
              label="EVASION"
              from={delta.baseEvasion.from}
              to={delta.baseEvasion.to}
              precision={2}
              testid="shipyard-stat-evasion"
            />
            <StatWithDelta
              label="HULL REPAIR / T"
              from={delta.perTurnHullRepair.from}
              to={delta.perTurnHullRepair.to}
              testid="shipyard-stat-hullRepair"
            />
            {stats.weapons.length > 0 ? (
              <PerWeaponTable weapons={stats.weapons} />
            ) : (
              <div class="mono-xs c-dim" style="padding:6px 0" data-testid="shipyard-per-weapon-empty">
                NO WEAPONS FITTED.
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

function PerWeaponTable(props: {
  weapons: DerivedStats['weapons'];
}) {
  const { weapons } = props;
  let expectedDPT = 0;
  for (const w of weapons) {
    expectedDPT += w.damage * w.shotsPerTurn * w.accuracy;
  }
  return (
    <div style="margin-top:8px" data-testid="shipyard-per-weapon">
      <div style="display:flex;align-items:baseline;gap:8px">
        <span class="t-h2" style="font-size:11px">PER-WEAPON</span>
        <span class="grow" />
        <span class="mono-xs">
          EXPECTED DPT{' '}
          <span class="c-hi" style="font-weight:700">
            {expectedDPT.toFixed(1)}
          </span>
        </span>
      </div>
      <StatRow label="COUNT" value={String(weapons.length)} />
      {weapons.map((w, i) => (
        <StatRow
          key={`${w.name}-${i}`}
          label={w.name.toUpperCase()}
          value={`R ${w.range} · D ${w.damage} · ×${w.shotsPerTurn} · ACC ${w.accuracy.toFixed(2)}`}
        />
      ))}
    </div>
  );
}
