// M14 UI — Tactical Attack weapon bench (S06 CP1).
//
// Per player-ship fire rows: one row per live weapon / loaded missile rack
// (dead + spent slots excluded, never disabled — model.liveFireSlots). Each row
// carries a target picker over living enemies; a weapon row with a chosen target
// renders the hit-chance BREAKDOWN read straight from `hitChanceFor` — the base
// accuracy and the range / target-velocity / target-evasion factors it returns,
// down to a final %. The % is NEVER computed here (arch §13.3): the formula lives
// in `sim/rules`, single-sourced through the controller seam.

import type { ComponentChildren } from 'preact';

import type {
  BlindMatchView,
  BlindShipView,
  BodyId,
  HitChanceBreakdown,
} from '../../../sim/index.js';
import { distance } from '../../../sim/mathx/index.js';
import { Select } from '../../components/index.js';
import type { SelectOption } from '../../components/index.js';

import {
  enemyShips,
  friendlyShips,
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

export interface WeaponBenchProps {
  readonly view: BlindMatchView;
  readonly selfFleetId: number;
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
  /** SESSION-07 — surface which fire slot the player is interacting with so
   *  the tactical viewport can draw a range shell around its shooter. Called
   *  on focus-within a row and on target change. */
  readonly onSelectSlot?: (slot: FireSlot) => void;
}

export function WeaponBench(props: WeaponBenchProps) {
  const { view, selfFleetId } = props;
  const shooters = friendlyShips(view, selfFleetId);
  const targets = enemyShips(view, selfFleetId);

  return (
    <div class="stack" data-testid="weapon-bench">
      {shooters.map((shooter) => (
        <ShipGroup
          key={shooter.bodyId}
          shooter={shooter}
          targets={targets}
          {...props}
        />
      ))}
      {shooters.length === 0 ? (
        <div class="mono-xs c-dim">NO SHIPS LEFT TO FIRE.</div>
      ) : null}
    </div>
  );
}

interface ShipGroupProps extends WeaponBenchProps {
  readonly shooter: BlindShipView;
  readonly targets: readonly BlindShipView[];
}

function ShipGroup(props: ShipGroupProps) {
  const { shooter } = props;
  const slots = liveFireSlots(shooter);
  return (
    <section class="panel-in" style="padding:var(--s3)">
      <div style="display:flex;align-items:center;gap:var(--s2)">
        <span class="grow truncate" style="font-weight:700;color:var(--ink-hi);letter-spacing:.04em">
          {shooter.name}
        </span>
        <span class="mono-xs">{`${shooter.chassisClass.toUpperCase()} · ${String(slots.length)} FIRE SLOTS`}</span>
      </div>
      {slots.length === 0 ? (
        <div class="mono-xs c-dim" style="margin-top:6px">ALL WEAPONS DESTROYED — HOLDING.</div>
      ) : (
        <div class="stack" style="margin-top:8px">
          {slots.map((slot) => (
            <FireRow key={slotKey(slot)} slot={slot} {...props} />
          ))}
        </div>
      )}
    </section>
  );
}

interface FireRowProps extends ShipGroupProps {
  readonly slot: FireSlot;
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
  // playtest-feedback-03 SESSION-01 CP2 — surface the weapon's own range /
  // damage / shots in the row header so the player connects this row to the
  // engagement shell drawn around the ship (D-ATK-ORIENTATION). Read straight
  // off `SimWeapon`; never a to-hit number (arch §13.3 stays `HitChance`-only).
  const weapon = isMissile ? undefined : shooter.ship.weapons[slot.index];

  const options: SelectOption[] = [
    { value: HOLD, label: isMissile ? '— HOLD LAUNCH —' : '— HOLD FIRE —' },
    ...targets.map((t) => {
      const tPos = positionOf(view, t.bodyId);
      const d =
        shooterPos !== undefined && tPos !== undefined
          ? ` · ${String(Math.round(distance(shooterPos, tPos)))}u`
          : '';
      // Playtest-feedback-04 FB1: weapon slots flag out-of-range enemies in
      // the picker itself so the player sees "the resolver will refuse this"
      // BEFORE assigning — the row still allows the pick (warns, never
      // blocks, §4.6). Missile racks have no line-of-sight envelope; skip.
      const outOfRange =
        !isMissile && weaponOutOfRange(view, shooter.bodyId, slot.index, t.bodyId);
      const oor = outOfRange ? ' · OUT OF RANGE' : '';
      return {
        value: String(t.bodyId),
        label: `${t.name} · ${t.chassisClass.toUpperCase()}${d}${oor}`,
      };
    }),
  ];

  const selected = assignment?.targetId !== undefined ? String(assignment.targetId) : HOLD;
  const targetView =
    assignment?.targetId !== undefined
      ? targets.find((t) => t.bodyId === assignment.targetId)
      : undefined;
  // Playtest-feedback-04 FB1: for a weapon slot with an assigned target, does
  // the resolver refuse the shot? The bench must announce OUT OF RANGE instead
  // of a HitChance readout — the controller now publishes 0% for this case
  // (CP1), but the player needs the reason spelled out. Missile slots stay
  // free of this — they have no line-of-sight envelope.
  const outOfRange =
    !isMissile && targetView !== undefined
      ? weaponOutOfRange(view, shooter.bodyId, slot.index, targetView.bodyId)
      : false;

  const onChange = (e: Event) => {
    const value = (e.currentTarget as HTMLSelectElement).value;
    onAssign(slot, value === HOLD ? null : Number(value));
    onSelectSlot?.(slot);
  };

  // SESSION-07 — any focus inside the row (target select, called-shot picker)
  // surfaces this slot upward so the viewport range shell tracks what the
  // player is actually interacting with. `focusin` bubbles natively (unlike
  // `focus`), so a single handler on the row's outer div catches focus into
  // any nested control — no per-control wiring.
  const onSlotFocusIn = (): void => onSelectSlot?.(slot);

  return (
    <div
      data-testid="weapon-row"
      data-slot={slotKey(slot)}
      onFocusIn={onSlotFocusIn}
      style={`border:1px solid var(--line);border-left:2px solid ${isMissile ? 'var(--red)' : 'var(--line-hot)'};border-radius:var(--r);padding:var(--s2) var(--s3)`}
    >
      <div style="display:flex;align-items:center;gap:var(--s2)">
        <span class={`tag-slot ${isMissile ? 'tag-missile' : 'tag-weapon'}`}>{label}</span>
        <span class="grow truncate" style="font-weight:700;color:var(--ink-hi);letter-spacing:.06em">
          {isMissile ? 'MISSILE RACK' : 'WEAPON'}
        </span>
        {isMissile ? (
          <span class="mono-xs">{`AMMO ${String(shooter.missileAmmo[slot.index] ?? 0)}`}</span>
        ) : (
          <span class={`chip${outOfRange ? ' chip-red' : ''}`}>
            {outOfRange ? 'OUT OF RANGE' : assignment ? 'ASSIGNED' : 'HOLD'}
          </span>
        )}
      </div>

      {!isMissile && weapon !== undefined ? (
        <div class="mono-xs c-dim" style="margin:3px 0 6px">
          {`RANGE ${String(weapon.range)} · DMG ${String(weapon.damage)} ×${String(weapon.shotsPerTurn)} SHOTS · ACC ${weapon.accuracy.toFixed(2)}`}
        </div>
      ) : null}

      <Select
        aria-label={`${shooter.name} ${label} target`}
        value={selected}
        options={options}
        onChange={onChange}
      />

      {!isMissile && targetView !== undefined ? (
        outOfRange ? (
          <OutOfRange />
        ) : (
          <HitChance breakdown={hitChanceFor(shooter.bodyId, targetView.bodyId, slot.index)} />
        )
      ) : null}

      {isMissile ? (
        <div class="mono-xs c-dim" style="margin-top:5px">
          NO TO-HIT ROLL — DETONATES ON CONTACT · AoE BLAST
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
 * Playtest-feedback-04 FB1: replaces the HitChance readout when the resolver
 * would refuse the shot (`weaponOutOfRange`). Text-first + `c-red` — never
 * colour alone (§1.1); the block spells out WHY (SHOT WILL NOT FIRE) so the
 * player can distinguish this from a hard-but-legal in-range 5% shot.
 */
function OutOfRange() {
  return (
    <div
      data-testid="weapon-out-of-range"
      role="status"
      style="margin-top:6px"
    >
      <div style="display:flex;align-items:baseline;justify-content:space-between">
        <span class="t-label">HIT CHANCE</span>
        <span
          class="t-num c-red"
          style="font-size:14px;font-weight:700;letter-spacing:.08em"
        >
          OUT OF RANGE
        </span>
      </div>
      <div class="mono-xs c-red" style="margin-top:5px">
        SHOT WILL NOT FIRE · MOVE CLOSER OR RE-TARGET.
      </div>
    </div>
  );
}

interface HitChanceProps {
  readonly breakdown: HitChanceBreakdown;
}

/**
 * The hit-chance readout. Every number is a field of the supplied breakdown —
 * this component multiplies nothing. Text-first (never colour-only): the final
 * % is spelled out, and each factor names its sign.
 */
function HitChance(props: HitChanceProps) {
  const b = props.breakdown;
  return (
    <div style="margin-top:6px">
      <div style="display:flex;align-items:baseline;justify-content:space-between">
        <span class="t-label">HIT CHANCE</span>
        <span
          class={`t-num ${hitChanceTone(b.final)}`}
          data-testid="hitchance-final"
          style="font-size:20px;font-weight:700"
        >
          {pct(b.final)}
        </span>
      </div>
      <div class="mono-xs" style="margin-top:5px;line-height:1.7">
        <div>{`BASE ACC ${b.base.toFixed(2)}`}</div>
        <div>{`RANGE · ${signed(b.rangeFactor - 1)}`}</div>
        <div>{`TGT VELOCITY · ${signed(b.velocityFactor - 1)}`}</div>
        <div>{`TGT EVASION · ${signed(b.evasionFactor - 1)}`}</div>
      </div>
    </div>
  );
}
