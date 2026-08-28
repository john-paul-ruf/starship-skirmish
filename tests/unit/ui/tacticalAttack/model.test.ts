// M14 UI — Tactical Attack model (S06). Node-only (no JSX, no DOM):
// the fire-slot gate, the called-shot unlock at shields===0, the AoE-overlap
// geometry (friendly inside vs outside the blast), and `toAttackPlans` shape
// (calledShot present ONLY when unlocked, exactly one of weapon/missile index).

import { describe, expect, it } from 'vitest';

import {
  aoeOverlapsFriendly,
  aoeRingProjection,
  assignmentGate,
  calledShotEquals,
  calledShotOptions,
  calledShotUnlocked,
  enemyShips,
  fireContext,
  fireSlotTotal,
  friendlyShips,
  GENERATOR_HINT,
  hitChanceBarFill,
  hitChanceTone,
  liveFireSlots,
  rangePreviewFor,
  shieldReadout,
  shipRangePreview,
  slotKey,
  toAttackPlans,
  weaponOutOfRange,
  type Assignment,
  type FireSlot,
} from '../../../../src/ui/screens/tacticalAttack/model.js';
import type {
  BlindMatchView,
  BlindShipView,
  Body,
  SimShip,
  SimWeapon,
  Vec3,
} from '../../../../src/sim/index.js';

// ---- Fixtures -------------------------------------------------------------

const at = (x: number, y = 0, z = 0): Vec3 => ({ x, y, z });

const simShip = (over: Partial<SimShip> = {}): SimShip => ({
  buildId: 'b',
  name: 'SHIP',
  chassisClass: 'frigate',
  mass: 100,
  radius: 4,
  maxHull: 70,
  shieldCapacity: 40,
  shieldRegenPerTurn: 2,
  deltaVPerTurn: 30,
  baseEvasion: 0.1,
  hullRepairPerTurn: 0,
  weapons: [],
  missiles: [],
  pointDefense: [],
  decoys: [],
  ...over,
});

const shipView = (over: Partial<BlindShipView>): BlindShipView => ({
  bodyId: 1,
  fleetId: 0,
  name: 'WIDOWMAKER',
  chassisClass: 'cruiser',
  hull: 100,
  maxHull: 140,
  shields: 30,
  shieldCapacity: 45,
  shieldGenAlive: true,
  engineAlive: true,
  weaponAlive: [true, true],
  missileAlive: [],
  missileAmmo: [],
  pdAlive: [],
  decoyAlive: [],
  decoyCharges: [],
  decoyActiveUntilTurn: 0,
  ship: simShip(),
  ...over,
});

const body = (id: number, position: Vec3): Body => ({
  id,
  kind: 'ship',
  position,
  velocity: at(0),
  mass: 100,
  radius: 4,
});

const viewOf = (ships: readonly BlindShipView[], bodies: readonly Body[]): BlindMatchView => ({
  turn: 4,
  arena: { center: at(0), radius: 5400 },
  selfFleetId: 0,
  bodies,
  ships,
});

// ---- Fire slots + gate ----------------------------------------------------

describe('liveFireSlots', () => {
  it('includes intact weapons and loaded missile racks; excludes dead + spent', () => {
    const ship = shipView({
      weaponAlive: [true, false, true],
      missileAlive: [true, true],
      missileAmmo: [2, 0],
    });
    const slots = liveFireSlots(ship);
    expect(slots).toEqual([
      { shooterId: 1, kind: 'weapon', index: 0 },
      { shooterId: 1, kind: 'weapon', index: 2 },
      { shooterId: 1, kind: 'missile', index: 0 },
    ]);
  });

  it('slotKey disambiguates weapon vs missile at the same index', () => {
    expect(slotKey({ shooterId: 1, kind: 'weapon', index: 0 })).not.toBe(
      slotKey({ shooterId: 1, kind: 'missile', index: 0 }),
    );
  });
});

describe('assignmentGate', () => {
  it('counts assigned against total live slots (hold fire is legal — total is fixed)', () => {
    const ships = [
      shipView({ bodyId: 1, weaponAlive: [true, true] }),
      shipView({ bodyId: 2, weaponAlive: [true], missileAlive: [true], missileAmmo: [1] }),
    ];
    expect(fireSlotTotal(ships)).toBe(4);
    const assignments: Assignment[] = [{ shooterId: 1, targetId: 9, weaponIndex: 0 }];
    expect(assignmentGate(assignments, ships)).toEqual({ assigned: 1, total: 4 });
  });
});

