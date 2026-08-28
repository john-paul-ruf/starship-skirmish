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
import { Meter, Select } from '../../components/index.js';
import type { SelectOption } from '../../components/index.js';

import {
  enemyShips,
  friendlyShips,
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
  const assigned = countAssigned(props.assignments, shooter.bodyId);
  return (
    <section class="ta-ship-group panel-in" data-testid="ship-group" data-ship-id={String(shooter.bodyId)}>
      <header class="ta-ship-hd">
        <span class="ta-ship-name grow truncate">{shooter.name}</span>
        <span class="mono-xs c-dim ta-ship-class">
          {shooter.chassisClass.toUpperCase()}
        </span>
        <span class={`chip${assigned === slots.length && slots.length > 0 ? ' chip-cyan' : ''}`}>
          {`${String(assigned)} / ${String(slots.length)}`}
        </span>
      </header>
      {slots.length === 0 ? (
        <div class="mono-xs c-dim ta-ship-empty">ALL WEAPONS DESTROYED — HOLDING.</div>
      ) : (
        <div class="ta-ship-cards">
          {slots.map((slot) => (
            <FireRow key={slotKey(slot)} slot={slot} {...props} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Count the assignments staged against one shooter's live slots — feeds the
 *  per-ship `N / M` chip in the ShipGroup header (mock screenshot 7 shows the
 *  same badge pattern). Pure DOM presentation of the existing assignments
 *  map; never a gate on commit. */
const countAssigned = (
  assignments: ReadonlyMap<string, Assignment>,
  shooterId: BodyId,
): number => {
  let n = 0;
  for (const a of assignments.values()) if (a.shooterId === shooterId) n += 1;
  return n;
};

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

  // playtest-feedback-05 SESSION-04 CP3 — the card modifier state:
  //   * `is-msl` — missile rack (red left border)
  //   * `is-set` — an assigned weapon target (cyan left border)
  //   * `is-oor` — assigned but out-of-range (dashed border, same red hint)
  // Default (weapon, no target) keeps the neutral `.ta-card` border.
  const cardMod = isMissile
    ? ' is-msl'
    : outOfRange
      ? ' is-oor'
      : assignment !== undefined
        ? ' is-set'
        : '';

  // Absolute-range readout the mock's card carries below the picker:
  // `RANGE {targetDistance} / {weapon.range}`. Both numbers are already in
  // hand (the picker suffix uses the same distance). We only compute it when
  // there IS a target — otherwise the mock reads the weapon's range verbatim
  // in the SLOT line below.
  const targetPos = targetView !== undefined ? positionOf(view, targetView.bodyId) : undefined;
  const currentDistance =
    shooterPos !== undefined && targetPos !== undefined
      ? Math.round(distance(shooterPos, targetPos))
      : null;

  return (
    <div
      class={`ta-card${cardMod}`}
      data-testid="weapon-row"
      data-slot={slotKey(slot)}
      onFocusIn={onSlotFocusIn}
    >
      <div class="ta-card-hd">
        <span class={`tag-slot ${isMissile ? 'tag-missile' : 'tag-weapon'}`}>{label}</span>
        <span class="ta-card-name grow truncate">
          {isMissile ? 'MISSILE RACK' : 'WEAPON'}
        </span>
        {isMissile ? (
          <span class="mono-xs">{`AMMO ${String(shooter.missileAmmo[slot.index] ?? 0)}`}</span>
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

      <Select
        aria-label={`${shooter.name} ${label} target`}
        value={selected}
        options={options}
        onChange={onChange}
      />

      {!isMissile && targetView !== undefined ? (
        outOfRange ? (
          <OutOfRange
            targetDistance={currentDistance}
            weaponRange={weapon?.range}
          />
        ) : (
          <HitChance
            breakdown={hitChanceFor(shooter.bodyId, targetView.bodyId, slot.index)}
            targetDistance={currentDistance}
            weaponRange={weapon?.range}
          />
        )
      ) : null}

      {isMissile ? (
        <div class="mono-xs c-dim ta-card-hint">
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
 * playtest-feedback-05 SESSION-04 CP3 — surfaces the mock's absolute range
 * readout too (`RANGE 412 / 260 · OUT`), so the player sees the numeric gap.
 */
interface OutOfRangeProps {
  readonly targetDistance: number | null;
  readonly weaponRange: number | undefined;
}

function OutOfRange(props: OutOfRangeProps) {
  const { targetDistance, weaponRange } = props;
  return (
    <div
      data-testid="weapon-out-of-range"
      role="status"
      class="ta-hit"
    >
      <div class="ta-hit-hd">
        <span class="t-label">HIT CHANCE</span>
        <span
          class="t-num c-red ta-hit-num-oor"
        >
          OUT OF RANGE
        </span>
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
 * % is spelled out, and each factor names its sign.
 * playtest-feedback-05 SESSION-04 CP3 — the mock's `.acard` treatment adds an
 * absolute range readout (`RANGE 118 / 260`) between the % and the factor
 * lines, and a `.meter` bar whose width is `breakdown.final` normalised
 * against 1.0. Presentation transforms of published values — the `%` and the
 * `range factor` still come straight off the breakdown; no formula lives here
 * (arch §13.3).
 */
function HitChance(props: HitChanceProps) {
  const { breakdown: b, targetDistance, weaponRange } = props;
  return (
    <div class="ta-hit">
      <div class="ta-hit-hd">
        <span class="t-label">HIT CHANCE</span>
        <span
          class={`t-num ${hitChanceTone(b.final)} ta-hit-num`}
          data-testid="hitchance-final"
        >
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
