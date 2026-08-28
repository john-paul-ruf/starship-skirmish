// Range shell — a translucent cyan sphere drawn around a shooter to show a
// weapon's engagement envelope while its fire-slot is selected on the Tactical
// Attack screen (playtest-feedback-01 SESSION-07, feature: "visual of weapon
// range and chance to hit").
//
// Mirrors `createBoundaryShell` in shape and lifecycle — sphere geometry scaled
// by `setRadius`, disposed on unmount, `setQuality` degrade hook — but does two
// things the boundary does not:
//   • `setCenter(x, y, z)` moves the shell to follow the shooter (the boundary
//     is arena-anchored at the origin, the range shell rides on a ship);
//   • `setVisible(v)` toggles it on/off between selections (the boundary is
//     always-on, the range preview is an on-demand overlay).
//
// Colour is cyan (`mocks/console.css --cyan`, the player-fleet / primary token —
// hostile-red is reserved for boundary and lethal cues, `specs/design.md §1.1`);
// the value is written literally because render cannot import a stylesheet, and
// its meaning is documented at the constant so the token mapping is legible.
// The shell computes NO to-hit number — it draws a supplied radius at a supplied
// position and nothing more (arch §13.3 — hit chance stays single-sourced
// through `hitChanceFor`).

import { BackSide, DoubleSide, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import type { RenderQuality } from './types.js';

/** Range cyan (mocks/console.css `--cyan`, `--fleet-0` — player-primary token). */
const RANGE_COLOR = 0x22e3ff;
/** Low-alpha wash — legible at fleet-scale, never occludes ship glyphs. */
const RANGE_ALPHA = 0.09;

export interface RangeShell {
  readonly mesh: Mesh;
  /** Match the shell to a weapon's range envelope (world units). */
  setRadius(radius: number): void;
  /** Slide the shell centre onto the shooter's world position. */
  setCenter(x: number, y: number, z: number): void;
  /** Toggle without disposing — cheap between fire-slot selections. */
  setVisible(visible: boolean): void;
  setQuality(quality: RenderQuality): void;
  dispose(): void;
}

/** Build the range shell at `radius`; centre defaults to the origin. */
export const createRangeShell = (radius: number): RangeShell => {
  const material = new MeshBasicMaterial({
    color: RANGE_COLOR,
    transparent: true,
    opacity: RANGE_ALPHA,
    depthWrite: false,
    side: DoubleSide,
  });

  const geometry = new SphereGeometry(1, 48, 32);
  const mesh = new Mesh(geometry, material);
  mesh.scale.setScalar(radius);
  mesh.frustumCulled = false;
  // Behind bodies so it never occludes ship glyphs / hit-chance readouts; the
  // boundary shell uses -1, the range shell sits just in front of that so the
  // two overlays layer boundary → range → bodies without z-fighting.
  mesh.renderOrder = -0.5;

  const setRadius = (next: number): void => {
    mesh.scale.setScalar(next);
  };

  const setCenter = (x: number, y: number, z: number): void => {
    mesh.position.set(x, y, z);
  };

  const setVisible = (visible: boolean): void => {
    mesh.visible = visible;
  };

  const setQuality = (quality: RenderQuality): void => {
    // Under `reduced`, drop to back-face only so the shell reads as a rim from
    // outside without the front-face haze crossing every foreground glyph.
    material.side = quality === 'reduced' ? BackSide : DoubleSide;
    material.needsUpdate = true;
  };

  const dispose = (): void => {
    geometry.dispose();
    material.dispose();
  };

  return { mesh, setRadius, setCenter, setVisible, setQuality, dispose };
};
