// M14 UI — shared roster/inspector model (skirmish-tactical-parity SESSION-02
// CP1). Node-only (no JSX, no DOM): grouping order, pip derivation, and the
// destroyed-ship-still-in-roster rule the FR-15 all-fleets roster depends on.

import { describe, expect, it } from 'vitest';

import {
  fleetLabel,
  groupByFleet,
  isAlive,
  pipsFor,
} from '../../../../../src/ui/components/roster/model.js';
import type {
  BlindShipView,
  ChassisClass,
  SimShip,
} from '../../../../../src/sim/index.js';

// ---- Fixtures -------------------------------------------------------------

const ship = (name: string, over: Partial<SimShip> = {}): SimShip => ({
  buildId: `b-${name}`,
  name,
  chassisClass: 'fighter',
  mass: 100,
  radius: 4,
  maxHull: 40,
  shieldCapacity: 20,
  shieldRegenPerTurn: 2,
  deltaVPerTurn: 60,
  baseEvasion: 0.2,
  hullRepairPerTurn: 0,
  weapons: [],
  missiles: [],
  pointDefense: [],
  decoys: [],
  ...over,
});

const shipView = (
  bodyId: number,
  fleetId: number,
  name: string,
  over: Partial<BlindShipView> = {},
): BlindShipView => {
  const s = ship(name);
  return {
    bodyId,
    fleetId,
    name,
    chassisClass: 'fighter' as ChassisClass,
    hull: s.maxHull,
    maxHull: s.maxHull,
    shields: s.shieldCapacity,
    shieldCapacity: s.shieldCapacity,
    shieldGenAlive: true,
    engineAlive: true,
    weaponAlive: [],
    missileAlive: [],
    missileAmmo: [],
    pdAlive: [],
    decoyAlive: [],
    decoyCharges: [],
    decoyActiveUntilTurn: 0,
    ship: s,
    ...over,
  };
};

// ---- pipsFor / isAlive ----------------------------------------------------

describe('pipsFor — one binary pip per intact/destroyed subsystem', () => {
  it('maps weaponAlive [true,false] to W1 online, W2 destroyed', () => {
    const v = shipView(1, 0, 'A', { weaponAlive: [true, false] });
    const pips = pipsFor(v);
    const weapons = pips.filter((p) => p.kind === 'weapon');
    expect(weapons).toHaveLength(2);
    expect(weapons[0]).toMatchObject({ index: 0, label: 'W1', state: 'online' });
    expect(weapons[1]).toMatchObject({ index: 1, label: 'W2', state: 'destroyed' });
  });

  it('emits aggregate SHLD + ENG pips with no numeric suffix', () => {
    const v = shipView(1, 0, 'A', { shieldGenAlive: false, engineAlive: true });
    const pips = pipsFor(v);
    const shld = pips.find((p) => p.kind === 'shield');
    const eng = pips.find((p) => p.kind === 'engine');
    expect(shld).toMatchObject({ label: 'SHLD', state: 'destroyed' });
    expect(eng).toMatchObject({ label: 'ENG', state: 'online' });
  });

  it('emits pips in stable order: weapons → shield → missiles → pd → decoys → engine', () => {
    const v = shipView(1, 0, 'A', {
      weaponAlive: [true],
      missileAlive: [true],
      pdAlive: [true],
      decoyAlive: [true],
    });
    const order = pipsFor(v).map((p) => p.kind);
    expect(order).toEqual(['weapon', 'shield', 'missile', 'pd', 'decoy', 'engine']);
  });

  it('labels missile / pd / decoy 1-indexed', () => {
    const v = shipView(1, 0, 'A', {
      missileAlive: [true, false],
      pdAlive: [true],
      decoyAlive: [false, true],
    });
    const labels = pipsFor(v).map((p) => p.label);
    // W (0) · SHLD · M1 · M2 · PD1 · DECOY1 · DECOY2 · ENG
    expect(labels).toEqual(['SHLD', 'M1', 'M2', 'PD1', 'DECOY1', 'DECOY2', 'ENG']);
  });
});

describe('isAlive — hull>0 keeps a ship in the roster; hull===0 marks it dead', () => {
  it('returns true while hull > 0', () => {
    expect(isAlive(shipView(1, 0, 'A', { hull: 12 }))).toBe(true);
  });

  it('returns false when hull is exactly 0 (still present, struck through)', () => {
    expect(isAlive(shipView(1, 0, 'A', { hull: 0 }))).toBe(false);
  });
});

