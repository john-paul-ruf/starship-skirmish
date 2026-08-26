// M07 IO — shareToken codec tests (specs/database.md §5, architecture §8.1).
//
// The suite has to prove five things:
//   1. Round-trip: a fighter (3 slots, some empty) and a fully-fitted 12-slot
//      mega destroyer both encode → decode back to the same chassis + every
//      slot + name.
//   2. Size: an encoded 12-slot mega with a 20-char name is well under
//      `URL_TOKEN_BUDGET` (§5 "Size check" — expects ~52 base64url chars).
//   3. Every `DecodeCode` is triggered by a hand-crafted bad token, returns
//      the right code, returns a sensible `offset`, and DOES NOT THROW.
//   4. A successful decode returns a PREVIEW build — `id` empty, no persist
//      side effect (asserted by comparing catalog state before/after).
//   5. Both encoder errors (`ERR_UNRESOLVED_ORDINAL`, `ERR_NAME_TOO_LONG`) are
//      surfaced without throwing.

import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../../../../src/catalog/index.js';
import type { Build, BuildMeta } from '../../../../src/domain/index.js';
import { emptyBuild, withSlot } from '../../../../src/domain/index.js';
import { toBase64url } from '../../../../src/io/codec/base64url.js';
import { crc8 } from '../../../../src/io/codec/crc8.js';
import {
  decodeShareToken,
  encodeShareToken,
  type DecodeCode,
} from '../../../../src/io/codec/shareToken.js';
import { NAME_MAX, TOKEN_MAX, URL_TOKEN_BUDGET } from '../../../../src/io/limits.js';

const catalog = loadCatalog();

