// M07 IO — cross-format caps (specs/database.md §10 note 2, FORGE-CONFIG "Caps live in one module").
//
// Every hard cap that spans the wire formats + the persistence layer + the UI
// lives HERE and only here. Duplicating them elsewhere is how a token that
// encodes stops decoding (§10 note 3): the Shipyard accepts a 60-char name, the
// token's `nameLen` field caps at 48, and now half the library cannot be
// shared. One module, one number, everyone reads it.
//
// The unit for the persistence budget is deliberately UTF-16 code units per
// entry (`(key.length + value.length) × 2`, specs/database.md §3.7) — the
// storage layer owns the ratio policy (`WARN_AT` / `CRITICAL_AT`) and reads
// only the ceiling from here.

/**
 * Minimum name length after NFC-trim (specs/database.md §3.2). A zero-length
 * name would decode from a token with `nameLen = 0` and satisfy the fitter but
 * would be an unlabeled build in the Encyclopedia; forbid at the boundary.
 */
export const NAME_MIN = 1;

/**
 * Maximum name length after NFC-trim (specs/database.md §3.2 / §8.1 field
 * `nameLen`). This value is CROSS-FORMAT: the share token's `nameLen` cap fixes
 * 48 at the wire layer, so raising it anywhere else silently mints builds that
 * save but cannot be shared (§10 note 3). Do not raise in a single module.
 */
export const NAME_MAX = 48;

/**
 * Maximum number of tags per build (specs/database.md §3.2 — `≤ 8` items).
 * Filter axis in the Encyclopedia (FR-7); more than eight becomes unwieldy in
 * the tag chip row without adding query power.
 */
export const TAGS_MAX = 8;

/**
 * Minimum length of a single tag after NFC-trim (specs/database.md §3.2).
 * Empty-string tags survive `split(',')` on paste but represent nothing;
 * forbid at the boundary rather than push the check into every consumer.
 */
export const TAG_MIN = 1;

/**
 * Maximum length of a single tag (specs/database.md §3.2 — `1..24` chars).
 * Kebab-case identifiers over 24 chars stop being identifiers and become
 * descriptions; the schema's opinion is that tags are labels, not sentences.
 */
export const TAG_MAX = 24;

/**
 * Absolute ceiling for a share-token string before base64 decode
 * (specs/database.md §8.1 / architecture §8.1). The decoder REFUSES the input
 * at this cap BEFORE any allocation — a hostile 10 MB URL fragment must not
 * reach `atob`. `URL_TOKEN_BUDGET` below is the softer UI warning threshold.
 */
export const TOKEN_MAX = 2048;

/**
 * Soft target for the URL-embedded token (FR-8). If a generated token exceeds
 * this budget the Shipyard surfaces a "link is long" warning; the token is
 * still valid up to `TOKEN_MAX`. The 1900-char budget is the "keep it inside
 * common URL length limits" heuristic from architecture §8.1.
 */
export const URL_TOKEN_BUDGET = 1900;

/**
 * Maximum number of builds a JSON export/import may contain
 * (specs/database.md §8.2 / architecture §8.2). Import refuses a file over
 * this count BEFORE per-build validation — a foreign file's own
 * `builds.length` is never taken as a loop bound.
 */
export const BUILDS_MAX = 5000;

/**
 * Byte ceiling for a JSON export file at import time (specs/database.md §8.2 /
 * architecture §8.2). The 8 MB cap sits comfortably above the 5000-build
 * projection and below any reasonable browser-memory concern; refuses a
 * hostile 500 MB "library" before allocation.
 */
export const FILE_MAX_BYTES = 8_000_000;

/**
 * Storage budget for the Encyclopedia in UTF-16 code units
 * (specs/database.md §3.7). Conservative — real browser ceilings vary, and the
 * conservative number is easier to defend than a per-engine probe. Persist's
 * `quota.ts` READS this value and owns the WARN/CRITICAL ratio policy; the raw
 * ceiling does not live in two places.
 */
export const STORAGE_BUDGET_BYTES = 5_000_000;
