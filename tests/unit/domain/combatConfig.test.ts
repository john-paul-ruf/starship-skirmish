// M05 Domain — combatConfigFromTuning tests (S01 checkpoint 2, sim-combat feature).
//
// Every combat-tuning field in the real catalog round-trips through the resolver
// unchanged; the per-class tables narrow to exactly the four ChassisClass keys;
// a missing class in a per-class table fails loud (RangeError), matching the
// established `resolveArena` posture.
//
// This is the domain → sim seam for combat: the sim can't import the catalog,
// so a stale/incomplete resolver would surface much later as an undefined index
// deep inside the beat resolver. Fail here instead.

import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../../../src/catalog/index.js';
import type { Tuning } from '../../../src/catalog/index.js';
import { combatConfigFromTuning } from '../../../src/domain/resolveFleet.js';

const catalog = loadCatalog();
const CLASSES = ['fighter', 'frigate', 'cruiser', 'mega-destroyer'] as const;

describe('combatConfigFromTuning — every tuning field maps faithfully', () => {
  const cfg = combatConfigFromTuning(catalog.tuning);

  it('hazards scalars copy across unchanged', () => {
    expect(cfg.hazards.maxSimultaneousBodies).toBe(
      catalog.tuning.hazards.maxSimultaneousBodies,
    );
    expect(cfg.hazards.debrisLifetimeTurns).toBe(
      catalog.tuning.hazards.debrisLifetimeTurns,
    );
    expect(cfg.hazards.debrisScatterImpulse).toBe(
      catalog.tuning.hazards.debrisScatterImpulse,
    );
    expect(cfg.hazards.debrisMassFractionOfHull).toBe(
      catalog.tuning.hazards.debrisMassFractionOfHull,
    );
    expect(cfg.hazards.debrisRadius).toBe(catalog.tuning.hazards.debrisRadius);
  });

  it('hazards.debrisPerDestruction narrows to all four ChassisClass keys', () => {
    for (const c of CLASSES) {
      expect(cfg.hazards.debrisPerDestruction[c]).toBe(
        catalog.tuning.hazards.debrisPerDestruction[c],
      );
    }
    expect(Object.keys(cfg.hazards.debrisPerDestruction).sort()).toEqual(
      [...CLASSES].sort(),
    );
  });

  it('destruction per-class tables carry every value', () => {
    for (const c of CLASSES) {
      expect(cfg.destruction.aoeRadiusByClass[c]).toBe(
        catalog.tuning.destruction.aoeRadiusByClass[c],
      );
      expect(cfg.destruction.aoeDamageByClass[c]).toBe(
        catalog.tuning.destruction.aoeDamageByClass[c],
      );
    }
    expect(Object.keys(cfg.destruction.aoeRadiusByClass).sort()).toEqual(
      [...CLASSES].sort(),
    );
    expect(Object.keys(cfg.destruction.aoeDamageByClass).sort()).toEqual(
      [...CLASSES].sort(),
    );
  });

  it('missiles + shields booleans/numbers pass through unchanged', () => {
    expect(cfg.missiles.trackingBeats).toBe(catalog.tuning.missiles.trackingBeats);
    expect(cfg.missiles.spentRemainsArmed).toBe(
      catalog.tuning.missiles.spentRemainsArmed,
    );
    expect(cfg.missiles.reacquireOnTargetLoss).toBe(
      catalog.tuning.missiles.reacquireOnTargetLoss,
    );
    expect(cfg.shields.regenTicksRegardlessOfDamage).toBe(
      catalog.tuning.shields.regenTicksRegardlessOfDamage,
    );
  });

  it('produces a full CombatConfig — no field left undefined on the shipped catalog', () => {
    // A defensive snapshot: any accidental omission surfaces here as `undefined`.
    expect(cfg).toEqual({
      hazards: {
        maxSimultaneousBodies: catalog.tuning.hazards.maxSimultaneousBodies,
        debrisLifetimeTurns: catalog.tuning.hazards.debrisLifetimeTurns,
        debrisPerDestruction: {
          fighter: catalog.tuning.hazards.debrisPerDestruction['fighter'],
          frigate: catalog.tuning.hazards.debrisPerDestruction['frigate'],
          cruiser: catalog.tuning.hazards.debrisPerDestruction['cruiser'],
          'mega-destroyer':
            catalog.tuning.hazards.debrisPerDestruction['mega-destroyer'],
        },
        debrisScatterImpulse: catalog.tuning.hazards.debrisScatterImpulse,
        debrisMassFractionOfHull: catalog.tuning.hazards.debrisMassFractionOfHull,
        debrisRadius: catalog.tuning.hazards.debrisRadius,
      },
      destruction: {
        aoeRadiusByClass: {
          fighter: catalog.tuning.destruction.aoeRadiusByClass['fighter'],
          frigate: catalog.tuning.destruction.aoeRadiusByClass['frigate'],
          cruiser: catalog.tuning.destruction.aoeRadiusByClass['cruiser'],
          'mega-destroyer':
            catalog.tuning.destruction.aoeRadiusByClass['mega-destroyer'],
        },
        aoeDamageByClass: {
          fighter: catalog.tuning.destruction.aoeDamageByClass['fighter'],
          frigate: catalog.tuning.destruction.aoeDamageByClass['frigate'],
          cruiser: catalog.tuning.destruction.aoeDamageByClass['cruiser'],
          'mega-destroyer':
            catalog.tuning.destruction.aoeDamageByClass['mega-destroyer'],
        },
      },
      missiles: {
        trackingBeats: catalog.tuning.missiles.trackingBeats,
        spentRemainsArmed: catalog.tuning.missiles.spentRemainsArmed,
        reacquireOnTargetLoss: catalog.tuning.missiles.reacquireOnTargetLoss,
      },
      shields: {
        regenTicksRegardlessOfDamage:
          catalog.tuning.shields.regenTicksRegardlessOfDamage,
      },
    });
  });
});

describe('combatConfigFromTuning — missing per-class key fails loud', () => {
  it('throws RangeError when aoeDamageByClass is missing "cruiser"', () => {
    // Hand-build a Tuning with cruiser missing from aoeDamageByClass.
    const tuning: Tuning = {
      ...catalog.tuning,
      destruction: {
        aoeRadiusByClass: catalog.tuning.destruction.aoeRadiusByClass,
        aoeDamageByClass: {
          fighter: 12,
          frigate: 30,
          // cruiser deliberately missing
          'mega-destroyer': 140,
        },
        cascadeToNextMovement: catalog.tuning.destruction.cascadeToNextMovement,
      },
    };
    expect(() => combatConfigFromTuning(tuning)).toThrow(RangeError);
    expect(() => combatConfigFromTuning(tuning)).toThrow(
      /aoeDamageByClass missing class "cruiser"/,
    );
  });
});
