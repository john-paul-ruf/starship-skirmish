// M07 IO — public surface (architecture §4).
//
// Everything the F7/F8 UI needs from io — the cross-format caps, the
// validation gate, the load-pipeline runner, the share-token codec, and the
// JSON export/import — is re-exported here. Consumers import from THIS barrel;
// individual files stay internal.
//
// PERSIST NOTE (STATE.md design decision): `src/persist/**` imports
// `src/io/migrate/migrate.js` DIRECTLY, not through this barrel. Persist
// depends on migrate + limits only; pulling the codec / export / import into
// its bundle is unnecessary. The barrel is for the UI, which does depend on
// the whole surface.

// ---- S01 caps (specs/database.md §10 note 2) -----------------------------
export {
  NAME_MIN,
  NAME_MAX,
  TAGS_MAX,
  TAG_MIN,
  TAG_MAX,
  TOKEN_MAX,
  URL_TOKEN_BUDGET,
  BUILDS_MAX,
  FILE_MAX_BYTES,
  STORAGE_BUDGET_BYTES,
} from './limits.js';

// ---- S01 validation gate -------------------------------------------------
export { validateCandidate, coerceCandidate, normalizeName, normalizeTags } from './validate.js';
export type { ValidateCode, ValidateError } from './validate.js';

// ---- S01 load pipeline (§7.2) -------------------------------------------
export { finishLoad, migrate } from './migrate/migrate.js';
export type { Loaded, MigrateCode, MigrateError } from './migrate/migrate.js';

// ---- Share-token codec (this session) -----------------------------------
export { encodeShareToken, decodeShareToken } from './codec/shareToken.js';
export type { DecodeCode, DecodeError, EncodeError } from './codec/shareToken.js';

// ---- JSON export (this session) -----------------------------------------
export { exportLibrary, exportToText } from './exportLibrary.js';
export type { LibraryExport, LibraryExportBuild } from './exportLibrary.js';

// ---- JSON import — parse-level (this session) ----------------------------
export { importLibrary } from './importLibrary.js';
export type {
  ImportParseReport,
  ImportCandidate,
  ImportFileError,
  ImportFileCode,
} from './importLibrary.js';
