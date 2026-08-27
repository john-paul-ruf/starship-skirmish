# M07 — IO (`src/io/`)

> Per-module architecture detail for M07, accreted per session under Jikijitsu.
> Full canonical contract in `specs/architecture.md` §4. IO is the single untrusted-input boundary:
> everything returns `Result`, nothing throws across it, nothing mutates caller state, nothing writes.
> S01 built the internals (`limits`, `validate`, `migrate/migrate`) and judged no arch delta was
> needed beyond `SESSION-01.md`'s Implementation section; S02 established the public surface below.

<!-- SESSION-02 -->
## M07 IO — public surface established (SESSION-02)

S01 introduced the io internals (`limits`, `validate`, `migrate/migrate`); S02 completes the module
by adding the two wire-format artifacts and the barrel that consumers import through. The public
API of M07 is now stable at v1:

### `src/io/index.ts` — the barrel

```ts
// Caps (specs/database.md §10 note 2)
export {
  NAME_MIN, NAME_MAX, TAGS_MAX, TAG_MIN, TAG_MAX,
  TOKEN_MAX, URL_TOKEN_BUDGET, BUILDS_MAX, FILE_MAX_BYTES, STORAGE_BUDGET_BYTES,
} from './limits.js';

// Validation gate (S01)
export { validateCandidate, coerceCandidate, normalizeName, normalizeTags } from './validate.js';
export type { ValidateCode, ValidateError } from './validate.js';

// Load pipeline runner (S01, §7.2)
export { finishLoad, migrate } from './migrate/migrate.js';
export type { Loaded, MigrateCode, MigrateError } from './migrate/migrate.js';

// Share-token codec (S02, §5 / architecture §8.1)
export { encodeShareToken, decodeShareToken } from './codec/shareToken.js';
export type { DecodeCode, DecodeError, EncodeError } from './codec/shareToken.js';

// JSON export (S02, §6 / architecture §8.2)
export { exportLibrary, exportToText } from './exportLibrary.js';
export type { LibraryExport, LibraryExportBuild } from './exportLibrary.js';

// JSON import — parse-level, never writes (S02, §6, FR-9)
export { importLibrary } from './importLibrary.js';
export type { ImportParseReport, ImportCandidate, ImportFileError, ImportFileCode } from './importLibrary.js';
```

### Consumer routing

- **F7/F8 UI** imports from `src/io/index.js` (the whole surface: codec + export/import + validation).
- **`src/persist/**`** imports `src/io/migrate/migrate.js` **directly** (migrate + finishLoad only —
  persist has no need for codec/export/import). This is why S02∥S03 concurrency is genuine: persist
  does not depend on the barrel.

### Wire-format contracts (frozen — architecture §8)

- **Share token** (`encodeShareToken` / `decodeShareToken`): base64url of the §8.1 byte layout.
  Decode is TOTAL — every failure returns a typed `DecodeError` with a code and offset (byte offset
  in the decoded payload for post-decode errors; character offset in the raw token for
  `ERR_TOO_LONG`/`ERR_BAD_BASE64`/`ERR_BAD_MAGIC`). CRC-8 polynomial **`0x07`** (init `0x00`, no
  reflect, no final XOR) is FROZEN — changing it silently invalidates every share token in the wild.
  Base64url alphabet `A-Z a-z 0-9 - _`, NO PADDING (URL-fragment convention).
- **JSON envelope** (`exportLibrary` / `importLibrary`): `format: 'starship-skirmish/library'`;
  per-build fields = `BuildRecord` MINUS `id`/`createdAt`/`updatedAt` (identity is local, minted on
  `applyImport`). `exportedAt` is caller-supplied — io never reads the wall clock.

### v2+ seams (empty-but-present, mirroring the migration chain)

- `decodeShareToken` validates `slotCount` against `catalog.slotLayout(class).length` at v1 (there
  is one lock). Marked comment: v2+ needs `classSlotCountsAt(catalogVersion, class)` to accept
  shorter historical layouts padded with empty.
- `importLibrary` accepts per-build entries missing `schemaVersion` by falling back to the envelope's
  version — a v1-only file that omitted per-build version for brevity still imports.
