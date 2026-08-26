// M08 Persist — byte accounting + WARN/CRITICAL ratio policy (specs/database.md §3.7).
//
// The BYTE CEILING lives in `src/io/limits.ts` (`STORAGE_BUDGET_BYTES`, one
// module — §10 note 2). This module owns only the ratio policy: how many bytes
// a `(key, value)` pair costs, and where "warn" and "critical" sit on the
// [0, budget] axis. Duplicating the byte ceiling here would let it drift; the
// import is deliberate.
//
// UTF-16 code units per entry (§3.7): `(key.length + value.length) × 2`. The
// unit is what most real browsers charge and what the projected 200 KB / 500
// builds figure was measured in.

import { STORAGE_BUDGET_BYTES } from '../io/limits.js';

/**
 * The ratio at which the UI raises "storage is filling up" (§3.7). The number
 * is UI policy, not a storage-engine ceiling; put/import continue to succeed
 * until the store itself refuses.
 */
export const WARN_AT = 0.8;

/**
 * The ratio at which the UI prominently warns and pushes an export (§3.7).
 * Still not a hard cap — the hard cap is the browser's own quota; this is the
 * "act NOW before we cross it" threshold.
 */
export const CRITICAL_AT = 0.95;

/**
 * Byte cost of one `(key, value)` pair, in UTF-16 code units (§3.7). No `.text`
 * or `.charAt` here — `.length` on a JavaScript string IS UTF-16 units.
 */
export const bytesOf = (key: string, value: string): number =>
  (key.length + value.length) * 2;

/** The three usage bands the UI paints. */
export type UsageLevel = 'ok' | 'warn' | 'critical';

/**
 * Bucket the used-byte count against the WARN/CRITICAL ratios. Called with the
 * `Σ entry.bytes` total the index carries so the headroom display doesn't
 * re-walk the store on every render.
 */
export const usageLevel = (usedBytes: number): UsageLevel => {
  const ratio = usedBytes / STORAGE_BUDGET_BYTES;
  if (ratio >= CRITICAL_AT) return 'critical';
  if (ratio >= WARN_AT) return 'warn';
  return 'ok';
};

/**
 * Remaining bytes against the budget. Clamped to `≥ 0` — a store that has
 * somehow exceeded the budget (racy write, browser generosity) reports zero
 * headroom rather than a negative number the UI would need to guard.
 */
export const headroom = (usedBytes: number): number =>
  Math.max(0, STORAGE_BUDGET_BYTES - usedBytes);

/** Re-exported so the UI's storage-headroom display can label its axis. */
export { STORAGE_BUDGET_BYTES };