// ---- Roster slicing -------------------------------------------------------

describe('roster slicing', () => {
  it('friendly = same fleet living; enemy = other fleet living; dead excluded', () => {
    const view = viewOf(
      [
        shipView({ bodyId: 1, fleetId: 0, hull: 100 }),
        shipView({ bodyId: 2, fleetId: 0, hull: 0 }), // dead friendly
        shipView({ bodyId: 3, fleetId: 1, hull: 50 }),
        shipView({ bodyId: 4, fleetId: 1, hull: 0 }), // dead enemy
      ],
      [],
    );
    expect(friendlyShips(view, 0).map((s) => s.bodyId)).toEqual([1]);
    expect(enemyShips(view, 0).map((s) => s.bodyId)).toEqual([3]);
  });
});

// ---- Called-shot unlock (§4.5 / FR-25) ------------------------------------

describe('calledShotUnlocked', () => {
  it('locks above zero shields, unlocks exactly at zero', () => {
    expect(calledShotUnlocked(shipView({ shields: 1 }))).toBe(false);
    expect(calledShotUnlocked(shipView({ shields: 88 }))).toBe(false);
    expect(calledShotUnlocked(shipView({ shields: 0 }))).toBe(true);
  });

  it('shieldReadout reads HOLDING (locked) above zero and DOWN at zero', () => {
    expect(shieldReadout(shipView({ shields: 88, shieldCapacity: 140 }))).toBe(
      'SHIELDS 88/140 — HOLDING · CALLED SHOTS LOCKED',
    );
    expect(shieldReadout(shipView({ shields: 0, shieldCapacity: 38 }))).toBe(
      'SHIELDS 0/38 — DOWN',
    );
  });
});

describe('calledShotOptions', () => {
  it('lists weapons, missiles, generator (w/ hint), engine, then flat specials', () => {
    const t = shipView({
      weaponAlive: [true, false],
      missileAlive: [true],
      pdAlive: [true],
      decoyAlive: [false],
      shieldGenAlive: true,
      engineAlive: true,
    });
    const opts = calledShotOptions(t);
    expect(opts.map((o) => o.label)).toEqual([
      'W1',
      'W2',
      'M1',
      'SHIELD GENERATOR',
      'ENGINE',
      'PD1',
      'DECOY1',
    ]);
    // Destroyed subsystems carry alive:false (struck-through + unselectable in UI).
    expect(opts.find((o) => o.label === 'W2')?.alive).toBe(false);
    expect(opts.find((o) => o.label === 'DECOY1')?.alive).toBe(false);
    // Flat specials index matches sim/rules layout: pd then decoy.
    expect(opts.find((o) => o.label === 'PD1')?.target).toEqual({ kind: 'special', index: 0 });
    expect(opts.find((o) => o.label === 'DECOY1')?.target).toEqual({ kind: 'special', index: 1 });
    // Generator hint verbatim (§4.5).
    expect(opts.find((o) => o.label === 'SHIELD GENERATOR')?.hint).toBe(GENERATOR_HINT);
  });
});

describe('calledShotEquals', () => {
  it('matches on kind + index; distinguishes indices and undefined', () => {
    expect(calledShotEquals({ kind: 'weapon', index: 1 }, { kind: 'weapon', index: 1 })).toBe(true);
    expect(calledShotEquals({ kind: 'weapon', index: 0 }, { kind: 'weapon', index: 1 })).toBe(false);
    expect(calledShotEquals({ kind: 'engine' }, { kind: 'engine' })).toBe(true);
    expect(calledShotEquals({ kind: 'engine' }, { kind: 'shield-generator' })).toBe(false);
    expect(calledShotEquals(undefined, { kind: 'engine' })).toBe(false);
  });
});

// ---- AoE friendly-fire geometry (§4.6 / FR-20) ----------------------------

