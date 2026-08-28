// M14 UI — Shipyard: per-item info copy (playtest-feedback-03 · S03).
//
// UI-side reference text for every catalog item shown in the Shipyard's
// pickers. Owner playtest asked "why should I choose it? what makes it
// different?" — this file answers, keyed by catalog id, in one short
// sentence grounded in the item's real stats.
//
// D-CATALOG-COPY-UI-SIDE. Authored HERE, not in the catalog JSON: the
// catalog is additive-only and hash-locked (FR-1), so item copy that WILL
// be re-worded across playtests would either bump the lock every rewrite
// or ossify the words. The precedent is `components/glossary.ts` — the
// derived-stat definitions live in the UI, not in the domain, because the
// tone iterates while the numbers do not.
//
// XSS-safe: every string is a plain text node when rendered through
// `InfoTip` (the InfoTip primitive forbids `dangerouslySetInnerHTML`
// repo-wide; `.tip-pop` renders `label` as a single text child).
//
// The diff-tag map (`DIFF_TAG`) is the SECOND playtest ask: "you can
// barely differentiate the icon." Every ComponentPicker row surfaces
// that tag so entries read apart at a glance without relying on the
// shared SlotTag glyph. Tags are derived from each component's standout
// stat — WORKHORSE / ALPHA STRIKE / HIGH REGEN / MAX THRUST / etc — and
// carry meaning even without color (never-color-alone, design §1.1).

/**
 * Per-item plain-language blurb, keyed by catalog id. One short sentence
 * per entry — what it is, what makes it different, when to pick it —
 * grounded in the item's real stats. Covers all 26 v1 components + all
 * 12 v1 chassis (proven by `catalogInfo.test.ts`).
 */
export const CATALOG_INFO: Record<string, string> = {
  // ---- Weapons (6) --------------------------------------------------------
  'wpn-pulse-array':
    'Cheap 6-damage pulse array with three reliable shots at 900u and 70% accuracy — the default workhorse when nothing exotic is needed.',
  'wpn-scatter-gun':
    'Five-shot short-range spray at 600u for 55% accuracy — trades reach and precision for raw shot volume up close.',
  'wpn-mote-repeater':
    'Four sustained 9-damage shots at 1100u — a mid-cost repeater that keeps steady pressure between the workhorse pulse and the alpha-strike heavies.',
  'wpn-rail-driver':
    'Single 22-damage slug that reaches 2200u — the cheapest way to touch a target from outside its own return-fire range.',
  'wpn-fusion-lance':
    'One 40-damage bolt at 78% accuracy out to 1600u — the most reliable single-shot heavy, but its mass and cost bite small hulls.',
  'wpn-siege-cannon':
    'One devastating 65-damage shot at 3000u range but only 48% accuracy — an alpha-strike gamble sized for cracking capital hulls.',

  // ---- Shields (5) --------------------------------------------------------
  'shd-skim':
    'Tiny 22-point pool with 4 regen — the lightest shield fit, for hulls that only need to soak a single stray hit.',
  'shd-fluxweave':
    'Fast-recovering 40-point pool with 12 regen per turn — outlasts bigger shields against steady low-damage fire.',
  'shd-cyclic':
    'Balanced 70-point pool with 10 regen — the middle-weight default, decent capacity paired with respectable recovery.',
  'shd-bulwark':
    'Heavy 120-point pool with only 6 regen — soaks a big alpha strike but slow to come back once popped.',
  'shd-aegis-lattice':
    'Massive 190-point pool with 14 regen — the flagship shield: capacity, recovery, and a cost/mass to match.',

  // ---- Missiles (5) -------------------------------------------------------
  'mis-tack-launcher':
    'Four cheap 14-damage missiles with a small 30u burst — a probing tack for softening targets or forcing point-defense reactions.',
  'mis-hornet-rack':
    'Six 18-damage missiles with a 60u burst — a balanced workhorse rack for consistent standoff pressure.',
  'mis-swarm-cell':
    'Ten 9-damage missiles with a wide 90u burst — a saturation launcher that overwhelms point-defense by sheer count.',
  'mis-lance-pod':
    'Three 55-damage missiles with a tight 40u burst and the fastest boost velocity — the most damage per shot, hardest to intercept.',
  'mis-breaker-tube':
    'Two 110-damage missiles with a huge 130u burst — a siege-grade tube meant to open capital ships in one salvo.',

  // ---- Engines (5) --------------------------------------------------------
  'eng-ion-trickle':
    'Bare-minimum 2400 thrust impulse — cheap and light, but leaves anything heavier than a fighter sluggish.',
  'eng-standard-drive':
    'Balanced 6000 thrust impulse — the general-purpose drive; the neutral choice for most frigate and cruiser fits.',
  'eng-vector-cluster':
    'Light 7500 thrust impulse at only 3 mass — pay in points for the best thrust-per-mass ratio in the catalog.',
  'eng-burner':
    'Heavy 10000 thrust impulse — the go-to engine for mid-mass ships that need serious delta-V without breaking the point budget.',
  'eng-torch':
    'Massive 15000 thrust impulse — the only engine that keeps a mega-destroyer nimble, but its mass and cost are steep.',

  // ---- Specials (5) -------------------------------------------------------
  'spc-armor-plating':
    'Adds a flat 60 hull points — the cheapest way to survive an alpha strike, at the cost of 9 mass eating into delta-V.',
  'spc-decoy-launcher':
    'Three charges that grant +0.25 evasion for one turn each — a defensive burst you time against incoming fire.',
  'spc-thrust-booster':
    'Adds 3000 thrust impulse for only 2 mass — a way to add engine power without a second engine slot.',
  'spc-point-defense':
    'Intercepts up to 3 missiles per turn within 400u at 55% chance — the primary counter to missile-heavy fleets.',
  'spc-damage-control':
    'Repairs 8 hull points at the end of every turn — a slow but permanent recovery that outlasts short skirmishes.',

  // ---- Chassis (12) -------------------------------------------------------
  'fig-needle':
    'Cheapest 4-point fighter: 18 hull, 42% base evasion, only three slots — the interceptor pick for saturation swarms.',
  'fig-wasp':
    'Mid 6-point fighter: 26 hull, 36% evasion — the balanced fighter, tough enough to trade shots while still hard to hit.',
  'fig-shrike':
    'Heavy 8-point fighter: 34 hull, 30% evasion — the durable fighter, closer to a mini-frigate than a scout.',
  'frg-lancet':
    'Cheapest 12-point frigate: 70 hull and six slots — the entry-level medium hull, room for a first weapons + shield + missile fit.',
  'frg-bastion':
    'Heavy 16-point frigate: 96 hull for the toughest sub-cruiser — trades evasion for the ability to soak sustained fire.',
  'frg-harrier':
    'Fast 20-point frigate: 84 hull and 27% evasion — pays a premium to keep frigate durability with the highest frigate evasion.',
  'cru-hammerhead':
    'Entry 30-point cruiser: 190 hull, nine slots — the first hull that fits a three-weapon two-shield layout.',
  'cru-meridian':
    'Mid 38-point cruiser: 220 hull for a versatile main-line hull — the default cruiser choice.',
  'cru-basilisk':
    'Heavy 45-point cruiser: 260 hull — capital-adjacent durability without paying mega-destroyer prices.',
  'meg-anvil':
    'Entry 72-point mega-destroyer: 430 hull, twelve slots — the first hull with four weapons and two specials.',
  'meg-leviathan':
    'Mid 90-point mega-destroyer: 540 hull — the flagship main-line: massive throughput and staying power.',
  'meg-oblivion':
    'Peak 108-point mega-destroyer: 640 hull — the biggest hull in the catalog; a single Oblivion consumes most of a small skirmish budget.',
};

