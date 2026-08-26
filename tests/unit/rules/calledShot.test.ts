// calledShot.test — resolve component-integrity hits and their knockouts (FR-25).

import { describe, expect, it } from 'vitest';
import { resolveCalledShot } from '../../../src/sim/rules/calledShot.js';
import {
  BASE_INTEGRITY,
  CLASS_INTEGRITY_MULT,
  newShipCombat,
} from '../../../src/sim/rules/combatState.js';
import type { SimShip } from '../../../src/sim/types.js';

const ship = (overrides: Partial<SimShip> = {}): SimShip => ({
  buildId: 'b',
  name: 'Test',
  chassisClass: 'frigate',
  mass: 500,
  radius: 20,
  maxHull: 200,
  shieldCapacity: 100,
  shieldRegenPerTurn: 10,
  deltaVPerTurn: 300,
  baseEvasion: 0.1,
  hullRepairPerTurn: 0,
  weapons: [
    { range: 800, damage: 20, shotsPerTurn: 1, accuracy: 0.7 },
    { range: 400, damage: 30, shotsPerTurn: 1, accuracy: 0.8 },
  ],
  missiles: [
    {
      ammo: 4, damage: 60, aoeRadius: 80, boostVelocity: 200,
      trackingTurnRate: 30, bodyMass: 5, bodyRadius: 6,
    },
  ],
  pointDefense: [
    { interceptRange: 200, interceptChance: 0.6, interceptsPerTurn: 2 },
  ],
  decoys: [
    { charges: 2, evasionBonus: 0.3, durationTurns: 1 },
  ],
  ...overrides,
});

const frigateWeapon = BASE_INTEGRITY.weapon * CLASS_INTEGRITY_MULT.frigate;
const frigateShieldGen =
  BASE_INTEGRITY.shieldGenerator * CLASS_INTEGRITY_MULT.frigate;
const frigateEngine = BASE_INTEGRITY.engine * CLASS_INTEGRITY_MULT.frigate;

describe('resolveCalledShot — shield generator', () => {
  it('subtracts from integrity and marks destroyed on ≤ 0', () => {
    const sc = newShipCombat(ship(), 1);
    sc.shields = 0; // legality gate assumed passed
    const r = resolveCalledShot(sc, { kind: 'shield-generator' }, frigateShieldGen + 5);
    expect(r.destroyed).toBe(true);
    expect(r.after.shieldGenAlive).toBe(false);
    expect(r.after.shields).toBe(0);
    expect(r.after.componentIntegrity.shieldGenerator).toBe(0);
  });

  it('generator kill does not repair or restore hull', () => {
    const sc = newShipCombat(ship(), 1);
    sc.shields = 0;
    sc.hull = 120;
    const r = resolveCalledShot(sc, { kind: 'shield-generator' }, frigateShieldGen + 100);
    expect(r.after.hull).toBe(120); // untouched
  });

  it('partial hit ⇒ subsystem still alive, integrity decremented', () => {
    const sc = newShipCombat(ship(), 1);
    sc.shields = 0;
    const r = resolveCalledShot(sc, { kind: 'shield-generator' }, 5);
    expect(r.destroyed).toBe(false);
    expect(r.after.shieldGenAlive).toBe(true);
    expect(r.after.componentIntegrity.shieldGenerator).toBe(frigateShieldGen - 5);
  });

  it('subsequent shot on already-dead generator is a no-op', () => {
    const sc = newShipCombat(ship(), 1);
    sc.shieldGenAlive = false;
    sc.componentIntegrity.shieldGenerator = 0;
    const r = resolveCalledShot(sc, { kind: 'shield-generator' }, 20);
    expect(r.destroyed).toBe(false);
    expect(r.after.componentIntegrity.shieldGenerator).toBe(0);
  });
});

describe('resolveCalledShot — engine', () => {
  it('destruction flips engineAlive', () => {
    const sc = newShipCombat(ship(), 1);
    sc.shields = 0;
    const r = resolveCalledShot(sc, { kind: 'engine' }, frigateEngine + 1);
    expect(r.destroyed).toBe(true);
    expect(r.after.engineAlive).toBe(false);
  });
});

describe('resolveCalledShot — weapon', () => {
  it('flips only the addressed weapon index', () => {
    const sc = newShipCombat(ship(), 1);
    sc.shields = 0;
    const r = resolveCalledShot(sc, { kind: 'weapon', index: 1 }, frigateWeapon + 1);
    expect(r.destroyed).toBe(true);
    expect(r.after.weaponAlive[0]).toBe(true);
    expect(r.after.weaponAlive[1]).toBe(false);
  });

  it('index out of range is a no-op', () => {
    const sc = newShipCombat(ship(), 1);
    sc.shields = 0;
    const r = resolveCalledShot(sc, { kind: 'weapon', index: 99 }, 1000);
    expect(r.destroyed).toBe(false);
    expect(r.after.weaponAlive).toEqual([true, true]);
  });
});

describe('resolveCalledShot — missile', () => {
  it('flips the missile rack alive flag on knockout', () => {
    const sc = newShipCombat(ship(), 1);
    sc.shields = 0;
    const r = resolveCalledShot(sc, { kind: 'missile', index: 0 }, 999);
    expect(r.destroyed).toBe(true);
    expect(r.after.missileAlive[0]).toBe(false);
  });
});

describe('resolveCalledShot — special (canonical layout: pd first, then decoys)', () => {
  it('index 0 hits the first point-defense', () => {
    const sc = newShipCombat(ship(), 1);
    sc.shields = 0;
    const r = resolveCalledShot(sc, { kind: 'special', index: 0 }, 999);
    expect(r.destroyed).toBe(true);
    expect(r.after.pdAlive[0]).toBe(false);
    expect(r.after.decoyAlive[0]).toBe(true);
  });

  it('index past pd rolls over to decoys', () => {
    const sc = newShipCombat(ship(), 1); // pd.length = 1, so decoy[0] is at index 1
    sc.shields = 0;
    const r = resolveCalledShot(sc, { kind: 'special', index: 1 }, 999);
    expect(r.destroyed).toBe(true);
    expect(r.after.pdAlive[0]).toBe(true);
    expect(r.after.decoyAlive[0]).toBe(false);
  });

  it('index past all specials is a no-op', () => {
    const sc = newShipCombat(ship(), 1);
    sc.shields = 0;
    const r = resolveCalledShot(sc, { kind: 'special', index: 99 }, 999);
    expect(r.destroyed).toBe(false);
  });
});

describe('resolveCalledShot — invariants', () => {
  it('non-positive incoming is a no-op', () => {
    const sc = newShipCombat(ship(), 1);
    sc.shields = 0;
    const before = sc.componentIntegrity.engine;
    const r0 = resolveCalledShot(sc, { kind: 'engine' }, 0);
    expect(r0.after.componentIntegrity.engine).toBe(before);
    const rNeg = resolveCalledShot(sc, { kind: 'engine' }, -20);
    expect(rNeg.after.componentIntegrity.engine).toBe(before);
  });

  it('does not mutate the input ShipCombat', () => {
    const sc = newShipCombat(ship(), 1);
    sc.shields = 0;
    const before = sc.componentIntegrity.engine;
    resolveCalledShot(sc, { kind: 'engine' }, 20);
    expect(sc.componentIntegrity.engine).toBe(before);
    expect(sc.engineAlive).toBe(true);
  });
});