describe('aoeOverlapsFriendly', () => {
  const shooter = shipView({
    bodyId: 1,
    fleetId: 0,
    ship: simShip({
      missiles: [
        {
          ammo: 2,
          damage: 40,
          aoeRadius: 60,
          boostVelocity: 140,
          trackingTurnRate: 1,
          bodyMass: 5,
          bodyRadius: 1,
        },
      ],
    }),
    missileAlive: [true],
    missileAmmo: [2],
  });
  const enemyTarget = shipView({ bodyId: 3, fleetId: 1 });

  const build = (friendlyPos: Vec3) =>
    viewOf(
      [shooter, shipView({ bodyId: 2, fleetId: 0, name: 'TIN CAN 3' }), enemyTarget],
      [
        body(1, at(0)),
        body(2, friendlyPos),
        body(3, at(200)), // target position
      ],
    );

  const missileAssignment: Assignment = { shooterId: 1, targetId: 3, missileIndex: 0 };

  it('flags a friendly INSIDE the blast radius (names it)', () => {
    const overlap = aoeOverlapsFriendly(missileAssignment, build(at(244))); // 44u from target
    expect(overlap).not.toBeNull();
    expect(overlap?.aoeRadius).toBe(60);
    expect(overlap?.hits.map((h) => h.friendly.name)).toEqual(['TIN CAN 3']);
    expect(overlap?.hits[0]?.distance).toBe(44);
  });

  it('returns null when the friendly is OUTSIDE the blast radius', () => {
    expect(aoeOverlapsFriendly(missileAssignment, build(at(300)))).toBeNull(); // 100u > 60
  });

  it('returns null for a weapon assignment (no AoE)', () => {
    const weapon: Assignment = { shooterId: 1, targetId: 3, weaponIndex: 0 };
    expect(aoeOverlapsFriendly(weapon, build(at(244)))).toBeNull();
  });

  it('never counts the shooter itself as a caught friendly', () => {
    // Shooter (body 1) sits right on the target; only body 2 is a real friendly,
    // placed far away → no overlap despite the shooter being at the blast centre.
    const view = viewOf(
      [shooter, shipView({ bodyId: 2, fleetId: 0 }), enemyTarget],
      [body(1, at(200)), body(2, at(999)), body(3, at(200))],
    );
    expect(aoeOverlapsFriendly(missileAssignment, view)).toBeNull();
  });
});

// ---- Fire-context annotation (S04 CP1) ------------------------------------

