// Public surface of `src/ai/` — M12 barrel (S04 CP4).
//
// This is the sole `import from '../ai/index.js'` entry — the S05 harness and
// any later render/ui consumer reach the AI module through THIS file. Reaching
// into concrete `src/ai/*.ts` files from outside `src/ai/` is legal (they are
// plain modules) but this barrel is the canonical face, kept intentionally
// small: exactly the four pieces the architecture §4 module contract calls
// out — `BotTier`, `TIER_CONFIG`, `generateBotFleet`, `HeuristicCommander` —
// plus the `TierConfig` type and `BOT_TIERS` canonical ordering that S05's
// CLI (fleet-tier parsing + iteration) needs.
//
// Everything else stays module-local: `attackPlanner`, `movementPlanner`, and
// `threatMap` are implementation details of `HeuristicCommander`; adding them
// here now would widen the public surface for no current consumer.
// S05/S06 can widen if they need direct access (a follow-up edit to this file,
// not a breaking change).

export type { BotTier, TierConfig } from './tiers.js';
export { BOT_TIERS, TIER_CONFIG } from './tiers.js';
export { generateBotFleet } from './generateBotFleet.js';
export { HeuristicCommander } from './HeuristicCommander.js';
