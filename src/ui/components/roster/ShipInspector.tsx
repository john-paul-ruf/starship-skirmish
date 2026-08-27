// M14 UI — shared ship inspector (skirmish-tactical-parity SESSION-02 CP3).
//
// Design §5's "ship inspector" panel — the read-only detail view every screen
// mounts alongside `FleetRoster`. Displays hull, shields, class, and per-slot
// component state for whatever ship the caller has selected — ANY fleet, no
// fog (Decision 6 / FR-15). If `ship` is null it renders a quiet
// "SELECT A SHIP" empty state so a screen can mount the inspector before any
// selection exists.
//
// Weapon / missile / point-defense / decoy detail lists reuse the sim's
// per-index ordering (matches `pipsFor` and every prior UI). Destroyed
// components struck through with the `--red` token — the same never-color-
// alone treatment (glyph + text + color) the pips carry, so the destruction
// state reads on a colorblind display.

import { FleetGlyph, Meter, StatRow, type FleetId } from '../index.js';

import { pipsFor, type PipState } from './model.js';

import type { BlindShipView } from '../../../sim/index.js';

const isFleetId = (id: number): id is FleetId =>
  id === 0 || id === 1 || id === 2 || id === 3 || id === 4;

const classLabel = (chassisClass: string): string =>
  chassisClass.replace('-', ' ').toUpperCase();

const stateWord = (state: PipState): string =>
  state === 'online' ? 'ONLINE' : 'DESTROYED';

const speedOf = (v: { readonly x: number; readonly y: number; readonly z: number }): number => {
  // deterministic-free distance — components magnitude via multiply + add + sqrt.
  const m = v.x * v.x + v.y * v.y + v.z * v.z;
  return Math.sqrt(m);
};

/** One row in a subsystem list: label + state, struck through when destroyed.
 *  `aria-label` names both the label and the state so a colorblind reader hears
 *  the destruction state alongside the letter. */
function InspectorPip({
  label,
  state,
  detail,
}: {
  readonly label: string;
  readonly state: PipState;
  readonly detail?: string;
}) {
  const dead = state === 'destroyed';
  return (
    <div
      data-testid="inspector-pip"
      data-pip-state={state}
      style="display:flex;align-items:center;gap:var(--s2);padding:3px 0;border-bottom:1px solid var(--line)"
    >
      <span
        class={dead ? 'c-red' : 'c-hi'}
        style={`font-weight:700;letter-spacing:.16em;min-width:56px${dead ? ';text-decoration:line-through' : ''}`}
      >
        {label}
      </span>
      <span class="grow" />
      {detail !== undefined ? (
        <span class="mono-xs c-dim" style="letter-spacing:.12em">
          {detail}
        </span>
      ) : null}
      <span
        class={dead ? 'c-red' : 'c-green'}
        aria-label={`${label} ${stateWord(state).toLowerCase()}`}
        style="letter-spacing:.16em;font-size:10px;font-weight:700"
      >
        {stateWord(state)}
      </span>
    </div>
  );
}

export interface ShipInspectorProps {
  /** The selected ship (any fleet), or null → empty state. */
  readonly ship: BlindShipView | null;
  /** Optional live velocity from `state.bodies` (a match state read-through).
   *  When supplied, the inspector shows the current speed magnitude. */
  readonly velocity?: { readonly x: number; readonly y: number; readonly z: number } | null;
}

/**
 * Read-only detail for the selected ship. Renders nothing writeable — every
 * button lives on the parent screen (fire assignments in S04, arc plotting in
 * S03). The pip grid + subsystem lists reuse `pipsFor` so the roster and the
 * inspector never disagree on which subsystems are alive.
 */
