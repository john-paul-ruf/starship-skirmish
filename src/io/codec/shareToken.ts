// M07 IO — share token encode + total decode (specs/database.md §5,
// architecture §8.1, FR-8).
//
// The share token is one of two artifacts that cross machines and years, so it
// is treated with HTTP-API seriousness (architecture §8). Layout:
//
//   base64url( magic 'S' (1 byte)
//            | schemaVersion  varuint
//            | catalogVersion varuint
//            | chassisOrdinal varuint
//            | slotCount      varuint
//            | slotOrdinals[] varuint × slotCount   (0 = empty)
//            | nameLen        varuint               (≤ NAME_MAX)
//            | nameUtf8       bytes
//            | crc8           1 byte over everything preceding )
//
// DECODE IS TOTAL (architecture §4/§10, specs/database.md §5 "Decode contract"):
//   * every failure path returns `Result.err` with a typed code and a byte /
//     character offset (design §4.9)
//   * hard caps precede every allocation — `token.length ≤ TOKEN_MAX` is
//     enforced BEFORE `fromBase64url`; `nameLen ≤ NAME_MAX` is enforced BEFORE
//     the name-bytes read
//   * a successful decode is a PREVIEW `Build` — an empty `id` marks the
//     "not yet in the library" state; `applyImport` mints identity on accept
//
// The decoder does NOT re-validate what the layout already proves. Ordinals
// resolved via `catalog.byOrdinal` are known-good; slot-type checks against
// `slotLayout(class)` are done here rather than deferring to `validateFit`.
// `finishLoad(priceFresh:true)` runs as a belt-and-suspenders tail so a token
// with, e.g., a trimmed-empty name still surfaces a typed error.

import type { Catalog, ChassisDef, ComponentDef } from '../../catalog/index.js';
import type { Build, BuildMeta, Result } from '../../domain/index.js';
import { emptyBuild, withSlot } from '../../domain/index.js';
import { NAME_MAX, TOKEN_MAX } from '../limits.js';
import { finishLoad } from '../migrate/migrate.js';
import { CURRENT_SCHEMA_VERSION } from '../migrate/migrations.js';
import type { ValidateError } from '../validate.js';
import { fromBase64url, toBase64url } from './base64url.js';
import { crc8 } from './crc8.js';
import { readVaruint, writeVaruint } from './varuint.js';

// ---- Public error surface -------------------------------------------------

/**
 * The complete set of things that can be wrong with a decoded share token.
 * Callers (F7/F8 UI) render an offset + a code + a message; no other
 * information about the failure is exposed (design §4.9).
 */
export type DecodeCode =
  | 'ERR_TOO_LONG'
  | 'ERR_BAD_MAGIC'
  | 'ERR_BAD_BASE64'
  | 'ERR_TRUNCATED'
  | 'ERR_CHECKSUM'
  | 'ERR_FUTURE_SCHEMA'
  | 'ERR_FUTURE_CATALOG'
  | 'ERR_UNKNOWN_ORDINAL'
  | 'ERR_SLOT_TYPE_MISMATCH'
  | 'ERR_SLOT_COUNT'
  | 'ERR_NAME_TOO_LONG'
  | 'ERR_BAD_UTF8';

/**
 * One decode failure. `offset` is a character index in the raw token for
 * pre-base64-decode errors (`ERR_TOO_LONG`, `ERR_BAD_BASE64`), or a byte
 * offset into the decoded payload for post-decode errors. Optional because a
 * few error paths have no meaningful position (a stripped-empty name).
 */
export interface DecodeError {
  readonly code: DecodeCode;
  readonly message: string;
  readonly offset?: number;
}

/**
 * The set of things that can be wrong with an encode. Callers only ever hit
 * this on an id the catalog can't resolve (impossible for a catalog-locked
 * build) or a name longer than the wire format's `nameLen` cap.
 */
export interface EncodeError {
  readonly code: 'ERR_UNRESOLVED_ORDINAL' | 'ERR_NAME_TOO_LONG';
  readonly message: string;
}

// ---- Internal helpers -----------------------------------------------------

const MAGIC = 0x53; // 'S'

const err = (code: DecodeCode, message: string, offset?: number): DecodeError =>
  offset === undefined ? { code, message } : { code, message, offset };

