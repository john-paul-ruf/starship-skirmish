// M08 Persist — applyImport (FR-9, specs/database.md §3.6 / §6).
//
// The persist half of the JSON import boundary. `io.importLibrary` (S02) parses
// a foreign file into a per-entry report: each candidate is either `valid`
// (a Build the caller minted an id + timestamps for) or `failed(reason)`. This
// module APPLIES those candidates against the current library — collision
// policy, additive-only write, deterministic 4-way `ImportReport` that
// F7/F8's import dialog paints.
//
// The FOUR outcomes (FR-9):
//   * IMPORTED  — no collision; the build was written verbatim
//   * RENAMED   — collision under `policy: 'rename'`; a unique name was minted
//                 and the ORIGINAL survived
//   * SKIPPED   — collision under `policy: 'skip'`; the original survived
//   * REPLACED  — collision under `policy: 'replace'`; the original was
//                 overwritten IN PLACE (same id)
//   * FAILED    — the candidate arrived as `failed(reason)`, or persist's own
//                 write threw ERR_VALIDATION / ERR_QUOTA
//
// Load-bearing rule (§3.5 / FR-9): **additive by default, never deletes**. A
// `SKIPPED` collision keeps the existing record; a `REPLACED` collision writes
// over the SAME id (the caller's replace policy asked us to). No collision
// path ever removes an unrelated build. This module has no `remove()` call.

import { nameKeyOf } from './rebuildIndex.js';
import type { LibraryRepo, PutResult } from './LibraryRepo.js';
import type { BuildDoc } from './records.js';

// ---- Public shapes --------------------------------------------------------

/**
 * The per-candidate shape `io.importLibrary` produces (S02's boundary). The
 * shape lives HERE (not in io) because io returns candidates using this vocab
 * and persist consumes them; keeping the type on the consumer side means io
 * doesn't need to know persist's collision report. `valid` carries a complete
 * `BuildDoc` — the caller (F7/F8's import path) MINTS the id + createdAt +
 * updatedAt locally (§6 "Per-build fields are BuildRecord minus id + timestamps,
 * all minted locally on import"). `failed` carries the parse-level reason.
 */
export type ImportCandidate =
  | { readonly status: 'valid'; readonly build: BuildDoc }
  | { readonly status: 'failed'; readonly reason: string; readonly sourceIndex?: number };

/**
 * How to resolve a collision when the incoming build's `nameKey` matches an
 * existing entry (§3.6). The Encyclopedia UI asks the user once per import;
 * the choice is threaded through as this enum. Persist NEVER decides the
 * policy — the user does, via F7/F8's rename/replace/cancel dialog.
 */
export type ImportPolicy = 'rename' | 'replace' | 'skip';

/** The reason on a `FAILED` outcome — pass-through from io + persist's own codes. */
export type ImportFailureReason = string;

/** The tagged outcome for one imported candidate. */
export type ImportOutcome =
  | { readonly status: 'imported'; readonly id: string; readonly name: string }
  | {
      readonly status: 'renamed';
      readonly id: string;
      readonly originalName: string;
      readonly finalName: string;
      readonly collidedWith: readonly string[];
    }
  | { readonly status: 'skipped'; readonly name: string; readonly collidedWith: readonly string[] }
  | { readonly status: 'replaced'; readonly id: string; readonly name: string }
  | { readonly status: 'failed'; readonly reason: ImportFailureReason; readonly name?: string };

/**
 * The aggregate 4-way report the import dialog paints (FR-9). Counts are
 * derived from `outcomes` for convenience — a caller that wants only totals
 * can render straight from the four numbers.
 */
export interface ImportReport {
  readonly imported: number;
  readonly renamed: number;
  readonly skipped: number;
  readonly replaced: number;
  readonly failed: number;
  readonly outcomes: readonly ImportOutcome[];
  /** `true` if any write triggered session-mode degrade during import. */
  readonly degraded: boolean;
}

// ---- Rename minting -------------------------------------------------------

/**
 * Mint a name that doesn't collide with any existing `nameKey` in `repo`.
 * Suffix strategy: append " (2)", " (3)", … until the derived `nameKey` is
 * free. Guarded by `nameLen` from io/limits at the caller — we never emit a
 * name longer than 48 chars; on overflow we truncate the base before appending.
 *
 * Detached (pure): takes the repo's nameKey lookup rather than the repo, so
 * it's straight to test.
 */