export function ShipInspector(props: ShipInspectorProps) {
  const { ship, velocity } = props;

  if (ship === null) {
    return (
      <section
        data-testid="ship-inspector"
        aria-label="Ship inspector"
        class="panel"
        style="padding:var(--s3)"
      >
        <div
          data-testid="inspector-empty"
          class="mono-xs c-dim"
          style="text-align:center;padding:var(--s4) 0;letter-spacing:.2em"
        >
          SELECT A SHIP
        </div>
      </section>
    );
  }

  const pips = pipsFor(ship);
  const weaponPips = pips.filter((p) => p.kind === 'weapon');
  const shieldPip = pips.find((p) => p.kind === 'shield');
  const missilePips = pips.filter((p) => p.kind === 'missile');
  const pdPips = pips.filter((p) => p.kind === 'pd');
  const decoyPips = pips.filter((p) => p.kind === 'decoy');
  const enginePip = pips.find((p) => p.kind === 'engine');
  const glyph = isFleetId(ship.fleetId) ? <FleetGlyph fleetId={ship.fleetId} /> : null;
  const speed = velocity !== undefined && velocity !== null ? speedOf(velocity) : null;

  return (
    <section
      data-testid="ship-inspector"
      data-ship-id={String(ship.bodyId)}
      aria-label={`Ship inspector — ${ship.name}`}
      class="panel"
      style="padding:var(--s3);display:flex;flex-direction:column;gap:var(--s3)"
    >
      <header style="display:flex;align-items:center;gap:var(--s2)">
        {glyph}
        <span class="t-h1 c-hi">{ship.name}</span>
        <span class="grow" />
        <span class="mono-xs c-dim" style="letter-spacing:.14em">
          {classLabel(ship.chassisClass)}
        </span>
      </header>

      <div style="display:flex;flex-direction:column;gap:var(--s2)">
        <div style="display:flex;align-items:center;gap:var(--s2)">
          <span class="t-label" style="width:44px;flex:none">HULL</span>
          <Meter
            value={ship.hull}
            max={ship.maxHull}
            fill="hull"
            compact
            aria-label={`Hull ${String(ship.hull)} of ${String(ship.maxHull)}`}
          />
          <span class="mono-xs c-hi" style="min-width:72px;text-align:right;letter-spacing:.14em">
            {String(ship.hull)} / {String(ship.maxHull)}
          </span>
        </div>
        <div style="display:flex;align-items:center;gap:var(--s2)">
          <span class="t-label" style="width:44px;flex:none">SHLD</span>
          <Meter
            value={ship.shields}
            max={ship.shieldCapacity}
            fill="shield"
            compact
            aria-label={`Shields ${String(ship.shields)} of ${String(ship.shieldCapacity)}`}
          />
          <span class="mono-xs c-hi" style="min-width:72px;text-align:right;letter-spacing:.14em">
            {String(ship.shields)} / {String(ship.shieldCapacity)}
          </span>
        </div>
        {speed !== null ? (
          <StatRow label="SPEED" value={`${speed.toFixed(1)} u/t`} />
        ) : null}
      </div>

      {weaponPips.length > 0 ? (
        <div>
          <div class="t-label" style="margin-bottom:5px">WEAPONS</div>
          {weaponPips.map((p, i) => (
            <InspectorPip
              key={p.label}
              label={p.label}
              state={p.state}
              detail={ship.ship.weapons[i] !== undefined
                ? `DMG ${String(ship.ship.weapons[i]!.damage)} · RNG ${String(ship.ship.weapons[i]!.range)}`
                : undefined}
            />
          ))}
        </div>
      ) : null}

      {missilePips.length > 0 ? (
        <div>
          <div class="t-label" style="margin-bottom:5px">MISSILES</div>
          {missilePips.map((p, i) => (
            <InspectorPip
              key={p.label}
              label={p.label}
              state={p.state}
              detail={`AMMO ${String(ship.missileAmmo[i] ?? 0)}`}
            />
          ))}
        </div>
      ) : null}

      {pdPips.length > 0 ? (
        <div>
          <div class="t-label" style="margin-bottom:5px">POINT DEFENSE</div>
          {pdPips.map((p) => (
            <InspectorPip key={p.label} label={p.label} state={p.state} />
          ))}
        </div>
      ) : null}

      {decoyPips.length > 0 ? (
        <div>
          <div class="t-label" style="margin-bottom:5px">DECOYS</div>
          {decoyPips.map((p, i) => (
            <InspectorPip
              key={p.label}
              label={p.label}
              state={p.state}
              detail={`CHARGES ${String(ship.decoyCharges[i] ?? 0)}`}
            />
          ))}
        </div>
      ) : null}

      {shieldPip !== undefined || enginePip !== undefined ? (
        <div>
          <div class="t-label" style="margin-bottom:5px">CORE</div>
          {shieldPip !== undefined ? (
            <InspectorPip label={shieldPip.label} state={shieldPip.state} />
          ) : null}
          {enginePip !== undefined ? (
            <InspectorPip label={enginePip.label} state={enginePip.state} />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
