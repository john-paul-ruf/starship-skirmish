// M14 UI — Tactical Attack weapon bench (tactical-attack-mock-parity SESSION-03).
//
// The right fire rail renders ONE active shooter (D-TA-RAIL-SHOOTER), not every
// player ship in one long scroll — navigation between shooters is the all-fleet
// roster on the left. Each of the active shooter's live fire slots (one intact
// weapon / one loaded missile rack — dead + spent slots excluded, never
// disabled, model.liveFireSlots) is a card carrying a target picker over living
// enemies. A weapon row with a chosen target renders the hit-chance BREAKDOWN
// read straight from `hitChanceFor` — the base accuracy and the range /
// target-velocity / target-evasion factors it returns, down to a final %. The %
// is NEVER computed here (arch §13.3): the formula lives in `sim/rules`,
// single-sourced through the controller seam.
//
// Card + option names come from SESSION-01 display identity where present
// (`weapon.display?.name`, `rack.display?.name`, `ship.chassis?.name`) with a
// text-first index fallback for synthetic / legacy fixtures.

import type { ComponentChildren } from 'preact';

import type {
  BlindMatchView,
  BlindShipView,
  BodyId,
  HitChanceBreakdown,
} from '../../../sim/index.js';
import { distance } from '../../../sim/mathx/index.js';
import { FLEET_META, Meter, Select } from '../../components/index.js';
import type { SelectOption } from '../../components/index.js';

import {
  enemyShips,
  hitChanceBarFill,
  hitChanceTone,
  liveFireSlots,
  positionOf,
  slotKey,
  weaponOutOfRange,
  type Assignment,
  type FireSlot,
} from './model.js';

const HOLD = '__hold__';

const pct = (v: number): string => `${String(Math.round(v * 100))}%`;
/** Signed factor readout, e.g. `+0.08` / `−0.05`. Uses a real minus glyph. */
const signed = (v: number): string =>
  v < 0 ? `−${(-v).toFixed(2)}` : `+${v.toFixed(2)}`;

/** Uppercase class label with the hyphen spaced out (mega-destroyer → MEGA DESTROYER). */
const classLabel = (chassisClass: string): string =>
  chassisClass.replace('-', ' ').toUpperCase();

/** A fleet's glyph char for plain-text `<select>` options (never colour-alone:
 *  the glyph is one channel, the ship name + range text carry the rest). */
const fleetGlyphOf = (fleetId: number): string => {
  const meta = (FLEET_META as Record<number, { glyph: string } | undefined>)[fleetId];
  return meta?.glyph ?? '◆';
};

/** Authored chassis name, or the uppercase class as a legacy-safe fallback. */
const chassisNameOf = (ship: BlindShipView): string =>
  ship.ship.chassis?.name ?? classLabel(ship.chassisClass);

export interface WeaponBenchProps {
  readonly view: BlindMatchView;
  readonly selfFleetId: number;
  /** The single active shooter whose slots fill the rail (D-TA-RAIL-SHOOTER).
   *  `null` when the player has no ship left to fire. */
  readonly shooter: BlindShipView | null;
  readonly assignments: ReadonlyMap<string, Assignment>;
  /** Assign (or, with `null`, hold fire on) a slot. */
  readonly onAssign: (slot: FireSlot, targetId: BodyId | null) => void;
  /** Single hit-chance source (arch §13.3) — never recomputed in the UI. */
  readonly hitChanceFor: (
    shooterId: BodyId,
    targetId: BodyId,
    weaponIndex: number,
  ) => HitChanceBreakdown;
  /** CP2 called-shot picker, rendered under a weapon row when supplied. */
  readonly renderCalledShot?: (
    slot: FireSlot,
    assignment: Assignment,
    target: BlindShipView,
  ) => ComponentChildren;
  /** Surface which fire slot the player is interacting with so the tactical
   *  viewport can draw a range shell around its shooter. Called on focus-within
   *  a row and on target change. */
  readonly onSelectSlot?: (slot: FireSlot) => void;
}

export function WeaponBench(props: WeaponBenchProps) {
  const { view, selfFleetId, shooter } = props;
  const targets = enemyShips(view, selfFleetId);

  if (shooter === null) {
    return (
      <div class="mono-xs c-dim" data-testid="weapon-bench">
        NO SHIPS LEFT TO FIRE.
      </div>
    );
  }

  const slots = liveFireSlots(shooter);
  return (
    <div class="ta-ship-cards" data-testid="weapon-bench" data-ship-id={String(shooter.bodyId)}>
      {slots.length === 0 ? (
        <div class="mono-xs c-dim ta-ship-empty">ALL WEAPONS DESTROYED — HOLDING.</div>
      ) : (
        slots.map((slot) => (
          <FireRow key={slotKey(slot)} {...props} slot={slot} shooter={shooter} targets={targets} />
        ))
      )}
    </div>
  );
}

interface FireRowProps extends WeaponBenchProps {
  readonly slot: FireSlot;
  /** The active shooter, narrowed non-null for the card. */
  readonly shooter: BlindShipView;
  readonly targets: readonly BlindShipView[];
}

