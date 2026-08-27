// M14 UI — shared all-fleets roster (skirmish-tactical-parity SESSION-02 CP2).
//
// The FR-15 "lists all fleets — player and every bot — grouped by owner" panel.
// Consumes the pure model's `FleetGroup[]` (see `./model.ts`); both tactical
// screens (S03 move, S04 attack) mount this over `groupByFleet(view.ships, …)`
// and wire `onSelect(bodyId)` to `focusBody` + their own selection state.
//
// The `annotate(entry)` prop is the per-screen slot: on the movement screen it
// paints a PLANNED / COAST / EXIT status; on the attack screen it paints the
// SHOOTER / TARGETED / AoE context. This component itself is opinion-free
// beyond selection + destruction — it never invents fire-plan or arc state.
//
// A11y (design §1.1 never-color-alone): every fleet header carries the glyph
// via `FleetGlyph` (glyph + text + color); every pip carries the label letter
// AND an `aria-label` naming its state (`W1 · destroyed`); every row is either
// a real `<button>` (selectable, `aria-pressed`) or an `is-dead` non-interactive
// row struck through by the shipped `.row.is-dead` style — a colorblind player
// loses zero information.

import type { ComponentChildren } from 'preact';

import { FleetGlyph, Meter, type FleetId } from '../index.js';

import type { FleetGroup, PipState, RosterEntry, ShipPip } from './model.js';

const isFleetId = (id: number): id is FleetId =>
  id === 0 || id === 1 || id === 2 || id === 3 || id === 4;

const classLabel = (chassisClass: string): string =>
  chassisClass.replace('-', ' ').toUpperCase();

const pipStateLabel = (state: PipState): string =>
  state === 'online' ? 'online' : 'destroyed';

/** The `.pip-on` / `.pip-off` token classes carry the color; the letter label
 *  + `aria-label` carry the meaning without it (never-color-alone). */
function Pip({ pip }: { readonly pip: ShipPip }) {
  const stateLabel = pipStateLabel(pip.state);
  const cls = pip.state === 'online' ? 'pip-on' : 'pip-off';
  return (
    <span
      data-testid="ship-pip"
      class={cls}
      aria-label={`${pip.label} ${stateLabel}`}
      title={`${pip.label} · ${stateLabel.toUpperCase()}`}
      style={pip.state === 'destroyed' ? 'text-decoration:line-through' : undefined}
    >
      {pip.label}
    </span>
  );
}

/** The `W1 W2 SHLD M1 ENG` strip — index-based labels only (the sim carries
 *  no per-component product name; recorded S06 limitation). */
function PipStrip({ pips }: { readonly pips: readonly ShipPip[] }) {
  return (
    <span
      class="pips"
      data-testid="ship-pips"
      style="display:inline-flex;flex-wrap:wrap;gap:6px;font-size:10px;font-weight:700;letter-spacing:.14em"
    >
      {pips.map((p) => (
        <Pip key={`${p.kind}:${String(p.index)}`} pip={p} />
      ))}
    </span>
  );
}

function FleetHeader({ group }: { readonly group: FleetGroup }) {
  const colorStyle = isFleetId(group.fleetId)
    ? `color:var(--fleet-${String(group.fleetId)})`
    : undefined;
  const living = group.entries.reduce((n, e) => (e.alive ? n + 1 : n), 0);
  return (
    <div
      class="panel-hd"
      data-testid="fleet-group-header"
      style="background:var(--panel-in);border-top:1px solid var(--line)"
    >
      {isFleetId(group.fleetId) ? <FleetGlyph fleetId={group.fleetId} /> : null}
      <span class="t-h2" style={colorStyle}>{group.label}</span>
      <span class="grow" />
      <span class="mono-xs">
        <span class="c-hi">{String(living)}</span> / {String(group.entries.length)} ALIVE
      </span>
    </div>
  );
}

/** One ship row inside a fleet section. Living rows are `<button>` and reach
 *  the `onSelect` callback; destroyed rows are struck-through `<div>`s that
 *  cannot be focused — the FR-15 "click a ship" contract lives on the button. */
