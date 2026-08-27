// M14 UI — shared roster / inspector barrel (skirmish-tactical-parity
// SESSION-02). The public surface both tactical screens (S03 move, S04 attack)
// read from. Explicit re-exports rather than `export *` — verbatimModuleSyntax
// separates value / type re-exports and the M14 component-library barrel
// convention (see `../index.ts` header) does not use `export *`.

export { FleetRoster } from './FleetRoster.js';
export type { FleetRosterProps } from './FleetRoster.js';

export { ShipInspector } from './ShipInspector.js';
export type { ShipInspectorProps } from './ShipInspector.js';

export {
  fleetLabel,
  groupByFleet,
  isAlive,
  pipsFor,
} from './model.js';
export type {
  FleetGroup,
  PipKind,
  PipState,
  RosterEntry,
  ShipPip,
} from './model.js';