function FireRow(props: FireRowProps) {
  const {
    slot,
    shooter,
    targets,
    view,
    assignments,
    onAssign,
    hitChanceFor,
    renderCalledShot,
    onSelectSlot,
  } = props;
  const assignment = assignments.get(slotKey(slot));
  const isMissile = slot.kind === 'missile';
  const label = `${isMissile ? 'M' : 'W'}${String(slot.index + 1)}`;
  const shooterPos = positionOf(view, shooter.bodyId);
  const weapon = isMissile ? undefined : shooter.ship.weapons[slot.index];
  const rack = isMissile ? shooter.ship.missiles[slot.index] : undefined;

  // Authored card name (SESSION-01 display identity) with an index fallback.
  const cardName = isMissile
    ? rack?.display?.name ?? `MISSILE RACK M${String(slot.index + 1)}`
    : weapon?.display?.name ?? `WEAPON W${String(slot.index + 1)}`;

  const options: SelectOption[] = [
    { value: HOLD, label: isMissile ? '— HOLD LAUNCH —' : '— HOLD FIRE —' },
    ...targets.map((t) => {
      const tPos = positionOf(view, t.bodyId);
      const d =
        shooterPos !== undefined && tPos !== undefined
          ? String(Math.round(distance(shooterPos, tPos)))
          : null;
      // Weapon slots flag out-of-range enemies in the picker itself so the
      // player sees "the resolver will refuse this" BEFORE assigning — the row
      // still allows the pick (warns, never blocks, §4.6). Missile racks have no
      // line-of-sight envelope; they carry no range verdict.
      const outOfRange =
        !isMissile && weaponOutOfRange(view, shooter.bodyId, slot.index, t.bodyId);
      const rangeText = isMissile
        ? d !== null
          ? ` · ${d}u`
          : ''
        : d !== null
          ? ` · ${d}u · ${outOfRange ? 'OUT OF RANGE' : 'IN RANGE'}`
          : outOfRange
            ? ' · OUT OF RANGE'
            : ' · IN RANGE';
      return {
        value: String(t.bodyId),
        label: `${fleetGlyphOf(t.fleetId)} ${t.name} · ${chassisNameOf(t)}${rangeText}`,
      };
    }),
  ];

  const selected = assignment?.targetId !== undefined ? String(assignment.targetId) : HOLD;
  const targetView =
    assignment?.targetId !== undefined
      ? targets.find((t) => t.bodyId === assignment.targetId)
      : undefined;
  const outOfRange =
    !isMissile && targetView !== undefined
      ? weaponOutOfRange(view, shooter.bodyId, slot.index, targetView.bodyId)
      : false;

  const onChange = (e: Event) => {
    const value = (e.currentTarget as HTMLSelectElement).value;
    onAssign(slot, value === HOLD ? null : Number(value));
    onSelectSlot?.(slot);
  };

  // Any focus inside the row (target select, called-shot picker) surfaces this
  // slot upward so the viewport range shell tracks what the player is actually
  // interacting with. `focusin` bubbles natively (unlike `focus`), so a single
  // handler on the row's outer div catches focus into any nested control.
  const onSlotFocusIn = (): void => onSelectSlot?.(slot);

  // Card modifier state:
  //   * `is-msl` — missile rack (red left border)
  //   * `is-set` — an assigned weapon target (cyan left border)
  //   * `is-oor` — assigned but out-of-range (dashed border, same red hint)
  const cardMod = isMissile
    ? ' is-msl'
    : outOfRange
      ? ' is-oor'
      : assignment !== undefined
        ? ' is-set'
        : '';

  const targetPos = targetView !== undefined ? positionOf(view, targetView.bodyId) : undefined;
  const currentDistance =
    shooterPos !== undefined && targetPos !== undefined
      ? Math.round(distance(shooterPos, targetPos))
      : null;

  const ammo = isMissile ? shooter.missileAmmo[slot.index] ?? 0 : 0;
  const ammoMax = rack?.ammo ?? 0;

  return (
    <div
      class={`ta-card${cardMod}`}
      data-testid="weapon-row"
      data-slot={slotKey(slot)}
      onFocusIn={onSlotFocusIn}
    >
      <div class="ta-card-hd">
        <span class={`tag-slot ${isMissile ? 'tag-missile' : 'tag-weapon'}`}>{label}</span>
        <span class="ta-card-name grow truncate">{cardName}</span>
        {isMissile ? (
          <span class={`chip${ammo > 0 ? ' chip-red' : ''}`}>
            {ammo > 0 ? 'LAUNCH' : 'NO LAUNCH'}
          </span>
        ) : (
          <span class={`chip${outOfRange ? ' chip-red' : assignment ? ' chip-green' : ''}`}>
            {outOfRange ? 'OUT OF RANGE' : assignment ? 'ASSIGNED' : 'HOLD'}
          </span>
        )}
      </div>

      {!isMissile && weapon !== undefined ? (
        <div class="mono-xs c-dim ta-card-slot">
          {`SLOT ${label} · RANGE ${String(weapon.range)} · DMG ${String(weapon.damage)} ×${String(weapon.shotsPerTurn)} SHOTS · ACC ${weapon.accuracy.toFixed(2)}`}
        </div>
      ) : null}

      {isMissile && rack !== undefined ? (
        <div class="mono-xs c-dim ta-card-slot">
          {`SLOT ${label} · DMG ${String(rack.damage)} · AoE ${String(rack.aoeRadius)} · AMMO ${String(ammo)}/${String(ammoMax)}`}
        </div>
      ) : null}

      {isMissile && ammo <= 0 ? (
        <div class="mono-xs c-red ta-card-hint" role="status">
          MAGAZINE EMPTY — CANNOT LAUNCH THIS MATCH.
        </div>
      ) : (
        <Select
          aria-label={`${shooter.name} ${label} target`}
          value={selected}
          options={options}
          onChange={onChange}
        />
      )}

      {!isMissile && targetView !== undefined ? (
        outOfRange ? (
          <OutOfRange targetDistance={currentDistance} weaponRange={weapon?.range} />
        ) : (
          <HitChance
            breakdown={hitChanceFor(shooter.bodyId, targetView.bodyId, slot.index)}
            targetDistance={currentDistance}
            weaponRange={weapon?.range}
          />
        )
      ) : null}

      {isMissile && ammo > 0 ? (
        <div class="mono-xs c-dim ta-card-hint">
          NO TO-HIT ROLL — DETONATES ON CONTACT WITH ANY BODY · AoE BLAST.
        </div>
      ) : null}

      {!isMissile &&
      renderCalledShot !== undefined &&
      assignment !== undefined &&
      targetView !== undefined
        ? renderCalledShot(slot, assignment, targetView)
        : null}
    </div>
  );
}

