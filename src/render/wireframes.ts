// Ship silhouettes — four fat-line wireframes, one per ChassisClass (FR-13).
//
// Each class MUST be distinguishable by outline alone at fleet zoom (design §1.1 ⛓:
// silhouette + fleet color together, never color alone). The per-class vertex tables
// are pure exported data so a unit test can assert the four are non-degenerate and
// mutually distinct without a WebGL context; the runtime rendering is a screen-e2e
// concern. Ships are drawn as pooled `LineSegments2` (fat lines) — ≤60 ships at the
// ceiling, so one object per ship is cheap; hazards (300) get the instanced path.
//
// Nothing here mutates `MatchState`: `sync`/`setPosition` are fed plain position
// tuples the caller derived from a read-only `Body`.

import { Group, Mesh, MeshBasicMaterial, SphereGeometry, Vector2, Vector3 } from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { BodyId, ChassisClass } from '../sim/index.js';
import type { FleetColor, RenderQuality } from './types.js';

/** The five fleet colors (mocks/console.css `--fleet-0..4`). */
export const FLEET_PALETTE: Readonly<Record<FleetColor, number>> = {
  0: 0x22e3ff,
  1: 0xff3d7f,
  2: 0xffb020,
  3: 0xa45bff,
  4: 0x7cff4f,
};

/** Map any fleet id to one of the five palette slots (design §1.1). Pure. */
export const fleetColorOf = (fleetId: number): FleetColor =>
  (((fleetId % 5) + 5) % 5) as FleetColor;

type V3 = readonly [number, number, number];

/** A class silhouette as vertices + the index pairs that form its line segments. */
export interface ClassGeometry {
  readonly vertices: readonly V3[];
  readonly edges: readonly (readonly [number, number])[];
}

// Unit-radius silhouettes (scaled per ship by hull radius). Chosen for four clearly
// different outlines: a 4-vertex dart, a 7-vertex finned rod, a 6-vertex strutted
// diamond, and an 8-vertex latticed box — distinct vertex counts AND aspect ratios.
export const SHIP_GEOMETRY: Readonly<Record<ChassisClass, ClassGeometry>> = {
  fighter: {
    // Sharp forward dart, small dorsal peak — reads as "fast + fragile".
    vertices: [
      [0, 0, 1],
      [-0.7, 0, -0.6],
      [0.7, 0, -0.6],
      [0, 0.35, -0.5],
    ],
    edges: [
      [0, 1],
      [0, 2],
      [1, 2],
      [0, 3],
      [3, 1],
      [3, 2],
    ],
  },
  frigate: {
    // Elongated hex rod with a dorsal fin — the mid-weight "line ship".
    vertices: [
      [0, 0, 1.3],
      [0.4, 0, 0.4],
      [0.4, 0, -0.8],
      [0, 0, -1.3],
      [-0.4, 0, -0.8],
      [-0.4, 0, 0.4],
      [0, 0.5, -0.2],
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 0],
      [6, 0],
      [6, 3],
    ],
  },
  cruiser: {
    // Broad diamond with vertical struts — wider silhouette, capital-ish.
    vertices: [
      [0, 0, 1],
      [1, 0, 0],
      [0, 0, -1],
      [-1, 0, 0],
      [0, 0.6, 0],
      [0, -0.6, 0],
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 0],
      [4, 1],
      [4, 2],
      [4, 3],
      [5, 0],
      [5, 2],
    ],
  },
  'mega-destroyer': {
    // Blocky elongated box + central spine — unmistakably the largest hull.
    vertices: [
      [-0.6, -0.4, 1.2],
      [0.6, -0.4, 1.2],
      [0.6, 0.4, 1.2],
      [-0.6, 0.4, 1.2],
      [-0.6, -0.4, -1.2],
      [0.6, -0.4, -1.2],
      [0.6, 0.4, -1.2],
      [-0.6, 0.4, -1.2],
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ],
  },
};

/** Expand a class geometry into a flat segment-endpoint array (LineSegments2 format). */
export const expandSegments = (geo: ClassGeometry): Float32Array => {
  const out = new Float32Array(geo.edges.length * 6);
  for (let e = 0; e < geo.edges.length; e += 1) {
    const [a, b] = geo.edges[e]!;
    const va = geo.vertices[a]!;
    const vb = geo.vertices[b]!;
    out.set([va[0], va[1], va[2], vb[0], vb[1], vb[2]], e * 6);
  }
  return out;
};