function ShipRow({
  entry,
  isSelected,
  onSelect,
  annotate,
}: {
  readonly entry: RosterEntry;
  readonly isSelected: boolean;
  readonly onSelect: (bodyId: number) => void;
  readonly annotate?: (entry: RosterEntry) => ComponentChildren;
}) {
  const meta = (
    <span class="mono-xs c-dim" style="letter-spacing:.14em">
      {classLabel(entry.chassisClass)}
    </span>
  );
  const glyph = isFleetId(entry.fleetId) ? <FleetGlyph fleetId={entry.fleetId} /> : null;
  const body = (
    <>
      <div style="display:flex;align-items:center;gap:var(--s2);width:100%">
        {glyph}
        <span class="row-name c-hi" style="font-weight:700;letter-spacing:.05em">
          {entry.name}
        </span>
        {meta}
        <span class="grow" />
        {annotate !== undefined ? annotate(entry) : null}
      </div>
      {entry.alive ? (
        <div style="display:flex;flex-direction:column;gap:4px;width:100%;padding-left:26px">
          <div style="display:flex;align-items:center;gap:6px">
            <span class="t-label" style="width:36px;flex:none">SHLD</span>
            <Meter
              value={entry.shields}
              max={entry.shieldCapacity}
              fill="shield"
              compact
              aria-label={`Shields ${String(entry.shields)} of ${String(entry.shieldCapacity)}`}
            />
            <span class="mono-xs c-dim" style="flex:none;min-width:52px;text-align:right">
              {String(entry.shields)} / {String(entry.shieldCapacity)}
            </span>
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            <span class="t-label" style="width:36px;flex:none">HULL</span>
            <Meter
              value={entry.hull}
              max={entry.maxHull}
              fill="hull"
              compact
              aria-label={`Hull ${String(entry.hull)} of ${String(entry.maxHull)}`}
            />
            <span class="mono-xs c-dim" style="flex:none;min-width:52px;text-align:right">
              {String(entry.hull)} / {String(entry.maxHull)}
            </span>
          </div>
          <PipStrip pips={entry.pips} />
        </div>
      ) : (
        <div style="display:flex;flex-direction:column;gap:4px;width:100%;padding-left:26px">
          <span class="mono-xs c-red" style="letter-spacing:.2em">
            ✕ DESTROYED
          </span>
          <PipStrip pips={entry.pips} />
        </div>
      )}
    </>
  );

  if (!entry.alive) {
    return (
      <div
        class="row is-dead"
        data-testid="roster-ship-dead"
        data-ship-id={String(entry.bodyId)}
        data-fleet-id={String(entry.fleetId)}
        style="display:flex;flex-direction:column;align-items:stretch;gap:5px;cursor:default"
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      class={`row${isSelected ? ' is-selected' : ''}`}
      data-testid="roster-ship"
      data-ship-id={String(entry.bodyId)}
      data-fleet-id={String(entry.fleetId)}
      aria-pressed={isSelected}
      aria-label={`${entry.name}, ${classLabel(entry.chassisClass)}`}
      onClick={() => onSelect(entry.bodyId)}
      style="display:flex;flex-direction:column;align-items:stretch;gap:5px;width:100%;text-align:left;font:inherit;color:inherit"
    >
      {body}
    </button>
  );
}

// ---- Public component -----------------------------------------------------

export interface FleetRosterProps {
  readonly groups: readonly FleetGroup[];
  readonly selectedId: number | null;
  readonly onSelect: (bodyId: number) => void;
  /** Per-screen annotation slot: movement paints a PLANNED / COAST badge;
   *  attack paints TARGETED / AoE context. Rendered inside the row header. */
  readonly annotate?: (entry: RosterEntry) => ComponentChildren;
  /** Optional accessible name for the enclosing `<aside>`. */
  readonly 'aria-label'?: string;
}

/**
 * The shared all-fleets roster. `groups` is the deterministic ordering from
 * `groupByFleet`; this component adds no ordering of its own. Selecting a
 * living row invokes `onSelect(bodyId)` — the caller focuses the camera and
 * (on the attack screen) opens the fire bench.
 */
export function FleetRoster(props: FleetRosterProps) {
  const { groups, selectedId, onSelect, annotate } = props;
  const ariaLabel = props['aria-label'] ?? 'Fleet roster';
  return (
    <aside data-testid="fleet-roster" aria-label={ariaLabel}>
      <div class="mono-xs c-dim" style="padding:6px var(--s3);letter-spacing:.14em">
        FULL STATE FOR ALL FLEETS · NO FOG OF WAR
      </div>
      {groups.map((group) => (
        <section
          key={String(group.fleetId)}
          data-testid="fleet-group"
          data-fleet-id={String(group.fleetId)}
          data-fleet-role={group.isPlayer ? 'player' : 'bot'}
        >
          <FleetHeader group={group} />
          <div style="display:flex;flex-direction:column">
            {group.entries.map((entry) => (
              <ShipRow
                key={String(entry.bodyId)}
                entry={entry}
                isSelected={selectedId === entry.bodyId}
                onSelect={onSelect}
                annotate={annotate}
              />
            ))}
          </div>
        </section>
      ))}
    </aside>
  );
}