/**
 * Replaces the HitChance readout when the resolver would refuse the shot
 * (`weaponOutOfRange`). Text-first + `c-red` — never colour alone (§1.1); the
 * block spells out WHY (SHOT WILL NOT FIRE) so the player can distinguish this
 * from a hard-but-legal in-range 5% shot, and surfaces the absolute range gap
 * (`RANGE 412 / 260 · OUT`).
 */
interface OutOfRangeProps {
  readonly targetDistance: number | null;
  readonly weaponRange: number | undefined;
}

function OutOfRange(props: OutOfRangeProps) {
  const { targetDistance, weaponRange } = props;
  return (
    <div data-testid="weapon-out-of-range" role="status" class="ta-hit">
      <div class="ta-hit-hd">
        <span class="t-label">HIT CHANCE</span>
        <span class="t-num c-red ta-hit-num-oor">OUT OF RANGE</span>
      </div>
      {targetDistance !== null && weaponRange !== undefined ? (
        <div class="mono-xs c-red ta-hit-range">
          {`RANGE ${String(targetDistance)} / ${String(weaponRange)} · OUT`}
        </div>
      ) : null}
      <div class="mono-xs c-red ta-hit-hint">
        SHOT WILL NOT FIRE · MOVE CLOSER OR RE-TARGET.
      </div>
    </div>
  );
}

interface HitChanceProps {
  readonly breakdown: HitChanceBreakdown;
  /** Distance shooter → chosen target (world units), for the mock's absolute
   *  range readout. `null` when either position is missing. */
  readonly targetDistance: number | null;
  /** Weapon's engagement radius (world units) — pairs with `targetDistance`
   *  to render `RANGE {d} / {r}`. */
  readonly weaponRange: number | undefined;
}

/**
 * The hit-chance readout. Every number is a field of the supplied breakdown —
 * this component multiplies nothing. Text-first (never colour-only): the final
 * % is spelled out, a `.meter` bar mirrors it (`hitChanceBarFill`), and each
 * factor names its sign. No formula lives here (arch §13.3).
 */
function HitChance(props: HitChanceProps) {
  const { breakdown: b, targetDistance, weaponRange } = props;
  return (
    <div class="ta-hit">
      <div class="ta-hit-hd">
        <span class="t-label">HIT CHANCE</span>
        <span class={`t-num ${hitChanceTone(b.final)} ta-hit-num`} data-testid="hitchance-final">
          {pct(b.final)}
        </span>
      </div>
      <Meter
        value={b.final}
        max={1}
        fill={hitChanceBarFill(b.final)}
        class="ta-hit-meter"
        aria-label={`Hit chance ${pct(b.final)}`}
      />
      <div class="mono-xs ta-hit-factors">
        {targetDistance !== null && weaponRange !== undefined ? (
          <div>{`RANGE ${String(targetDistance)} / ${String(weaponRange)} · ${signed(b.rangeFactor - 1)}`}</div>
        ) : (
          <div>{`RANGE · ${signed(b.rangeFactor - 1)}`}</div>
        )}
        <div>{`BASE ACC ${b.base.toFixed(2)}`}</div>
        <div>{`TGT VELOCITY · ${signed(b.velocityFactor - 1)}`}</div>
        <div>{`TGT EVASION · ${signed(b.evasionFactor - 1)}`}</div>
      </div>
    </div>
  );
}
