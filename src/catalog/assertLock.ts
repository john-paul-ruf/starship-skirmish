// Catalog invariants C1–C9 (specs/database.md §2.6). These are the CI-enforced
// guarantees that make FR-1 real — a violation would silently reinterpret every
// share token ever generated, orphan builds, or ship content that does nothing.
// `test:catalog-lock` runs the per-invariant violation table under this module.
//
// Signature takes a list of locks (currently just v1) so a future catalog-v2.json
// becomes an added import in loadCatalog, not a refactor here.

import type {
  Catalog,
  CatalogLock,
  ChassisClass,
  ChassisDef,
  ComponentDef,
} from './types.js';

export type CatalogInvariantId = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7' | 'C8' | 'C9';

export class CatalogLockError extends Error {
  readonly invariant: CatalogInvariantId;
  constructor(invariant: CatalogInvariantId, detail: string) {
    super(`Catalog invariant ${invariant} violated: ${detail}`);
    this.name = 'CatalogLockError';
    this.invariant = invariant;
  }
}

// Function declaration (not an arrow const) so TypeScript's control-flow
// analysis narrows past `if (x === undefined) fail(...);` — the `: never`
// return type is what drives the narrowing.
function fail(invariant: CatalogInvariantId, detail: string): never {
  throw new CatalogLockError(invariant, detail);
}

// The closed set of implemented special effects (§2.3). Adding a new effect is
// the single catalog change that requires code — this set is the enforcement.
const IMPLEMENTED_SPECIAL_EFFECTS: ReadonlySet<string> = new Set([
  'armor-plating',
  'decoy-launcher',
  'thrust-booster',
  'point-defense',
  'damage-control',
]);

// The closed set of slot types (§2.1). Kept as strings so a corrupted runtime
// value (past the TS type gate) still fails C5 loudly rather than silently.
const SLOT_TYPES: ReadonlySet<string> = new Set([
  'weapon',
  'shield',
  'missile',
  'engine',
  'special',
]);

/**
 * Run the nine catalog invariants against `catalog` and every historical `lock`.
 * Throws `CatalogLockError` on the first violation with the failing invariant id.
 *
 * Check order is chosen so a per-invariant test can violate exactly one field
 * and see the expected id fire first: catalog-side integrity (C3–C6) before
 * version consistency (C7) before lock cross-check (C1, C2, C8) before tuning
 * shape (C9).
 */
export const assertLock = (catalog: Catalog, locks: readonly CatalogLock[]): void => {
  const chassis: readonly ChassisDef[] = catalog.allChassis();
  const components: readonly ComponentDef[] = catalog.allComponents();

  // ---- C3: id + ordinal globally unique across chassis + components -------
  const seenIds = new Set<string>();
  const seenOrdinals = new Set<number>();
  const allEntries: readonly (ChassisDef | ComponentDef)[] = [...chassis, ...components];
  for (const entry of allEntries) {
    if (seenIds.has(entry.id)) fail('C3', `duplicate id "${entry.id}"`);
    seenIds.add(entry.id);
    if (seenOrdinals.has(entry.ordinal)) {
      fail('C3', `duplicate ordinal ${entry.ordinal} (at id "${entry.id}")`);
    }
    seenOrdinals.add(entry.ordinal);
  }

  // ---- C4: every chassis.classId resolves in classes.json ------------------
  for (const ch of chassis) {
    if (catalog.classOf(ch.classId) === undefined) {
      fail('C4', `chassis "${ch.id}" references unknown classId "${ch.classId}"`);
    }
  }

  // ---- C5: every component.slotType ∈ slotTypes ---------------------------
  for (const co of components) {
    if (!SLOT_TYPES.has(co.slotType)) {
      fail('C5', `component "${co.id}" has unknown slotType "${co.slotType}"`);
    }
  }

  // ---- C6: every special.stats.effect is an implemented rule --------------
  for (const co of components) {
    if (co.slotType === 'special') {
      const effect = co.stats.effect as string | undefined;
      if (effect === undefined || !IMPLEMENTED_SPECIAL_EFFECTS.has(effect)) {
        fail('C6', `special "${co.id}" has unimplemented effect "${String(effect)}"`);
      }
    }
  }

  // ---- C7: catalogVersion consistency across classes / tuning / newest lock
  if (locks.length === 0) {
    fail('C7', 'no lock files provided (need at least the current catalog-vN.json)');
  }
  const newestLock = locks[locks.length - 1]!;
  if (catalog.catalogVersion !== catalog.tuning.catalogVersion) {
    fail(
      'C7',
      `classes.catalogVersion ${catalog.catalogVersion} !== tuning.catalogVersion ${catalog.tuning.catalogVersion}`,
    );
  }
  if (catalog.catalogVersion !== newestLock.catalogVersion) {
    fail(
      'C7',
      `classes.catalogVersion ${catalog.catalogVersion} !== newest lock.catalogVersion ${newestLock.catalogVersion}`,
    );
  }

  // ---- C1 + C2: every id in every lock exists AND has the same ordinal ----
  for (const lock of locks) {
    for (const [id, ordinal] of Object.entries(lock.ordinals)) {
      const entry = catalog.chassis(id) ?? catalog.component(id);
      if (entry === undefined) {
        fail(
          'C1',
          `id "${id}" (lock v${lock.catalogVersion}) is missing from the current catalog`,
        );
      }
      if (entry.ordinal !== ordinal) {
        fail(
          'C2',
          `id "${id}" moved: lock v${lock.catalogVersion} = ${ordinal}, catalog = ${entry.ordinal}`,
        );
      }
    }
  }

  // ---- C8: no class layout shrank (length may only grow at the tail) ------
  for (const lock of locks) {
    for (const [classId, lockCount] of Object.entries(lock.classSlotCounts)) {
      const cls = catalog.classOf(classId as ChassisClass);
      if (cls === undefined) {
        fail(
          'C8',
          `class "${classId}" (lock v${lock.catalogVersion}) is missing from the current catalog`,
        );
      }
      if (cls.slots.length < lockCount) {
        fail(
          'C8',
          `class "${classId}" shrank from ${lockCount} (lock v${lock.catalogVersion}) to ${cls.slots.length}`,
        );
      }
    }
  }

  // ---- C9: arena.radiusByBudget keys ≡ match.legalBudgets exactly ---------
  const radiusKeys = Object.keys(catalog.tuning.arena.radiusByBudget)
    .map((k) => Number(k))
    .sort((a, b) => a - b);
  const legalBudgets = [...catalog.tuning.match.legalBudgets].sort((a, b) => a - b);
  const budgetsMatch =
    radiusKeys.length === legalBudgets.length &&
    radiusKeys.every((k, i) => k === legalBudgets[i]);
  if (!budgetsMatch) {
    fail(
      'C9',
      `arena.radiusByBudget keys [${radiusKeys.join(',')}] !== match.legalBudgets [${legalBudgets.join(',')}]`,
    );
  }
};
