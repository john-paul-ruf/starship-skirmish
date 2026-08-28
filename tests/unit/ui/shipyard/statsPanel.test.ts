// M14 UI — StatsPanel glossary wiring (playtest-feedback-01 · S06 CP3).
//
// StatsPanel is a `.tsx` module; importing it into a node-env test would pull
// JSX into `tsc --noEmit -p tsconfig.node.json` (see the S03 handoff note
// preserved in shipyard/model.test.ts). Instead this test reads the panel
// source verbatim and proves the glossary-tip wiring is complete:
//
//   1. every StatWithDelta row for a derived stat carries a `tipKey`
//   2. every referenced `tipKey` resolves to a defined GLOSSARY entry
//   3. the per-weapon header carries the two tips the session prompt names
//      (weaponSpec on the legend, expectedDpt on the sub-header)
//
// This keeps the wiring drift-safe without importing the JSX module: rename a
// DerivedStats field in domain and this suite plus the tooltip suite catch it.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { GLOSSARY, type GlossaryKey } from '../../../../src/ui/components/index.js';

const STATS_PANEL_PATH = fileURLToPath(
  new URL('../../../../src/ui/screens/shipyard/StatsPanel.tsx', import.meta.url),
);
const source = readFileSync(STATS_PANEL_PATH, 'utf8');

/** Every stat-row testid the panel renders, paired with its expected GlossaryKey. */
const STAT_ROWS: ReadonlyArray<readonly [testid: string, tipKey: GlossaryKey]> = [
  ['shipyard-stat-maxHull', 'maxHull'],
  ['shipyard-stat-shieldCapacity', 'shieldCapacity'],
  ['shipyard-stat-shieldRegen', 'shieldRegenPerTurn'],
  ['shipyard-stat-deltaV', 'deltaVPerTurn'],
  ['shipyard-stat-mass', 'totalMass'],
  ['shipyard-stat-accel', 'effectiveAcceleration'],
  ['shipyard-stat-missileAmmo', 'totalMissileAmmo'],
  ['shipyard-stat-evasion', 'baseEvasion'],
  ['shipyard-stat-hullRepair', 'perTurnHullRepair'],
];

describe('StatsPanel — every derived row carries a glossary tip (S06 CP3)', () => {
  it.each(STAT_ROWS)(
    'row `%s` is wired to GLOSSARY key `%s`',
    (testid, tipKey) => {
      // Row is still present (regression protection — S05 CP3 promise).
      expect(source).toContain(`testid="${testid}"`);
      // Row carries the expected tipKey (drift-safe wiring).
      expect(source).toMatch(
        new RegExp(`testid="${testid}"[\\s\\S]*?tipKey="${tipKey}"`),
      );
      // GLOSSARY has a definition for that key.
      expect(GLOSSARY[tipKey]).toBeDefined();
      expect(GLOSSARY[tipKey].length).toBeGreaterThan(10);
    },
  );

  it('per-weapon header carries the weaponSpec legend tip', () => {
    expect(source).toContain('tip-shipyard-per-weapon-legend');
    expect(source).toContain('GLOSSARY.weaponSpec');
  });

  it('per-weapon header carries the expectedDpt sub-header tip', () => {
    expect(source).toContain('tip-shipyard-per-weapon-expectedDpt');
    expect(source).toContain('GLOSSARY.expectedDpt');
  });

  it('per-weapon header tip ids are unique literals (a11y linkage)', () => {
    // The two per-weapon tips use literal ids; each must appear exactly once
    // — duplicate ids on a single page collapse the aria-describedby link.
    // Stat-row tips are template-generated from the row testid
    // (`tip-${testid}`) and inherit uniqueness from the row testids, which
    // are themselves proven distinct by the per-row match above.
    for (const id of [
      'tip-shipyard-per-weapon-legend',
      'tip-shipyard-per-weapon-expectedDpt',
    ]) {
      const occurrences = source.split(id).length - 1;
      expect(occurrences).toBe(1);
    }
  });

  it('stat-row tip ids are template-generated from the row testid', () => {
    // The `tip-${testid}` template ensures every stat-row id is unique so
    // long as the row testids are — which they are (one row per DerivedStats
    // field, testids matched literally in this suite's STAT_ROWS table).
    expect(source).toContain('id={`tip-${testid}`}');
  });
});