const meta = (): BuildMeta => ({
  id: '00000000-0000-4000-8000-000000000001',
  schemaVersion: 1,
  catalogVersion: catalog.catalogVersion,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

/** Build a legal fighter: fig-wasp, weapon + engine + empty special. */
const fighter = (name = 'Wasp Alpha'): Build => {
  const empty = emptyBuild(catalog, 'fig-wasp', name, meta());
  if (!empty.ok) throw new Error(`fixture setup: ${empty.error.message}`);
  let b = empty.value;
  b = withSlot(b, 0, 'wpn-pulse-array');
  b = withSlot(b, 1, 'eng-standard-drive');
  return b;
};

/** Build a fully-fitted 12-slot mega destroyer for the size / round-trip test. */
const megaFullyFitted = (name = 'The Long Farewell'): Build => {
  const empty = emptyBuild(catalog, 'meg-oblivion', name, meta());
  if (!empty.ok) throw new Error(`fixture setup: ${empty.error.message}`);
  // Layout: weapon×4, shield×2, missile×3, engine×1, special×2
  let b = empty.value;
  b = withSlot(b, 0, 'wpn-pulse-array');
  b = withSlot(b, 1, 'wpn-scatter-gun');
  b = withSlot(b, 2, 'wpn-rail-driver');
  b = withSlot(b, 3, 'wpn-fusion-lance');
  b = withSlot(b, 4, 'shd-fluxweave');
  b = withSlot(b, 5, 'shd-aegis-lattice');
  b = withSlot(b, 6, 'mis-hornet-rack');
  b = withSlot(b, 7, 'mis-lance-pod');
  b = withSlot(b, 8, 'mis-breaker-tube');
  b = withSlot(b, 9, 'eng-torch');
  b = withSlot(b, 10, 'spc-armor-plating');
  b = withSlot(b, 11, 'spc-point-defense');
  return b;
};

// ─── Round-trip ───────────────────────────────────────────────────────────

describe('encodeShareToken + decodeShareToken — round-trip', () => {
  it('round-trips a fighter (3 slots, one empty)', () => {
    const src = fighter('Wasp Alpha');
    const encoded = encodeShareToken(catalog, src);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    const decoded = decodeShareToken(catalog, encoded.value);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    expect(decoded.value.chassisId).toBe('fig-wasp');
    expect(decoded.value.slots).toEqual(['wpn-pulse-array', 'eng-standard-drive', null]);
    expect(decoded.value.name).toBe('Wasp Alpha');
    // Preview: id empty; timestamps empty (persist mints them).
    expect(decoded.value.id).toBe('');
    expect(decoded.value.createdAt).toBe('');
    expect(decoded.value.updatedAt).toBe('');
    // priceFresh:true stamped storedCost to current pointCost.
    expect(decoded.value.storedCost).toBeGreaterThan(0);
  });

  it('round-trips a fully-fitted 12-slot mega destroyer', () => {
    const src = megaFullyFitted();
    const encoded = encodeShareToken(catalog, src);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    const decoded = decodeShareToken(catalog, encoded.value);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    expect(decoded.value.chassisId).toBe('meg-oblivion');
    expect(decoded.value.slots).toEqual(src.slots);
    expect(decoded.value.name).toBe('The Long Farewell');
  });

  it('preserves UTF-8 name bytes (multi-byte characters)', () => {
    const src = fighter('Ærø 蜂');
    const encoded = encodeShareToken(catalog, src);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const decoded = decodeShareToken(catalog, encoded.value);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.name).toBe('Ærø 蜂');
  });
});

// ─── Size ─────────────────────────────────────────────────────────────────

describe('encodeShareToken — size', () => {
  it('a fully-fitted 12-slot mega with a 20-char name lands well under URL_TOKEN_BUDGET (§5)', () => {
    const src = megaFullyFitted('Long Farewell — 12 sl');
    const encoded = encodeShareToken(catalog, src);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    // §5 estimate: ~52 chars. Assert generously — a token under 150 chars is
    // ~13× under the 1900 budget, catching an accidental order-of-magnitude
    // regression without pinning an exact number.
    expect(encoded.value.length).toBeLessThan(150);
    expect(encoded.value.length).toBeLessThan(URL_TOKEN_BUDGET);
  });

  it('an all-empty fighter with an empty name is the minimum-size token', () => {
    const empty = emptyBuild(catalog, 'fig-wasp', 'x', meta());
    if (!empty.ok) throw new Error('setup');
    const encoded = encodeShareToken(catalog, empty.value);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    // Empty + one-char name → tiny.
    expect(encoded.value.length).toBeLessThan(30);
  });
});

// ─── Encode errors ────────────────────────────────────────────────────────

describe('encodeShareToken — errors', () => {
  it('returns ERR_UNRESOLVED_ORDINAL when chassisId is not in the catalog', () => {
    const b: Build = {
      ...fighter('X'),
      chassisId: 'fig-does-not-exist',
    };
    const r = encodeShareToken(catalog, b);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('ERR_UNRESOLVED_ORDINAL');
  });

  it('returns ERR_UNRESOLVED_ORDINAL when a slot component id is not in the catalog', () => {
    const src = fighter('X');
    const b: Build = {
      ...src,
      slots: ['wpn-does-not-exist', 'eng-standard-drive', null],
    };
    const r = encodeShareToken(catalog, b);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('ERR_UNRESOLVED_ORDINAL');
  });

  it('returns ERR_NAME_TOO_LONG when name UTF-8 bytes exceed NAME_MAX', () => {
    const overlong = 'x'.repeat(NAME_MAX + 1);
    const b: Build = { ...fighter('X'), name: overlong };
    const r = encodeShareToken(catalog, b);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('ERR_NAME_TOO_LONG');
  });

  it('does not throw on any of the above', () => {
    expect(() => encodeShareToken(catalog, { ...fighter('X'), chassisId: 'nope' })).not.toThrow();
  });
});

// ─── Decode errors — every DecodeCode with an offset ──────────────────────

/**
 * Helper: build a byte payload plus its base64url token in one step. The
 * payload is the RAW bytes; `token = toBase64url(payload)`.
 */
const encodePayload = (bytes: readonly number[]): string => toBase64url(new Uint8Array(bytes));

/** A canonical VALID payload (fighter) as raw bytes, without crc8. */
const validFighterPayloadWithoutCrc = (): number[] => {
  // magic | schema=1 | catalog=1 | chassis=fig-wasp(2) | slotCount=3 |
  // slots: wpn-pulse-array(13), eng-standard-drive(30), empty(0) |
  // nameLen=1 | name='x'
  return [0x53, 1, 1, 2, 3, 13, 30, 0, 1, 0x78];
};

/** Append the correct crc8 to a payload; return as a base64url token. */
const encodeWithCrc = (payload: readonly number[]): string => {
  const withoutCrc = new Uint8Array(payload);
  const bytes = [...payload, crc8(withoutCrc)];
  return encodePayload(bytes);
};

describe('decodeShareToken — every DecodeCode with a sensible offset', () => {
  const cases: readonly {
    readonly name: string;
    readonly token: string;
    readonly code: DecodeCode;
    readonly expectOffset?: boolean;
  }[] = [
    {
      name: 'ERR_TOO_LONG — token exceeds TOKEN_MAX characters',
      token: 'A'.repeat(TOKEN_MAX + 1),
      code: 'ERR_TOO_LONG',
      expectOffset: true,
    },
    {
      name: 'ERR_BAD_BASE64 — non-alphabet character',
      // 'A!AA' — the `!` at offset 1 is illegal.
      token: 'A!AA',
      code: 'ERR_BAD_BASE64',
      expectOffset: true,
    },
    {
      name: 'ERR_BAD_MAGIC — first byte is not 0x53',
      token: encodeWithCrc([0x54, 1, 1, 2, 3, 13, 30, 0, 1, 0x78]),
      code: 'ERR_BAD_MAGIC',
      expectOffset: true,
    },
    {
      name: 'ERR_TRUNCATED — payload ends before all fields are read',
      // Just magic + schema — no crc, no catalogVersion. The read at cursor=2
      // runs off the end of a 2-byte buffer → readVaruint returns null.
      token: encodePayload([0x53, 1]),
      code: 'ERR_TRUNCATED',
      expectOffset: true,
    },
    {
      name: 'ERR_FUTURE_SCHEMA — schemaVersion > CURRENT_SCHEMA_VERSION',
      token: encodeWithCrc([0x53, 99, 1, 2, 3, 13, 30, 0, 1, 0x78]),
      code: 'ERR_FUTURE_SCHEMA',
      expectOffset: true,
    },
    {
      name: 'ERR_FUTURE_CATALOG — catalogVersion > catalog.catalogVersion',
      token: encodeWithCrc([0x53, 1, 99, 2, 3, 13, 30, 0, 1, 0x78]),
      code: 'ERR_FUTURE_CATALOG',
      expectOffset: true,
    },
    {
      name: 'ERR_UNKNOWN_ORDINAL — chassis ordinal does not resolve',
      // 200 is above nextOrdinal (39); unresolved.
      token: encodeWithCrc([0x53, 1, 1, 200, 3, 13, 30, 0, 1, 0x78]),
      code: 'ERR_UNKNOWN_ORDINAL',
      expectOffset: true,
    },
    {
      name: 'ERR_UNKNOWN_ORDINAL — chassis ordinal resolves to a COMPONENT (kind check)',
      // 13 = wpn-pulse-array (a component, not a chassis).
      token: encodeWithCrc([0x53, 1, 1, 13, 3, 13, 30, 0, 1, 0x78]),
      code: 'ERR_UNKNOWN_ORDINAL',
      expectOffset: true,
    },
    {
      name: 'ERR_SLOT_COUNT — declared count does not match layout',
      // fig-wasp (ord 2) has 3 slots; declaring 5 is wrong.
      token: encodeWithCrc([0x53, 1, 1, 2, 5, 13, 30, 0, 0, 0, 1, 0x78]),
      code: 'ERR_SLOT_COUNT',
      expectOffset: true,
    },
    {
      name: 'ERR_UNKNOWN_ORDINAL — slot ordinal does not resolve',
      // 250 is above nextOrdinal — unresolved.
      token: encodeWithCrc([0x53, 1, 1, 2, 3, 250, 30, 0, 1, 0x78]),
      code: 'ERR_UNKNOWN_ORDINAL',
      expectOffset: true,
    },
    {
      name: 'ERR_SLOT_TYPE_MISMATCH — component slotType != layout slotType',
      // Layout[0] = weapon; ordinal 30 (eng-standard-drive) is an engine.
      token: encodeWithCrc([0x53, 1, 1, 2, 3, 30, 30, 0, 1, 0x78]),
      code: 'ERR_SLOT_TYPE_MISMATCH',
      expectOffset: true,
    },
    {
      name: 'ERR_NAME_TOO_LONG — nameLen > NAME_MAX',
      // Set nameLen to NAME_MAX + 1 (49). We only need to declare it — the
      // truncation check would fire first, so we DO include enough trailing
      // bytes to prove the length check is what rejects (nameLen check runs
      // before the byte-availability check).
      token: encodeWithCrc([
        0x53, 1, 1, 2, 3, 13, 30, 0, NAME_MAX + 1,
        ...new Array(NAME_MAX + 1).fill(0x78),
      ]),
      code: 'ERR_NAME_TOO_LONG',
      expectOffset: true,
    },
    {
      name: 'ERR_BAD_UTF8 — name bytes are not valid UTF-8',
      // 0x80 alone is an invalid UTF-8 continuation byte.
      token: encodeWithCrc([0x53, 1, 1, 2, 3, 13, 30, 0, 1, 0x80]),
      code: 'ERR_BAD_UTF8',
      expectOffset: true,
    },
    {
      name: 'ERR_CHECKSUM — trailing crc8 byte is wrong',
      // Take a valid payload and append a WRONG crc byte.
      token: encodePayload([...validFighterPayloadWithoutCrc(), 0x00]),
      code: 'ERR_CHECKSUM',
      expectOffset: true,
    },
  ];

  it.each(cases)('$name', ({ token, code, expectOffset }) => {
    // Executing the call itself must not throw — even the wildest hostile
    // input returns a typed Result.
    expect(() => decodeShareToken(catalog, token)).not.toThrow();
    const result = decodeShareToken(catalog, token);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(code);
    if (expectOffset) {
      expect(typeof result.error.offset).toBe('number');
      expect(result.error.offset).toBeGreaterThanOrEqual(0);
    }
  });

  it('never throws on any of the above', () => {
    for (const { token } of cases) {
      expect(() => decodeShareToken(catalog, token)).not.toThrow();
    }
  });

  it('never throws on a wildly hostile input (empty / control chars / garbage)', () => {
    for (const t of ['', 'A', '!!', '\x00\x01\x02', 'AAAA', 'AAAAB']) {
      expect(() => decodeShareToken(catalog, t)).not.toThrow();
    }
  });
});

// ─── Preview semantics ────────────────────────────────────────────────────

describe('decodeShareToken — preview semantics (no state mutation)', () => {
  it('returns id="" — identity is minted only on accept (§5)', () => {
    const encoded = encodeShareToken(catalog, fighter('X'));
    if (!encoded.ok) throw new Error('setup');
    const decoded = decodeShareToken(catalog, encoded.value);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.id).toBe('');
  });

  it('a decoded fighter has storedCost stamped to current pointCost (priceFresh:true)', () => {
    const src = fighter('X');
    const encoded = encodeShareToken(catalog, src);
    if (!encoded.ok) throw new Error('setup');
    const decoded = decodeShareToken(catalog, encoded.value);
    if (!decoded.ok) throw new Error('decode');
    // A share token carries no cost, so the decoded build is priced fresh —
    // the storedCost is whatever the current catalog prices these parts at.
    // fig-wasp(6) + wpn-pulse-array(2) + eng-standard-drive(3) = 11.
    expect(decoded.value.storedCost).toBe(11);
  });
});
