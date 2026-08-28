// TacticalView — the assembled static tactical view (arch §4, §9).
//
// `createTacticalView(canvas)` composes the scene scaffold, the persistent orbit
// camera, and the four instanced sub-systems (ships / hazards / boundary / labels)
// plus GPU picking into the `TacticalView` contract. `setState(state)` diffs a FROZEN
// `MatchState` into the scene — it READS only, never mutates (FR-33: deleting
// `src/render/` leaves a working headless game). A private RAF drives orbit damping +
// hazard billboarding + a ~15 Hz label pass; `dispose()` tears it all down.
//
// SESSION-03 (playback + ghost) builds on the `.scene` seam without re-editing this
// file — it pushes interpolated transforms into `.scene.ships` / `.scene.hazards` and
// renders through `.scene.render()`.

import { Matrix4 } from 'three';
import type { Body, BodyId, ChassisClass, MatchState } from '../sim/index.js';
import { createBoundaryShell } from './boundary.js';
import { createTacticalCamera, focusBodyFor, focusSourceFor, projectToViewport } from './camera.js';
import { createHazardInstances, bodyKindToGlyph, type HazardInput, type HazardKind } from './hazards.js';
import {
  LABEL_PRIORITY,
  createLabelOverlay,
  debrisLabelText,
  shipLabelText,
  spentMissileLabelText,
  trackingMissileLabelText,
  type LabelDatum,
} from './labels.js';
import { createPickBuffer, type PickInput } from './pick.js';
import { createSceneContext, type StalkInput } from './scene.js';
import type { PickResult, SceneHandles, TacticalView } from './types.js';
import { createShipInstances, fleetColorOf, type ShipInput } from './wireframes.js';

/** Fallback arena radius before the first `setState` (updated from `state.arena`). */
const DEFAULT_ARENA_RADIUS = 1000;
/** ~15 Hz label reprojection, decoupled from the render loop (Gate 1 §3). */
const LABEL_INTERVAL_MS = 66;

const positionTuple = (body: Body): readonly [number, number, number] => [
  body.position.x,
  body.position.y,
  body.position.z,
];

/**
 * Build the tactical view over `canvas`. `initialArenaRadius` seeds the camera framing
 * before the first `setState`; pass the known arena radius (setup screen) for a correct
 * `R` reset, or omit it for the default.
 */
