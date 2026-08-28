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

// playtest-feedback-01 SESSION-07 — weapon-range preview shell. Screens attach
// this to `.scene.context.scene` and drive it over the same seams that carry
// the AoE ring; the shell computes no to-hit number (arch §13.3).
export { createRangeShell } from './range.js';
export type { RangeShell } from './range.js';

// SESSION-03 — trace playback + plotting ghost. The Movement/Attack screens drive these
// over the `.scene` seam; the ghost DRAWS a supplied `previewArc` path (it never
// integrates one — the single-integrator invariant lives in `sim/physics`).
export { attachTracePlayer } from './TracePlayer.js';
export type { TracePlayer, Playback, PlaybackOpts } from './TracePlayer.js';
export { attachGhost, fromPreviewPath } from './ghost.js';
export type { GhostLayer, GhostDrawInput, GhostMark } from './ghost.js';
// Ghost palette tokens the screens reference (Gate 1 §2a).
export { GHOST_CYAN, GHOST_MAGENTA_HI, GHOST_AMBER, GHOST_EXIT_RED, EXIT_STATUS } from './ghost.js';

// SESSION-01 (skirmish-tactical-parity) — flown-path trail primitive (Gate 1 FINDINGS
// §2a, prototype `last ~16 s` fade). Attached to a `TacticalView` and driven from a
// TracePlayer keyframe hook or the screen's own scheduler.
export { attachTrail, DEFAULT_TRAIL_WINDOW_SECONDS, TRAIL_COLOR, trailAlphaFor, pruneTrail } from './trail.js';
export type { TrailLayer, TrailPoint } from './trail.js';
