// M14 UI — Shipyard model (S05).
//
// The pure logic layer of the Shipyard screen. `Shipyard.tsx` and its
// component subtree own the signals and rendering; every derivation — fit
// snapshot, per-bay label, chassis grouping, stats delta, save/share
// orchestration — lives HERE so it can be exercised in the node-env unit
// tests (vitest is node-only per S03's test-env reality, no DOM harness).
//
// The screen NEVER re-derives cost / legality / stats; it forwards to domain
// (`validateFit`, `pointCost`, `pointBreakdown`, `derivedStats`, `refitDiff`).
// That is what keeps player builds provably fair against bots (FR-31 — both
// pass the same `validateFit`) and it is a hard S05 review gate.
//
// Author-note (S02/S03 tsconfig.node trap): this file stays `.ts` so unit
// tests importing it never pull `.tsx` sources through `tsc --noEmit -p
// tsconfig.node.json`. Screens under `./` may be `.tsx` — tests must NOT
// import them.

import type {
  Catalog,
  ChassisClass,
  ChassisDef,
  ClassDef,
  ComponentDef,
  SlotType,
} from '../../../catalog/index.js';
import type {
  Build,
  BuildMeta,
  DerivedStats,
  FitError,
  PointBreakdown,
  RefitDiff,
  Result,
  ValidatedBuild,
} from '../../../domain/index.js';
import {
  derivedStats,
  emptyBuild,
  pointBreakdown,
  pointCost,
  refitDiff,
  slotTypesFor,
  validateFit,
  withSlot,
} from '../../../domain/index.js';
import {
  NAME_MAX,
  NAME_MIN,
  URL_TOKEN_BUDGET,
  encodeShareToken,
  normalizeName,
  normalizeTags,
  type EncodeError,
  type ValidateError,
} from '../../../io/index.js';
import { SLOT_LETTER } from '../../components/index.js';

// ---- Chassis grouping ------------------------------------------------------

/** The four ship classes rendered top-to-bottom in the catalog picker (design §3). */
export const CLASS_ORDER: readonly ChassisClass[] = [
  'fighter',
  'frigate',
  'cruiser',
  'mega-destroyer',
];

/** One row in the chassis picker's class-grouped list. */
export interface ChassisGroup {
  readonly classId: ChassisClass;
  readonly className: string;
  readonly layout: readonly SlotType[];
  readonly chassis: readonly ChassisDef[];
}

/**
 * Group `catalog.allChassis()` by class in `CLASS_ORDER`. Empty groups (a
 * class absent from the catalog) are dropped, not rendered as headers with
 * no rows underneath.
 */
export const chassisByClass = (catalog: Catalog): readonly ChassisGroup[] => {
  const groups: ChassisGroup[] = [];
  for (const classId of CLASS_ORDER) {
    const clsDef: ClassDef | undefined = catalog.classOf(classId);
    if (clsDef === undefined) continue;
    const chassis = catalog.chassisOfClass(classId);
    if (chassis.length === 0) continue;
    groups.push({
      classId,
      className: clsDef.name,
      layout: clsDef.slots,
      chassis,
    });
  }
  return groups;
};

// ---- Slot labelling --------------------------------------------------------

/**
 * Per-bay label in the mock's shape — `W1 W2 W3 S1 S2 M1 M2 E1 X1 X2`. Labels
 * are POSITIONAL within a slot type and follow the layout's arrival order,
 * matching the wireframe schematic (SlotPips uses the same ordering).
 * `layout[i]` → `slotLabels(layout)[i]`.
 */
export const slotLabels = (layout: readonly SlotType[]): readonly string[] => {
  const counters: Record<SlotType, number> = {
    weapon: 0,
    shield: 0,
    missile: 0,
    engine: 0,
    special: 0,
  };
  const labels: string[] = new Array<string>(layout.length);
  for (let i = 0; i < layout.length; i += 1) {
    const type = layout[i];
    if (type === undefined) {
      labels[i] = '';
      continue;
    }
    counters[type] += 1;
    labels[i] = `${SLOT_LETTER[type]}${counters[type]}`;
  }
  return labels;
};

// ---- Fit snapshot -----------------------------------------------------------

