// The `test:catalog-lock` target (package.json → `vitest run tests/unit/catalog`).
// Asserts assertLock passes on the shipped v1 content, then a per-invariant table
// that crafts an isolated violation of each C1–C9 (specs/database.md §2.6) and
// asserts assertLock throws `CatalogLockError` naming that invariant.
//
// Every violation deep-clones the real content so mutations do not leak between
// cases. The catalog files under `catalog/**` are never modified.

import { describe, it, expect } from 'vitest';
import { buildCatalog, loadCatalog, type CatalogInput } from '../../../src/catalog/loadCatalog.js';
import {
  assertLock,
  CatalogLockError,
  type CatalogInvariantId,
} from '../../../src/catalog/assertLock.js';
import type {
  CatalogLock,
  ChassisDef,
  ClassDef,
  ComponentDef,
  SpecialDef,
  Tuning,
} from '../../../src/catalog/types.js';

// Raw content imports — same paths the loader uses.
import classesFile from '../../../catalog/classes.json';
import tuningFile from '../../../catalog/tuning.json';
import fighterChassisFile from '../../../catalog/chassis/fighter.json';
import frigateChassisFile from '../../../catalog/chassis/frigate.json';
import cruiserChassisFile from '../../../catalog/chassis/cruiser.json';
import megaChassisFile from '../../../catalog/chassis/mega-destroyer.json';
import weaponComponentsFile from '../../../catalog/components/weapon.json';
import shieldComponentsFile from '../../../catalog/components/shield.json';
import missileComponentsFile from '../../../catalog/components/missile.json';
import engineComponentsFile from '../../../catalog/components/engine.json';
import specialComponentsFile from '../../../catalog/components/special.json';
import lockV1File from '../../../catalog/lock/catalog-v1.json';

// Distributive deep-writable — strips readonly so tests can mutate cloned data
// without ugly per-site casts. Distributes over the ComponentDef union.
type Writable<T> = T extends readonly (infer U)[]
  ? Writable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: Writable<T[K]> }
    : T;

interface ChassisEnvelope {
  readonly entries: readonly ChassisDef[];
}
interface ComponentEnvelope {
  readonly entries: readonly ComponentDef[];
}
interface ClassesEnvelope {
  readonly catalogVersion: number;
  readonly classes: readonly ClassDef[];
}

const cf = classesFile as unknown as ClassesEnvelope;

// Build the same shape loadCatalog builds from the static imports. Cloned per
// test below.
const REAL_INPUT: CatalogInput = {
  catalogVersion: cf.catalogVersion,
  classes: cf.classes,
  chassis: [
    ...(fighterChassisFile as unknown as ChassisEnvelope).entries,
    ...(frigateChassisFile as unknown as ChassisEnvelope).entries,
    ...(cruiserChassisFile as unknown as ChassisEnvelope).entries,
    ...(megaChassisFile as unknown as ChassisEnvelope).entries,
  ],
  components: [
    ...(weaponComponentsFile as unknown as ComponentEnvelope).entries,
    ...(shieldComponentsFile as unknown as ComponentEnvelope).entries,
    ...(missileComponentsFile as unknown as ComponentEnvelope).entries,
    ...(engineComponentsFile as unknown as ComponentEnvelope).entries,
    ...(specialComponentsFile as unknown as ComponentEnvelope).entries,
  ],
  tuning: tuningFile as unknown as Tuning,
};

const REAL_LOCK = lockV1File as unknown as CatalogLock;

interface Fresh {
  input: Writable<CatalogInput>;
  lock: Writable<CatalogLock>;
}

const loadFresh = (): Fresh => ({
  input: structuredClone(REAL_INPUT) as Writable<CatalogInput>,
  lock: structuredClone(REAL_LOCK) as Writable<CatalogLock>,
});

const expectInvariant = (fn: () => void, expected: CatalogInvariantId): void => {
  let thrown: unknown = undefined;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(CatalogLockError);
  expect((thrown as CatalogLockError).invariant).toBe(expected);
};

// -----------------------------------------------------------------------------

describe('assertLock — shipped v1 content passes', () => {
  it('loadCatalog() does not throw on the real catalog + lock', () => {
    expect(() => loadCatalog()).not.toThrow();
  });

  it('assertLock returns void (no return value on success)', () => {
    const catalog = buildCatalog(REAL_INPUT);
    expect(assertLock(catalog, [REAL_LOCK])).toBeUndefined();
  });
});

