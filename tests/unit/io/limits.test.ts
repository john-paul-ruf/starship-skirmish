// M07 IO — limits.ts tests (specs/database.md §3.2 / §3.7 / §8, §10 note 2-3).
//
// The point of these tests isn't to prove the constants exist — TypeScript does
// that. The point is to pin the CROSS-FORMAT invariants: `NAME_MAX = 48` is the
// share token's `nameLen` cap and raising it in one place silently mints
// unshareable builds (§10 note 3). If either half changes, this test fails and
// forces the change to be intentional.

import { describe, expect, it } from 'vitest';
import {
  BUILDS_MAX,
  FILE_MAX_BYTES,
  NAME_MAX,
  NAME_MIN,
  STORAGE_BUDGET_BYTES,
  TAG_MAX,
  TAG_MIN,
  TAGS_MAX,
  TOKEN_MAX,
  URL_TOKEN_BUDGET,
} from '../../../src/io/limits.js';

describe('limits — pinned values (specs/database.md §3.2 / §3.7 / §8)', () => {
  it('name range is 1..48 (§3.2)', () => {
    expect(NAME_MIN).toBe(1);
    expect(NAME_MAX).toBe(48);
  });

  it('tag count and length caps match §3.2 (≤ 8 tags, each 1..24)', () => {
    expect(TAGS_MAX).toBe(8);
    expect(TAG_MIN).toBe(1);
    expect(TAG_MAX).toBe(24);
  });

  it('token / URL budgets match §8.1 (2048 absolute, 1900 URL-embed target)', () => {
    expect(TOKEN_MAX).toBe(2048);
    expect(URL_TOKEN_BUDGET).toBe(1900);
  });

  it('import caps match §8.2 (5000 builds, 8 MB file)', () => {
    expect(BUILDS_MAX).toBe(5000);
    expect(FILE_MAX_BYTES).toBe(8_000_000);
  });

  it('storage budget matches §3.7 (5 MB in UTF-16 code units)', () => {
    expect(STORAGE_BUDGET_BYTES).toBe(5_000_000);
  });
});

describe('limits — cross-format invariants (§10 note 3)', () => {
  it('NAME_MAX (io) is fixed at 48 because the share token nameLen field is capped at 48', () => {
    // The share token (architecture §8.1) reserves a `nameLen` varuint with a
    // documented ≤48 cap. Raising NAME_MAX here without also widening the token
    // encoder silently produces builds the Shipyard accepts but the sharer's
    // link cannot express. The only sanctioned change to this number is
    // simultaneous with a token schema bump — assert the pin explicitly.
    expect(NAME_MAX).toBe(48);
  });

  it('URL_TOKEN_BUDGET < TOKEN_MAX — the URL budget is a warning, not a limit', () => {
    // TOKEN_MAX is the hard ceiling the decoder refuses at; URL_TOKEN_BUDGET
    // is the softer "link is long" nudge. Reversing them (or making them
    // equal) collapses the warning into a rejection.
    expect(URL_TOKEN_BUDGET).toBeLessThan(TOKEN_MAX);
  });

  it('TAG_MIN ≤ TAG_MAX and NAME_MIN ≤ NAME_MAX (ordering sanity)', () => {
    expect(TAG_MIN).toBeLessThanOrEqual(TAG_MAX);
    expect(NAME_MIN).toBeLessThanOrEqual(NAME_MAX);
  });
});