describe('fireContext', () => {
  // A shooter (fleet 0), a nearby friendly (fleet 0), and two enemies (fleet 1).
  const shooter = shipView({
    bodyId: 1,
    fleetId: 0,
    name: 'WIDOWMAKER',
    ship: simShip({
      missiles: [
        {
          ammo: 2,
          damage: 40,
          aoeRadius: 60,
          boostVelocity: 140,
          trackingTurnRate: 1,
          bodyMass: 5,
          bodyRadius: 1,
        },
      ],
    }),
    missileAlive: [true],
    missileAmmo: [2],
  });
  const friendly = shipView({ bodyId: 2, fleetId: 0, name: 'TIN CAN 3' });
  const enemyPrimary = shipView({ bodyId: 3, fleetId: 1, name: 'SPUR' });
  const enemySecondary = shipView({ bodyId: 4, fleetId: 1, name: 'IRON VERDICT' });

  const view = viewOf(
    [shooter, friendly, enemyPrimary, enemySecondary],
    [body(1, at(0)), body(2, at(244)), body(3, at(200)), body(4, at(600))],
  );

  it('flags a targeted enemy and the shooter on a weapon assignment (no AoE)', () => {
    const roles = fireContext(
      [{ shooterId: 1, targetId: 4, weaponIndex: 0 }],
      view,
    );
    expect(roles.get(1)).toEqual(['shooter']);
    expect(roles.get(4)).toEqual(['targeted']);
    // No missile → no AoE-friendly annotations.
    expect(roles.get(2)).toBeUndefined();
    expect(roles.get(3)).toBeUndefined();
  });

  it('flags an AoE friendly whose position sits inside the missile blast', () => {
    const roles = fireContext(
      [{ shooterId: 1, targetId: 3, missileIndex: 0 }],
      view,
    );
    // Shooter + targeted enemy first…
    expect(roles.get(1)).toEqual(['shooter']);
    expect(roles.get(3)).toEqual(['targeted']);
    // …and TIN CAN 3 (bodyId 2) is 44u from the target (r60) → flagged AoE.
    expect(roles.get(2)).toEqual(['aoe-friendly']);
  });

  it('combines roles when a ship carries more than one (shooter AND caught in AoE)', () => {
    // Second assignment: enemySecondary lobs a missile at TIN CAN 3 — but ships
    // can't be sim-side enemies fighting the shooter itself, so instead re-use
    // the shooter as ALSO an AoE friendly by staging a second missile from a
    // sibling in the same fleet. Build a small stand-in: another player ship
    // launching a missile whose blast catches WIDOWMAKER.
    const sibling = shipView({
      bodyId: 5,
      fleetId: 0,
      name: 'HARRIER-2',
      ship: simShip({
        missiles: [
          {
            ammo: 1,
            damage: 30,
            aoeRadius: 40,
            boostVelocity: 120,
            trackingTurnRate: 1,
            bodyMass: 5,
            bodyRadius: 1,
          },
        ],
      }),
      missileAlive: [true],
      missileAmmo: [1],
    });
    const combined = viewOf(
      [shooter, sibling, friendly, enemyPrimary],
      // Enemy at 30 → within r40 of blast center; WIDOWMAKER at 0 → within r40 too.
      [body(1, at(0)), body(5, at(-100)), body(2, at(999)), body(3, at(30))],
    );
    const roles = fireContext(
      [
        { shooterId: 1, targetId: 3, weaponIndex: 0 },     // WIDOWMAKER shoots SPUR
        { shooterId: 5, targetId: 3, missileIndex: 0 },    // HARRIER-2 lobs a missile at SPUR → catches WIDOWMAKER
      ],
      combined,
    );
    // WIDOWMAKER is BOTH the shooter of assignment #1 AND caught in HARRIER-2's blast.
    const widow = roles.get(1);
    expect(widow).toBeDefined();
    expect(widow).toContain('shooter');
    expect(widow).toContain('aoe-friendly');
    // HARRIER-2 is the second shooter.
    expect(roles.get(5)).toEqual(['shooter']);
  });

  it('is empty when no assignments are staged (commit is never gated by roles)', () => {
    expect(fireContext([], view).size).toBe(0);
  });
});

// ---- World-projected AoE ring (S04 CP2) -----------------------------------

describe('aoeRingProjection', () => {
  // A fake `worldToScreen` that simulates a top-down orthographic-ish
  // projection: world (x, z) plane maps 1:1 into pixel space with a fixed
  // (400, 300) canvas origin. `y` is ignored (elevation), so a horizontal
  // AoE ring lands as a horizontal pixel ring — exact numbers we can assert.
  const fakeW2S = (pos: readonly [number, number, number]): { readonly x: number; readonly y: number } | null => {
    const [wx, , wz] = pos;
    return { x: 400 + wx, y: 300 + wz };
  };

  it('derives ring pixel center + radius from two projected samples', () => {
    const ring = aoeRingProjection(fakeW2S, { x: 100, y: 0, z: 200 }, 60);
    expect(ring).not.toBeNull();
    // Center: (400 + 100, 300 + 200) = (500, 500).
    expect(ring?.cx).toBe(500);
    expect(ring?.cy).toBe(500);
    // Edge sample at (x+60, y, z) → (560, 500); pixel distance = 60.
    expect(ring?.r).toBe(60);
  });

  it('returns null when the ring CENTER projects behind the camera', () => {
    // A projection that always returns null → hide the ring entirely.
    const behindCamera = (): { readonly x: number; readonly y: number } | null => null;
    expect(aoeRingProjection(behindCamera, { x: 0, y: 0, z: 0 }, 60)).toBeNull();
  });

  it('returns null when the EDGE sample projects behind the camera (never draws partial)', () => {
    // Center projects fine, edge sample degenerates → hide the ring instead of
    // drawing a mis-scaled radius. Banner remains authoritative.
    const centerOnly = (pos: readonly [number, number, number]): { readonly x: number; readonly y: number } | null => {
      const [wx] = pos;
      // Center point (wx === 100) projects; anything else (wx === 160) is behind.
      if (wx === 100) return { x: 500, y: 500 };
      return null;
    };
    expect(aoeRingProjection(centerOnly, { x: 100, y: 0, z: 200 }, 60)).toBeNull();
  });

  it('a null-projected preview leaves aoeOverlapsFriendly (the authoritative geometry) untouched', () => {
    // The banner geometry is orthogonal to the ring — verified against the same
    // fixtures. Even with the ring hidden, `aoeOverlapsFriendly` still fires.
    const shooterShip = shipView({
      bodyId: 1,
      fleetId: 0,
      ship: simShip({
        missiles: [
          {
            ammo: 1,
            damage: 40,
            aoeRadius: 60,
            boostVelocity: 140,
            trackingTurnRate: 1,
            bodyMass: 5,
            bodyRadius: 1,
          },
        ],
      }),
      missileAlive: [true],
      missileAmmo: [1],
    });
    const view = viewOf(
      [shooterShip, shipView({ bodyId: 2, fleetId: 0, name: 'TIN CAN 3' }), shipView({ bodyId: 3, fleetId: 1 })],
      [body(1, at(0)), body(2, at(244)), body(3, at(200))],
    );
    // Ring hidden…
    expect(aoeRingProjection(() => null, at(200), 60)).toBeNull();
    // …banner still fires.
    expect(
      aoeOverlapsFriendly({ shooterId: 1, targetId: 3, missileIndex: 0 }, view),
    ).not.toBeNull();
  });
});

