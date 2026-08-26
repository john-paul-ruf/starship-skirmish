/**
 * SCHEMA MIGRATION CHAIN — the durability guarantee behind Pillar 4 ("No loss, ever") and FR-2.
 *
 * This file is the registry ONLY. The runner that composes it with validation and re-pricing is
 * `src/io/migrate/migrate.ts` (owned by the data-access layer); its contract is specified in
 * `specs/database.md` §7.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * RULES — these are the whole point of the file. Violating one breaks artifacts already in the
 * wild, and there is no server to fix them from.
 *
 *  1. APPEND ONLY. Never edit a released migration. A bug in `1 → 2` is fixed by adding `2 → 3`.
 *  2. Every step is `from: N, to: N + 1`. No gaps, no skips, no multi-version jumps.
 *  3. `up()` is PURE: it takes a plain document, returns a NEW plain document, mutates nothing,
 *     throws nothing, reads no globals, and never touches the catalog, the clock, or storage.
 *  4. `up()` must handle a *hostile* document. It runs on bytes from other people (share tokens,
 *     imported JSON). Missing fields, wrong types, and absurd array lengths are expected input,
 *     not exceptional input. Never take a loop bound or an allocation size from the document.
 *  5. Migrations move SHAPE only. Stat/point changes are catalog concerns and are applied by
 *     re-pricing after the chain runs (Ruling A) — never by a migration.
 *  6. Adding a migration REQUIRES adding a frozen fixture for the outgoing version under
 *     `tests/fixtures/migration/v<N>/`, registered in that directory's hash manifest. CI
 *     recomputes the hashes; editing a historical fixture fails the build (FR-2).
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */

/** An artifact document mid-migration. Deliberately untyped: it is foreign data until validated. */
export type MigratableDoc = Readonly<Record<string, unknown>>;

export interface Migration {
  /** Schema version this step consumes. */
  readonly from: number;
  /** Schema version this step produces. Always `from + 1`. */
  readonly to: number;
  /** Human-readable reason this step exists. Shown in migration reports and logs. */
  readonly description: string;
  /** Pure shape transform. Must not throw; must not mutate `doc`. */
  up(doc: MigratableDoc): MigratableDoc;
}

/**
 * The version every artifact is migrated UP to. Bump this in the same commit that appends a
 * migration — never separately.
 */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * The lowest `schemaVersion` this build can still read. Because migrations are append-only and
 * never removed, this stays 1 forever. If it ever moves, Pillar 4 is broken.
 */
export const MINIMUM_SUPPORTED_SCHEMA_VERSION = 1;

/**
 * Ordered chain, ascending by `from`. Empty at v1: the initial schema has no predecessor.
 *
 * The chain is empty and the machinery still exists — that is deliberate. FR-2 requires the
 * migration layer on day one precisely so the first real migration is a five-line append instead
 * of an architecture change.
 *
 * Worked example of a future append (do not uncomment; it is illustrative):
 *
 *   {
 *     from: 1,
 *     to: 2,
 *     description: 'v2 splits `name` into `name` + `tags[]`; pre-v2 builds get an empty tag list.',
 *     up: (doc) => ({ ...doc, tags: Array.isArray(doc.tags) ? doc.tags.slice(0, 8) : [], schemaVersion: 2 }),
 *   }
 */
export const migrations: readonly Migration[] = [];

/** CI guard: asserts the chain is contiguous, ascending, and terminates at the current version. */
export function assertChainIsWellFormed(): void {
  let expected = MINIMUM_SUPPORTED_SCHEMA_VERSION;
  for (const m of migrations) {
    if (m.from !== expected) {
      throw new Error(`migration chain gap: expected from=${expected}, got from=${m.from}`);
    }
    if (m.to !== m.from + 1) {
      throw new Error(`migration ${m.from}->${m.to} must step exactly one version`);
    }
    expected = m.to;
  }
  if (expected !== CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `migration chain ends at v${expected} but CURRENT_SCHEMA_VERSION is ${CURRENT_SCHEMA_VERSION}`,
    );
  }
}
