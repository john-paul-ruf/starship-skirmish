// GPU color-ID codec for O(1) picking (arch §9).
//
// Every body is flat-shaded into an offscreen target with the RGB triple that
// `encodeId` derives from its `BodyId`; the pixel under the cursor is read back and
// `decodeId` recovers the id. This survives line geometry where three's raycaster is
// fiddly, and costs one render + one 1×1 readback regardless of body count.
//
// The codec is a pure bijection over the low 24 bits of the id (`uint32` body ids
// never approach 2^24 in a match). `pick.ts` owns the "empty space" sentinel by
// clearing the target to a reserved color outside the live-id range — the codec
// itself stays a total, dependency-free round-trip so it is trivially unit-tested.

/** A pixel-space RGB triple, each channel `0..255` (matches `readRenderTargetPixels`). */
export type ColorId = readonly [number, number, number];

/** `BodyId → [r,g,b]`. Bijective over `0 .. 0xFFFFFF`. */
export const encodeId = (id: number): ColorId => [
  (id >>> 16) & 0xff,
  (id >>> 8) & 0xff,
  id & 0xff,
];

/** `[r,g,b] → BodyId`. Exact inverse of `encodeId` for every id it can represent. */
export const decodeId = ([r, g, b]: ColorId): number =>
  (((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff)) >>> 0;

/** Normalize a channel triple to three.js `0..1` color space for a material/clear color. */
export const idToUnitRgb = (id: number): readonly [number, number, number] => {
  const [r, g, b] = encodeId(id);
  return [r / 255, g / 255, b / 255];
};
