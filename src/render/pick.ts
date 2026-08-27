// GPU color-ID picking (arch §9) — O(1) regardless of body count, and robust on the
// line geometry where three's raycaster is fiddly.
//
// Each body is mirrored as a flat-shaded proxy in a private pick scene, its instance
// color set to `encodeId(bodyId)`. On `pick(x,y)` the camera is offset to render just
// the picked pixel into a 1×1 target; the read-back color is decoded to a `BodyId`.
// Empty space clears to a reserved sentinel color outside the live-id range, so it
// decodes to "no hit". The encode/decode round-trip is covered by colorId.test.ts.
//
// Nothing here mutates `MatchState` — proxies are built from read-only body data.

import {
  Color,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import type { PerspectiveCamera, WebGLRenderer } from 'three';
import type { Body, BodyId } from '../sim/index.js';
import { decodeId, encodeId } from './colorId.js';
import type { PickResult } from './types.js';

const MAX_PICK_BODIES = 512;
/** Reserved id well above any live body count; its color clears the pick target. */
const SENTINEL_ID = 0xffffff;

/** One body's pick proxy inputs, derived from a read-only `Body`. */
export interface PickInput {
  readonly id: BodyId;
  readonly kind: Body['kind'];
  readonly position: readonly [number, number, number];
  readonly radius: number;
}

export interface PickBuffer {
  /** Rebuild the pick proxies for the current body set. */
  sync(bodies: readonly PickInput[]): void;
  /** Resolve a canvas pixel to a body, or `null` for empty space. */
  pick(
    renderer: WebGLRenderer,
    camera: PerspectiveCamera,
    x: number,
    y: number,
    viewWidth: number,
    viewHeight: number,
  ): PickResult | null;
  dispose(): void;
}

/** Build the pick buffer (its own scene + 1×1 read-back target). */
export const createPickBuffer = (): PickBuffer => {
  const scene = new Scene();
  const geometry = new IcosahedronGeometry(1, 1);
  const material = new MeshBasicMaterial({ toneMapped: false });
  const mesh = new InstancedMesh(geometry, material, MAX_PICK_BODIES);
  mesh.count = 0;
  mesh.frustumCulled = false;
  scene.add(mesh);

  const target = new WebGLRenderTarget(1, 1);
  const buffer = new Uint8Array(4);
  const kinds = new Map<BodyId, Body['kind']>();

  const matrix = new Matrix4();
  const noRotation = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  const color = new Color();

  const sync = (bodies: readonly PickInput[]): void => {
    const n = Math.min(bodies.length, MAX_PICK_BODIES);
    kinds.clear();
    for (let i = 0; i < n; i += 1) {
      const b = bodies[i]!;
      position.set(b.position[0], b.position[1], b.position[2]);
      scale.setScalar(Math.max(b.radius, 1));
      matrix.compose(position, noRotation, scale);
      mesh.setMatrixAt(i, matrix);
      const [r, g, bl] = encodeId(b.id);
      color.setRGB(r / 255, g / 255, bl / 255);
      mesh.setColorAt(i, color);
      kinds.set(b.id, b.kind);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  };

  const pick = (
    renderer: WebGLRenderer,
    camera: PerspectiveCamera,
    x: number,
    y: number,
    viewWidth: number,
    viewHeight: number,
  ): PickResult | null => {
    const prevTarget = renderer.getRenderTarget();
    const prevAlpha = renderer.getClearAlpha();
    const prevColor = new Color();
    renderer.getClearColor(prevColor);

    // Render only the picked pixel: offset the camera to a 1×1 sub-frame.
    camera.setViewOffset(viewWidth, viewHeight, Math.floor(x), Math.floor(y), 1, 1);
    const [sr, sg, sb] = encodeId(SENTINEL_ID);
    renderer.setRenderTarget(target);
    renderer.setClearColor(new Color(sr / 255, sg / 255, sb / 255), 1);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, 1, 1, buffer);

    camera.clearViewOffset();
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);

    const id = decodeId([buffer[0]!, buffer[1]!, buffer[2]!]);
    if (id === SENTINEL_ID) return null;
    const kind = kinds.get(id);
    if (kind === undefined) return null;
    return { bodyId: id, kind };
  };

  const dispose = (): void => {
    geometry.dispose();
    material.dispose();
    mesh.dispose();
    target.dispose();
    kinds.clear();
  };

  return { sync, pick, dispose };
};
