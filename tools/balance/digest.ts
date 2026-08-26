// tools/balance/digest.ts — the reproducibility primitive (architecture §7.5).
//
// A digest is a short hex string that identifies the outcome of a scenario BIT-EXACTLY.
// Two engines that agree on this string agree on every float they produced during the
// simulation. Disagreement is the loudest possible failure signal.
//
// FLOAT FORMAT. Each `number` becomes the 16 hex chars of its IEEE-754 float64
// bit pattern (little-endian read of a DataView). This is the tightest possible
// engine-portable representation:
//   - `-0` and `+0` land on distinct bit patterns → the digest distinguishes them.
//   - `NaN` payloads are preserved verbatim (a change in NaN encoding IS a
//     determinism failure worth catching).
//   - Every subnormal is represented exactly; `Number.toString()` shortest-round-trip
//     does the right thing on all modern engines, but the bit pattern is stricter
//     and cheaper — no engine ambiguity remains.
//
// HASH FUNCTION. FNV-1a-64 over the canonical text, computed with `BigInt`. `BigInt`
// arithmetic is exact by spec across V8 / SpiderMonkey / JSC / Node, so the hash
// value itself is engine-portable. FNV is not cryptographic — it does not need to be;
// its job is to compress a canonical serialization into 16 hex chars for eyeball
// comparison and CI equality. If a serialization changes, the hash changes.
//
// CANONICAL SERIALIZATION. See `canonicalize()` — line-based, sorted by body id,
// contacts in the sim's already-canonical `(subStep, toi, idA, idB)` order, exits in
// the sub-step order they were detected. Sub-step keyframes are DELIBERATELY NOT
// hashed: they would 5×–64× the string and every intermediate collision is already
// pinned by the contact records that read out of them.

import type { Vec3 } from '../../src/sim/mathx/index.js';
import type { ScenarioResult } from './scenario.js';

// One shared 8-byte buffer / DataView per module. Every hex conversion writes into
// the same little-endian slot and reads two uint32s out — no allocation per float.
const FLOAT_BUF = new ArrayBuffer(8);
const FLOAT_VIEW = new DataView(FLOAT_BUF);

/** IEEE-754 float64 → 16 hex chars (low uint32 first, then high — a stable order
 *  regardless of host endianness because we control the DataView reads). */
export const hexFloat = (n: number): string => {
  FLOAT_VIEW.setFloat64(0, n, true);
  const lo = FLOAT_VIEW.getUint32(0, true);
  const hi = FLOAT_VIEW.getUint32(4, true);
  // toString(16) drops leading zeros; padStart(8) restores the fixed 8-char width.
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
};

const hexVec = (v: Vec3): string =>
  `${hexFloat(v.x)} ${hexFloat(v.y)} ${hexFloat(v.z)}`;

/**
 * Canonicalize a `ScenarioResult` to a text string. This is the pre-image of the
 * digest; a change here (adding a field, reordering a column) invalidates every
 * recorded fixture and must be paired with a coordinated regeneration + version bump.
 *
 * Line grammar:
 *   `b <beat> N=<subStepCount>`                                     — beat header
 *   `B <id> <kind> <mass> <radius> <pos*3> <vel*3>`                 — surviving body
 *   `C <subStep> <toi> <idA> <idB> <normal*3> <point*3> <relSpeedNormal> <damage>`
 *   `E <bodyId> <kind> <subStep>`                                   — boundary exit
 *
 * Ordering within a beat: bodies by ascending id (already sorted by resolveMovement),
 * contacts in the sim's canonical `(subStep, toi, idA, idB)` order, exits in
 * detection order (sub-step monotone). All these are guaranteed by the sim; this
 * function does not re-sort — that would silently paper over a determinism bug.
 */
export const canonicalize = (result: ScenarioResult): string => {
  const lines: string[] = [];
  for (const beat of result.beats) {
    lines.push(`b ${beat.beat} N=${beat.step.subStepCount}`);
    for (const b of beat.step.finalBodies) {
      lines.push(
        `B ${b.id} ${b.kind} ${hexFloat(b.mass)} ${hexFloat(b.radius)} ${hexVec(b.position)} ${hexVec(b.velocity)}`,
      );
    }
    for (const c of beat.step.contacts) {
      lines.push(
        `C ${c.subStep} ${hexFloat(c.toi)} ${c.idA} ${c.idB} ${hexVec(c.normal)} ${hexVec(c.point)} ${hexFloat(c.relSpeedNormal)} ${hexFloat(c.damage)}`,
      );
    }
    for (const e of beat.step.exits) {
      lines.push(`E ${e.bodyId} ${e.kind} ${e.subStep}`);
    }
  }
  // Trailing newline so canonicalize(a) + canonicalize(b) is unambiguously the
  // concatenation of the two, not two lines glued into one.
  return lines.join('\n') + '\n';
};

// FNV-1a-64 constants (Fowler-Noll-Vo).
const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/**
 * FNV-1a-64 over the UTF-16 code units of `text`. Portable across engines because
 * BigInt arithmetic is exact by spec. Non-cryptographic — the guarantee is
 * "distinct inputs almost always distinct outputs," which is all a fingerprint needs.
 */
export const fnv1a64 = (text: string): string => {
  let h = FNV_OFFSET_64;
  for (let i = 0; i < text.length; i += 1) {
    h = (h ^ BigInt(text.charCodeAt(i))) & MASK_64;
    h = (h * FNV_PRIME_64) & MASK_64;
  }
  return h.toString(16).padStart(16, '0');
};

/**
 * The one thing the harness records against and the cross-engine test compares
 * against: `fnv1a64(canonicalize(result))`. 16 hex chars, engine-portable, bit-exact.
 */
export const digest = (result: ScenarioResult): string => fnv1a64(canonicalize(result));
