// Boundary shell — the always-on hex-grid sphere (FR-16, arch §4.1, §9).
//
// A `ShaderMaterial` on a double-sided sphere: front faces render at low alpha
// (~0.14, Gate 1's tuned value so magenta ghosts still read across it), back faces
// lower, so the shell reads "from outside looking in" without ever competing with
// per-body glyphs / paths. Never fades, no toggle (design §4.1). Radius tracks
// `arena.radius`.
//
// The hex pattern is computed in the fragment shader from the sphere UVs; there is no
// pure helper to unit-test here (the CP4 pure test is the label projection). Nothing
// mutates `MatchState`.

import { BackSide, Color, DoubleSide, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import type { RenderQuality } from './types.js';

/** Boundary red (mocks/console.css `--red`). Secondary to the shape of the shell. */
const BOUNDARY_COLOR = 0xff2e63;
const FRONT_ALPHA = 0.14;
const BACK_ALPHA = 0.05;
/** Hex cells around the sphere — sparser than a wireframe at the same visual weight. */
const HEX_DENSITY = 34;

const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Hex-grid border mask: fold uv into a hexagonal lattice and light the cell edges.
const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;
uniform float uFrontAlpha;
uniform float uBackAlpha;
uniform float uDensity;
varying vec2 vUv;

float hexBorder(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);       // hex cell metrics
  vec2 h = s * 0.5;
  vec2 a = mod(p, s) - h;
  vec2 b = mod(p - h, s) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;    // nearest cell-centre offset
  gv = abs(gv);
  float edge = max(dot(gv, normalize(vec2(1.0, 1.7320508))), gv.x);
  return edge;                                 // ~0.5 at cell centre, 0 at border
}

void main() {
  vec2 p = vec2(vUv.x * uDensity, vUv.y * uDensity * 0.6);
  float edge = hexBorder(p);
  float line = smoothstep(0.02, 0.0, edge);   // thin bright border
  float base = gl_FrontFacing ? uFrontAlpha : uBackAlpha;
  float alpha = base * (0.35 + 0.65 * line);
  if (alpha < 0.005) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

export interface BoundaryShell {
  readonly mesh: Mesh;
  /** Match the shell to a new arena radius (setState reads `state.arena.radius`). */
  setRadius(radius: number): void;
  setQuality(quality: RenderQuality): void;
  dispose(): void;
}

/** Build the boundary shell at `radius`. */
export const createBoundaryShell = (radius: number): BoundaryShell => {
  const material = new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(BOUNDARY_COLOR) },
      uFrontAlpha: { value: FRONT_ALPHA },
      uBackAlpha: { value: BACK_ALPHA },
      uDensity: { value: HEX_DENSITY },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });

  const geometry = new SphereGeometry(1, 48, 32);
  const mesh = new Mesh(geometry, material);
  mesh.scale.setScalar(radius);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1; // behind bodies so it never occludes glyphs

  const setRadius = (next: number): void => {
    mesh.scale.setScalar(next);
  };

  const setQuality = (quality: RenderQuality): void => {
    // `reduced` renders the back-face wash flat (drop the double-sided cost cue),
    // still legible from outside — visual-only, never touches sim.
    material.side = quality === 'reduced' ? BackSide : DoubleSide;
    material.needsUpdate = true;
  };

  const dispose = (): void => {
    geometry.dispose();
    material.dispose();
  };

  return { mesh, setRadius, setQuality, dispose };
};
