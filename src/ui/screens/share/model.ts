// M14 UI — Share/Import screen pure-logic model (S06).
//
// This file is DELIBERATELY `.ts` (never `.tsx`) so its unit tests can import
// it in Vitest's node env WITHOUT pulling the screen's `.tsx` graph through
// `tsconfig.node.json` (which has no JSX setting — see S03 surprises). The
// screen imports view-model results from here and does presentation only.
//
// This module owns:
//   1. `previewToken` — turn a share-token string into a "what would land"
//      preview view-model, or a designed failure view-model. Delegates to
//      `io.decodeShareToken` (the untrusted-input codec). NEVER writes.
//   2. `errorCopy` — map a `DecodeError` to the design §4.9 fail-closed error
//      strings the UI paints. NEVER writes.
//   3. `resolveNewBuild` — apply a collision policy to a decoded preview,
//      producing the `BuildDoc` the caller should hand to `repo.put`. This
//      module MINTS identity (id, createdAt, updatedAt) via injected clocks so
//      the model stays testable without a wall-clock.
//   4. `summarizeReport` — flatten a `persist.ImportReport` into a display
//      array the report panel iterates.
//
// LOAD-BEARING:
//   * `previewToken` does NOT touch persist — it is pure decode-and-shape. The
//     screen only writes after the user clicks ADD (checkpoint 2) or drops a
//     file (checkpoint 3).
//   * `resolveNewBuild` returns `{ kind: 'cancel' }` when the caller chose
//     cancel; the caller MUST NOT hand it to `repo.put`.
//   * `mintUniqueName` from persist is used verbatim for the collision-rename
//     suggestion — the same suffixing the persist import path uses (parity).

import type { Catalog, ChassisDef, ClassDef, SlotType } from '../../../catalog/index.js';
import type { Build } from '../../../domain/index.js';
import { pointCost } from '../../../domain/index.js';
import {
  BUILDS_MAX,
  FILE_MAX_BYTES,
  decodeShareToken,
  importLibrary,
  type DecodeError,
  type ImportParseReport,
} from '../../../io/index.js';
import type {
  ImportCandidate,
  ImportOutcome,
  ImportReport,
  LibraryRepo,
} from '../../../persist/index.js';
import { applyImport, mintUniqueName } from '../../../persist/index.js';
import type { BuildDoc } from '../../../persist/index.js';
import { nameKeyOf } from '../../../persist/rebuildIndex.js';

// ---- Preview view-model ---------------------------------------------------

/**
 * The successful decode's shape. Chassis + class resolve via the catalog we
 * already validated against; layout + `filled[]` drive the `SlotPips` fit
 * readout; `points` is `pointCost(catalog, build)` — the same domain function
 * the Shipyard uses.
 */
export interface PreviewOk {
  readonly status: 'ok';
  readonly build: Build;
  readonly chassis: ChassisDef;
  readonly klass: ClassDef;
  readonly layout: readonly SlotType[];
  readonly filled: readonly boolean[];
  readonly points: number;
  readonly nameKey: string;
}

/**
 * The designed decode-failure shape (design §4.9). The `DecodeError` from io
 * carries the code + message + optional offset; the screen renders `title +
 * detail` and a copy-error affordance.
 */
export interface PreviewErr {
  readonly status: 'error';
  readonly error: DecodeError;
}

export type Preview = PreviewOk | PreviewErr;

/**
 * TOTAL: `token === ''` returns a designated "empty" error rather than
 * throwing, so the screen can render the empty state uniformly. The decode
 * itself is total — every failure carries a typed `DecodeError`.
 */
export const previewToken = (catalog: Catalog, token: string): Preview => {
  if (token.length === 0) {
    return {
      status: 'error',
      error: {
        code: 'ERR_BAD_MAGIC',
        message: 'No token supplied. Paste an import link or open one from clipboard.',
      },
    };
  }
  const result = decodeShareToken(catalog, token);
  if (!result.ok) return { status: 'error', error: result.error };
  const build = result.value;
  const chassis = catalog.chassis(build.chassisId);
  if (chassis === undefined) {
    // Defensive: decodeShareToken already resolves chassis; a miss here is a
    // programming error, not a hostile-input path. Fold to ERR_UNKNOWN_ORDINAL
    // so the fail-closed path still renders instead of crashing.
    return {
      status: 'error',
      error: {
        code: 'ERR_UNKNOWN_ORDINAL',
        message: `Decoded chassis "${build.chassisId}" is no longer in the catalog.`,
      },
    };
  }
  const klass = catalog.classOf(chassis.classId);
  const layout = catalog.slotLayout(chassis.classId) ?? [];
  if (klass === undefined) {
    return {
      status: 'error',
      error: {
        code: 'ERR_UNKNOWN_ORDINAL',
        message: `Chassis "${chassis.id}" declares class "${chassis.classId}" which is not in the catalog.`,
      },
    };
  }
  const filled = build.slots.map((s) => s !== null);
  return {
    status: 'ok',
    build,
    chassis,
    klass,
    layout,
    filled,
    points: pointCost(catalog, build),
    nameKey: nameKeyOf(build.name),
  };
};

