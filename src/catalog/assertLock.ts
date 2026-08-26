// STUB — replaced with the real invariant checker in checkpoint 2.
//
// loadCatalog wires this in from checkpoint 1 so the load pipeline is complete
// end-to-end; the stub is a no-op and the loader tests do not exercise it.

import type { Catalog, CatalogLock } from './types.js';

export type CatalogInvariantId = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7' | 'C8' | 'C9';

export class CatalogLockError extends Error {
  readonly invariant: CatalogInvariantId;
  constructor(invariant: CatalogInvariantId, detail: string) {
    super(`Catalog invariant ${invariant} violated: ${detail}`);
    this.name = 'CatalogLockError';
    this.invariant = invariant;
  }
}

export const assertLock = (catalog: Catalog, locks: readonly CatalogLock[]): void => {
  // no-op stub — real checks land in CP2. Reference the args so the stub compiles
  // under `no-unused-vars` without changing the signature.
  void catalog;
  void locks;
};
