// M14 UI — glossary copy for the derived-stats panel (S06).
//
// Plain-language definitions of every FR-6 readout the Shipyard shows in the
// DERIVED panel plus its PER-WEAPON sub-table. The copy is grounded in the
// formulas and semantics established by `src/domain/derivedStats.ts` — so
// tests can prove the glossary covers every field the domain exposes, and a
// future rename over there surfaces here as a stale key. The Shipyard wires
// each row via a `tipKey: GlossaryKey`, keeping the definition next to the
// number the player is trying to understand.
//
// Static object (no i18n indirection). Kept in this component-library file so
// screens read only from the barrel — the glossary is `read-only reference
// text`, not a data source that varies per catalog version.

/**
 * The union of every glossary key the derived-stats readout and its
 * per-weapon sub-table reference. One entry per DerivedStats field, plus:
 *   - `expectedDpt` — the PER-WEAPON header's expected damage-per-turn
 *   - `weaponSpec` — the R · D · × · ACC legend under each weapon row
 */
export type GlossaryKey =
  | 'maxHull'
  | 'shieldCapacity'
  | 'shieldRegenPerTurn'
  | 'deltaVPerTurn'
  | 'totalMass'
  | 'effectiveAcceleration'
  | 'totalMissileAmmo'
  | 'baseEvasion'
  | 'perTurnHullRepair'
  | 'expectedDpt'
  | 'weaponSpec';

/**
 * Definition text keyed by concept. Each string is a single sentence, no
 * markup, safe to render as a text node (XSS-safe — every rule in
 * `src/ui/**` treats user + reference text as text nodes only).
 */
export const GLOSSARY: Record<GlossaryKey, string> = {
  maxHull:
    'Hull points. Chassis hull plus any armor-plating bonus. Ship is destroyed at 0.',
  shieldCapacity:
    'Total shield points across every fitted shield. Absorbs damage before hull.',
  shieldRegenPerTurn:
    'Shield points restored each turn, summed across every fitted shield.',
  deltaVPerTurn:
    'How much you can change velocity in one turn: total thrust ÷ total mass. 0 means dead in space (legal but bad).',
  totalMass:
    'Chassis mass plus every fitted component. Heavier ships get less delta-V from the same thrust.',
  effectiveAcceleration:
    'Delta-V divided by the turn duration in seconds — your acceleration.',
  totalMissileAmmo:
    'Missiles you can launch across the whole match, summed across every fitted missile rack.',
  baseEvasion:
    'Base chance to be missed (0 to 1). Reduces incoming hit chance. Decoy bonuses are per-turn and are not included here.',
  perTurnHullRepair:
    'Hull points repaired at the end of each turn, summed across every damage-control special.',
  expectedDpt:
    'Expected damage per turn across every fitted weapon: sum of damage × shots × base accuracy.',
  weaponSpec:
    'R = range, D = damage per shot, × = shots per turn, ACC = base accuracy (0 to 1). Full hit chance factors in range and evasion at fire time.',
};