// ---- Error copy (design §4.9) --------------------------------------------

/**
 * The paint-ready copy for a designed decode failure. `title` is the headline
 * ("TOKEN FAILED VALIDATION AT CHARACTER N."); `detail` is the sub-line ("No
 * changes were made to your Encyclopedia.") plus the specific reason. Kept
 * separate from the rendering so tests exercise the copy in the node env.
 */
export interface DecodeErrorCopy {
  readonly title: string;
  readonly detail: string;
  readonly reassurance: string;
  readonly offset?: number;
}

/**
 * The fail-closed copy for a share-token decode failure (design §4.9). Never
 * mutates. Every DecodeCode surfaces as the same reassurance line — "No
 * changes were made to your Encyclopedia." — because the whole point of §4.9
 * is that the user learns nothing was written.
 */
export const errorCopy = (error: DecodeError): DecodeErrorCopy => {
  const at =
    typeof error.offset === 'number' ? ` AT CHARACTER ${String(error.offset)}` : '';
  const title = `TOKEN FAILED VALIDATION${at}.`;
  return {
    title,
    detail: error.message,
    reassurance: 'No changes were made to your Encyclopedia.',
    ...(typeof error.offset === 'number' ? { offset: error.offset } : {}),
  };
};

// ---- Collision resolution -------------------------------------------------

/**
 * The three choices the collision modal offers (design §4.9). `rename`
 * suggests a unique name via `persist.mintUniqueName`; `replace` overwrites
 * the FIRST colliding entry in place; `cancel` writes nothing.
 */
export type CollisionChoice = 'rename' | 'replace' | 'cancel';

/**
 * The suggested unique name for the rename path. Uses `persist.mintUniqueName`
 * so it matches the suffixing the JSON-import path would produce on the same
 * collision.
 */
export const suggestRenamed = (
  originalName: string,
  findByNameKey: (nk: string) => readonly string[],
): string => mintUniqueName(originalName, (nk) => findByNameKey(nk).length > 0);

/**
 * A resolved add-action: the caller either hands `build` to `repo.put`
 * (`writeAs === 'insert'` or `'replace'`) or does nothing (`writeAs === 'cancel'`).
 * `replace` reuses the colliding entry's id so `repo.put` overwrites in place
 * (see `persist.applyImport` — same pattern).
 */
export type ResolvedAddAction =
  | { readonly writeAs: 'insert'; readonly build: BuildDoc; readonly action: 'imported' | 'renamed' }
  | { readonly writeAs: 'replace'; readonly build: BuildDoc; readonly replacedId: string }
  | { readonly writeAs: 'cancel' };

/**
 * Turn a decoded preview + collision choice + user-edited name into the exact
 * `BuildDoc` to persist. The caller is expected to have already looked the
 * collision up via `repo.findByNameKey(preview.nameKey)` — we take that list
 * so the model stays a pure function of its inputs.
 *
 * Identity minting happens HERE (§6 "Per-build fields are BuildRecord minus id
 * + timestamps, all minted locally"). Callers inject `mintId` + `now` so the
 * model is a pure function of its inputs.
 */
export interface ResolveAddInputs {
  readonly preview: PreviewOk;
  readonly choice: CollisionChoice;
  readonly editedName?: string;
  readonly collidingIds: readonly string[];
  readonly mintId: () => string;
  readonly now: () => string;
}