/**
 * Scan `token` for the first character outside the base64url alphabet. Used
 * only on the failure path of `fromBase64url` to surface a sensible offset for
 * `ERR_BAD_BASE64`. Returns the char index (or `token.length` if every char is
 * alphabet-legal but the total length is illegal — e.g. `length % 4 === 1`).
 */
const firstBadBase64Offset = (token: string): number => {
  for (let i = 0; i < token.length; i += 1) {
    const c = token.charCodeAt(i);
    const isUpper = c >= 0x41 && c <= 0x5a; // A-Z
    const isLower = c >= 0x61 && c <= 0x7a; // a-z
    const isDigit = c >= 0x30 && c <= 0x39; // 0-9
    const isDash = c === 0x2d; // -
    const isUnder = c === 0x5f; // _
    if (!(isUpper || isLower || isDigit || isDash || isUnder)) return i;
  }
  // Every char is alphabet-legal but the whole string won't decode — e.g. a
  // 1-mod-4 length. Point at end-of-string; the message says why.
  return token.length;
};

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const UTF8_ENCODER = new TextEncoder();

/** Strip C0 control chars (0x00-0x1F) and DEL (0x7F) from a decoded name. */
const stripControls = (s: string): string => {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) continue;
    out += s.charAt(i);
  }
  return out;
};

/**
 * Best-effort map a residual `ValidateError` (from `finishLoad`) back into a
 * `DecodeCode`. In practice this only fires for a name that decoded to bytes
 * but trims to empty — the layout checks catch everything else. Anything
 * unexpected folds into `ERR_BAD_UTF8` (the closest "malformed payload" code
 * available; a decoded token that fails validation IS malformed).
 */
const validateErrorToDecodeError = (e: ValidateError, nameOffset: number): DecodeError => {
  switch (e.code) {
    case 'ERR_NAME_EMPTY':
    case 'ERR_NAME_TOO_LONG':
      return err('ERR_NAME_TOO_LONG', e.message, nameOffset);
    case 'ERR_SLOT_COUNT':
      return err('ERR_SLOT_COUNT', e.message);
    case 'ERR_SLOT_TYPE_MISMATCH':
      return err('ERR_SLOT_TYPE_MISMATCH', e.message);
    case 'ERR_UNKNOWN_CHASSIS':
    case 'ERR_UNKNOWN_CLASS':
    case 'ERR_UNKNOWN_COMPONENT':
      return err('ERR_UNKNOWN_ORDINAL', e.message);
    default:
      return err('ERR_BAD_UTF8', e.message, nameOffset);
  }
};

// ---- encodeShareToken -----------------------------------------------------

/**
 * Encode a `Build` into a share-token string (base64url of the §8.1 byte
 * layout). Emits `CURRENT_SCHEMA_VERSION` and `catalog.catalogVersion` for the
 * version fields (a token stamped by this build is a "today" artifact — the
 * decoder does the version-back-compat).
 *
 * Returns `ERR_UNRESOLVED_ORDINAL` on an id the catalog cannot resolve (a
 * catalog-locked build never hits this — it is a caller-bug guard), and
 * `ERR_NAME_TOO_LONG` on a UTF-8 name longer than `NAME_MAX` bytes. The token
 * itself is returned even past `URL_TOKEN_BUDGET` — the UI decides how loud a
 * warning to surface (a token is still functional up to `TOKEN_MAX`).
 */
export const encodeShareToken = (catalog: Catalog, build: Build): Result<string, EncodeError> => {
  const chassisOrdinal = catalog.ordinalOf(build.chassisId);
  if (chassisOrdinal === undefined) {
    return {
      ok: false,
      error: {
        code: 'ERR_UNRESOLVED_ORDINAL',
        message: `Cannot encode: chassis id "${build.chassisId}" is not in the current catalog.`,
      },
    };
  }

  const nameBytes = UTF8_ENCODER.encode(build.name);
  if (nameBytes.length > NAME_MAX) {
    return {
      ok: false,
      error: {
        code: 'ERR_NAME_TOO_LONG',
        message: `Cannot encode: name is ${nameBytes.length} UTF-8 bytes; max ${NAME_MAX}.`,
      },
    };
  }

  const bytes: number[] = [];
  bytes.push(MAGIC);
  writeVaruint(CURRENT_SCHEMA_VERSION, bytes);
  writeVaruint(catalog.catalogVersion, bytes);
  writeVaruint(chassisOrdinal, bytes);
  writeVaruint(build.slots.length, bytes);
  for (let i = 0; i < build.slots.length; i += 1) {
    const componentId = build.slots[i] ?? null;
    if (componentId === null) {
      writeVaruint(0, bytes); // empty slot sentinel
      continue;
    }
    const componentOrdinal = catalog.ordinalOf(componentId);
    if (componentOrdinal === undefined) {
      return {
        ok: false,
        error: {
          code: 'ERR_UNRESOLVED_ORDINAL',
          message: `Cannot encode: slot ${i} component id "${componentId}" is not in the current catalog.`,
        },
      };
    }
    writeVaruint(componentOrdinal, bytes);
  }
  writeVaruint(nameBytes.length, bytes);
  for (let i = 0; i < nameBytes.length; i += 1) bytes.push(nameBytes[i] as number);
  const preCrc = new Uint8Array(bytes);
  bytes.push(crc8(preCrc));

  return { ok: true, value: toBase64url(new Uint8Array(bytes)) };
};

