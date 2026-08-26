// M07 IO — validate.ts tests (specs/database.md §3.2 / §7.2, §10 note 7).
//
// The four things this test file has to prove:
//   1. A legal foreign doc validates and its Build carries the NORMALISED
//      name/tags (not the raw input).
//   2. Every ValidateCode has a case that surfaces it.
//   3. All violations are collected in one pass (FR-5), not first-fail.
//   4. A hostile 10⁶-length `slots` array is coerced without allocation
//      catastrophe and rejected on fit (§10 note 7).

import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../../../src/catalog/index.js';
import type { BuildMeta } from '../../../src/domain/index.js';
import {
  coerceCandidate,
  normalizeName,
  normalizeTags,
  validateCandidate,
} from '../../../src/io/validate.js';

const catalog = loadCatalog();

const meta = (): BuildMeta => ({
  id: '00000000-0000-4000-8000-000000000001',
  schemaVersion: 1,
  catalogVersion: catalog.catalogVersion,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

/** A legal v1 fighter doc (fig-wasp, weapon + engine + empty special). */
const validDoc = (): Record<string, unknown> => ({
  id: 'ignored-by-coercer',
  name: 'Wasp Alpha',
  tags: ['alpha', 'test'],
  chassisId: 'fig-wasp',
  slots: ['wpn-pulse-array', 'eng-standard-drive', null],
  storedCost: 11,
  schemaVersion: 1,
  catalogVersion: 1,
});

describe('normalizeName', () => {
  it('trims and NFC-normalises', () => {
    // 'Ä' (A + combining diaeresis) → 'Ä' (NFC)
    expect(normalizeName('  Ä  ')).toBe('Ä');
  });

  it('coerces null/undefined to empty', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
  });

  it('coerces non-strings via String()', () => {
    expect(normalizeName(42)).toBe('42');
  });
});

describe('normalizeTags', () => {
  it('dedupes, sorts, and cleans a legal list', () => {
    const { tags, errors } = normalizeTags(['beta', 'alpha', 'beta']);
    expect(errors.some((e) => e.code === 'ERR_TAG_DUPLICATE')).toBe(true);
    expect(tags).toEqual(['alpha', 'beta']);
  });

  it('treats undefined and null as empty', () => {
    expect(normalizeTags(undefined)).toEqual({ tags: [], errors: [] });
    expect(normalizeTags(null)).toEqual({ tags: [], errors: [] });
  });

  it('reports non-array input', () => {
    const { tags, errors } = normalizeTags('not-a-list');
    expect(tags).toEqual([]);
    expect(errors[0]?.code).toBe('ERR_TOO_MANY_TAGS');
  });
});

describe('coerceCandidate — defensive shape coercion (§10 note 7)', () => {
  it('caps a 10⁶-length slots array before iteration (no OOM)', () => {
    const doc = {
      chassisId: 'fig-wasp',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      slots: new Array(1_000_000).fill('wpn-pulse-array') as unknown as any[],
    };
    // Should not OOM, should not iterate 10⁶ times.
    const b = coerceCandidate(catalog, doc, meta());
    expect(b.slots.length).toBeLessThanOrEqual(256);
  });

  it('sets storedCost to 0 when missing / non-numeric / non-finite', () => {
    expect(coerceCandidate(catalog, { chassisId: 'fig-wasp' }, meta()).storedCost).toBe(0);
    expect(
      coerceCandidate(catalog, { chassisId: 'fig-wasp', storedCost: 'nope' }, meta()).storedCost,
    ).toBe(0);
    expect(
      coerceCandidate(catalog, { chassisId: 'fig-wasp', storedCost: Infinity }, meta()).storedCost,
    ).toBe(0);
  });

  it('replaces non-string slot entries with null', () => {
    const doc = { chassisId: 'fig-wasp', slots: [42, null, 'eng-standard-drive'] };
    const b = coerceCandidate(catalog, doc, meta());
    expect(b.slots).toEqual([null, null, 'eng-standard-drive']);
  });

  it('preserves the doc slot length so validateFit can emit ERR_SLOT_COUNT', () => {
    const doc = { chassisId: 'fig-wasp', slots: [null, null] }; // fighter layout is 3
    const b = coerceCandidate(catalog, doc, meta());
    expect(b.slots.length).toBe(2);
  });
});

describe('validateCandidate — happy path', () => {
  it('accepts a legal doc and returns a ValidatedBuild with normalised name/tags', () => {
    const v = validateCandidate(catalog, validDoc(), meta());
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value._validated).toBe(true);
    expect(v.value.build.name).toBe('Wasp Alpha');
    // Sorted (dedupe applies only when duplicates exist).
    expect(v.value.build.tags).toEqual(['alpha', 'test']);
    expect(v.value.build.slots).toEqual(['wpn-pulse-array', 'eng-standard-drive', null]);
  });

  it('normalises the name via NFC before the length check', () => {
    // 48 characters of 'a' + a combining diaeresis on the last → NFC-normalises to 48 chars
    const doc = { ...validDoc(), name: 'a'.repeat(47) + 'ä' };
    const v = validateCandidate(catalog, doc, meta());
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.build.name.length).toBe(48);
  });
});

