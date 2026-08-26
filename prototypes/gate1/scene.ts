// three.js scene wiring for the Gate 1 prototype (M18, disposable).
//
// This file is programmer-art wireframes on purpose. Real ship silhouettes,
// bloom, `LineSegments2` fat-line materials, hex-grid shader boundary, hazard
// atlases — all that lives in M13 render. Gate 1 exists to answer *"is that
// turn fun?"* with the real deterministic physics driving cheap geometry.
//
// Design intent, per design §4.1 and architecture §9:
//   * Boundary shell always visible, red, legible from outside looking in.
//   * Reference grid on the ground plane for depth cues.
//   * Ships carry vertical altitude stalks (`.mk-stalk` in the mocks).
//   * Cyan for fleet 0 (YOU), magenta for fleet 1 (opponent). Reserved.
//
// Colors are pulled from `mocks/console.css` — Enso Stroke 2: reserved hues are
// law, not palette. No hex literals are minted here.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  EdgesGeometry,
  GridHelper,
  Group,
  IcosahedronGeometry,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  Vector3,
  WireframeGeometry,
} from 'three';

// Design tokens borrowed verbatim from mocks/console.css §1. The two "hi"
// variants below are LIGHTENED sibling shades (already present in the mocks as
// text callout colors — `#FFD7E1`/`#FF8FAB` in tactical-move.html) used to keep
// magenta-fleet ghost paths legible against the red boundary wireframe. Ship
// silhouettes still use the pure fleet colors — silhouette + color together
// preserve the "never color alone" rule (design §1.1 ⛓).
export const TOKEN = {
  cyan: new Color('#22e3ff'),
  magenta: new Color('#ff3d7f'),
  magentaHi: new Color('#ffb0c8'),
  red: new Color('#ff2e63'),
  amber: new Color('#ffb020'),
  hazard: new Color('#ff7a1a'),
  grid: new Color('#1e2c3c'),
  ghost: new Color('#33475a'),
  ink: new Color('#c7d6e5'),
} as const;

export type FleetIdx = 0 | 1;

export interface TimeMark {
  readonly position: Vector3;
  readonly second: number;
}

export interface ShipVisual {
  readonly fleet: FleetIdx;
  readonly group: Group;
  readonly stalk: Line;
  readonly ghost: Line;
  readonly exitMarker: Sprite;
  /** Recentre the visual to `position`. Called every animation tick. */
  moveTo(position: Vector3): void;
  /** Swap in a new predicted-path polyline (positions in world units). */
  setGhost(positions: readonly Vector3[], hostile: boolean): void;
  /** Show/hide the ✕ EXIT crash marker at the ghost's endpoint. */
  setExit(visible: boolean, at: Vector3 | null): void;
  /** Numbered time-graduation marks along the ghost (planning only). Empty array clears them. */
  setTimeMarks(marks: readonly TimeMark[]): void;
  dispose(): void;
}

export interface DebrisVisual {
  readonly point: Points;
  moveTo(position: Vector3): void;
  dispose(): void;
}

export interface Scenery {
  readonly scene: Scene;
  readonly boundary: LineSegments;
  readonly grid: GridHelper;
  addShip(fleet: FleetIdx, position: Vector3, hullRadius: number): ShipVisual;
  addDebris(position: Vector3, radius: number): DebrisVisual;
  /** Convenience for the marker-density stress toggle — bulk-adds inert hazards. */
  addStressHazards(n: number, arenaRadius: number): DebrisVisual[];
  clearStressHazards(): void;
  dispose(): void;
}

/**
 * A small canvas-generated ✕ sprite used to mark predicted boundary exits.
 * SpriteMaterial is camera-facing and free — no shader tuning needed for a probe.
 */
const buildExitTexture = (): CanvasTexture => {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = '#ff2e63';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(size * 0.2, size * 0.2);
  ctx.lineTo(size * 0.8, size * 0.8);
  ctx.moveTo(size * 0.8, size * 0.2);
  ctx.lineTo(size * 0.2, size * 0.8);
  ctx.stroke();
  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
};

/**
 * Wireframe ship silhouette: fleet 0 gets an octahedron ("Meridian" cruiser stand-in),
 * fleet 1 gets an icosahedron ("Obelisk" mega stand-in). They read differently from
 * both silhouette and color — never color alone (design §1.1 ⛓).
 */