/**
 * Typed accessor. Returns `undefined` for an id with no entry — callers
 * fall back to the item's own name (the `InfoTip` label is required
 * non-empty, so a fallback keeps the a11y contract intact even if a new
 * catalog entry lands before its blurb is authored). The
 * `catalogInfo.test.ts` coverage suite guards against that gap in CI.
 */
export const infoFor = (id: string): string | undefined => CATALOG_INFO[id];

/**
 * Per-component "what makes it different" tag, keyed by catalog id. One
 * short all-caps phrase per entry, derived from that component's standout
 * stat (range / damage / regen / thrust / etc). Rendered next to the
 * component name in the picker so rows read apart at a glance — never
 * color-alone (design §1.1); the tag carries meaning as pure text.
 *
 * Chassis rows are NOT tagged here: the chassis picker already shows the
 * class letter (F/G/C/D), hull/mass/evasion, and cost — enough per-row
 * differentiation without a second tag layer.
 */
export const DIFF_TAG: Record<string, string> = {
  // Weapons — angle: range × damage × shots × accuracy
  'wpn-pulse-array': 'WORKHORSE',
  'wpn-scatter-gun': 'HIGH VOLUME',
  'wpn-mote-repeater': 'SUSTAINED',
  'wpn-rail-driver': 'LONG RANGE',
  'wpn-fusion-lance': 'PRECISION',
  'wpn-siege-cannon': 'ALPHA STRIKE',

  // Shields — angle: capacity vs regen
  'shd-skim': 'LIGHTWEIGHT',
  'shd-fluxweave': 'HIGH REGEN',
  'shd-cyclic': 'BALANCED',
  'shd-bulwark': 'HIGH CAPACITY',
  'shd-aegis-lattice': 'FLAGSHIP',

  // Missiles — angle: ammo × damage × aoe
  'mis-tack-launcher': 'PROBE',
  'mis-hornet-rack': 'WORKHORSE',
  'mis-swarm-cell': 'SATURATION',
  'mis-lance-pod': 'HARD HITTER',
  'mis-breaker-tube': 'SIEGE',

  // Engines — angle: thrust impulse
  'eng-ion-trickle': 'MINIMAL',
  'eng-standard-drive': 'BALANCED',
  'eng-vector-cluster': 'THRUST / MASS',
  'eng-burner': 'HIGH THRUST',
  'eng-torch': 'MAX THRUST',

  // Specials — angle: effect
  'spc-armor-plating': 'HULL PLATE',
  'spc-decoy-launcher': 'EVASION BURST',
  'spc-thrust-booster': 'EXTRA THRUST',
  'spc-point-defense': 'ANTI-MISSILE',
  'spc-damage-control': 'SELF-REPAIR',
};

/** Typed accessor for `DIFF_TAG`; returns undefined for chassis / unknown ids. */
export const diffTagFor = (id: string): string | undefined => DIFF_TAG[id];