describe('validateCandidate — name failures', () => {
  it('reports ERR_NAME_EMPTY when name trims to empty', () => {
    const v = validateCandidate(catalog, { ...validDoc(), name: '   ' }, meta());
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error.some((e) => e.code === 'ERR_NAME_EMPTY')).toBe(true);
  });

  it('reports ERR_NAME_TOO_LONG when name exceeds 48 chars after trim', () => {
    const v = validateCandidate(catalog, { ...validDoc(), name: 'x'.repeat(49) }, meta());
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error.some((e) => e.code === 'ERR_NAME_TOO_LONG')).toBe(true);
  });
});

describe('validateCandidate — tag failures', () => {
  it('reports ERR_TOO_MANY_TAGS at nine tags', () => {
    const nine = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'];
    const v = validateCandidate(catalog, { ...validDoc(), tags: nine }, meta());
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error.some((e) => e.code === 'ERR_TOO_MANY_TAGS')).toBe(true);
  });

  it('reports ERR_TAG_TOO_LONG for a 25-char tag', () => {
    const v = validateCandidate(catalog, { ...validDoc(), tags: ['x'.repeat(25)] }, meta());
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error.some((e) => e.code === 'ERR_TAG_TOO_LONG')).toBe(true);
  });

  it('reports ERR_TAG_EMPTY for an empty-string tag', () => {
    const v = validateCandidate(catalog, { ...validDoc(), tags: [''] }, meta());
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error.some((e) => e.code === 'ERR_TAG_EMPTY')).toBe(true);
  });

  it('reports ERR_TAG_NOT_KEBAB for uppercase / spaces / underscores', () => {
    const v = validateCandidate(catalog, { ...validDoc(), tags: ['Not-Kebab'] }, meta());
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error.some((e) => e.code === 'ERR_TAG_NOT_KEBAB')).toBe(true);
  });

  it('reports ERR_TAG_DUPLICATE for a repeat', () => {
    const v = validateCandidate(catalog, { ...validDoc(), tags: ['alpha', 'alpha'] }, meta());
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error.some((e) => e.code === 'ERR_TAG_DUPLICATE')).toBe(true);
  });
});

describe('validateCandidate — folds domain fit errors verbatim', () => {
  it('surfaces ERR_UNKNOWN_CHASSIS', () => {
    const v = validateCandidate(catalog, { ...validDoc(), chassisId: 'nope' }, meta());
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error.some((e) => e.code === 'ERR_UNKNOWN_CHASSIS')).toBe(true);
  });

  it('surfaces ERR_SLOT_TYPE_MISMATCH with expected/actual carried through', () => {
    // fig-wasp layout: weapon, engine, special. Put a shield in slot 0.
    const v = validateCandidate(
      catalog,
      { ...validDoc(), slots: ['shd-skim', 'eng-standard-drive', null] },
      meta(),
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    const mismatch = v.error.find((e) => e.code === 'ERR_SLOT_TYPE_MISMATCH');
    expect(mismatch?.expected).toBe('weapon');
    expect(mismatch?.actual).toBe('shield');
    expect(mismatch?.slotIndex).toBe(0);
  });

  it('surfaces ERR_SLOT_COUNT when slot length disagrees with the layout', () => {
    const v = validateCandidate(catalog, { ...validDoc(), slots: [null, null] }, meta());
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error.some((e) => e.code === 'ERR_SLOT_COUNT')).toBe(true);
  });
});

describe('validateCandidate — collects ALL violations (FR-5)', () => {
  it('emits every code from a maximally-broken doc in one report', () => {
    const doc = {
      name: '',
      tags: ['Not-Kebab', 'ok', 'ok'], // not-kebab + duplicate
      chassisId: 'fig-wasp',
      slots: ['shd-skim'], // wrong length AND wrong type at index 0
      storedCost: 0,
    };
    const v = validateCandidate(catalog, doc, meta());
    expect(v.ok).toBe(false);
    if (v.ok) return;
    const codes = new Set(v.error.map((e) => e.code));
    expect(codes.has('ERR_NAME_EMPTY')).toBe(true);
    expect(codes.has('ERR_TAG_NOT_KEBAB')).toBe(true);
    expect(codes.has('ERR_TAG_DUPLICATE')).toBe(true);
    expect(codes.has('ERR_SLOT_COUNT')).toBe(true);
    expect(codes.has('ERR_SLOT_TYPE_MISMATCH')).toBe(true);
  });
});

describe('validateCandidate — hostile input (§10 note 7)', () => {
  it('rejects a 10⁶-length slots doc without OOM', () => {
    const doc = {
      name: 'hostile',
      tags: [],
      chassisId: 'fig-wasp',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      slots: new Array(1_000_000).fill('wpn-pulse-array') as unknown as any[],
      storedCost: 0,
    };
    const v = validateCandidate(catalog, doc, meta());
    expect(v.ok).toBe(false);
    if (v.ok) return;
    // Should fail on slot count (256 ceiling vs 3 layout).
    expect(v.error.some((e) => e.code === 'ERR_SLOT_COUNT')).toBe(true);
  });

  it('handles a non-object doc field for tags without throwing', () => {
    const v = validateCandidate(catalog, { ...validDoc(), tags: 42 }, meta());
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error.some((e) => e.code === 'ERR_TOO_MANY_TAGS')).toBe(true);
  });
});
