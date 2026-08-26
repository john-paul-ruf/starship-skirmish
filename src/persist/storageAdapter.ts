// M08 Persist — the narrow storage seam (specs/database.md §3.7 boot probe,
// FR-7 degrade-never-crash).
//
// Vitest runs `environment: 'node'` — there is no `localStorage`. Any code that
// touches a bare `localStorage` global here would crash the unit suite before
// the first assertion. This module defines a narrow `KeyValueStore` interface
// with two impls (`localStorageStore` behind a feature-detect, `memoryStore`
// fallback + tests) and a single `openStore()` boot-probe that decides at
// runtime which one to use.
//
// Production wiring (F7/F8 `app`) passes the real `localStorage` in explicitly;
// tests inject `memoryStore()`. Storage is INJECTED, not imported.
//
// The `memoryStore(quotaAtBytes?)` variant is what lets a unit test simulate
// `QuotaExceededError` without a browser — cross the ceiling and `setItem`
// throws exactly like a real browser would (name property `QuotaExceededError`
// per Web Storage spec).

// ---- Interface ------------------------------------------------------------

/**
 * The full storage surface persist ever uses. Deliberately narrower than the
 * DOM `Storage` interface — no `.length`, no `.key(n)`, no `.clear()`. `keys()`
 * returns a fresh array snapshot so the caller can safely mutate the store
 * mid-iteration (rebuild does this).
 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  /** May throw a `QuotaExceededError` when the store is full — the caller MUST catch. */
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** Snapshot of every key currently in the store. Order is unspecified. */
  keys(): readonly string[];
}

// ---- Memory store ---------------------------------------------------------

/**
 * A quota-aware error whose `.name === 'QuotaExceededError'` — matches the Web
 * Storage spec so callers can catch by name without a DOM dependency.
 */
class MemoryQuotaError extends Error {
  override readonly name = 'QuotaExceededError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * A `Map`-backed `KeyValueStore`. Used by every unit test and by the degrade
 * path when the real `localStorage` is unavailable or full. `quotaAtBytes`
 * (optional) makes the store throw `QuotaExceededError` past a ceiling —
 * the crash-recovery + quota-degrade tests use this to simulate a real quota
 * failure deterministically.
 *
 * Byte accounting uses UTF-16 code units (`(key.length + value.length) * 2`),
 * the same formula persist/quota.ts uses — so a store built with `quotaAtBytes
 * = STORAGE_BUDGET_BYTES` refuses writes at exactly the same total the app
 * would try to warn about.
 */
export const memoryStore = (
  opts?: { readonly quotaAtBytes?: number },
): KeyValueStore => {
  const data = new Map<string, string>();
  const cap = opts?.quotaAtBytes;

  const totalBytes = (): number => {
    let sum = 0;
    for (const [k, v] of data) sum += (k.length + v.length) * 2;
    return sum;
  };

  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      if (cap !== undefined) {
        const existing = data.get(key);
        const existingBytes = existing !== undefined ? (key.length + existing.length) * 2 : 0;
        const nextBytes = (key.length + value.length) * 2;
        const projected = totalBytes() - existingBytes + nextBytes;
        if (projected > cap) {
          throw new MemoryQuotaError(
            `memoryStore quota exceeded: writing "${key}" would use ${projected} bytes (cap ${cap}).`,
          );
        }
      }
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
    keys: () => Array.from(data.keys()),
  };
};

// ---- localStorage store ---------------------------------------------------

/**
 * The DOM-`Storage`-facing subset persist uses. Typed as a structural minimum
 * so a browser `localStorage` object satisfies it without a DOM import.
 */
interface DomStorageLike {
  readonly length: number;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
}

/**
 * Wrap a DOM `Storage` in the narrow `KeyValueStore` interface. `keys()`
 * enumerates via `.key(n)` — using `Object.keys(localStorage)` picks up
 * inherited members on some engines and enumerates keys the app doesn't own.
 * Does NOT feature-detect — call `openStore()` for that.
 */
export const localStorageStore = (raw: DomStorageLike): KeyValueStore => ({
  getItem: (key) => raw.getItem(key),
  setItem: (key, value) => raw.setItem(key, value),
  removeItem: (key) => raw.removeItem(key),
  keys: () => {
    const out: string[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const k = raw.key(i);
      if (k !== null) out.push(k);
    }
    return out;
  },
});

// ---- Boot probe (§3.7) ----------------------------------------------------

const PROBE_KEY = 'starship-skirmish:__probe__';

/**
 * The one-shot feature-detect for the real `Storage` (§3.7): attempt a
 * `setItem` + `removeItem` of a throwaway key on `localStorage`. Any failure
 * (undefined global, private-mode `SecurityError`, zero-quota) reports the
 * absence WITHOUT throwing. Detects unavailability ONCE — never during a save.
 */
const probeDomStorage = (candidate: DomStorageLike | undefined): boolean => {
  if (candidate === undefined) return false;
  try {
    candidate.setItem(PROBE_KEY, '1');
    candidate.removeItem(PROBE_KEY);
    return true;
  } catch {
    return false;
  }
};

/**
 * The result of `openStore()`: which store was chosen, and whether writes will
 * outlive the browser tab (`durable: false` means the app must surface a
 * session-mode banner — §3.7 / FR-7).
 */
export interface OpenedStore {
  readonly store: KeyValueStore;
  readonly durable: boolean;
}

/**
 * Choose a `KeyValueStore` at boot. If `injected` is provided, it is used
 * verbatim — the caller decides `durable` in that path (memory injections are
 * non-durable; a caller passing a wrapped `localStorage` sets durable itself
 * via `localStorageStore` + this call's default). If nothing is injected, the
 * boot probe is run against the ambient `localStorage`; success returns a
 * durable wrapper, any failure returns an in-memory fallback with
 * `durable: false`.
 *
 * The `localStorage` reference is looked up via `globalThis` so this file
 * NEVER touches a bare `localStorage` identifier — under Vitest's Node
 * environment that would be a `ReferenceError` before any test runs.
 */
export const openStore = (
  injected?: { readonly store: KeyValueStore; readonly durable: boolean },
): OpenedStore => {
  if (injected !== undefined) return injected;

  const ambient = (globalThis as { readonly localStorage?: DomStorageLike }).localStorage;
  if (probeDomStorage(ambient) && ambient !== undefined) {
    return { store: localStorageStore(ambient), durable: true };
  }
  return { store: memoryStore(), durable: false };
};