// ---- Range preview + hit-chance tone (S07) --------------------------------

describe('rangePreviewFor', () => {
  const weapon = (over: Partial<SimWeapon> = {}): SimWeapon => ({
    range: 240,
    damage: 12,
    shotsPerTurn: 1,
    accuracy: 0.6,
    ...over,
  });
  const shooter = shipView({
    bodyId: 1,
    fleetId: 0,
    ship: simShip({ weapons: [weapon({ range: 240 }), weapon({ range: 120 })] }),
    weaponAlive: [true, true],
    missileAlive: [true],
    missileAmmo: [2],
  });
  const view = viewOf(
    [shooter, shipView({ bodyId: 3, fleetId: 1 })],
    [body(1, at(-40, 0, 12)), body(3, at(200))],
  );

  it('returns the shooter position and the selected weapon range', () => {
    const slot: FireSlot = { shooterId: 1, kind: 'weapon', index: 0 };
    const preview = rangePreviewFor(view, slot);
    expect(preview).not.toBeNull();
    expect(preview?.center).toEqual({ x: -40, y: 0, z: 12 });
    expect(preview?.radius).toBe(240);
  });

  it('uses the weapon at the slot index, not W1', () => {
    const preview = rangePreviewFor(view, { shooterId: 1, kind: 'weapon', index: 1 });
    expect(preview?.radius).toBe(120);
  });

  it('returns null for a null selection', () => {
    expect(rangePreviewFor(view, null)).toBeNull();
  });

  it('returns null for a missile slot (no line-of-sight range)', () => {
    expect(rangePreviewFor(view, { shooterId: 1, kind: 'missile', index: 0 })).toBeNull();
  });

  it('returns null when the shooter is not in the view (destroyed / stale selection)', () => {
    expect(rangePreviewFor(view, { shooterId: 99, kind: 'weapon', index: 0 })).toBeNull();
  });

  it('returns null when the weapon index is out of range', () => {
    expect(rangePreviewFor(view, { shooterId: 1, kind: 'weapon', index: 9 })).toBeNull();
  });

  it('returns null when the shooter view exists but its body has no position', () => {
    const viewNoBody = viewOf([shooter], []); // ships present, bodies empty
    expect(
      rangePreviewFor(viewNoBody, { shooterId: 1, kind: 'weapon', index: 0 }),
    ).toBeNull();
  });
});

