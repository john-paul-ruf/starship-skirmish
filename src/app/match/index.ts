// M16 App — match session barrel (S01).
//
// The app-internal face of the match session: `session.ts` wires `startMatch`
// on top of these. `createMatchController` produces the value the ui-owned
// `MatchController` contract (`src/ui/matchContext.ts`) describes; the config
// assembly + commander seams support it.

export {
  assembleMatchConfig,
  mintSeed,
  PLAYER_FLEET_ID,
} from './config.js';
export {
  makeBotCommanders,
  makePlayerCommander,
  type PlayerCommanderHandle,
} from './commanders.js';
export { createMatchController, type MatchServices } from './controller.js';