// ---- decodeShareToken -----------------------------------------------------

/**
 * The total decode. Each step's cap PRECEDES the allocation it guards; each
 * failure returns a typed `DecodeError` with the failing offset (character
 * index for pre-base64 errors, byte offset otherwise). Never throws. Never
 * mutates. Never writes. Mints no `id` — the returned `Build` is a preview.
 */
export const decodeShareToken = (catalog: Catalog, token: string): Result<Build, DecodeError> => {
  // Step 0 — token character cap. CHECK BEFORE fromBase64url allocation.
  if (token.length > TOKEN_MAX) {
    return {
      ok: false,
      error: err(
        'ERR_TOO_LONG',
        `Token is ${token.length} chars; max ${TOKEN_MAX}.`,
        TOKEN_MAX,
      ),
    };
  }

  // Step 1 — base64url decode.
  const bytes = fromBase64url(token);
  if (bytes === null) {
    return {
      ok: false,
      error: err(
        'ERR_BAD_BASE64',
        'Token contains a character outside the base64url alphabet (or has an illegal length).',
        firstBadBase64Offset(token),
      ),
    };
  }

  // Step 2 — magic byte. Absent = empty payload; still ERR_BAD_MAGIC (offset 0).
  if (bytes.length === 0 || bytes[0] !== MAGIC) {
    return {
      ok: false,
      error: err('ERR_BAD_MAGIC', `Token magic must be 0x53 ('S').`, 0),
    };
  }

  // Step 3 — read all fixed-header varuints.
  let cursor = 1;
  const readOffset = cursor;
  const schemaRead = readVaruint(bytes, cursor);
  if (schemaRead === null) {
    return { ok: false, error: err('ERR_TRUNCATED', 'Token truncated reading schemaVersion.', readOffset) };
  }
  const schemaVersion = schemaRead.value;
  cursor = schemaRead.next;

  const catalogOffset = cursor;
  const catalogRead = readVaruint(bytes, cursor);
  if (catalogRead === null) {
    return { ok: false, error: err('ERR_TRUNCATED', 'Token truncated reading catalogVersion.', catalogOffset) };
  }
  const catalogVersion = catalogRead.value;
  cursor = catalogRead.next;

  // Step 4 — version gate: schemaVersion is the load-pipeline authority.
  if (schemaVersion < 1 || schemaVersion > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: err(
        'ERR_FUTURE_SCHEMA',
        `Token schemaVersion ${schemaVersion} is outside 1..${CURRENT_SCHEMA_VERSION}.`,
        readOffset,
      ),
    };
  }

  // Step 5 — future catalog is a hard error (a token from tomorrow may name
  // ordinals we don't have; refuse to guess).
  if (catalogVersion < 1 || catalogVersion > catalog.catalogVersion) {
    return {
      ok: false,
      error: err(
        'ERR_FUTURE_CATALOG',
        `Token catalogVersion ${catalogVersion} is outside 1..${catalog.catalogVersion}.`,
        catalogOffset,
      ),
    };
  }

  // Step 6 — chassis ordinal must resolve AND be of kind chassis.
  const chassisOffset = cursor;
  const chassisRead = readVaruint(bytes, cursor);
  if (chassisRead === null) {
    return { ok: false, error: err('ERR_TRUNCATED', 'Token truncated reading chassisOrdinal.', chassisOffset) };
  }
  const chassisOrdinal = chassisRead.value;
  cursor = chassisRead.next;
  const chassisEntry = catalog.byOrdinal(chassisOrdinal);
  if (chassisEntry === undefined || !isChassis(chassisEntry)) {
    return {
      ok: false,
      error: err(
        'ERR_UNKNOWN_ORDINAL',
        `chassisOrdinal ${chassisOrdinal} does not resolve to a chassis in catalog v${catalog.catalogVersion}.`,
        chassisOffset,
      ),
    };
  }
  const chassis: ChassisDef = chassisEntry;

  // Step 7 — slotCount matches the layout for this class.
  // NOTE (v2+ seam): §5 wants `slotCount` validated against `classSlotCounts`
  // for the TOKEN'S own `catalogVersion`. At v1 there is exactly one lock, so
  // `slotLayout(class).length` IS the v1 count — use it. When catalog v2 lands
  // this becomes `classSlotCountsAt(catalogVersion, class)` (empty-but-present
  // pattern, mirroring `migrations`); pad the tail with empty for a shorter
  // historical layout. Do not build the historical-lock lookup now.
  const layout = catalog.slotLayout(chassis.classId);
  if (layout === undefined) {
    return {
      ok: false,
      error: err(
        'ERR_UNKNOWN_ORDINAL',
        `Chassis "${chassis.id}" declares class "${chassis.classId}" which is not in the catalog.`,
        chassisOffset,
      ),
    };
  }
  const slotCountOffset = cursor;
  const slotCountRead = readVaruint(bytes, cursor);
  if (slotCountRead === null) {
    return { ok: false, error: err('ERR_TRUNCATED', 'Token truncated reading slotCount.', slotCountOffset) };
  }
  const slotCount = slotCountRead.value;
  cursor = slotCountRead.next;
  if (slotCount !== layout.length) {
    return {
      ok: false,
      error: err(
        'ERR_SLOT_COUNT',
        `Token slotCount ${slotCount} does not match layout length ${layout.length} for class "${chassis.classId}".`,
        slotCountOffset,
      ),
    };
  }

  // Step 8 — read every slotOrdinal; 0 = empty; else must resolve AND its
  // slotType must equal the layout's slot type at that index.
  const componentIds: (string | null)[] = new Array(slotCount).fill(null);
  for (let i = 0; i < slotCount; i += 1) {
    const slotOffset = cursor;
    const slotRead = readVaruint(bytes, cursor);
    if (slotRead === null) {
      return {
        ok: false,
        error: err('ERR_TRUNCATED', `Token truncated reading slotOrdinals[${i}].`, slotOffset),
      };
    }
    const slotOrdinal = slotRead.value;
    cursor = slotRead.next;
    if (slotOrdinal === 0) continue; // empty slot, legal (§5)

    const componentEntry = catalog.byOrdinal(slotOrdinal);
    if (componentEntry === undefined || isChassis(componentEntry)) {
      return {
        ok: false,
        error: err(
          'ERR_UNKNOWN_ORDINAL',
          `slotOrdinals[${i}] = ${slotOrdinal} does not resolve to a component in catalog v${catalog.catalogVersion}.`,
          slotOffset,
        ),
      };
    }
    const component: ComponentDef = componentEntry;
    const expected = layout[i] as (typeof layout)[number];
    if (component.slotType !== expected) {
      return {
        ok: false,
        error: err(
          'ERR_SLOT_TYPE_MISMATCH',
          `slotOrdinals[${i}] "${component.id}" is a ${component.slotType}; layout expects ${expected}.`,
          slotOffset,
        ),
      };
    }
    componentIds[i] = component.id;
  }

  // Step 9 — name. `nameLen` capped BEFORE the byte read.
  const nameLenOffset = cursor;
  const nameLenRead = readVaruint(bytes, cursor);
  if (nameLenRead === null) {
    return { ok: false, error: err('ERR_TRUNCATED', 'Token truncated reading nameLen.', nameLenOffset) };
  }
  const nameLen = nameLenRead.value;
  cursor = nameLenRead.next;
  if (nameLen > NAME_MAX) {
    return {
      ok: false,
      error: err(
        'ERR_NAME_TOO_LONG',
        `Token nameLen ${nameLen} exceeds max ${NAME_MAX}.`,
        nameLenOffset,
      ),
    };
  }

  const nameBytesOffset = cursor;
  if (cursor + nameLen > bytes.length - 1) {
    // Reserve one trailing byte for the crc8; if the name would consume it,
    // the token is truncated.
    return {
      ok: false,
      error: err(
        'ERR_TRUNCATED',
        `Token truncated reading ${nameLen} name bytes.`,
        nameBytesOffset,
      ),
    };
  }
  const nameBytes = bytes.slice(cursor, cursor + nameLen);
  cursor += nameLen;

  let name: string;
  try {
    name = UTF8_DECODER.decode(nameBytes);
  } catch {
    return {
      ok: false,
      error: err('ERR_BAD_UTF8', 'Name bytes are not valid UTF-8.', nameBytesOffset),
    };
  }
  name = stripControls(name);

  // Step 10 — crc8 over everything preceding the trailing byte.
  if (cursor !== bytes.length - 1) {
    return {
      ok: false,
      error: err(
        'ERR_TRUNCATED',
        `Token has ${bytes.length - cursor} trailing byte(s); expected exactly 1 (crc8).`,
        cursor,
      ),
    };
  }
  const crcOffset = cursor;
  const claimed = bytes[cursor] as number;
  const actual = crc8(bytes.slice(0, cursor));
  if (claimed !== actual) {
    return {
      ok: false,
      error: err(
        'ERR_CHECKSUM',
        `Token crc8 mismatch (claimed 0x${claimed.toString(16)}, actual 0x${actual.toString(16)}).`,
        crcOffset,
      ),
    };
  }

  // Assemble the preview Build via the domain constructors (immutable) and
  // run the belt-and-suspenders §7.2 tail. Identity is left EMPTY — the
  // caller mints it on accept (§5).
  const meta: BuildMeta = {
    id: '',
    schemaVersion,
    catalogVersion,
    createdAt: '',
    updatedAt: '',
  };
  const empty = emptyBuild(catalog, chassis.id, name, meta);
  // emptyBuild's fit gate can only fail on unknown chassis / class — we
  // already resolved both, so this is a defensive fold.
  if (!empty.ok) {
    return {
      ok: false,
      error: err('ERR_UNKNOWN_ORDINAL', empty.error.message, chassisOffset),
    };
  }
  let build: Build = empty.value;
  for (let i = 0; i < slotCount; i += 1) {
    const id = componentIds[i];
    if (id !== null) build = withSlot(build, i, id ?? null);
  }

  // Docless finishLoad — treat the assembled Build as the migrated doc; the
  // migration chain step is a no-op here because we assembled a v_current-
  // shaped doc from ordinals. `priceFresh: true` stamps storedCost fresh.
  const loaded = finishLoad(catalog, buildAsDoc(build), meta, { priceFresh: true });
  if (!loaded.ok) {
    // Report the first residual error mapped to a decode code (the layout
    // guards above catch everything except an NFC-trim-empty name).
    const first = loaded.error[0];
    if (first === undefined) {
      return {
        ok: false,
        error: err('ERR_BAD_UTF8', 'Token failed validation with no reported errors.', nameBytesOffset),
      };
    }
    return { ok: false, error: validateErrorToDecodeError(first, nameBytesOffset) };
  }
  return { ok: true, value: loaded.value.build };
};

// ---- Small internal helpers ----------------------------------------------

/**
 * Present the assembled `Build` as a plain doc `finishLoad` will accept.
 * `validateCandidate` inside `finishLoad` re-normalises name/tags and
 * re-validates fit — a cheap double-check whose cost is O(slots).
 */
const buildAsDoc = (build: Build): Readonly<Record<string, unknown>> => ({
  id: build.id,
  name: build.name,
  tags: build.tags,
  chassisId: build.chassisId,
  slots: build.slots,
  storedCost: build.storedCost,
  schemaVersion: build.schemaVersion,
  catalogVersion: build.catalogVersion,
  createdAt: build.createdAt,
  updatedAt: build.updatedAt,
});

/**
 * Discriminate chassis from component entries surfaced by `catalog.byOrdinal`.
 * Both share the ordinal space (§2.5), so this guard is how the decoder
 * enforces "the chassis field must resolve to a chassis" without threading a
 * separate index through.
 */
const isChassis = (entry: ChassisDef | ComponentDef): entry is ChassisDef =>
  !('slotType' in entry);
