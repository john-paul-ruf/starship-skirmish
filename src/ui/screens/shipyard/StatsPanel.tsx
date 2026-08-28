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
//
// Playtest-feedback-01 · S06: every row now carries an `InfoTip` sourced
// from the components-library `GLOSSARY`. Wiring rule — `tipKey` is a
// `GlossaryKey`, so a stat with no matching glossary entry fails to
// typecheck (the glossary can't drift silently from the DerivedStats
// surface). Tip id derives from the row testid to keep AT associations
// unique on the page.

import type { DerivedStats } from '../../../domain/index.js';
import {
  Delta,
  GLOSSARY,
  InfoTip,
  Panel,
  PanelHeader,
  StatRow,
  type GlossaryKey,
} from '../../components/index.js';

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
  tipKey?: GlossaryKey;
}) {
  const {
    label,
    from,
    to,
    precision = 0,
    unit = '',
    displayUnit,
    testid,
    tipKey,
  } = props;
  const shown = to.toFixed(precision);
  const trailing = displayUnit ?? '';
  return (
    <div class="stat">
      <span class="stat-k">
        {label}
        {tipKey !== undefined ? (
          <InfoTip id={`tip-${testid}`} label={GLOSSARY[tipKey]} />
        ) : null}
      </span>
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
              tipKey="maxHull"
            />
            <StatWithDelta
              label="SHIELD CAP"
              from={delta.shieldCapacity.from}
              to={delta.shieldCapacity.to}
              testid="shipyard-stat-shieldCapacity"
              tipKey="shieldCapacity"
            />
            <StatWithDelta
              label="SHIELD REGEN"
              from={delta.shieldRegenPerTurn.from}
              to={delta.shieldRegenPerTurn.to}
              displayUnit="/turn"
              testid="shipyard-stat-shieldRegen"
              tipKey="shieldRegenPerTurn"
            />
            <StatWithDelta
              label="DELTA-V"
              from={delta.deltaVPerTurn.from}
              to={delta.deltaVPerTurn.to}
              precision={2}
              displayUnit="/turn"
              testid="shipyard-stat-deltaV"
              tipKey="deltaVPerTurn"
            />
            <StatWithDelta
              label="MASS"
              from={delta.totalMass.from}
              to={delta.totalMass.to}
              testid="shipyard-stat-mass"
              tipKey="totalMass"
            />
            <StatWithDelta
              label="EFFECTIVE ACCEL"
              from={delta.effectiveAcceleration.from}
              to={delta.effectiveAcceleration.to}
              precision={2}
              testid="shipyard-stat-accel"
              tipKey="effectiveAcceleration"
            />
            <StatWithDelta
              label="MISSILE AMMO"
              from={delta.totalMissileAmmo.from}
              to={delta.totalMissileAmmo.to}
              testid="shipyard-stat-missileAmmo"
              tipKey="totalMissileAmmo"
            />
            <StatWithDelta
              label="EVASION"
              from={delta.baseEvasion.from}
              to={delta.baseEvasion.to}
              precision={2}
              testid="shipyard-stat-evasion"
              tipKey="baseEvasion"
            />
            <StatWithDelta
              label="HULL REPAIR / T"
              from={delta.perTurnHullRepair.from}
              to={delta.perTurnHullRepair.to}
              testid="shipyard-stat-hullRepair"
              tipKey="perTurnHullRepair"
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
        <span class="t-h2" style="font-size:11px">
          PER-WEAPON
          <InfoTip
            id="tip-shipyard-per-weapon-legend"
            label={GLOSSARY.weaponSpec}
          />
        </span>
        <span class="grow" />
        <span class="mono-xs">
          EXPECTED DPT{' '}
          <InfoTip
            id="tip-shipyard-per-weapon-expectedDpt"
            label={GLOSSARY.expectedDpt}
          />{' '}
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
