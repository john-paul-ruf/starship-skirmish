// M08 Persist — the localStorage key namespace (specs/database.md §3.1).
//
// GitHub Pages project sites share ONE origin across all of the owner's repos
// (`https://<owner>.github.io/`) and `localStorage` is scoped to origin, not
// path. Every other project this owner ever deploys reads and writes the same
// store. A short prefix like `ss:` is a live corruption-and-data-loss risk with
// no server-side recovery. ~18 extra bytes × 500 records ≈ 9 KB of a 5 MB
// budget is not a trade worth thinking about.
//
// **Never shorten `PREFIX`.** The tests in `keys.test.ts` pin the exact string.

/**
 * Namespace prefix for every key persist ever writes (§3.1). The verbose form
 * is deliberate — see the file header. DO NOT SHORTEN.
 */
export const PREFIX = 'starship-skirmish:';

/** Singleton key — first-run stamps, cached quota total, export bookkeeping (§3.8). */
export const META_KEY = `${PREFIX}meta`;

/** Singleton key — the rebuildable IndexRecord cache (§3.4). */
export const INDEX_KEY = `${PREFIX}index`;

/** Singleton key — non-critical user prefs (§3.8, total-with-default parse). */
export const PREFS_KEY = `${PREFIX}prefs`;

/** Prefix for the N `:build:<uuid>` records that are the source of truth (§3.5). */
export const BUILD_PREFIX = `${PREFIX}build:`;

/** Compose the storage key for a build id. */
export const buildKey = (id: string): string => `${BUILD_PREFIX}${id}`;

/**
 * Recover a build id from a storage key. Returns `null` for anything outside
 * the `:build:` namespace so the rebuild pass can safely scan every key.
 */
export const parseBuildKey = (key: string): string | null => {
  if (!key.startsWith(BUILD_PREFIX)) return null;
  const id = key.slice(BUILD_PREFIX.length);
  return id.length > 0 ? id : null;
};