export const resolveAddAction = (inputs: ResolveAddInputs): ResolvedAddAction => {
  const { preview, choice, editedName, collidingIds, mintId, now } = inputs;
  if (choice === 'cancel') return { writeAs: 'cancel' };

  const nowStamp = now();
  const baseName = editedName !== undefined ? editedName : preview.build.name;
  const hasCollision = collidingIds.length > 0;

  if (choice === 'replace') {
    if (!hasCollision) {
      // No collision → replace is meaningless; degrade to insert so the
      // caller's UI never emits a bogus replace outcome.
      return {
        writeAs: 'insert',
        action: 'imported',
        build: docFrom(preview.build, mintId(), baseName, nowStamp),
      };
    }
    const targetId = collidingIds[0];
    if (targetId === undefined) {
      return {
        writeAs: 'insert',
        action: 'imported',
        build: docFrom(preview.build, mintId(), baseName, nowStamp),
      };
    }
    return {
      writeAs: 'replace',
      replacedId: targetId,
      build: docFrom(preview.build, targetId, baseName, nowStamp),
    };
  }

  // choice === 'rename' — the caller-supplied `editedName` is the user's
  // edited value from the modal (starts as the suggestion). We do NOT
  // re-suggest here; the caller pre-populated the field via `suggestRenamed`
  // and may have edited it. If the field is still colliding, the caller can
  // detect that and disable ADD; this function's contract is "shape the doc,
  // don't second-guess".
  const isRenamedAction = hasCollision || baseName !== preview.build.name;
  return {
    writeAs: 'insert',
    action: isRenamedAction ? 'renamed' : 'imported',
    build: docFrom(preview.build, mintId(), baseName, nowStamp),
  };
};

/**
 * Freeze a `Build` from the decoder plus fresh identity into the `BuildDoc`
 * the repo will persist. `storedCost` is preserved from the decode (which ran
 * `finishLoad(priceFresh:true)` — so it already matches current catalog).
 */
const docFrom = (build: Build, id: string, name: string, stamp: string): BuildDoc => ({
  id,
  name,
  tags: build.tags,
  chassisId: build.chassisId,
  slots: build.slots,
  storedCost: build.storedCost,
  schemaVersion: build.schemaVersion,
  catalogVersion: build.catalogVersion,
  createdAt: stamp,
  updatedAt: stamp,
});

// ---- Import report summarisation -----------------------------------------

/**
 * Display-ready outcome row. Same discriminant vocabulary as
 * `persist.ImportOutcome` (IMPORTED / RENAMED / SKIPPED / REPLACED / FAILED)
 * but flattened for the table renderer — no per-status field shape drift.
 */
export interface ImportOutcomeRow {
  readonly kind: 'IMPORTED' | 'RENAMED' | 'REPLACED' | 'SKIPPED' | 'FAILED';
  /** Header cell text — the build's name, "→ mintedName" for rename, or "(entry N, unnamed)". */
  readonly label: string;
  /** Detail cell text — the reason on failure, migration note on RENAMED, empty otherwise. */
  readonly detail: string;
  /** Set on failure for the copy-diagnostic affordance. */
  readonly reason?: string;
}

/**
 * Flatten a persist `ImportReport.outcomes` into a display list. Preserves
 * the source order (which is the file order — `ImportParseReport.candidates`
 * are ordered by their position in the JSON `builds` array).
 */
export const summarizeReport = (report: ImportReport): readonly ImportOutcomeRow[] =>
  report.outcomes.map(outcomeToRow);

const outcomeToRow = (outcome: ImportOutcome, index: number): ImportOutcomeRow => {
  switch (outcome.status) {
    case 'imported':
      return { kind: 'IMPORTED', label: outcome.name, detail: '' };
    case 'renamed':
      return {
        kind: 'RENAMED',
        label: `${outcome.originalName} → ${outcome.finalName}`,
        detail: 'NAME COLLISION — BOTH KEPT, NOTHING OVERWRITTEN',
      };
    case 'skipped':
      return {
        kind: 'SKIPPED',
        label: outcome.name,
        detail: 'NAME COLLISION — YOUR EXISTING BUILD SURVIVED, NOTHING WRITTEN',
      };
    case 'replaced':
      return {
        kind: 'REPLACED',
        label: outcome.name,
        detail: 'NAME COLLISION — YOUR EXISTING BUILD WAS OVERWRITTEN',
      };
    case 'failed':
      return {
        kind: 'FAILED',
        label: outcome.name !== undefined ? outcome.name : `(entry ${String(index + 1)}, unnamed)`,
        detail: outcome.reason,
        reason: outcome.reason,
      };
  }
};

// ---- Report counts (for the header chips) --------------------------------

export interface ReportCounts {
  readonly total: number;
  readonly imported: number;
  readonly renamed: number;
  readonly replaced: number;
  readonly skipped: number;
  readonly failed: number;
}

export const reportCounts = (report: ImportReport): ReportCounts => ({
  total: report.outcomes.length,
  imported: report.imported,
  renamed: report.renamed,
  replaced: report.replaced,
  skipped: report.skipped,
  failed: report.failed,
});

// ---- JSON import pipeline (CP3) -------------------------------------------

/**
 * The pre-flight rejections the UI paints when a file NEVER reaches io or
 * persist (§10 note 7: hard caps precede every allocation). Each carries a
 * text-node message — no state has been touched at this point.
 */
