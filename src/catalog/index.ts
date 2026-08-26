// M03 Catalog — public surface (architecture §4).
//
// Everything a downstream module needs to resolve a chassis or component id, to
// browse chassis by class or components by slot, to encode / decode a share
// token, and to trust the catalog against its historical lock. Internals
// (`buildCatalog`, file envelopes) stay behind loadCatalog.ts.

export type {
  Catalog,
  CatalogLock,
  ChassisClass,
  ChassisDef,
  ClassDef,
  ComponentDef,
  EngineDef,
  MissileDef,
  ShieldDef,
  SpecialDef,
  SpecialEffect,
  SlotType,
  Tuning,
  WeaponDef,
} from './types.js';

export { loadCatalog } from './loadCatalog.js';
export { assertLock, CatalogLockError, type CatalogInvariantId } from './assertLock.js';
