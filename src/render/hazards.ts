// Hazard glyphs — one InstancedMesh of camera-facing quads sampling a glyph atlas
// (arch §9: 300 hazards ⇒ 1 draw call). Identity is SHAPE-coded so it survives
// colorblindness (design §1.1 — never color alone): ✳ debris, ➤ tracking missile,
// ◇ spent/ballistic missile. The quads are billboarded on the CPU (compose each
// instance matrix against the camera orientation) so the shader only has to sample
// the atlas sub-rect for that instance.
//
// The atlas UV indexing and the `Body.kind → glyph` mapping are pure functions,
// unit-tested without WebGL; the canvas atlas + mesh are built lazily inside
// `createHazardInstances` (guarded so the module imports cleanly under node).
//
// Nothing here mutates `MatchState`.

import {
  CanvasTexture,
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { Camera, Texture } from 'three';
import type { Body, BodyId } from '../sim/index.js';
import type { RenderQuality } from './types.js';

/** The three shape-coded hazard glyphs, in atlas order. */
export enum HazardGlyph {
  Debris = 0,
  TrackingMissile = 1,
  SpentMissile = 2,
}

/** The two `Body` kinds that render as hazards (ships get wireframes + DOM labels). */
export type HazardKind = Exclude<Body['kind'], 'ship'>;

/** Glyph tint (secondary to shape) — hazard orange (mocks/console.css `--hazard`). */
const HAZARD_COLOR = 0xff7a1a;

/** 2×2 atlas holding the 3 glyphs (4th cell blank). */
export const ATLAS_COLS = 2;
export const ATLAS_ROWS = 2;

/** Design budget: 300 hazard bodies, with headroom (arch §9). */
const MAX_HAZARDS = 400;

/** Sub-rect (origin top-left) of a glyph index within the atlas. Pure. */
export const glyphAtlasRect = (
  glyph: HazardGlyph,
): { readonly u: number; readonly v: number; readonly w: number; readonly h: number } => {
  const col = glyph % ATLAS_COLS;
  const row = Math.floor(glyph / ATLAS_COLS);
  return { u: col / ATLAS_COLS, v: row / ATLAS_ROWS, w: 1 / ATLAS_COLS, h: 1 / ATLAS_ROWS };
};

/** `Body.kind → glyph`. Debris is ✳; a live missile body renders as the tracking ➤. Pure. */
export const bodyKindToGlyph = (kind: HazardKind): HazardGlyph =>
  kind === 'debris' ? HazardGlyph.Debris : HazardGlyph.TrackingMissile;

/** The unicode glyph drawn into each atlas cell (build-time only). */
const GLYPH_CHAR: Readonly<Record<HazardGlyph, string>> = {
  [HazardGlyph.Debris]: '✳',
  [HazardGlyph.TrackingMissile]: '➤',
  [HazardGlyph.SpentMissile]: '◇',
};

/** One hazard's render inputs, derived from a read-only `Body`. */
export interface HazardInput {
  readonly id: BodyId;
  readonly glyph: HazardGlyph;
  readonly position: readonly [number, number, number];
  readonly radius: number;
}

export interface HazardInstances {
  readonly mesh: InstancedMesh;
  /** Reconcile the live hazard set into instance transforms + atlas offsets. */
  sync(hazards: readonly HazardInput[]): void;
  /** Billboard every quad toward the camera — call once per frame before render. */
  faceCamera(camera: Camera): void;
  setQuality(quality: RenderQuality): void;
  dispose(): void;
}

const buildAtlasTexture = (): Texture | null => {
  if (typeof document === 'undefined') return null;
  const cell = 128;
  const canvas = document.createElement('canvas');
  canvas.width = cell * ATLAS_COLS;
  canvas.height = cell * ATLAS_ROWS;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.floor(cell * 0.7)}px 'JetBrains Mono', ui-monospace, monospace`;
  for (const glyph of [HazardGlyph.Debris, HazardGlyph.TrackingMissile, HazardGlyph.SpentMissile]) {
    const col = glyph % ATLAS_COLS;
    const row = Math.floor(glyph / ATLAS_COLS);
    ctx.fillText(GLYPH_CHAR[glyph], (col + 0.5) * cell, (row + 0.55) * cell);
  }
  const tex = new CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
};

const VERTEX_SHADER = /* glsl */ `
attribute vec4 aGlyph; // u, v, w, h of the atlas sub-rect
varying vec2 vUv;
void main() {
  vUv = aGlyph.xy + vec2(uv.x, 1.0 - uv.y) * aGlyph.zw;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec4 texel = texture2D(uAtlas, vUv);
  if (texel.a < 0.05) discard;
  gl_FragColor = vec4(uColor * texel.rgb, texel.a);
}
`;

/** Build the instanced hazard field. */
export const createHazardInstances = (): HazardInstances => {
  const geometry = new PlaneGeometry(1, 1);
  const glyphAttr = new InstancedBufferAttribute(new Float32Array(MAX_HAZARDS * 4), 4);
  geometry.setAttribute('aGlyph', glyphAttr);

  const material = new ShaderMaterial({
    uniforms: {
      uAtlas: { value: buildAtlasTexture() },
      uColor: { value: new Color(HAZARD_COLOR) },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
  });

  const mesh = new InstancedMesh(geometry, material, MAX_HAZARDS);
  mesh.count = 0;
  mesh.frustumCulled = false;

  // CPU billboard bookkeeping — per active instance position + scale.
  const positions: Vector3[] = [];
  const scales: number[] = [];
  const matrix = new Matrix4();
  const quat = new Quaternion();
  const unitScale = new Vector3();
  let qualityScale = 1;

  const sync = (hazards: readonly HazardInput[]): void => {
    const n = Math.min(hazards.length, MAX_HAZARDS);
    positions.length = 0;
    scales.length = 0;
    for (let i = 0; i < n; i += 1) {
      const h = hazards[i]!;
      const rect = glyphAtlasRect(h.glyph);
      glyphAttr.setXYZW(i, rect.u, rect.v, rect.w, rect.h);
      positions.push(new Vector3(h.position[0], h.position[1], h.position[2]));
      scales.push(h.radius * 2.2); // quad a touch larger than the collider (arch §9 legibility)
    }
    glyphAttr.needsUpdate = true;
    mesh.count = n;
    // Lay down identity-oriented matrices; faceCamera() orients them each frame.
    quat.identity();
    for (let i = 0; i < n; i += 1) {
      unitScale.setScalar(scales[i]! * qualityScale);
      matrix.compose(positions[i]!, quat, unitScale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  const faceCamera = (camera: Camera): void => {
    camera.getWorldQuaternion(quat);
    for (let i = 0; i < mesh.count; i += 1) {
      unitScale.setScalar(scales[i]! * qualityScale);
      matrix.compose(positions[i]!, quat, unitScale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  const setQuality = (quality: RenderQuality): void => {
    qualityScale = quality === 'reduced' ? 0.85 : 1;
  };

  const dispose = (): void => {
    geometry.dispose();
    material.dispose();
    const atlas = material.uniforms['uAtlas']?.value as Texture | null;
    if (atlas !== null && atlas !== undefined) atlas.dispose();
    mesh.dispose();
  };

  return { mesh, sync, faceCamera, setQuality, dispose };
};