describe('shipRangePreview', () => {
  const weapon = (over: Partial<SimWeapon> = {}): SimWeapon => ({
    range: 240,
    damage: 12,
    shotsPerTurn: 1,
    accuracy: 0.6,
    ...over,
  });
  const shooter = shipView({
    bodyId: 1,
    fleetId: 0,
    hull: 100,
    ship: simShip({ weapons: [weapon({ range: 120 }), weapon({ range: 260 }), weapon({ range: 90 })] }),
    weaponAlive: [true, false, true],
  });
  const view = viewOf(
    [shooter, shipView({ bodyId: 9, fleetId: 0, hull: 0, ship: simShip({ weapons: [weapon()] }), weaponAlive: [true] })],
    [body(1, at(-10, 0, 5)), body(9, at(50))],
  );

  it("returns the ship's post-movement position and its longest-range LIVE weapon", () => {
    // W1 (range 120) and W3 (range 90) are live; W2 (range 260, the largest
    // overall) is dead and must be excluded — max among LIVE weapons is 120.
    const preview = shipRangePreview(view, 1);
    expect(preview).not.toBeNull();
    expect(preview?.center).toEqual({ x: -10, y: 0, z: 5 });
    expect(preview?.radius).toBe(120);
  });

  it('returns null for a null selection', () => {
    expect(shipRangePreview(view, null)).toBeNull();
  });

  it('returns null for an unknown/missing ship id', () => {
    expect(shipRangePreview(view, 999)).toBeNull();
  });

  it('returns null for a dead ship (hull <= 0)', () => {
    expect(shipRangePreview(view, 9)).toBeNull();
  });

  it('returns null for a ship with no live weapon', () => {
    const noWeapons = shipView({ bodyId: 5, fleetId: 0, hull: 50, weaponAlive: [false, false] });
    const v = viewOf([noWeapons], [body(5, at(1))]);
    expect(shipRangePreview(v, 5)).toBeNull();
  });

  it('returns null when the ship view exists but its body has no position', () => {
    const viewNoBody = viewOf([shooter], []);
    expect(shipRangePreview(viewNoBody, 1)).toBeNull();
  });
});

describe('weaponOutOfRange (playtest-feedback-04 FB1)', () => {
  const w = (over: Partial<SimWeapon> = {}): SimWeapon => ({
    range: 300,
    damage: 12,
    shotsPerTurn: 1,
    accuracy: 0.6,
    ...over,
  });
  const shooter = shipView({
    bodyId: 1,
    fleetId: 0,
    ship: simShip({ weapons: [w({ range: 300 })] }),
    weaponAlive: [true],
    missileAlive: [],
    missileAmmo: [],
  });
  const target = shipView({ bodyId: 3, fleetId: 1 });
  const build = (targetX: number): BlindMatchView =>
    viewOf([shooter, target], [body(1, at(0)), body(3, at(targetX))]);

  it('past-range → true (the resolver will refuse the shot)', () => {
    expect(weaponOutOfRange(build(500), 1, 0, 3)).toBe(true);
  });

  it('inside-range → false', () => {
    expect(weaponOutOfRange(build(200), 1, 0, 3)).toBe(false);
  });

  it('exactly-at-range → false (mirrors the resolver\'s strict `>` in attack.ts)', () => {
    // sim/rules/attack.ts uses `range > weapon.range`, so distance === range
    // still fires — the bench must NOT label it OUT OF RANGE. The pure
    // formula's HIT_FLOOR still applies here (the read-out shows 5%), and
    // that 5% is honest for an in-range hard shot.
    expect(weaponOutOfRange(build(300), 1, 0, 3)).toBe(false);
  });

  it('missile-index-out-of-bounds / unknown weapon → false (nothing to warn about)', () => {
    expect(weaponOutOfRange(build(500), 1, 9, 3)).toBe(false);
  });

  it('missing shooter view / missing body → false (silent skip)', () => {
    expect(weaponOutOfRange(build(500), 999, 0, 3)).toBe(false);
    const missingBody = viewOf([shooter, target], []); // ships but no bodies
    expect(weaponOutOfRange(missingBody, 1, 0, 3)).toBe(false);
  });

  it('per-slot: uses the weapon at the given index, not W1', () => {
    // W1 range 100 (out), W2 range 500 (in). Target at 200:
    //   - weaponIndex 0 → out of range (200 > 100)
    //   - weaponIndex 1 → in range (200 ≤ 500)
    const twoWeapons = shipView({
      bodyId: 1,
      fleetId: 0,
      ship: simShip({ weapons: [w({ range: 100 }), w({ range: 500 })] }),
      weaponAlive: [true, true],
    });
    const v = viewOf([twoWeapons, target], [body(1, at(0)), body(3, at(200))]);
    expect(weaponOutOfRange(v, 1, 0, 3)).toBe(true);
    expect(weaponOutOfRange(v, 1, 1, 3)).toBe(false);
  });
});

