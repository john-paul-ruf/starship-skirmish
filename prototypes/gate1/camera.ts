// Camera + free orbit/pan/zoom controls for the Gate 1 prototype (design §7.1 spike).
//
// three.js's stock `OrbitControls` is the accessible baseline: LMB drags → orbit,
// MMB (or ⌥+LMB) → pan, wheel → zoom. These are the industry defaults every player
// already knows — the design §7.1 open question is whether they carry the game at
// fleet scale. `R` resets the camera to a "fleet-view" framing that always shows
// the whole arena; `F` focuses the currently-selected ship (Checkpoint 3).
//
// The prototype talks to this module only through the exported `mountCamera()`
// return value — a small handle whose surface stays flat (`resetToFleet`, `focus`,
// `update`, `resize`, `dispose`). The camera itself is a stock PerspectiveCamera;
// the game's real camera lives in M13 render and inherits nothing from here except
// the field-of-view answer (see FINDINGS.md).

import { PerspectiveCamera, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface CameraHandle {
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  /** Frame the whole arena from a neutral orbit angle. */
  resetToFleet(): void;
  /** Slide the orbit target to `point` without changing distance. */
  focus(point: Vector3): void;
  /** Re-fit projection after the container resizes. */
  resize(width: number, height: number): void;
  /** Called every frame — orbit damping needs this. */
  update(): void;
  dispose(): void;
}

export interface CameraOptions {
  readonly arenaRadius: number;
  readonly domElement: HTMLElement;
  readonly renderer: WebGLRenderer;
}

/**
 * Mount a camera + OrbitControls pair over `domElement` and return the handle.
 *
 * The initial framing is fleet-scale: the camera sits at `~2.4 × arenaRadius`
 * from the origin at ~35° elevation, pointing at the arena center. Near/far are
 * generous but not unbounded — a WebGL frustum with `near = 1` and
 * `far = 40 × arenaRadius` keeps the depth buffer usable at the largest zoom-out
 * without any artificial clamp (FR-14).
 */
export const mountCamera = ({ arenaRadius, domElement, renderer }: CameraOptions): CameraHandle => {
  const camera = new PerspectiveCamera(
    50,
    domElement.clientWidth / Math.max(1, domElement.clientHeight),
    1,
    40 * arenaRadius,
  );

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.zoomSpeed = 0.9;
  controls.rotateSpeed = 0.7;
  controls.panSpeed = 0.9;
  controls.screenSpacePanning = true;
  // No artificial clamp (FR-14) — but keep the camera outside the arena centre
  // and let it back off to double the far plane's usable range.
  controls.minDistance = arenaRadius * 0.1;
  controls.maxDistance = arenaRadius * 12;

  const fleetView = () => {
    const dist = arenaRadius * 2.4;
    // 35° up, 30° around from +X. Chosen so the ground grid reads and both
    // ships (placed on the ±X axis by default) sit inside the frame.
    const elev = (35 * Math.PI) / 180;
    const az = (30 * Math.PI) / 180;
    const y = dist * Math.sin(elev);
    const r = dist * Math.cos(elev);
    camera.position.set(r * Math.cos(az), y, r * Math.sin(az));
    controls.target.set(0, 0, 0);
    controls.update();
  };

  fleetView();

  const focus = (point: Vector3) => {
    controls.target.copy(point);
    controls.update();
  };

  const resize = (width: number, height: number) => {
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  };

  const update = () => {
    controls.update();
  };

  const dispose = () => {
    controls.dispose();
  };

  return { camera, controls, resetToFleet: fleetView, focus, resize, update, dispose };
};
