// M05 Domain — derivedStats tests (S03 checkpoint 1, FR-6 / specs/database.md §2.3).
//
// The load-bearing formula is the deltaV/mass one — verify with real catalog numbers.
// Passive specials fold (armor-plating → maxHull, thrust-booster → deltaV numerator,
// damage-control → perTurnHullRepair). Active specials do NOT fold (decoy-launcher's
// evasionBonus stays a sim/rules concern; point-defense is a rule too).

import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../../../src/catalog/index.js';
import type { BuildMeta } from '../../../src/domain/types.js';
import { emptyBuild, withSlot } from '../../../src/domain/build.js';
import { derivedStats } from '../../../src/domain/derivedStats.js';
import { validateFit } from '../../../src/domain/validateFit.js';

const catalog = loadCatalog();

const meta = (): BuildMeta => ({
  id: '00000000-0000-4000-8000-000000000001',
  schemaVersion: 1,
  catalogVersion: catalog.catalogVersion,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

// Sugar: build → validate → unwrap. Tests fail loudly if the fit is illegal.
const validate = (b: ReturnType<typeof emptyBuild>) => {
  if (!b.ok) throw new Error('expected build ok');
  const v = validateFit(catalog, b.value);
  if (!v.ok) throw new Error(`expected validate ok: ${v.error.map((e) => e.code).join(',')}`);
  return v.value;
};

describe('derivedStats — the mass/hull axes', () => {
  it('empty Hammerhead reports chassis-only mass (78) and hull (190)', () => {
    // Cruiser Hammerhead: mass 78, hullPoints 190, baseEvasion 0.14 (from catalog/chassis/cruiser.json)
    const v = validate(emptyBuild(catalog, 'cru-hammerhead', 'x', meta()));
    const stats = derivedStats(catalog, v);
    expect(stats.totalMass).toBe(78);
    expect(stats.maxHull).toBe(190);
    expect(stats.baseEvasion).toBeCloseTo(0.14, 10);
    // No shields, no engines, no missiles, no repair → all zeros.
    expect(stats.shieldCapacity).toBe(0);
    expect(stats.shieldRegenPerTurn).toBe(0);
    expect(stats.deltaVPerTurn).toBe(0);
    expect(stats.effectiveAcceleration).toBe(0);
    expect(stats.totalMissileAmmo).toBe(0);
    expect(stats.perTurnHullRepair).toBe(0);
    expect(stats.weapons).toEqual([]);
  });

  it('fitted component masses add to chassis mass', () => {
    // Hammerhead (78) + Fusion Lance (mass 7) + Fluxweave (mass 3) = 88
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    let fitted = withSlot(b.value, 0, 'wpn-fusion-lance');
    fitted = withSlot(fitted, 3, 'shd-fluxweave');
    const v = validateFit(catalog, fitted);
    if (!v.ok) throw new Error('expected ok');
    expect(derivedStats(catalog, v.value).totalMass).toBe(78 + 7 + 3);
  });

  it('armor-plating adds 60 to maxHull', () => {
    // Hammerhead hullPoints 190 + Armor Plating bonusHull 60 = 250; mass adds too (chassis 78 + armor 9 = 87)
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const fitted = withSlot(b.value, 8, 'spc-armor-plating');
    const v = validateFit(catalog, fitted);
    if (!v.ok) throw new Error('expected ok');
    const stats = derivedStats(catalog, v.value);
    expect(stats.maxHull).toBe(190 + 60);
    expect(stats.totalMass).toBe(78 + 9);
  });
});

describe('derivedStats — the deltaV/mass formula (specs/database.md §2.3)', () => {
  it('Hammerhead (mass 78) + Standard Drive (thrustImpulse 6000, mass 4) → deltaV = 6000 / (78+4)', () => {
    // Note: fits into slot 7 (engine slot on cruiser). Then divide by total mass.
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const fitted = withSlot(b.value, 7, 'eng-standard-drive');
    const v = validateFit(catalog, fitted);
    if (!v.ok) throw new Error('expected ok');
    const stats = derivedStats(catalog, v.value);
    const expectedTotalMass = 78 + 4;
    const expectedDeltaV = 6000 / expectedTotalMass;
    expect(stats.totalMass).toBe(expectedTotalMass);
    expect(stats.deltaVPerTurn).toBeCloseTo(expectedDeltaV, 10);
    // effectiveAcceleration = deltaV / turnDurationSeconds; tuning is 10s.
    expect(stats.effectiveAcceleration).toBeCloseTo(expectedDeltaV / 10, 10);
  });

  it('thrust-booster is added to the NUMERATOR before the divide', () => {
    // Hammerhead (78) + Standard Drive (6000, mass 4) + Thrust Booster (bonus 3000, mass 2)
    // → deltaV = (6000 + 3000) / (78 + 4 + 2) = 9000 / 84
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    let fitted = withSlot(b.value, 7, 'eng-standard-drive');
    fitted = withSlot(fitted, 8, 'spc-thrust-booster');
    const v = validateFit(catalog, fitted);
    if (!v.ok) throw new Error('expected ok');
    const stats = derivedStats(catalog, v.value);
    expect(stats.totalMass).toBe(78 + 4 + 2);
    expect(stats.deltaVPerTurn).toBeCloseTo(9000 / 84, 10);
  });

  it('degenerate fit (cheapest engine, heaviest hull) reports faithfully — NO delta-V floor (§11 Q4)', () => {
    // Meridian (mass 88) + Ion Trickle (thrustImpulse 2400, mass 2) → deltaV = 2400 / 90 ≈ 26.7
    // (This is *legal-but-bad*; a floor would hide the trade — deliberately absent.)
    const b = emptyBuild(catalog, 'cru-meridian', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const fitted = withSlot(b.value, 7, 'eng-ion-trickle');
    const v = validateFit(catalog, fitted);
    if (!v.ok) throw new Error('expected ok');
    const stats = derivedStats(catalog, v.value);
    const expected = 2400 / (88 + 2);
    expect(stats.deltaVPerTurn).toBeCloseTo(expected, 10);
    // The value is small — but nothing rounds it up. It stays what the formula says.
    expect(stats.deltaVPerTurn).toBeLessThan(30);
  });

  it('no engine → deltaVPerTurn = 0 (dead in space is legal — FR-18 same terminal state)', () => {
    const v = validate(emptyBuild(catalog, 'cru-hammerhead', 'x', meta()));
    expect(derivedStats(catalog, v).deltaVPerTurn).toBe(0);
  });
});

describe('derivedStats — shield + missile + repair folding', () => {
  it('two shields sum both capacity and regen', () => {
    // Skim (cap 22, regen 4) + Fluxweave (cap 40, regen 12) = cap 62, regen 16
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    let fitted = withSlot(b.value, 3, 'shd-skim');
    fitted = withSlot(fitted, 4, 'shd-fluxweave');
    const v = validateFit(catalog, fitted);
    if (!v.ok) throw new Error('expected ok');
    const stats = derivedStats(catalog, v.value);
    expect(stats.shieldCapacity).toBe(22 + 40);
    expect(stats.shieldRegenPerTurn).toBe(4 + 12);
  });

  it('missile ammo sums across racks', () => {
    // Tack (ammo 4) + Hornet (ammo 6) = 10
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    let fitted = withSlot(b.value, 5, 'mis-tack-launcher');
    fitted = withSlot(fitted, 6, 'mis-hornet-rack');
    const v = validateFit(catalog, fitted);
    if (!v.ok) throw new Error('expected ok');
    expect(derivedStats(catalog, v.value).totalMissileAmmo).toBe(4 + 6);
  });

  it('damage-control adds to perTurnHullRepair', () => {
    // Damage Control repairs 8/turn.
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const fitted = withSlot(b.value, 8, 'spc-damage-control');
    const v = validateFit(catalog, fitted);
    if (!v.ok) throw new Error('expected ok');
    expect(derivedStats(catalog, v.value).perTurnHullRepair).toBe(8);
  });
});

describe('derivedStats — weapons appear as SimWeaponReadout rows', () => {
  it('one weapon → one readout row with base stats', () => {
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const fitted = withSlot(b.value, 0, 'wpn-fusion-lance');
    const v = validateFit(catalog, fitted);
    if (!v.ok) throw new Error('expected ok');
    const stats = derivedStats(catalog, v.value);
    expect(stats.weapons).toHaveLength(1);
    // Fusion Lance: range 1600, damage 40, shotsPerTurn 1, accuracy 0.78, name "Fusion Lance"
    expect(stats.weapons[0]).toEqual({
      name: 'Fusion Lance',
      range: 1600,
      damage: 40,
      shotsPerTurn: 1,
      accuracy: 0.78,
    });
  });

  it('preserves slot order across multiple weapons', () => {
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    let fitted = withSlot(b.value, 0, 'wpn-pulse-array');
    fitted = withSlot(fitted, 1, 'wpn-fusion-lance');
    fitted = withSlot(fitted, 2, 'wpn-scatter-gun');
    const v = validateFit(catalog, fitted);
    if (!v.ok) throw new Error('expected ok');
    const names = derivedStats(catalog, v.value).weapons.map((w) => w.name);
    expect(names).toEqual(['Pulse Array', 'Fusion Lance', 'Scatter Gun']);
  });
});

describe('derivedStats — decoy is a rule, NOT a stat (deliberate)', () => {
  it('decoy-launcher does NOT change baseEvasion', () => {
    // Needle has baseEvasion 0.42. Decoy Launcher has evasionBonus 0.25.
    // derivedStats.baseEvasion is the CHASSIS value only. Any UI adding decoy
    // as permanent evasion would lie (decoy is charge-limited, timed, per-turn).
    const b = emptyBuild(catalog, 'fig-needle', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const fitted = withSlot(b.value, 2, 'spc-decoy-launcher');
    const v = validateFit(catalog, fitted);
    if (!v.ok) throw new Error('expected ok');
    const stats = derivedStats(catalog, v.value);
    expect(stats.baseEvasion).toBeCloseTo(0.42, 10);
    // No hidden `evasionBonus` / `decoyEvasion` field on the readout.
    const keys = Object.keys(stats);
    expect(keys).not.toContain('evasionBonus');
    expect(keys).not.toContain('decoyEvasion');
  });

  it('point-defense does not add to the numeric readout either', () => {
    // Point-defense is a rule (intercepts missiles). Mass still counts.
    const b = emptyBuild(catalog, 'cru-hammerhead', 'x', meta());
    if (!b.ok) throw new Error('expected ok');
    const fitted = withSlot(b.value, 8, 'spc-point-defense');
    const v = validateFit(catalog, fitted);
    if (!v.ok) throw new Error('expected ok');
    const stats = derivedStats(catalog, v.value);
    expect(stats.totalMass).toBe(78 + 3); // point-defense mass 3
    // Everything else at defaults (no shields/engines/repair).
    expect(stats.deltaVPerTurn).toBe(0);
    expect(stats.perTurnHullRepair).toBe(0);
  });
});
