// M14 UI — private helpers for the shared component library.
//
// Not re-exported from the barrel. Keeps every component's class-name plumbing
// in one place so callers see a small surface (`cx('btn', ...)` is used from
// every file). No runtime dependencies.

/**
 * Filter-and-join class-name parts. Skips `false`, `null`, `undefined`, and
 * empty strings — so callers can write `cx('btn', variant === 'sm' && 'btn-sm',
 * extra)` without branching. Order is preserved; a caller-supplied `extra`
 * appended last wins CSS-cascade ties over the built-in variant classes.
 */
export function cx(
  ...parts: readonly (string | false | null | undefined)[]
): string {
  let out = '';
  for (const p of parts) {
    if (p === false || p === null || p === undefined || p === '') continue;
    out = out === '' ? p : `${out} ${p}`;
  }
  return out;
}

/**
 * Clamp `n` to `[lo, hi]`. NaN → `lo`. Used by Meter to keep the rendered fill
 * within `0%..100%` for any numeric input.
 */
export function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