/** Axis-aligned extent (max − min) per axis. Used by the distinctness test. */
export const boundingExtent = (geo: ClassGeometry): V3 => {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const [x, y, z] of geo.vertices) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return [maxX - minX, maxY - minY, maxZ - minZ];
};

/** One ship's render inputs, derived by the caller from a read-only `Body` + fleet map. */
export interface ShipInput {
  readonly id: BodyId;
  readonly chassisClass: ChassisClass;
  readonly fleet: FleetColor;
  readonly position: V3;
  readonly radius: number;
}

/** The ship-instance manager `TacticalView` composes into the scene. */
export interface ShipInstances {
  readonly group: Group;
  /** Reconcile the live ship set (add / update / remove) against `ships`. */
  sync(ships: readonly ShipInput[]): void;
  /** Playback (SESSION-03): move one ship without a full re-sync. */
  setPosition(id: BodyId, x: number, y: number, z: number): void;
  /**
   * Playback (S01): set one ship instance's presence alpha (0 = gone, 1 = solid).
   * Multiplied against `SHIP_DEFAULT_OPACITY` so `alpha = 1` matches a freshly-synced
   * ship exactly; `alpha = 0` renders it invisible. No-op for unknown ids.
   */
  setOpacity(id: BodyId, alpha: number): void;
  /** Current world position of a ship, or `null` if absent (used by `F` focus). */
  positionOf(id: BodyId): Vector3 | null;
  /** Update fat-line pixel resolution on resize (LineMaterial needs viewport size). */
  setResolution(width: number, height: number): void;
  setQuality(quality: RenderQuality): void;
  dispose(): void;
}

interface ShipHandle {
  readonly object: LineSegments2;
  material: LineMaterial;
  /**
   * Dim inner-core aura material (playtest-feedback-02 SESSION-01 CP3 — prototype
   * `buildShipMesh`). Fades in step with `material` so a mid-beat opacity fade darkens
   * both outline and core; per-instance so `setOpacity(id, …)` never leaks to fleetmates.
   */
  coreMaterial: MeshBasicMaterial;
  chassisClass: ChassisClass;
  fleet: FleetColor;
}

const LINE_WIDTH_HIGH = 2.4;
const LINE_WIDTH_REDUCED = 1.2;
/** Default silhouette opacity — the "solid" ship look; playback fades multiply against it. */
export const SHIP_DEFAULT_OPACITY = 0.95;
/**
 * Default inner-core aura opacity (CP3 — prototype `buildShipMesh` `0.35`). The core is
 * a "hulls read solid at fleet zoom" cue; alpha stays well below the CP1 bloom threshold.
 */
export const SHIP_CORE_OPACITY = 0.35;
/**
 * Unit-radius factor for the inner core (CP3 — prototype `radius * 0.35`). The core
 * geometry is unit-radius × this factor; per-ship `object.scale.setScalar(radius)` on the
 * parent LineSegments2 scales it to the hull.
 */
const SHIP_CORE_RADIUS_FACTOR = 0.35;

