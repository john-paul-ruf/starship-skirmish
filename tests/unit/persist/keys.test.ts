// M08 Persist — keys.ts tests (specs/database.md §3.1).
//
// The whole point of this suite is to pin the EXACT prefix string. GitHub
// Pages shares one origin across all of the owner's repos; a silent shortening
// from `starship-skirmish:` to anything else is live data loss the day another
// project lands under `github.io/<owner>/`.

import { describe, expect, it } from 'vitest';
import {
  BUILD_PREFIX,
  INDEX_KEY,
  META_KEY,
  PREFIX,
  PREFS_KEY,
  buildKey,
  parseBuildKey,
} from '../../../src/persist/keys.js';

describe('keys — pinned namespace (§3.1)', () => {
  it('PREFIX is exactly `starship-skirmish:` (never shorten — origin collisions on Pages)', () => {
    expect(PREFIX).toBe('starship-skirmish:');
  });

  it('singleton keys use the pinned prefix', () => {
    expect(META_KEY).toBe('starship-skirmish:meta');
    expect(INDEX_KEY).toBe('starship-skirmish:index');
    expect(PREFS_KEY).toBe('starship-skirmish:prefs');
    expect(BUILD_PREFIX).toBe('starship-skirmish:build:');
  });
});

describe('keys — buildKey / parseBuildKey round-trip', () => {
  it('round-trips a UUID through buildKey and parseBuildKey', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const key = buildKey(id);
    expect(key).toBe(`starship-skirmish:build:${id}`);
    expect(parseBuildKey(key)).toBe(id);
  });

  it('parseBuildKey returns null for keys outside the :build: namespace', () => {
    expect(parseBuildKey(META_KEY)).toBeNull();
    expect(parseBuildKey(INDEX_KEY)).toBeNull();
    expect(parseBuildKey(PREFS_KEY)).toBeNull();
    expect(parseBuildKey('unrelated:build:foo')).toBeNull();
  });

  it('parseBuildKey returns null for an empty id (a truncated :build: key is not a build)', () => {
    expect(parseBuildKey(BUILD_PREFIX)).toBeNull();
  });
});
