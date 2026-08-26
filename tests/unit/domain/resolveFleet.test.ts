// M05 Domain — resolveFleet tests (S03 checkpoint 3, architecture §4).
//
// Build → SimShip field-by-field for a known cruiser fit; a fleet of N
// resolves to N ships with matching buildIds; resolveArena picks the right
// radius by budget and throws for illegal budgets; physicsConfigFromTuning
// maps every field. Also pins the design decisions the STATE.md handoff
// records: active specials structured (point-defense, decoy), passive folded.

import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../../../src/catalog/index.js';
import type { BuildMeta, ValidatedBuild } from '../../../src/domain/types.js';
import { emptyBuild, withSlot } from '../../../src/domain/build.js';
import {
  physicsConfigFromTuning,
  resolveArena,
  resolveFleet,
  resolveShip,
} from '../../../src/domain/resolveFleet.js';
import { validateFit } from '../../../src/domain/validateFit.js';

const catalog = loadCatalog();

const meta = (id: string = '00000000-0000-4000-8000-000000000001'): BuildMeta => ({
  id,
  schemaVersion: 1,
  catalogVersion: catalog.catalogVersion,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

// Sugar: build → validate → unwrap.
const validate = (b: ReturnType<typeof emptyBuild>): ValidatedBuild => {
  if (!b.ok) throw new Error('expected build ok');
  const v = validateFit(catalog, b.value);
  if (!v.ok) throw new Error(`expected validate ok: ${v.error.map((e) => e.code).join(',')}`);
  return v.value;
};

describe('resolveShip — field-by-field mapping from a known cruiser fit', () => {
  it('empty Hammerhead → identity + chassis numbers + empty arrays', () => {
    const v = validate(emptyBuild(catalog, 'cru-hammerhead', 'Test Hammerhead', meta('id-1')));
    const ship = resolveShip(catalog, v);
    expect(ship.buildId).toBe('id-1');
    expect(ship.name).toBe('Test Hammerhead');
    expect(ship.chassisClass).toBe('cruiser');
    expect(ship.radius).toBe(32); // Hammerhead hullRadius
    expect(ship.mass).toBe(78);
    expect(ship.maxHull).toBe(190);
    expect(ship.baseEvasion).toBeCloseTo(0.14, 10);
    expect(ship.shieldCapacity).toBe(0);
    expect(ship.shieldRegenPerTurn).toBe(0);
    expect(ship.deltaVPerTurn).toBe(0);
    expect(ship.hullRepairPerTurn).toBe(0);
    expect(ship.weapons).toEqual([]);
    expect(ship.missiles).toEqual([]);
    expect(ship.pointDefense).toEqual([]);
    expect(ship.decoys).toEqual([]);
  });

  it('fully-fitted Hammerhead maps every axis correctly', () => {
    // Slots: 0 pulse-array, 1 fusion-lance, 2 scatter-gun,
    //        3 fluxweave, 4 skim,
    //        5 tack-launcher, 6 hornet-rack,
    //        7 standard-drive,
    //        8 damage-control
    const b = emptyBuild(catalog, 'cru-hammerhead', 'Full Hammerhead', meta('id-full'));
    if (!b.ok) throw new Error('expected ok');
    let fitted = withSlot(b.value, 0, 'wpn-pulse-array');
    fitted = withSlot(fitted, 1, 'wpn-fusion-lance');
    fitted = withSlot(fitted, 2, 'wpn-scatter-gun');
    fitted = withSlot(fitted, 3, 'shd-fluxweave');
    fitted = withSlot(fitted, 4, 'shd-skim');
    fitted = withSlot(fitted, 5, 'mis-tack-launcher');
    fitted = withSlot(fitted, 6, 'mis-hornet-rack');
    fitted = withSlot(fitted, 7, 'eng-standard-drive');
    fitted = withSlot(fitted, 8, 'spc-damage-control');
    const v = validateFit(catalog, fitted);
    if (!v.ok) throw new Error(`expected ok: ${v.error.map((e) => e.code).join(',')}`);
    const ship = resolveShip(catalog, v.value);

    // Mass = chassis 78 + Σ component masses (2+7+3 + 3+1 + 2+3 + 4 + 3) = 106
    expect(ship.mass).toBe(78 + 2 + 7 + 3 + 3 + 1 + 2 + 3 + 4 + 3);

    // Shields: capacity 40+22 = 62; regen 12+4 = 16
    expect(ship.shieldCapacity).toBe(62);
    expect(ship.shieldRegenPerTurn).toBe(16);

    // Engine (Standard Drive thrustImpulse 6000) / totalMass. No booster fitted.
    expect(ship.deltaVPerTurn).toBeCloseTo(6000 / ship.mass, 10);

    // Damage control → 8 hull repair per turn.
    expect(ship.hullRepairPerTurn).toBe(8);

    // Weapons array — 3 rows, in slot order.
    expect(ship.weapons).toEqual([
      { range: 900, damage: 6, shotsPerTurn: 3, accuracy: 0.7 },  // pulse-array
      { range: 1600, damage: 40, shotsPerTurn: 1, accuracy: 0.78 }, // fusion-lance
      { range: 600, damage: 5, shotsPerTurn: 5, accuracy: 0.55 },  // scatter-gun
    ]);

    // Missiles — 2 racks, in slot order.
    expect(ship.missiles).toEqual([
      { ammo: 4, damage: 14, aoeRadius: 30, boostVelocity: 240, trackingTurnRate: 0.34, bodyMass: 1, bodyRadius: 4 },
      { ammo: 6, damage: 18, aoeRadius: 60, boostVelocity: 220, trackingTurnRate: 0.3, bodyMass: 1, bodyRadius: 5 },
    ]);

    // No point-defense / decoys on this fit.
    expect(ship.pointDefense).toEqual([]);
    expect(ship.decoys).toEqual([]);
  });

  it('active specials are carried STRUCTURED, not folded (Design Decision)', () => {
    // Fighter (Needle) with a decoy launcher.
    const b = emptyBuild(catalog, 'fig-needle', 'Decoy Fighter', meta());
    if (!b.ok) throw new Error('expected ok');
    const fitted = withSlot(b.value, 2, 'spc-decoy-launcher');
    const v = validateFit(catalog, fitted);
    if (!v.ok) throw new Error('expected ok');
    const ship = resolveShip(catalog, v.value);
    expect(ship.decoys).toHaveLength(1);
    expect(ship.decoys[0]).toEqual({ charges: 3, evasionBonus: 0.25, durationTurns: 1 });
    // baseEvasion stays the chassis value — the decoy bonus is a rule, not a stat.
    expect(ship.baseEvasion).toBeCloseTo(0.42, 10);
  });

  it('point-defense is carried structured too', () => {
    const b = emptyBuild(catalog, 'cru-hammerhead', 'PD Cruiser', meta());
    if (!b.ok) throw new Error('expected ok');
    const fitted = withSlot(b.value, 8, 'spc-point-defense');
    const v = validateFit(catalog, fitted);
    if (!v.ok) throw new Error('expected ok');
    const ship = resolveShip(catalog, v.value);
    expect(ship.pointDefense).toHaveLength(1);
    expect(ship.pointDefense[0]).toEqual({
      interceptRange: 400,
      interceptChance: 0.55,
      interceptsPerTurn: 3,
    });
  });

  it('passive specials fold into the numeric readout (armor-plating → maxHull)', () => {
    const b = emptyBuild(catalog, 'cru-hammerhead', 'Armored', meta());
    if (!b.ok) throw new Error('expected ok');
    const fitted = withSlot(b.value, 8, 'spc-armor-plating');
    const v = validateFit(catalog, fitted);
    if (!v.ok) throw new Error('expected ok');
    const ship = resolveShip(catalog, v.value);
    // No structured spec — passive.
    expect(ship.pointDefense).toEqual([]);
    expect(ship.decoys).toEqual([]);
    // Folded into maxHull.
    expect(ship.maxHull).toBe(190 + 60);
  });
});

describe('resolveFleet — N builds → N ships, matching buildIds', () => {
  it('maps ships in input order and preserves buildId identity', () => {
    const b1 = validate(emptyBuild(catalog, 'fig-needle', 'A', meta('build-A')));
    const b2 = validate(emptyBuild(catalog, 'fig-wasp', 'B', meta('build-B')));
    const b3 = validate(emptyBuild(catalog, 'cru-hammerhead', 'C', meta('build-C')));
    const fleet = resolveFleet(catalog, 2, [b1, b2, b3]);
    expect(fleet.fleetId).toBe(2);
    expect(fleet.ships).toHaveLength(3);
    expect(fleet.ships.map((s) => s.buildId)).toEqual(['build-A', 'build-B', 'build-C']);
    expect(fleet.ships.map((s) => s.chassisClass)).toEqual(['fighter', 'fighter', 'cruiser']);
  });

  it('empty fleet is legal (no ships in the roster yet)', () => {
    const fleet = resolveFleet(catalog, 0, []);
    expect(fleet.fleetId).toBe(0);
    expect(fleet.ships).toEqual([]);
  });
});

describe('resolveArena — arena radius from budget (Ruling C, catalog C9)', () => {
  it('budget 100 → radius 3400 (from tuning.arena.radiusByBudget)', () => {
    const arena = resolveArena(catalog.tuning, 100);
    expect(arena.radius).toBe(3400);
    expect(arena.center).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('every legal budget resolves to a defined radius', () => {
    for (const b of catalog.tuning.match.legalBudgets) {
      const arena = resolveArena(catalog.tuning, b);
      expect(arena.radius).toBeGreaterThan(0);
    }
  });

  it('an illegal budget throws (RangeError)', () => {
    expect(() => resolveArena(catalog.tuning, 99)).toThrow(RangeError);
    expect(() => resolveArena(catalog.tuning, 0)).toThrow(RangeError);
    expect(() => resolveArena(catalog.tuning, -100)).toThrow(RangeError);
  });
});

describe('physicsConfigFromTuning — every field maps', () => {
  it('reads dt/subStep/restitution/damageCoefficient/arena from tuning', () => {
    const cfg = physicsConfigFromTuning(catalog.tuning, 100);
    expect(cfg.dt).toBe(catalog.tuning.match.turnDurationSeconds);       // 10
    expect(cfg.subStepMin).toBe(catalog.tuning.match.movementSubStepMin); // 4
    expect(cfg.subStepMax).toBe(catalog.tuning.match.movementSubStepMax); // 64
    expect(cfg.restitution).toBe(catalog.tuning.collision.restitution);   // 0.15
    expect(cfg.collisionDamageCoefficient).toBe(
      catalog.tuning.collision.damageCoefficient,
    );                                                                    // 0.0012
    expect(cfg.arena.radius).toBe(3400);
    expect(cfg.arena.center).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('propagates illegal-budget throw from resolveArena', () => {
    expect(() => physicsConfigFromTuning(catalog.tuning, 99)).toThrow(RangeError);
  });
});
