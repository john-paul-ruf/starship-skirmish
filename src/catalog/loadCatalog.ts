// M03 Catalog Loader (architecture §4, specs/database.md §4 / §8).
//
// Reads the static v1 content, flattens the sharded chassis/component envelopes,
// builds the six indexes named in §4, and returns a frozen `Catalog`. Every id
// resolves through this one loader.
//
// STATIC JSON IMPORTS ONLY — no `import.meta.glob`. The loader must run identically
// in Vite (browser), Vitest (Node), and the tsx harness (Node); static imports are
// what makes that portable (F5 harness dependency).

import classesFile from '../../catalog/classes.json';
import tuningFile from '../../catalog/tuning.json';
import fighterChassisFile from '../../catalog/chassis/fighter.json';
import frigateChassisFile from '../../catalog/chassis/frigate.json';
import cruiserChassisFile from '../../catalog/chassis/cruiser.json';
import megaChassisFile from '../../catalog/chassis/mega-destroyer.json';
import weaponComponentsFile from '../../catalog/components/weapon.json';
import shieldComponentsFile from '../../catalog/components/shield.json';
import missileComponentsFile from '../../catalog/components/missile.json';
import engineComponentsFile from '../../catalog/components/engine.json';
import specialComponentsFile from '../../catalog/components/special.json';
import lockV1File from '../../catalog/lock/catalog-v1.json';

import type {
  Catalog,
  CatalogLock,
  ChassisClass,
  ChassisDef,
  ClassDef,
  ComponentDef,
  SlotType,
  Tuning,
} from './types.js';
import { assertLock } from './assertLock.js';

// ---- File envelope shapes (§2.1–§2.3) — private to this loader ------------

interface ClassesFile {
  readonly schemaVersion: number;
  readonly catalogVersion: number;
  readonly slotTypes: readonly SlotType[];
  readonly slotOrder: readonly SlotType[];
  readonly classes: readonly ClassDef[];
}

interface ChassisFile {
  readonly schemaVersion: number;
  readonly kind: 'chassis';
  readonly classId: ChassisClass;
  readonly entries: readonly ChassisDef[];
}

interface ComponentFile {
  readonly schemaVersion: number;
  readonly kind: 'component';
  readonly slotType: SlotType;
  readonly entries: readonly ComponentDef[];
}

// ---- Static input assembled once at module init ----------------------------

const CHASSIS_FILES: readonly ChassisFile[] = [
  fighterChassisFile as unknown as ChassisFile,
  frigateChassisFile as unknown as ChassisFile,
  cruiserChassisFile as unknown as ChassisFile,
  megaChassisFile as unknown as ChassisFile,
];

const COMPONENT_FILES: readonly ComponentFile[] = [
  weaponComponentsFile as unknown as ComponentFile,
  shieldComponentsFile as unknown as ComponentFile,
  missileComponentsFile as unknown as ComponentFile,
  engineComponentsFile as unknown as ComponentFile,
  specialComponentsFile as unknown as ComponentFile,
];

const CLASSES = classesFile as unknown as ClassesFile;

/**
 * Flat catalog input passed to `buildCatalog`. `loadCatalog` produces this from
 * the static JSON imports; tests may construct mutated variants to exercise
 * assertLock invariant violations.
 */
export interface CatalogInput {
  readonly catalogVersion: number;
  readonly classes: readonly ClassDef[];
  readonly chassis: readonly ChassisDef[];
  readonly components: readonly ComponentDef[];
  readonly tuning: Tuning;
}

const REAL_INPUT: CatalogInput = {
  catalogVersion: CLASSES.catalogVersion,
  classes: CLASSES.classes,
  chassis: CHASSIS_FILES.flatMap((f) => [...f.entries]),
  components: COMPONENT_FILES.flatMap((f) => [...f.entries]),
  tuning: tuningFile as unknown as Tuning,
};

const REAL_LOCKS: readonly CatalogLock[] = [lockV1File as unknown as CatalogLock];

// ---- Index construction (§4 — Q1..Q6 come from these six maps) ------------

const byOrdinalAsc = (
  a: ChassisDef | ComponentDef,
  b: ChassisDef | ComponentDef,
): number => a.ordinal - b.ordinal;

/**
 * Pure catalog constructor. Builds the six §4 indexes over `input` and returns
 * a frozen `Catalog`. Does NOT check invariants — `assertLock` is the CI gate.
 *
 * Exported for test use so mutated inputs can exercise assertLock violations.
 * `loadCatalog` is the public production entry point.
 */
export const buildCatalog = (input: CatalogInput): Catalog => {
  const chassis: readonly ChassisDef[] = [...input.chassis].sort(byOrdinalAsc);
  const components: readonly ComponentDef[] = [...input.components].sort(byOrdinalAsc);

  const classById = new Map<ChassisClass, ClassDef>();
  for (const c of input.classes) classById.set(c.id, c);

  const chassisById = new Map<string, ChassisDef>();
  const componentById = new Map<string, ComponentDef>();
  const byOrdinalMap = new Map<number, ChassisDef | ComponentDef>();
  const ordinalOfMap = new Map<string, number>();
  const bySlotType = new Map<SlotType, ComponentDef[]>();
  const chassisByClass = new Map<ChassisClass, ChassisDef[]>();

  for (const ch of chassis) {
    chassisById.set(ch.id, ch);
    byOrdinalMap.set(ch.ordinal, ch);
    ordinalOfMap.set(ch.id, ch.ordinal);
    const list = chassisByClass.get(ch.classId) ?? [];
    list.push(ch);
    chassisByClass.set(ch.classId, list);
  }

  for (const co of components) {
    componentById.set(co.id, co);
    byOrdinalMap.set(co.ordinal, co);
    ordinalOfMap.set(co.id, co.ordinal);
    const list = bySlotType.get(co.slotType) ?? [];
    list.push(co);
    bySlotType.set(co.slotType, list);
  }

  // Stable ordinal-sorted output for every list accessor.
  for (const arr of bySlotType.values()) arr.sort(byOrdinalAsc);
  for (const arr of chassisByClass.values()) arr.sort(byOrdinalAsc);

  const EMPTY_COMPONENTS: readonly ComponentDef[] = Object.freeze([]);
  const EMPTY_CHASSIS: readonly ChassisDef[] = Object.freeze([]);

  const catalog: Catalog = {
    catalogVersion: input.catalogVersion,
    tuning: input.tuning,
    chassis: (id) => chassisById.get(id),
    component: (id) => componentById.get(id),
    ordinalOf: (id) => ordinalOfMap.get(id),
    byOrdinal: (n) => byOrdinalMap.get(n),
    classOf: (classId) => classById.get(classId),
    slotLayout: (classId) => classById.get(classId)?.slots,
    componentsForSlot: (type) => bySlotType.get(type) ?? EMPTY_COMPONENTS,
    chassisOfClass: (classId) => chassisByClass.get(classId) ?? EMPTY_CHASSIS,
    allChassis: () => chassis,
    allComponents: () => components,
  };

  return Object.freeze(catalog);
};

/**
 * Load, index, and integrity-check the shipped v1 catalog. Throws
 * `CatalogLockError` on any invariant violation (§2.6, `test:catalog-lock`).
 */
export const loadCatalog = (): Catalog => {
  const catalog = buildCatalog(REAL_INPUT);
  assertLock(catalog, REAL_LOCKS);
  return catalog;
};