const buildShipMesh = (fleet: FleetIdx, radius: number, color: Color): LineSegments => {
  const geom =
    fleet === 0
      ? new OctahedronGeometry(radius, 0)
      : new IcosahedronGeometry(radius, 0);
  const wire = new EdgesGeometry(geom);
  const mat = new LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
  const ls = new LineSegments(wire, mat);
  // Wireframe + a solid dim inner core so the ship reads at fleet zoom.
  const core = new Mesh(
    new SphereGeometry(radius * 0.35, 12, 8),
    new MeshBasicMaterial({ color, transparent: true, opacity: 0.35 }),
  );
  ls.add(core);
  geom.dispose();
  return ls;
};

/**
 * Boundary sphere shell — architecture §9: "always-rendered … reads from outside
 * looking in". A wireframe sphere at moderate opacity plus a very faint back-face
 * inner shell delivers the "outside looking in" read without a custom shader,
 * which is out of scope for a disposable prototype.
 */
const buildBoundary = (radius: number): LineSegments => {
  const geom = new SphereGeometry(radius, 32, 20);
  const wire = new WireframeGeometry(geom);
  const mat = new LineBasicMaterial({
    color: TOKEN.red,
    transparent: true,
    // Kept low enough that a magenta-fleet ghost still reads across the shell —
    // the boundary must be "always visible" (design §4.1) but never dominant.
    opacity: 0.14,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const shell = new LineSegments(wire, mat);
  geom.dispose();
  return shell;
};

const buildBoundaryInnerHaze = (radius: number): Mesh => {
  const geom = new SphereGeometry(radius, 24, 16);
  const mat = new MeshBasicMaterial({
    color: TOKEN.red,
    transparent: true,
    opacity: 0.045,
    depthWrite: false,
    side: 1, // THREE.BackSide — a low-alpha back-face wash so the shell reads from inside
  });
  return new Mesh(geom, mat);
};

/**
 * A ground-plane grid centred at the origin. Sized to comfortably contain the
 * arena so the player always has a horizon reference at every zoom level.
 * Divisions chosen to give ≈300-unit cells at 2000-unit arena radius — coarse
 * enough not to alias at zoom-out, fine enough to hint at scale near a ship.
 */
const buildGrid = (arenaRadius: number): GridHelper => {
  const size = arenaRadius * 4;
  const divisions = 24;
  const grid = new GridHelper(size, divisions, TOKEN.grid, TOKEN.grid);
  const mat = grid.material as LineBasicMaterial | LineBasicMaterial[];
  if (Array.isArray(mat)) {
    mat.forEach((m) => {
      m.transparent = true;
      m.opacity = 0.55;
    });
  } else {
    mat.transparent = true;
    mat.opacity = 0.55;
  }
  // Sit just below the arena so ships don't intersect it at low pitch.
  grid.position.y = -arenaRadius;
  return grid;
};

const buildDebris = (position: Vector3, radius: number): DebrisVisual => {
  const geom = new BufferGeometry();
  geom.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([position.x, position.y, position.z]), 3),
  );
  const mat = new PointsMaterial({
    color: TOKEN.hazard,
    size: Math.max(6, radius * 0.6),
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const points = new Points(geom, mat);
  return {
    point: points,
    moveTo(p: Vector3) {
      const attr = geom.getAttribute('position') as BufferAttribute;
      attr.setXYZ(0, p.x, p.y, p.z);
      attr.needsUpdate = true;
    },
    dispose() {
      geom.dispose();
      mat.dispose();
    },
  };
};

/**
 * Build the scenery: boundary shell + inner haze + reference grid + a subtle
 * three-axis rig at the origin so the world's basis is legible.
 */
export const buildScene = (arenaRadius: number): Scenery => {
  const scene = new Scene();
  scene.background = new Color('#000205');

  const boundary = buildBoundary(arenaRadius);
  const boundaryHaze = buildBoundaryInnerHaze(arenaRadius);
  scene.add(boundary);
  scene.add(boundaryHaze);

  const grid = buildGrid(arenaRadius);
  scene.add(grid);

  // Origin axis rig: three short cyan/magenta/amber line segments so "which way
  // is X, Y, Z" is answerable at a glance.
  const axisLen = arenaRadius * 0.14;
  const axisGeom = new BufferGeometry();
  axisGeom.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([
        0, 0, 0, axisLen, 0, 0,
        0, 0, 0, 0, axisLen, 0,
        0, 0, 0, 0, 0, axisLen,
      ]),
      3,
    ),
  );
  axisGeom.setAttribute(
    'color',
    new BufferAttribute(
      new Float32Array([
        TOKEN.cyan.r, TOKEN.cyan.g, TOKEN.cyan.b, TOKEN.cyan.r, TOKEN.cyan.g, TOKEN.cyan.b,
        TOKEN.amber.r, TOKEN.amber.g, TOKEN.amber.b, TOKEN.amber.r, TOKEN.amber.g, TOKEN.amber.b,
        TOKEN.magenta.r, TOKEN.magenta.g, TOKEN.magenta.b, TOKEN.magenta.r, TOKEN.magenta.g, TOKEN.magenta.b,
      ]),
      3,
    ),
  );
  const axisMat = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75 });
  const axes = new LineSegments(axisGeom, axisMat);
  scene.add(axes);

  const stressHazards: DebrisVisual[] = [];

  const exitTex = buildExitTexture();

  // Scenery-scoped digit-texture cache — mirrors the `exitTex` seam (built once
  // here, disposed in `dispose()`). Digits repeat across ships and turns, so each
  // is built once and shared. No minted hex literal — amber derives from TOKEN.amber.
  const markTex = new Map<number, CanvasTexture>();
  const getMarkTexture = (second: number): CanvasTexture => {
    const cached = markTex.get(second);
    if (cached !== undefined) return cached;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const amber = `#${TOKEN.amber.getHexString()}`; // single source of truth — no new literal
    // faint filled dot so the mark reads as "point + number"
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = amber;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
    ctx.fill();
    // the second, centered
    ctx.globalAlpha = 1;
    ctx.fillStyle = amber;
    ctx.font = `bold ${Math.floor(size * 0.5)}px 'JetBrains Mono', ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(second), size / 2, size / 2 + size * 0.02);
    const tex = new CanvasTexture(canvas);
    tex.needsUpdate = true;
    markTex.set(second, tex);
    return tex;
  };

  const addShip = (fleet: FleetIdx, position: Vector3, hullRadius: number): ShipVisual => {
    const color = fleet === 0 ? TOKEN.cyan : TOKEN.magenta;
    // Ghost path uses a lightened sibling for magenta so it separates cleanly
    // from the red boundary wireframe. Cyan needs no such treatment.
    const ghostColor = fleet === 0 ? TOKEN.cyan : TOKEN.magentaHi;
    const group = new Group();
    const mesh = buildShipMesh(fleet, hullRadius, color);
    group.add(mesh);
    group.position.copy(position);
    scene.add(group);

    // Altitude stalk — a straight line from the ship down to y=grid — depth cue
    // (design §9 requires it for every tracked body).
    const stalkGeom = new BufferGeometry();
    stalkGeom.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([0, 0, 0, 0, -1, 0]), 3),
    );
    const stalk = new Line(
      stalkGeom,
      new LineBasicMaterial({ color, transparent: true, opacity: 0.42 }),
    );
    group.add(stalk);

    // Ghost line — replaced whenever the planner recomputes the preview path.
    let ghostGeom = new BufferGeometry();
    ghostGeom.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
    const ghostMat = new LineBasicMaterial({
      color: ghostColor,
      transparent: true,
      opacity: 0.85,
    });
    const ghost = new Line(ghostGeom, ghostMat);
    ghost.visible = false;
    // Draw ghosts in world space (not parented to the ship) so its coordinates
    // stay authoritative during resolution animation.
    scene.add(ghost);

    const exitSprite = new Sprite(
      new SpriteMaterial({ map: exitTex, color: TOKEN.red, transparent: true, depthTest: false }),
    );
    exitSprite.scale.setScalar(hullRadius * 2.2);
    exitSprite.visible = false;
    scene.add(exitSprite);

    // Per-ship pool of numbered time-marks, drawn in WORLD space (a Group added to
    // `scene`, not parented to `group`) so mark coordinates stay authoritative and
    // never inherit the ship's playback transform — the same rule the ghost follows.
    const markGroup = new Group();
    scene.add(markGroup);
    const markSprites: Sprite[] = [];

    const restretchStalk = () => {
      // Stretch the local unit stalk from the ship's y to the grid plane.
      const yToFloor = -arenaRadius - group.position.y;
      stalk.scale.y = Math.max(1, Math.abs(yToFloor));
    };
    restretchStalk();

    const visual: ShipVisual = {
      fleet,
      group,
      stalk,
      ghost,
      exitMarker: exitSprite,
      moveTo(p: Vector3) {
        group.position.copy(p);
        restretchStalk();
      },
      setGhost(positions, hostile) {
        if (positions.length < 2) {
          ghost.visible = false;
          return;
        }
        // Rebuild the geometry — length changes when subStepCount changes.
        ghost.geometry.dispose();
        const flat = new Float32Array(positions.length * 3);
        for (let i = 0; i < positions.length; i += 1) {
          const p = positions[i]!;
          flat[i * 3 + 0] = p.x;
          flat[i * 3 + 1] = p.y;
          flat[i * 3 + 2] = p.z;
        }
        ghostGeom = new BufferGeometry();
        ghostGeom.setAttribute('position', new BufferAttribute(flat, 3));
        ghost.geometry = ghostGeom;
        (ghost.material as LineBasicMaterial).color.copy(hostile ? TOKEN.red : ghostColor);
        (ghost.material as LineBasicMaterial).opacity = hostile ? 1.0 : 0.85;
        ghost.visible = true;
      },
      setExit(visible, at) {
        exitSprite.visible = visible;
        if (visible && at !== null) exitSprite.position.copy(at);
      },
      setTimeMarks(marks) {
        // Grow the pool to fit; sprites are reused across calls (this fires on
        // every slider `input`) — never allocate per call, and never rebuild a
        // texture here: `getMarkTexture` caches them.
        while (markSprites.length < marks.length) {
          const spr = new Sprite(new SpriteMaterial({ transparent: true, depthTest: false }));
          spr.scale.setScalar(hullRadius * 1.2); // smaller than the ✕ EXIT sprite (2.2)
          spr.visible = false;
          markGroup.add(spr);
          markSprites.push(spr);
        }
        for (let i = 0; i < markSprites.length; i += 1) {
          const spr = markSprites[i]!;
          const m = marks[i];
          if (m === undefined) {
            spr.visible = false;
            continue;
          }
          const mat = spr.material as SpriteMaterial;
          mat.map = getMarkTexture(m.second);
          mat.needsUpdate = true;
          spr.position.copy(m.position);
          spr.visible = true;
        }
      },
      dispose() {
        scene.remove(group);
        scene.remove(ghost);
        scene.remove(exitSprite);
        mesh.geometry.dispose();
        (mesh.material as LineBasicMaterial).dispose();
        stalkGeom.dispose();
        (stalk.material as LineBasicMaterial).dispose();
        ghost.geometry.dispose();
        (ghost.material as LineBasicMaterial).dispose();
        (exitSprite.material as SpriteMaterial).dispose();
        scene.remove(markGroup);
        // Dispose each sprite's MATERIAL only — the `map` is the shared scenery-level
        // cache (`markTex`), disposed once in the scenery `dispose()` below.
        for (const spr of markSprites) (spr.material as SpriteMaterial).dispose();
      },
    };
    return visual;
  };

  const addDebris = (position: Vector3, radius: number): DebrisVisual => {
    const d = buildDebris(position, radius);
    scene.add(d.point);
    return d;
  };

  const addStressHazards = (n: number, arenaR: number): DebrisVisual[] => {
    const spawned: DebrisVisual[] = [];
    for (let i = 0; i < n; i += 1) {
      // Deterministic-ish placement using a simple integer hash so the toggle
      // reproduces the same cluster each time it's flipped (helps A/B legibility).
      const seed = (i + 1) * 2654435761;
      const rx = ((seed & 0xffff) / 0xffff) * 2 - 1;
      const ry = (((seed >>> 8) & 0xffff) / 0xffff) * 2 - 1;
      const rz = (((seed >>> 16) & 0xffff) / 0xffff) * 2 - 1;
      const r = arenaR * 0.7;
      const p = new Vector3(rx * r, ry * r * 0.5, rz * r);
      const v = addDebris(p, 22);
      spawned.push(v);
      stressHazards.push(v);
    }
    return spawned;
  };

  const clearStressHazards = () => {
    for (const h of stressHazards) {
      scene.remove(h.point);
      h.dispose();
    }
    stressHazards.length = 0;
  };

  const dispose = () => {
    boundary.geometry.dispose();
    (boundary.material as LineBasicMaterial).dispose();
    boundaryHaze.geometry.dispose();
    (boundaryHaze.material as MeshBasicMaterial).dispose();
    grid.dispose();
    axes.geometry.dispose();
    axisMat.dispose();
    exitTex.dispose();
    for (const tex of markTex.values()) tex.dispose();
    clearStressHazards();
  };

  return {
    scene,
    boundary,
    grid,
    addShip,
    addDebris,
    addStressHazards,
    clearStressHazards,
    dispose,
  };
};
