// M08 Persist — quota.ts tests (specs/database.md §3.7).
//
// Pin the byte formula, the WARN/CRITICAL thresholds, and the fact that the
// budget constant is IMPORTED from src/io/limits (§10 note 2 — one module,
// one number). If any of these drifts, the storage-headroom UI in F7/F8 tells
// a different story than the write path, and that is the class of bug §3.7
// exists to prevent.

import { describe, expect, it } from 'vitest';
import { STORAGE_BUDGET_BYTES } from '../../../src/io/limits.js';
import {
  CRITICAL_AT,
  WARN_AT,
  bytesOf,
  headroom,
  usageLevel,
  STORAGE_BUDGET_BYTES as REEXPORTED_BUDGET,
} from '../../../src/persist/quota.js';

describe('quota — byte accounting (§3.7)', () => {
  it('bytesOf uses UTF-16 code units — (key.length + value.length) * 2', () => {
    expect(bytesOf('a', 'b')).toBe(4);
    expect(bytesOf('abc', 'defg')).toBe(14);
    expect(bytesOf('', '')).toBe(0);
  });

  it('bytesOf counts JavaScript .length (which IS UTF-16 units)', () => {
    // A surrogate pair (emoji) is 2 UTF-16 units in .length — count both.
    const emoji = '🚀'; // length 2 in UTF-16
    expect(emoji.length).toBe(2);
    expect(bytesOf('k', emoji)).toBe((1 + 2) * 2);
  });
});

describe('quota — thresholds (§3.7)', () => {
  it('WARN_AT is 0.80 and CRITICAL_AT is 0.95', () => {
    expect(WARN_AT).toBe(0.8);
    expect(CRITICAL_AT).toBe(0.95);
  });

  it('reads STORAGE_BUDGET_BYTES from io/limits (one module — §10 note 2)', () => {
    expect(REEXPORTED_BUDGET).toBe(STORAGE_BUDGET_BYTES);
  });
});

describe('quota — usageLevel bucketing', () => {
  it('reports ok below WARN_AT', () => {
    expect(usageLevel(0)).toBe('ok');
    expect(usageLevel(STORAGE_BUDGET_BYTES * 0.5)).toBe('ok');
    // Just below WARN_AT.
    expect(usageLevel(STORAGE_BUDGET_BYTES * 0.79)).toBe('ok');
  });

  it('reports warn at WARN_AT and up to CRITICAL_AT', () => {
    expect(usageLevel(STORAGE_BUDGET_BYTES * WARN_AT)).toBe('warn');
    expect(usageLevel(STORAGE_BUDGET_BYTES * 0.9)).toBe('warn');
  });

  it('reports critical at CRITICAL_AT and above', () => {
    expect(usageLevel(STORAGE_BUDGET_BYTES * CRITICAL_AT)).toBe('critical');
    expect(usageLevel(STORAGE_BUDGET_BYTES)).toBe('critical');
    expect(usageLevel(STORAGE_BUDGET_BYTES * 1.1)).toBe('critical');
  });
});

describe('quota — headroom', () => {
  it('returns budget minus used', () => {
    expect(headroom(0)).toBe(STORAGE_BUDGET_BYTES);
    expect(headroom(1000)).toBe(STORAGE_BUDGET_BYTES - 1000);
  });

  it('clamps at zero when used exceeds the budget', () => {
    expect(headroom(STORAGE_BUDGET_BYTES + 42)).toBe(0);
  });
});