describe('assertLock — CatalogLockError shape', () => {
  it('names the invariant, extends Error, carries the id as a field', () => {
    const err = new CatalogLockError('C3', 'test');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CatalogLockError');
    expect(err.invariant).toBe('C3');
    expect(err.message).toContain('C3');
  });
});

// The per-invariant table — one crafted-violation case per invariant. Each case
// clones fresh so mutations don't leak. Comments trace the expected fire path.
describe('assertLock — per-invariant violation table (C1..C9)', () => {
  it('C1 — lock references an id missing from the current catalog', () => {
    const { input, lock } = loadFresh();
    // A phantom id in the lock, catalog otherwise untouched.
    lock.ordinals['fig-phantom-not-in-catalog'] = 999;
    expectInvariant(() => assertLock(buildCatalog(input), [lock]), 'C1');
  });

  it('C2 — a locked id maps to a different ordinal in the catalog', () => {
    const { input, lock } = loadFresh();
    // Move fig-needle's catalog ordinal to a fresh, unused value so the C3
    // uniqueness check does NOT fire first.
    input.chassis[0]!.ordinal = 900;
    expectInvariant(() => assertLock(buildCatalog(input), [lock]), 'C2');
  });

  it('C3 — duplicate id across the catalog', () => {
    const { input, lock } = loadFresh();
    // Give the second chassis the same id as the first (ordinals still distinct).
    input.chassis[1]!.id = input.chassis[0]!.id;
    expectInvariant(() => assertLock(buildCatalog(input), [lock]), 'C3');
  });

  it('C3 — duplicate ordinal across the catalog', () => {
    const { input, lock } = loadFresh();
    input.chassis[1]!.ordinal = input.chassis[0]!.ordinal;
    expectInvariant(() => assertLock(buildCatalog(input), [lock]), 'C3');
  });

  it('C4 — chassis.classId references an unknown class', () => {
    const { input, lock } = loadFresh();
    (input.chassis[0]! as { classId: string }).classId = 'nonexistent-class';
    expectInvariant(() => assertLock(buildCatalog(input), [lock]), 'C4');
  });

  it('C5 — component.slotType is not in the closed slotTypes set', () => {
    const { input, lock } = loadFresh();
    (input.components[0]! as { slotType: string }).slotType = 'nonexistent-slot';
    expectInvariant(() => assertLock(buildCatalog(input), [lock]), 'C5');
  });

  it('C6 — special.stats.effect is not an implemented rule value', () => {
    const { input, lock } = loadFresh();
    // Find any special and rewrite its effect to an unimplemented value.
    const special = input.components.find(
      (c): c is Writable<SpecialDef> => c.slotType === 'special',
    );
    expect(special).toBeDefined();
    (special!.stats as { effect: string }).effect = 'not-a-real-effect';
    expectInvariant(() => assertLock(buildCatalog(input), [lock]), 'C6');
  });

  it('C7 — tuning.catalogVersion drifts from classes.catalogVersion', () => {
    const { input, lock } = loadFresh();
    input.tuning.catalogVersion = 999;
    expectInvariant(() => assertLock(buildCatalog(input), [lock]), 'C7');
  });

  it('C7 — newest lock.catalogVersion drifts from classes.catalogVersion', () => {
    const { input, lock } = loadFresh();
    lock.catalogVersion = 999;
    expectInvariant(() => assertLock(buildCatalog(input), [lock]), 'C7');
  });

  it('C8 — a class layout shrank (lockCount > current)', () => {
    const { input, lock } = loadFresh();
    // fighter currently has 3 slots; lock now says the historical count was 99.
    lock.classSlotCounts['fighter'] = 99;
    expectInvariant(() => assertLock(buildCatalog(input), [lock]), 'C8');
  });

  it('C9 — arena.radiusByBudget keys differ from match.legalBudgets', () => {
    const { input, lock } = loadFresh();
    // Drop 150 from legalBudgets while radiusByBudget still has 6 keys.
    input.tuning.match.legalBudgets = [25, 50, 75, 100, 125];
    expectInvariant(() => assertLock(buildCatalog(input), [lock]), 'C9');
  });
});
