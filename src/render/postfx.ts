// Bloom post-processing pipeline (arch §1 stack, §9 render) — the missing half-res
// selective-bloom pass the prototype faked with `AdditiveBlending`. Encapsulates
// `EffectComposer` + `RenderPass` + `UnrealBloomPass` + `OutputPass` behind a small
// handle `scene.ts` drives; nothing outside `render/` sees three's post-processing
// surface, so the barrel stays stable and every caller of `SceneContext.render` (live
// view + playback) inherits the glow with no API change.
//
// `halfRes` and `bloomParamsFor` are pure exports so a node unit test can lock the
// tier shape (`reduced` → bloom off, byte-equivalent to the pre-bloom render path);
// the composer itself needs WebGL and is proven by `vite build` + the e2e smoke.
// Nothing here mutates `MatchState` — render is a pixels-only leaf (FR-33).

import { PerspectiveCamera, Vector2 } from 'three';
import type { Scene, WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { RenderQuality } from './types.js';

/**
 * Half-resolution bloom target sizing (arch §9 "half-res selective bloom"). Pure —
 * halves each dimension with a floor of 1 so a zero-sized canvas never produces a
 * zero-length render target.
 */
export const halfRes = (width: number, height: number): readonly [number, number] => [
  Math.max(1, Math.floor(width / 2)),
  Math.max(1, Math.floor(height / 2)),
];

/** Tuned bloom parameters per render-quality tier. Pure — `reduced` disables bloom. */
export interface BloomParams {
  readonly enabled: boolean;
  readonly strength: number;
  readonly radius: number;
  readonly threshold: number;
}

/**
 * Bloom strength/radius/threshold per quality tier. `reduced` returns disabled + zero
 * strength so the fall-back render path in `scene.ts` is byte-equivalent to today.
 * The `high` values were tuned against the prototype look (Gate 1) — bright enough
 * that additive trails/beams glow, threshold high enough that the low-alpha boundary
 * shell does NOT bloom into the arena.
 */
export const bloomParamsFor = (quality: RenderQuality): BloomParams =>
  quality === 'reduced'
    ? { enabled: false, strength: 0, radius: 0, threshold: 1 }
    : { enabled: true, strength: 0.9, radius: 0.5, threshold: 0.55 };

/** The bloom-composer handle `scene.ts` drives. */
export interface BloomComposer {
  /** Render one frame through the composer using `camera` as the RenderPass camera. */
  render(camera: PerspectiveCamera): void;
  /** Resize the composer + bloom pass to a new canvas size (full width/height). */
  setSize(width: number, height: number): void;
  /** Swap tuning tiers — `reduced` turns bloom off, `high` restores it. */
  setQuality(quality: RenderQuality): void;
  /** Whether the current quality tier has bloom enabled (drives `scene.ts` routing). */
  readonly enabled: boolean;
  dispose(): void;
}

/**
 * Build the bloom composer for `renderer` + `scene`. The RenderPass camera is set on
 * every `render(camera)` call (a placeholder camera seeds the pass at construction so
 * playback and the live view can each pass their own camera without a composer
 * rebuild). The bloom pass sizes to `halfRes(w,h)` and gets re-sized in step with the
 * composer.
 */
export const createBloomComposer = (
  renderer: WebGLRenderer,
  scene: Scene,
  quality: RenderQuality,
): BloomComposer => {
  const size = renderer.getSize(new Vector2());
  const width = Math.max(1, size.x);
  const height = Math.max(1, size.y);
  const [halfW, halfH] = halfRes(width, height);

  const composer = new EffectComposer(renderer);
  composer.setSize(width, height);

  // Placeholder — overwritten on every `render(camera)` before the composer runs, so
  // its projection/view state never actually reaches the frame.
  const placeholderCamera = new PerspectiveCamera();
  const renderPass = new RenderPass(scene, placeholderCamera);
  composer.addPass(renderPass);

  let params = bloomParamsFor(quality);
  const bloomPass = new UnrealBloomPass(
    new Vector2(halfW, halfH),
    params.strength,
    params.radius,
    params.threshold,
  );
  bloomPass.enabled = params.enabled;
  bloomPass.setSize(halfW, halfH);
  composer.addPass(bloomPass);

  // OutputPass performs tonemapping + sRGB conversion so the composed frame matches
  // what `renderer.render(scene, camera)` would have produced under the same output
  // colour-space settings (three r171 default is `SRGBColorSpace`).
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  const render = (nextCamera: PerspectiveCamera): void => {
    renderPass.camera = nextCamera;
    composer.render();
  };

  const setSize = (nextW: number, nextH: number): void => {
    const w = Math.max(1, nextW);
    const h = Math.max(1, nextH);
    composer.setSize(w, h);
    const [hw, hh] = halfRes(w, h);
    bloomPass.setSize(hw, hh);
  };

  const setQuality = (next: RenderQuality): void => {
    params = bloomParamsFor(next);
    bloomPass.enabled = params.enabled;
    bloomPass.strength = params.strength;
    bloomPass.radius = params.radius;
    bloomPass.threshold = params.threshold;
  };

  const dispose = (): void => {
    composer.dispose();
    bloomPass.dispose();
    outputPass.dispose();
  };

  return {
    render,
    setSize,
    setQuality,
    get enabled() {
      return params.enabled;
    },
    dispose,
  };
};