export const mintUniqueName = (
  base: string,
  isTaken: (nameKey: string) => boolean,
  maxLength = 48,
): string => {
  const baseKey = nameKeyOf(base);
  if (!isTaken(baseKey)) return base;

  for (let counter = 2; counter < 10_000; counter += 1) {
    const suffix = ` (${counter})`;
    const budget = maxLength - suffix.length;
    // Truncate the visible name (not the key) so the suffix fits within cap.
    const trimmedBase = base.length > budget ? base.slice(0, Math.max(0, budget)).trimEnd() : base;
    const candidate = `${trimmedBase}${suffix}`;
    if (!isTaken(nameKeyOf(candidate))) return candidate;
  }
  // Extremely unlikely (10k dupes of the same name); fall back to base +
  // ` (imported)` suffix so this never loops forever, still respecting the
  // maxLength cap by truncating the base.
  const fallbackSuffix = ' (imported)';
  const fallbackBudget = Math.max(0, maxLength - fallbackSuffix.length);
  const fallbackBase = base.length > fallbackBudget ? base.slice(0, fallbackBudget).trimEnd() : base;
  return `${fallbackBase}${fallbackSuffix}`;
};

// ---- applyImport ----------------------------------------------------------

/**
 * Walk the candidate list against `repo`, applying `policy` to any collision.
 * ADDITIVE-ONLY (FR-9): never removes an unrelated build; the only "delete"
 * is the in-place overwrite of the SAME id under `policy: 'replace'`.
 *
 * Every write goes through `repo.put`, which handles the record-first /
 * index-second ordering + quota-degrade for us (§3.5, FR-7). A quota failure
 * on one candidate does not stop the rest — subsequent writes go to the
 * degraded (memory) store and the aggregate `degraded` flag flips.
 */
export const applyImport = (
  repo: LibraryRepo,
  candidates: readonly ImportCandidate[],
  policy: ImportPolicy,
): ImportReport => {
  const outcomes: ImportOutcome[] = [];
  let imported = 0;
  let renamed = 0;
  let skipped = 0;
  let replaced = 0;
  let failed = 0;
  let degraded = false;

  for (const candidate of candidates) {
    if (candidate.status === 'failed') {
      outcomes.push({ status: 'failed', reason: candidate.reason });
      failed += 1;
      continue;
    }

    const build = candidate.build;
    const key = nameKeyOf(build.name);
    const collidingIds = repo.findByNameKey(key);
    const hasCollision = collidingIds.length > 0;

    if (!hasCollision) {
      const result = writeAndTrack(repo, build);
      if (result.degraded) degraded = true;
      if (result.result.ok) {
        outcomes.push({ status: 'imported', id: build.id, name: build.name });
        imported += 1;
      } else {
        outcomes.push({ status: 'failed', reason: result.result.reason, name: build.name });
        failed += 1;
      }
      continue;
    }

    // Collision path — one of three outcomes per policy.
    if (policy === 'skip') {
      outcomes.push({ status: 'skipped', name: build.name, collidedWith: collidingIds });
      skipped += 1;
      continue;
    }

    if (policy === 'replace') {
      // Replace the FIRST colliding entry in place — the caller-supplied
      // build's id is ignored in favour of the existing entry's id so the
      // overwrite is truly in-place (updatedAt bumps).
      const targetId = collidingIds[0];
      if (targetId === undefined) {
        // Defensive — findByNameKey said collision but returned nothing.
        outcomes.push({ status: 'failed', reason: 'ERR_COLLISION_RESOLUTION', name: build.name });
        failed += 1;
        continue;
      }
      const replacement: BuildDoc = { ...build, id: targetId };
      const result = writeAndTrack(repo, replacement);
      if (result.degraded) degraded = true;
      if (result.result.ok) {
        outcomes.push({ status: 'replaced', id: targetId, name: build.name });
        replaced += 1;
      } else {
        outcomes.push({ status: 'failed', reason: result.result.reason, name: build.name });
        failed += 1;
      }
      continue;
    }

    // policy === 'rename' — mint a unique name and write.
    const uniqueName = mintUniqueName(build.name, (nk) => repo.findByNameKey(nk).length > 0);
    const renamedBuild: BuildDoc = { ...build, name: uniqueName };
    const result = writeAndTrack(repo, renamedBuild);
    if (result.degraded) degraded = true;
    if (result.result.ok) {
      outcomes.push({
        status: 'renamed',
        id: renamedBuild.id,
        originalName: build.name,
        finalName: uniqueName,
        collidedWith: collidingIds,
      });
      renamed += 1;
    } else {
      outcomes.push({ status: 'failed', reason: result.result.reason, name: build.name });
      failed += 1;
    }
  }

  return { imported, renamed, replaced, skipped, failed, outcomes, degraded };
};

interface TrackedWrite {
  readonly result: PutResult;
  readonly degraded: boolean;
}

const writeAndTrack = (repo: LibraryRepo, build: BuildDoc): TrackedWrite => {
  const result = repo.put(build);
  return { result, degraded: result.degraded === true };
};
