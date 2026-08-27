// M14 UI — Post-match FLEETS & FATES: every ship of every fleet, its fate.
//
// Per-fleet panels sourced from `perShipFates` — survivors carry live hull, the
// fallen carry their cause of death. Fleet ownership rides the never-color-alone
// `FleetGlyph` (glyph + label, not hue). All ship names render as text nodes.

import {
  Chip,
  FleetGlyph,
  FLEET_META,
  Panel,
  PanelHeader,
  type FleetId,
} from '../../components/index.js';

import { fateLabel, type FateRow, type FleetFates } from './model.js';

const classLabel = (chassisClass: string): string =>
  chassisClass.replace('-', ' ').toUpperCase();

/** Fate colour lane: survived (green), fire kill (red), environmental (amber). */
const fateToneClass = (row: FateRow): string => {
  if (row.fate === 'alive') return 'c-green';
  if (row.cause === 'collision' || row.cause === 'aoe' || row.cause === 'boundary') {
    return 'c-amber';
  }
  return 'c-red';
};

const fleetLabel = (fleetId: number): string =>
  fleetId in FLEET_META ? FLEET_META[fleetId as FleetId].label : `FLEET ${String(fleetId)}`;

export interface FleetsAndFatesProps {
  readonly fleets: readonly FleetFates[];
}

export function FleetsAndFates(props: FleetsAndFatesProps) {
  return (
    <section>
      <div style="display:flex;align-items:baseline;gap:var(--s3);margin-bottom:var(--s3)">
        <h2 class="t-h1">FLEETS &amp; FATES</h2>
        <span class="mono-xs">EVERY SHIP, EVERY CAUSE OF DEATH</span>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:var(--s3)">
        {props.fleets.map((fleet) => (
          <Panel key={fleet.fleetId} ticks>
            <PanelHeader>
              <FleetGlyph fleetId={fleet.fleetId as FleetId} />
              <span
                class="t-h2 grow"
                style={`color:var(--fleet-${String(fleet.fleetId)})`}
              >
                {fleetLabel(fleet.fleetId)}
              </span>
              <Chip tone={fleet.survivors > 0 ? 'green' : 'red'}>
                {fleet.survivors > 0
                  ? `${String(fleet.survivors)} / ${String(fleet.total)} SURVIVING`
                  : 'ELIMINATED'}
              </Chip>
            </PanelHeader>

            <div class="panel-bd">
              {fleet.rows.map((row) => (
                <div
                  key={row.bodyId}
                  data-testid="fate-row"
                  style="display:flex;align-items:center;gap:var(--s2);padding:var(--s2) 0;border-bottom:1px solid var(--line)"
                >
                  <div class="grow" style="min-width:0">
                    <div class="c-hi truncate" style="font-weight:700;letter-spacing:.05em">
                      {row.name}
                    </div>
                    <div class="mono-xs">
                      {`${classLabel(row.chassisClass)} · HULL ${String(row.hull)} / ${String(row.maxHull)}`}
                    </div>
                  </div>
                  <span class={`t-label ${fateToneClass(row)}`} style="flex:none">
                    {fateLabel(row)}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        ))}
      </div>
    </section>
  );
}