/**
 * The full picture the Shipyard derives from a working `Build`. One call →
 * the whole panel: cost, breakdown, legality (every violation), derived
 * stats, refit-vs-storedCost.
 *
 * `validated` is the domain nominal receipt: non-null iff `errors.length === 0`.
 * `stats` is only meaningful when `validated !== null`; on a broken fit the UI
 * shows the error list and hides the stats readout (per session prompt).
 */
export interface FitSnapshot {
  readonly build: Build;
  readonly cost: number;
  readonly breakdown: PointBreakdown;
  readonly validated: ValidatedBuild | null;
  readonly errors: readonly FitError[];
  readonly stats: DerivedStats | null;
  readonly refit: RefitDiff | null;
}

/**
 * Compute the full snapshot in ONE call. Every screen read derives from this
 * — no field is recomputed piecemeal. Order matches the §7.2 pipeline: fit →
 * cost → derive → refit.
 */
export const snapshot = (catalog: Catalog, build: Build): FitSnapshot => {
  const fit = validateFit(catalog, build);
  const breakdown = pointBreakdown(catalog, build);
  const validated = fit.ok ? fit.value : null;
  const errors: readonly FitError[] = fit.ok ? [] : fit.error;
  const stats = validated === null ? null : derivedStats(catalog, validated);
  const refit = refitDiff(catalog, build);
  return {
    build,
    cost: breakdown.total,
    breakdown,
    validated,
    errors,
    stats,
    refit,
  };
};

// ---- Stats delta (FR-6) ----------------------------------------------------

/** A signed change between two derived-stats snapshots. */
export interface StatDeltaField {
  readonly from: number;
  readonly to: number;
}

/**
 * Field-by-field diff between the previous fit's stats and the current fit's
 * stats. Both may be null (fresh build with no prior; or a broken current
 * fit) — in either case the delta is `0 → 0` on every field, which the
 * `Delta` primitive renders as `— 0` (never blank, FR-6).
 */
export interface StatsDelta {
  readonly maxHull: StatDeltaField;
  readonly shieldCapacity: StatDeltaField;
  readonly shieldRegenPerTurn: StatDeltaField;
  readonly deltaVPerTurn: StatDeltaField;
  readonly totalMass: StatDeltaField;
  readonly effectiveAcceleration: StatDeltaField;
  readonly totalMissileAmmo: StatDeltaField;
  readonly baseEvasion: StatDeltaField;
  readonly perTurnHullRepair: StatDeltaField;
}

const ZERO_STAT: StatDeltaField = { from: 0, to: 0 };

const fieldOf = (
  prev: DerivedStats | null,
  next: DerivedStats | null,
  pick: (s: DerivedStats) => number,
): StatDeltaField => {
  if (prev === null && next === null) return ZERO_STAT;
  const from = prev === null ? (next === null ? 0 : pick(next)) : pick(prev);
  const to = next === null ? (prev === null ? 0 : pick(prev)) : pick(next);
  return { from, to };
};

/**
 * Compute the per-field delta. When the previous stats are null the delta is
 * flat (a fresh build has no prior swap to compare to); when the current
 * stats are null (broken fit) the delta is also flat, so the readout does
 * not flicker between "▲ +5" and "— 0" on every keystroke of a bad fit.
 */
export const statsDelta = (
  prev: DerivedStats | null,
  next: DerivedStats | null,
): StatsDelta => ({
  maxHull: fieldOf(prev, next, (s) => s.maxHull),
  shieldCapacity: fieldOf(prev, next, (s) => s.shieldCapacity),
  shieldRegenPerTurn: fieldOf(prev, next, (s) => s.shieldRegenPerTurn),
  deltaVPerTurn: fieldOf(prev, next, (s) => s.deltaVPerTurn),
  totalMass: fieldOf(prev, next, (s) => s.totalMass),
  effectiveAcceleration: fieldOf(prev, next, (s) => s.effectiveAcceleration),
  totalMissileAmmo: fieldOf(prev, next, (s) => s.totalMissileAmmo),
  baseEvasion: fieldOf(prev, next, (s) => s.baseEvasion),
  perTurnHullRepair: fieldOf(prev, next, (s) => s.perTurnHullRepair),
});

// ---- Identity minting -------------------------------------------------------