// ---- fleetLabel -----------------------------------------------------------

describe('fleetLabel — reuses identity.ts FLEET_META vocabulary', () => {
  it('names the canonical fleets YOU / BOT-0N', () => {
    expect(fleetLabel(0)).toBe('YOU');
    expect(fleetLabel(1)).toBe('BOT-01');
    expect(fleetLabel(4)).toBe('BOT-04');
  });

  it('falls back to FLEET N for anything beyond the meta table', () => {
    expect(fleetLabel(7)).toBe('FLEET 7');
  });
});

// ---- groupByFleet ---------------------------------------------------------

describe('groupByFleet — player first, then bots ascending; entries by bodyId', () => {
  it('places the player fleet first even when its id is not the smallest', () => {
    const ships: readonly BlindShipView[] = [
      shipView(5, 1, 'BOT-A'),
      shipView(3, 2, 'YOU-A'),
      shipView(9, 0, 'OTHER'),
    ];
    const groups = groupByFleet(ships, 2);
    expect(groups.map((g) => g.fleetId)).toEqual([2, 0, 1]);
    expect(groups[0]!.isPlayer).toBe(true);
    expect(groups[1]!.isPlayer).toBe(false);
  });

  it('orders three fleets player-first + bots ascending by fleetId', () => {
    const ships: readonly BlindShipView[] = [
      shipView(1, 0, 'YOU-A'),
      shipView(2, 0, 'YOU-B'),
      shipView(3, 1, 'BOT-1A'),
      shipView(4, 2, 'BOT-2A'),
    ];
    const groups = groupByFleet(ships, 0);
    expect(groups.map((g) => g.fleetId)).toEqual([0, 1, 2]);
    expect(groups.map((g) => g.label)).toEqual(['YOU', 'BOT-01', 'BOT-02']);
  });

  it('sorts entries within a fleet ascending by bodyId', () => {
    const ships: readonly BlindShipView[] = [
      shipView(7, 0, 'GAMMA'),
      shipView(3, 0, 'ALPHA'),
      shipView(5, 0, 'BETA'),
    ];
    const groups = groupByFleet(ships, 0);
    expect(groups[0]!.entries.map((e) => e.bodyId)).toEqual([3, 5, 7]);
    expect(groups[0]!.entries.map((e) => e.name)).toEqual(['ALPHA', 'BETA', 'GAMMA']);
  });

  it('a destroyed ship (hull === 0) is still present with alive:false', () => {
    const ships: readonly BlindShipView[] = [
      shipView(1, 0, 'ALIVE', { hull: 10 }),
      shipView(2, 0, 'DEAD', { hull: 0 }),
    ];
    const groups = groupByFleet(ships, 0);
    expect(groups[0]!.entries.map((e) => ({ bodyId: e.bodyId, alive: e.alive }))).toEqual([
      { bodyId: 1, alive: true },
      { bodyId: 2, alive: false },
    ]);
  });

  it('drops empty fleets — no header without a ship', () => {
    const groups = groupByFleet([shipView(1, 0, 'A')], 0);
    expect(groups.map((g) => g.fleetId)).toEqual([0]);
  });

  it('derives ship-level fields from the view', () => {
    const view = shipView(1, 0, 'FROSTBITE', {
      hull: 12,
      maxHull: 40,
      shields: 5,
      shieldCapacity: 20,
      chassisClass: 'cruiser',
      weaponAlive: [true, false],
    });
    const [group] = groupByFleet([view], 0);
    const [entry] = group!.entries;
    expect(entry).toMatchObject({
      bodyId: 1,
      fleetId: 0,
      name: 'FROSTBITE',
      chassisClass: 'cruiser',
      hull: 12,
      maxHull: 40,
      shields: 5,
      shieldCapacity: 20,
      alive: true,
    });
    // pips carry through — W1 online, W2 destroyed
    const weapons = entry!.pips.filter((p) => p.kind === 'weapon');
    expect(weapons.map((p) => p.state)).toEqual(['online', 'destroyed']);
    // view is preserved for the inspector
    expect(entry!.view).toBe(view);
  });
});