export const createTacticalView = (
  canvas: HTMLCanvasElement,
  initialArenaRadius: number = DEFAULT_ARENA_RADIUS,
): TacticalView => {
  const context = createSceneContext(canvas, initialArenaRadius);
  const camera = createTacticalCamera(canvas, initialArenaRadius);
  const ships = createShipInstances();
  const hazards = createHazardInstances();
  const boundary = createBoundaryShell(initialArenaRadius);
  const labels = createLabelOverlay(
    typeof document !== 'undefined' ? canvas.parentElement : null,
  );
  const pickBuffer = createPickBuffer();

  context.scene.add(ships.group);
  context.scene.add(hazards.mesh);
  context.scene.add(boundary.mesh);

  let viewWidth = Math.max(1, canvas.clientWidth || 1);
  let viewHeight = Math.max(1, canvas.clientHeight || 1);
  ships.setResolution(viewWidth, viewHeight);

  // `F` focuses the last-picked body (selection lives with the caller; the view tracks
  // the pick so the shortcut has something to slide to).
  let selectedId: BodyId | null = null;
  camera.setFocusSource(focusSourceFor(() => selectedId, (id) => ships.positionOf(id)));

  let labelData: readonly LabelDatum[] = [];
  const viewProjection = new Matrix4();

  const syncLabels = (): void => {
    viewProjection.multiplyMatrices(
      camera.camera.projectionMatrix,
      camera.camera.matrixWorldInverse,
    );
    labels.sync(labelData, viewProjection, viewWidth, viewHeight);
  };

  const setState = (state: MatchState): void => {
    context.setArenaRadius(state.arena.radius);
    boundary.setRadius(state.arena.radius);

    const ids = Array.from(state.bodies.keys()).sort((a, b) => a - b);
    const shipInputs: ShipInput[] = [];
    const hazardInputs: HazardInput[] = [];
    const stalkInputs: StalkInput[] = [];
    const pickInputs: PickInput[] = [];
    const nextLabels: LabelDatum[] = [];

    for (const id of ids) {
      const body = state.bodies.get(id)!;
      const [x, y, z] = positionTuple(body);
      stalkInputs.push({ id, x, y, z });
      pickInputs.push({ id, kind: body.kind, position: [x, y, z], radius: body.radius });

      if (body.kind === 'ship') {
        const combat = state.ships.get(id);
        const chassisClass: ChassisClass = combat?.ship.chassisClass ?? 'fighter';
        const fleet = fleetColorOf(state.fleetOf.get(id) ?? 0);
        shipInputs.push({ id, chassisClass, fleet, position: [x, y, z], radius: body.radius });
        const name = combat?.ship.name ?? '';
        const shieldsDown =
          combat !== undefined && combat.ship.shieldCapacity > 0 && combat.shields <= 0;
        nextLabels.push({
          id,
          kind: 'ship',
          text: shipLabelText(name, fleet, shieldsDown),
          world: [x, y, z],
          fleet,
          priority: LABEL_PRIORITY.ship,
        });
      } else {
        hazardInputs.push({
          id,
          glyph: bodyKindToGlyph(body.kind as HazardKind),
          position: [x, y, z],
          radius: body.radius,
        });
        if (body.kind === 'debris') {
          nextLabels.push({
            id,
            kind: 'debris',
            text: debrisLabelText(id),
            world: [x, y, z],
            priority: LABEL_PRIORITY.debris,
          });
        } else if (body.kind === 'missile') {
          // A live guidance record means the missile is still tracking (T{n} beats
          // remaining). Absence means the guidance was cleared — either fuel-out
          // (`spentRemainsArmed=true` keeps it lethal on contact) or already
          // detonated but not yet swept. Either way the missile reads as `SPENT · ARMED`
          // per the mock.
          const guidance = state.guidances.get(id);
          if (guidance === undefined) {
            nextLabels.push({
              id,
              kind: 'missile-spent',
              text: spentMissileLabelText(id),
              world: [x, y, z],
              priority: LABEL_PRIORITY['missile-spent'],
            });
          } else {
            const targetName =
              state.ships.get(guidance.targetId)?.ship.name ?? `BODY ${guidance.targetId}`;
            nextLabels.push({
              id,
              kind: 'missile-tracking',
              text: trackingMissileLabelText(
                id,
                guidance.trackingBeatsLeft,
                targetName,
              ),
              world: [x, y, z],
              priority: LABEL_PRIORITY['missile-tracking'],
            });
          }
        }
      }
    }

    ships.sync(shipInputs);
    hazards.sync(hazardInputs);
    context.syncStalks(stalkInputs);
    pickBuffer.sync(pickInputs);
    labelData = nextLabels;
    if (selectedId !== null && !state.bodies.has(selectedId)) selectedId = null;
    syncLabels();
  };

  // Render loop — orbit damping needs a steady tick; hazards billboard per frame;
  // labels reproject at ~15 Hz. Guarded so the module is inert without a DOM.
  const hasRaf = typeof requestAnimationFrame === 'function';
  let rafId = 0;
  let lastLabelAt = 0;
  const tick = (t: number): void => {
    camera.update();
    hazards.faceCamera(camera.camera);
    context.render(camera.camera);
    if (t - lastLabelAt >= LABEL_INTERVAL_MS) {
      syncLabels();
      lastLabelAt = t;
    }
    rafId = requestAnimationFrame(tick);
  };
  if (hasRaf) rafId = requestAnimationFrame(tick);

  const pick = (x: number, y: number): PickResult | null => {
    const result = pickBuffer.pick(context.renderer, camera.camera, x, y, viewWidth, viewHeight);
    if (result !== null) selectedId = result.bodyId;
    return result;
  };

  const worldToScreen = (
    pos: readonly [number, number, number],
  ): { readonly x: number; readonly y: number } | null =>
    projectToViewport(pos, camera.camera, viewWidth, viewHeight);

  const focusBody = focusBodyFor((id) => ships.positionOf(id), camera.focus);

  const resize = (width: number, height: number, dpr?: number): void => {
    viewWidth = Math.max(1, width);
    viewHeight = Math.max(1, height);
    context.resize(width, height, dpr);
    camera.resize(width, height);
    ships.setResolution(viewWidth, viewHeight);
  };

  const scene: SceneHandles = {
    context,
    ships,
    hazards,
    boundary,
    camera,
    render: () => context.render(camera.camera),
  };

  const dispose = (): void => {
    if (hasRaf && rafId !== 0) cancelAnimationFrame(rafId);
    labels.dispose();
    pickBuffer.dispose();
    ships.dispose();
    hazards.dispose();
    boundary.dispose();
    camera.dispose();
    context.dispose();
  };

  return { setState, camera, scene, pick, worldToScreen, focusBody, resize, dispose };
};