/** Build the ship-instance manager. Shared geometry per class + material per fleet. */
export const createShipInstances = (): ShipInstances => {
  const group = new Group();

  const geometries = new Map<ChassisClass, LineSegmentsGeometry>();
  const geometryFor = (cls: ChassisClass): LineSegmentsGeometry => {
    const cached = geometries.get(cls);
    if (cached !== undefined) return cached;
    const g = new LineSegmentsGeometry();
    g.setPositions(expandSegments(SHIP_GEOMETRY[cls]));
    geometries.set(cls, g);
    return g;
  };

  // Shared inner-core sphere geometry (unit radius × factor) — one allocation for
  // every ship in the field. Per-ship materials still exist for the fade path.
  const coreGeometry = new SphereGeometry(SHIP_CORE_RADIUS_FACTOR, 12, 8);

  const resolution = new Vector2(1, 1);
  let currentLineWidth = LINE_WIDTH_HIGH;
  // Per-instance materials — one clone per ship — so `setOpacity` fades one ship
  // without touching its fleetmates (LineMaterial has no per-instance opacity path).
  const buildMaterial = (fleet: FleetColor): LineMaterial => {
    const m = new LineMaterial({
      color: FLEET_PALETTE[fleet],
      linewidth: currentLineWidth,
      transparent: true,
      opacity: SHIP_DEFAULT_OPACITY,
      depthTest: true,
    });
    m.resolution.copy(resolution);
    return m;
  };
  const buildCoreMaterial = (fleet: FleetColor): MeshBasicMaterial =>
    new MeshBasicMaterial({
      color: FLEET_PALETTE[fleet],
      transparent: true,
      opacity: SHIP_CORE_OPACITY,
      depthWrite: false,
    });

  const ships = new Map<BodyId, ShipHandle>();

  const sync = (inputs: readonly ShipInput[]): void => {
    const seen = new Set<BodyId>();
    for (const input of inputs) {
      seen.add(input.id);
      let handle = ships.get(input.id);
      if (handle === undefined) {
        const material = buildMaterial(input.fleet);
        const object = new LineSegments2(geometryFor(input.chassisClass), material);
        object.userData['bodyId'] = input.id;
        const coreMaterial = buildCoreMaterial(input.fleet);
        const core = new Mesh(coreGeometry, coreMaterial);
        object.add(core); // inherits `object.scale` so the core sits at `radius × 0.35`
        group.add(object);
        handle = {
          object,
          material,
          coreMaterial,
          chassisClass: input.chassisClass,
          fleet: input.fleet,
        };
        ships.set(input.id, handle);
      } else {
        if (handle.chassisClass !== input.chassisClass) {
          handle.object.geometry = geometryFor(input.chassisClass);
          handle.chassisClass = input.chassisClass;
        }
        if (handle.fleet !== input.fleet) {
          handle.material.dispose();
          handle.material = buildMaterial(input.fleet);
          handle.object.material = handle.material;
          handle.coreMaterial.dispose();
          handle.coreMaterial = buildCoreMaterial(input.fleet);
          // Re-parent the core with the fresh material — geometry stays shared.
          const previousCore = handle.object.children.find(
            (child): child is Mesh => child instanceof Mesh,
          );
          if (previousCore !== undefined) handle.object.remove(previousCore);
          handle.object.add(new Mesh(coreGeometry, handle.coreMaterial));
          handle.fleet = input.fleet;
        } else {
          // Re-sync a live ship → back to solid (any mid-beat fade is cleared).
          handle.material.opacity = SHIP_DEFAULT_OPACITY;
          handle.coreMaterial.opacity = SHIP_CORE_OPACITY;
        }
      }
      const [x, y, z] = input.position;
      handle.object.position.set(x, y, z);
      handle.object.scale.setScalar(input.radius);
    }
    for (const [id, handle] of ships) {
      if (!seen.has(id)) {
        group.remove(handle.object);
        handle.material.dispose();
        handle.coreMaterial.dispose();
        ships.delete(id);
      }
    }
  };

  const setPosition = (id: BodyId, x: number, y: number, z: number): void => {
    const handle = ships.get(id);
    if (handle !== undefined) handle.object.position.set(x, y, z);
  };

  const setOpacity = (id: BodyId, alpha: number): void => {
    const handle = ships.get(id);
    if (handle === undefined) return;
    const clamped = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    handle.material.opacity = clamped * SHIP_DEFAULT_OPACITY;
    handle.coreMaterial.opacity = clamped * SHIP_CORE_OPACITY;
  };

  const positionOf = (id: BodyId): Vector3 | null => {
    const handle = ships.get(id);
    return handle === undefined ? null : handle.object.position.clone();
  };

  const setResolution = (width: number, height: number): void => {
    resolution.set(width, height);
    for (const handle of ships.values()) handle.material.resolution.copy(resolution);
  };

  const setQuality = (quality: RenderQuality): void => {
    currentLineWidth = quality === 'reduced' ? LINE_WIDTH_REDUCED : LINE_WIDTH_HIGH;
    for (const handle of ships.values()) handle.material.linewidth = currentLineWidth;
  };

  const dispose = (): void => {
    for (const handle of ships.values()) {
      group.remove(handle.object);
      handle.material.dispose();
      handle.coreMaterial.dispose();
    }
    ships.clear();
    for (const g of geometries.values()) g.dispose();
    geometries.clear();
    coreGeometry.dispose();
  };

  return {
    group,
    sync,
    setPosition,
    setOpacity,
    positionOf,
    setResolution,
    setQuality,
    dispose,
  };
};
