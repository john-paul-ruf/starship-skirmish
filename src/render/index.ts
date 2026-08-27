// Public barrel of M13 render (arch §4, §11).
//
// The screens reach render only through a dynamic `import('../../../render/index.js')`
// so three.js stays in its own chunk (arch §11 bundle budget). This barrel exports the
// factory + the public types the screens need, plus the scene-handle seam types
// SESSION-03 (playback + ghost) builds against.

export { createTacticalView } from './TacticalView.js';

export type { TacticalView, TacticalCamera, SceneHandles, PickResult, RenderQuality, FleetColor } from './types.js';

// Scene-handle seam surfaces (for SESSION-03 playback + ghost).
export type { SceneContext, StalkInput } from './scene.js';
export type { ShipInstances, ShipInput } from './wireframes.js';
export { fleetColorOf, FLEET_PALETTE } from './wireframes.js';
export type { HazardInstances, HazardInput, HazardKind } from './hazards.js';
export { HazardGlyph, bodyKindToGlyph } from './hazards.js';
export type { BoundaryShell } from './boundary.js';