/**
 * The UI-boundary identity mint. `crypto.randomUUID()` + `new Date().toISOString()`
 * are UI (not sim) — the determinism ban-list scopes to `src/sim/**` +
 * `src/ai/**`, per FORGE-CONFIG. Injectable for tests.
 */
export interface IdentityClock {
  readonly newId: () => string;
  readonly now: () => string;
}

/**
 * The default clock — real UUIDs, real wall time. The UI calls this at save
 * time (fresh build) or preserves an existing id + createdAt (editing).
 */
export const defaultIdentityClock: IdentityClock = {
  newId: () => globalThis.crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

/**
 * Mint a fresh `BuildMeta` for a brand-new build. `schemaVersion` +
 * `catalogVersion` come from the catalog we are authoring against; `id` +
 * timestamps come from the injected clock (real UUIDs + wall time in the UI,
 * fixed values in tests).
 */
export const freshMeta = (
  catalog: Catalog,
  schemaVersion: number,
  clock: IdentityClock = defaultIdentityClock,
): BuildMeta => {
  const now = clock.now();
  return {
    id: clock.newId(),
    schemaVersion,
    catalogVersion: catalog.catalogVersion,
    createdAt: now,
    updatedAt: now,
  };
};

// ---- Fresh build construction ---------------------------------------------

/**
 * Thin wrapper over `emptyBuild` — the UI hands us a catalog + chassis id +
 * (optional) initial name + tags; we mint identity and return a `Result`.
 * The screen's ChassisPicker calls this on click.
 */
export const createFreshBuild = (
  catalog: Catalog,
  chassisId: string,
  name: string,
  schemaVersion: number,
  clock: IdentityClock = defaultIdentityClock,
  tags: readonly string[] = [],
): Result<Build, FitError> =>
  emptyBuild(catalog, chassisId, name, freshMeta(catalog, schemaVersion, clock), tags);

// ---- Fit edit --------------------------------------------------------------

/**
 * Immutable slot set. Thin façade over `domain.withSlot`; the screen calls
 * this so the ownership of "the fit edit orchestration" stays in one file.
 * `componentId === null` clears the bay (empty is legal, FR-4).
 */
export const applySlot = (
  build: Build,
  index: number,
  componentId: string | null,
): Build => withSlot(build, index, componentId);

/**
 * Human-facing text for a `FitError` code. `validateFit`'s own messages are
 * "wire" — they name id and index in engineering terms. The Shipyard needs a
 * short bay-anchored label ("W1 — wrong slot type", "unknown component"),
 * so we own the map here. S06 (Share) may reuse this table when rendering
 * import-preview error lines — the code→label mapping is stable per S05.
 */
export const fitErrorLabel = (
  error: FitError,
  labels: readonly string[],
): string => {
  const bay =
    error.slotIndex !== undefined && labels[error.slotIndex] !== undefined
      ? labels[error.slotIndex]
      : null;
  switch (error.code) {
    case 'ERR_UNKNOWN_CHASSIS':
      return 'UNKNOWN CHASSIS';
    case 'ERR_UNKNOWN_CLASS':
      return 'UNKNOWN CLASS';
    case 'ERR_SLOT_COUNT':
      return 'SLOT COUNT MISMATCH';
    case 'ERR_UNKNOWN_COMPONENT':
      return bay === null ? 'UNKNOWN COMPONENT' : `${bay} — UNKNOWN COMPONENT`;
    case 'ERR_SLOT_TYPE_MISMATCH': {
      const bayLabel = bay === null ? 'SLOT' : bay;
      const expected =
        error.expected !== undefined ? error.expected.toUpperCase() : 'MATCHING TYPE';
      return `${bayLabel} — WRONG TYPE · NEEDS ${expected}`;
    }
  }
};

// ---- Save orchestration ----------------------------------------------------

/**
 * The state a `SaveBar` submit produces — the name+tag validation report,
 * the fit legality, and (when everything checks) the Build ready to hand to
 * `repo.put`. Empty `nameErrors` + empty `fitErrors` ⇔ `build !== null`.
 */
export interface SaveCandidate {
  readonly build: Build | null;
  readonly nameErrors: readonly ValidateError[];
  readonly fitErrors: readonly FitError[];
  readonly cleanedName: string;
  readonly cleanedTags: readonly string[];
}

/**
 * Prepare a build for `repo.put`. Runs the io normalisation (NFC + caps +
 * kebab tags), refuses on any io error, then double-checks the FIT is legal
 * (save-gates-on-fit-not-budget — STATE.md design decision, design §4.4
 * corollary). Under-budget is legal (Skirmish Setup gates on budget); a
 * broken fit is not (validateFit surfaces every problem — FR-4).
 *
 * `updatedAt` is always stamped fresh on save (both fresh and edited
 * builds); `createdAt` is preserved when editing (a non-empty createdAt) or
 * stamped fresh when the build's createdAt is empty (a freshly-minted build
 * from `createFreshBuild`, or a token preview). `storedCost` is recomputed
 * against the current catalog — a save is a "priced at this catalog" event.
 */
export const prepareSave = (
  catalog: Catalog,
  base: Build,
  rawName: string,
  rawTags: readonly string[],
  clock: IdentityClock = defaultIdentityClock,
): SaveCandidate => {
  const cleanedName = normalizeName(rawName);
  const tagResult = normalizeTags(rawTags);
  const nameErrors: ValidateError[] = [];
  if (cleanedName.length < NAME_MIN) {
    nameErrors.push({
      code: 'ERR_NAME_EMPTY',
      message: `name must be at least ${NAME_MIN} char after NFC-trim.`,
    });
  } else if (cleanedName.length > NAME_MAX) {
    nameErrors.push({
      code: 'ERR_NAME_TOO_LONG',
      message: `name is ${cleanedName.length} chars after NFC-trim; max ${NAME_MAX}.`,
    });
  }
  for (const e of tagResult.errors) nameErrors.push(e);

  const nowStamp = clock.now();
  const candidate: Build = {
    ...base,
    name: cleanedName,
    tags: tagResult.tags,
    storedCost: pointCost(catalog, base),
    catalogVersion: catalog.catalogVersion,
    createdAt: base.createdAt !== '' ? base.createdAt : nowStamp,
    updatedAt: nowStamp,
  };

  const fit = validateFit(catalog, candidate);
  const fitErrors: readonly FitError[] = fit.ok ? [] : fit.error;

  const build = nameErrors.length === 0 && fitErrors.length === 0 ? candidate : null;

  return {
    build,
    nameErrors,
    fitErrors,
    cleanedName,
    cleanedTags: tagResult.tags,
  };
};

// ---- Share-link assembly --------------------------------------------------

/**
 * A generated share link: the raw token, the fully-assembled `#/share?t=…`
 * URL to write to the clipboard, and a `longUrl` flag when the token is past
 * `URL_TOKEN_BUDGET` (still valid, but worth a soft warning per io/limits).
 */
export interface ShareLink {
  readonly token: string;
  readonly url: string;
  readonly longUrl: boolean;
}

/**
 * Build a share URL for the given (validated) build. Uses `location.origin +
 * pathname` so the link works in dev (localhost:8081/starship-skirmish/)
 * AND in production (Pages base). `location` is injected so the same helper
 * is unit-testable in the node env.
 */
export const buildShareLink = (
  catalog: Catalog,
  build: Build,
  origin: string,
  pathname: string,
): Result<ShareLink, EncodeError> => {
  const encoded = encodeShareToken(catalog, build);
  if (!encoded.ok) return encoded;
  const base = `${origin}${pathname}`;
  const url = `${base}#/share?t=${encoded.value}`;
  return {
    ok: true,
    value: {
      token: encoded.value,
      url,
      longUrl: encoded.value.length > URL_TOKEN_BUDGET,
    },
  };
};

// ---- Small helpers used by the render layer -------------------------------

/**
 * Convenience: given a build and its layout, return the per-slot type map for
 * the current fit. Callers pass this into `SlotPips` (identity component)
 * to render the wireframe pip strip in the fitting bench.
 */
export const slotFillState = (build: Build): readonly boolean[] =>
  build.slots.map((s) => s !== null);

/** Convenience: fittable-component list for a slot type. */
export const componentsForBay = (
  catalog: Catalog,
  type: SlotType,
): readonly ComponentDef[] => catalog.componentsForSlot(type);

/** Convenience: the frozen layout for this build's chassis class. */
export const buildLayout = (
  catalog: Catalog,
  build: Build,
): readonly SlotType[] => slotTypesFor(catalog, build);
