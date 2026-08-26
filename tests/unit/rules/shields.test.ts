// shields.test — regen tick + called-shot legality gate (Ruling E, Decision 4, FR-25).

import { describe, expect, it } from 'vitest';
import { calledShotsUnlocked, regenShields } from '../../../src/sim/rules/shields.js';
import { newShipCombat } from '../../../src/sim/rules/combatState.js';
import type { CombatConfig, SimShip } from '../../../src/sim/types.js';

const ship = (overrides: Partial<SimShip> = {}): SimShip => ({
  buildId: 'b',
  name: 'Test',
  chassisClass: 'frigate',
  mass: 500,
  radius: 20,
  maxHull: 200,
  shieldCapacity: 100,
  shieldRegenPerTurn: 15,
  deltaVPerTurn: 300,
  baseEvasion: 0.1,
  hullRepairPerTurn: 0,
  weapons: [],
  missiles: [],
  pointDefense: [],
  decoys: [],
  ...overrides,
});

const cfg = (overrides: Partial<CombatConfig['shields']> = {}): CombatConfig => ({
  hazards: {
    maxSimultaneousBodies: 300,
    debrisLifetimeTurns: 6,
    debrisPerDestruction: { fighter: 2, frigate: 4, cruiser: 7, 'mega-destroyer': 12 },
    debrisScatterImpulse: 120,
    debrisMassFractionOfHull: 0.06,
    debrisRadius: 12,
  },
  destruction: {
    aoeRadiusByClass: { fighter: 90, frigate: 160, cruiser: 260, 'mega-destroyer': 400 },
    aoeDamageByClass: { fighter: 12, frigate: 30, cruiser: 70, 'mega-destroyer': 140 },
  },
  missiles: { trackingBeats: 2, spentRemainsArmed: true, reacquireOnTargetLoss: false },
  shields: { regenTicksRegardlessOfDamage: true, ...overrides },
});

describe('regenShields — Ruling E, FR-25', () => {
  it('increases shields by regenPerTurn every turn', () => {
    const sc = newShipCombat(ship(), 1);
    sc.shields = 40;
    const out = regenShields(sc, cfg());
    expect(out.shields).toBe(55);
  });

  it('caps at shieldCapacity', () => {
    const sc = newShipCombat(ship({ shieldCapacity: 100, shieldRegenPerTurn: 40 }), 1);
    sc.shields = 80;
    const out = regenShields(sc, cfg());
    expect(out.shields).toBe(100);
  });

  it('ticks regardless of prior damage (Ruling E)', () => {
    // Full shields — a real-world "no damage this turn" — still no-op past cap.
    const sc = newShipCombat(ship(), 1);
    expect(sc.shields).toBe(100);
    const out = regenShields(sc, cfg());
    expect(out.shields).toBe(100);
  });

  it('dead generator ⇒ no regen and shields pinned to 0', () => {
    const sc = newShipCombat(ship(), 1);
    sc.shieldGenAlive = false;
    sc.shields = 30; // stale non-zero
    const out = regenShields(sc, cfg());
    expect(out.shields).toBe(0);
  });

  it('dead generator ⇒ zero regen even when shields already zero', () => {
    const sc = newShipCombat(ship(), 1);
    sc.shieldGenAlive = false;
    sc.shields = 0;
    const out = regenShields(sc, cfg());
    expect(out.shields).toBe(0);
  });

  it('does not mutate the input', () => {
    const sc = newShipCombat(ship(), 1);
    sc.shields = 40;
    regenShields(sc, cfg());
    expect(sc.shields).toBe(40);
  });

  it('honours the tuning flag when flipped false (defensive; Ruling E pins it true)', () => {
    const sc = newShipCombat(ship(), 1);
    sc.shields = 40;
    const out = regenShields(sc, cfg({ regenTicksRegardlessOfDamage: false }));
    expect(out.shields).toBe(40);
  });
});

describe('calledShotsUnlocked — Decision 4', () => {
  it('true exactly when shields hit zero', () => {
    const sc = newShipCombat(ship(), 1);
    expect(calledShotsUnlocked(sc)).toBe(false);
    sc.shields = 1;
    expect(calledShotsUnlocked(sc)).toBe(false);
    sc.shields = 0;
    expect(calledShotsUnlocked(sc)).toBe(true);
  });

  it('true when shields are negative (defensive — over-application never blocks the gate)', () => {
    const sc = newShipCombat(ship(), 1);
    sc.shields = -5;
    expect(calledShotsUnlocked(sc)).toBe(true);
  });
});