export type PreflightRejection =
  | { readonly kind: 'OVERSIZE'; readonly byteLen: number }
  | { readonly kind: 'NO_HEADROOM'; readonly byteLen: number; readonly remaining: number }
  | { readonly kind: 'WOULD_OVERFLOW_BUILDS'; readonly current: number; readonly incoming: number };

/**
 * Result of `runJsonImport`. Exactly one of `report` / `parseError` /
 * `preflight` is populated. The `source` is a display label — the filename or
 * a synthetic "(dropped file)" for a nameless drop.
 */
export interface RunJsonImportResult {
  readonly source: string;
  readonly report?: ImportReport;
  readonly parseError?: string;
  readonly preflight?: PreflightRejection;
}

/**
 * The designed message for a pre-flight rejection (design §4.9 fail-closed
 * copy). Pure function — inspectable by tests without a DOM.
 */
export const preflightMessage = (r: PreflightRejection): string => {
  switch (r.kind) {
    case 'OVERSIZE':
      return `File is ${formatBytes(r.byteLen)}; the max import size is ${formatBytes(FILE_MAX_BYTES)}. No changes were made.`;
    case 'NO_HEADROOM':
      return `Import needs about ${formatBytes(r.byteLen)} but only ${formatBytes(r.remaining)} of storage is free. Export or delete some builds first. No changes were made.`;
    case 'WOULD_OVERFLOW_BUILDS':
      return `Your library holds ${String(r.current)} builds; the file adds ${String(r.incoming)}. That is more than the ${String(BUILDS_MAX)}-build limit. No changes were made.`;
  }
};

const formatBytes = (n: number): string => {
  if (n < 1024) return `${String(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * The pipeline behind the JSON drop zone, pulled out as a pure function so
 * every pre-flight gate is node-env unit-testable (no DOM, no `File`). The
 * component just wraps this by reading the dropped `File` into memory.
 *
 * PURE except `repo.put` inside `applyImport`. On every pre-flight rejection
 * AND on parse-error, `applyImport` is NEVER called and the repo is
 * byte-identical.
 */
export const runJsonImport = (
  catalog: Catalog,
  repo: LibraryRepo,
  input: { readonly source: string; readonly byteLen: number; readonly text: string },
): RunJsonImportResult => {
  const source = input.source;

  // Cap 1 — FILE_MAX_BYTES.
  if (input.byteLen > FILE_MAX_BYTES) {
    return {
      source,
      preflight: { kind: 'OVERSIZE', byteLen: input.byteLen },
    };
  }
  // Cap 2 — storage headroom BEFORE parse allocates.
  const headroom = repo.headroom();
  if (headroom.remainingBytes < input.byteLen) {
    return {
      source,
      preflight: {
        kind: 'NO_HEADROOM',
        byteLen: input.byteLen,
        remaining: headroom.remainingBytes,
      },
    };
  }
  // Parse.
  const parsed = importLibrary(catalog, input.text);
  if (!parsed.ok) {
    return { source, parseError: parsed.error.message };
  }
  const parseReport: ImportParseReport = parsed.value;
  const candidates: readonly ImportCandidate[] = parseReport.candidates.map(candidateFromParse);
  // Cap 3 — LOCAL build count.
  const current = repo.entries().length;
  const incoming = candidates.filter((c) => c.status === 'valid').length;
  if (current + incoming > BUILDS_MAX) {
    return {
      source,
      preflight: { kind: 'WOULD_OVERFLOW_BUILDS', current, incoming },
    };
  }
  const report: ImportReport = applyImport(repo, candidates, 'rename');
  return { source, report };
};

/**
 * Turn a parsed `ImportCandidate` from io into the shape persist expects. The
 * two types are structurally similar but declared in different modules — this
 * bridge keeps the boundary explicit.
 */
const candidateFromParse = (
  c: ImportParseReport['candidates'][number],
): ImportCandidate => {
  if (c.status === 'valid') {
    if (c.build === undefined) {
      return { status: 'failed', reason: 'internal: valid candidate without build' };
    }
    return {
      status: 'valid',
      build: {
        id: c.build.id,
        name: c.build.name,
        tags: c.build.tags,
        chassisId: c.build.chassisId,
        slots: c.build.slots,
        storedCost: c.build.storedCost,
        schemaVersion: c.build.schemaVersion,
        catalogVersion: c.build.catalogVersion,
        createdAt: c.build.createdAt,
        updatedAt: c.build.updatedAt,
      },
    };
  }
  return {
    status: 'failed',
    reason: c.reason ?? `Build at index ${String(c.index)} failed validation.`,
    sourceIndex: c.index,
  };
};