describe('hitChanceTone', () => {
  it('maps ≥ 0.66 → c-green (high-confidence hit)', () => {
    expect(hitChanceTone(0.66)).toBe('c-green');
    expect(hitChanceTone(0.8)).toBe('c-green');
    expect(hitChanceTone(1)).toBe('c-green');
  });

  it('maps 0.4 ≤ x < 0.66 → c-amber (marginal)', () => {
    expect(hitChanceTone(0.4)).toBe('c-amber');
    expect(hitChanceTone(0.5)).toBe('c-amber');
    expect(hitChanceTone(0.6599)).toBe('c-amber');
  });

  it('maps < 0.4 → c-red (long shot)', () => {
    expect(hitChanceTone(0)).toBe('c-red');
    expect(hitChanceTone(0.1)).toBe('c-red');
    expect(hitChanceTone(0.3999)).toBe('c-red');
  });
});

describe('hitChanceBarFill (playtest-feedback-05 SESSION-04 CP3)', () => {
  it('thresholds mirror hitChanceTone exactly (66 / 40 boundaries)', () => {
    // The bar fill and the text tint must agree at every threshold so the
    // meter and the number never contradict on a 66% / 40% edge.
    expect(hitChanceBarFill(0.66)).toBe('ok');
    expect(hitChanceBarFill(0.4)).toBe('dv');
    expect(hitChanceBarFill(0.3999)).toBe('hot');
  });

  it('maps ≥ 0.66 → ok (green meter fill)', () => {
    expect(hitChanceBarFill(0.8)).toBe('ok');
    expect(hitChanceBarFill(1)).toBe('ok');
  });

  it('maps 0.4 ≤ x < 0.66 → dv (amber meter fill)', () => {
    expect(hitChanceBarFill(0.5)).toBe('dv');
    expect(hitChanceBarFill(0.6599)).toBe('dv');
  });

  it('maps < 0.4 → hot (red meter fill)', () => {
    expect(hitChanceBarFill(0)).toBe('hot');
    expect(hitChanceBarFill(0.1)).toBe('hot');
  });
});

// ---- Plan emission --------------------------------------------------------

describe('toAttackPlans', () => {
  const downTarget = shipView({ bodyId: 3, shields: 0 });
  const upTarget = shipView({ bodyId: 4, shields: 20 });

  it('carries calledShot ONLY when the target shields are at zero', () => {
    const assignments: Assignment[] = [
      { shooterId: 1, targetId: 3, weaponIndex: 0, calledShot: { kind: 'engine' } },
      { shooterId: 1, targetId: 4, weaponIndex: 1, calledShot: { kind: 'engine' } },
    ];
    const plans = toAttackPlans(assignments, [downTarget, upTarget]);
    expect(plans[0]?.calledShot).toEqual({ kind: 'engine' }); // shields 0 → kept
    expect(plans[1]?.calledShot).toBeUndefined(); // shields up → dropped
  });

  it('emits exactly one of weaponIndex / missileIndex, never undefined keys', () => {
    const plans = toAttackPlans(
      [
        { shooterId: 1, targetId: 3, weaponIndex: 2 },
        { shooterId: 1, targetId: 3, missileIndex: 0 },
      ],
      [downTarget],
    );
    expect(plans[0]).toEqual({ shooterId: 1, targetId: 3, weaponIndex: 2 });
    expect('missileIndex' in plans[0]!).toBe(false);
    expect(plans[1]).toEqual({ shooterId: 1, targetId: 3, missileIndex: 0 });
    expect('weaponIndex' in plans[1]!).toBe(false);
  });

  it('drops a calledShot on an unknown target (defaults to locked)', () => {
    const plans = toAttackPlans(
      [{ shooterId: 1, targetId: 99, weaponIndex: 0, calledShot: { kind: 'engine' } }],
      [downTarget],
    );
    expect(plans[0]?.calledShot).toBeUndefined();
  });
});
