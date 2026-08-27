// M14 UI — Post-match screen (S07 body over the S01 placeholder).
//
// D-PLACEHOLDER: the `PostMatch` export name + `data-testid="screen-post-match"`
// root are contracted by S01 — the screens barrel and `App.tsx` outlet import
// them and MUST NOT be re-edited. This file only replaces the body.
//
// The loop's exit: outcome headline (FR-27), the seed as a first-class object
// (§4.11), per-ship fates, and the full combat log (FR-28) — all rendered off
// the completed `MatchController` via `useMatch()`. CONCEDE is not here; it lives
// in the shell match-chrome (S01) and merely lands on this screen.

import { useMatch } from '../matchContext.js';

import { OutcomeBanner } from './postMatch/OutcomeBanner.js';
import { FleetsAndFates } from './postMatch/FleetsAndFates.js';
import { perShipFates } from './postMatch/model.js';

export function PostMatch() {
  const match = useMatch();
  const outcome = match.outcome.value;

  // Guard: entered without a completed match (deep-link, mid-flight) → nothing
  // to summarise. The full redirect lands in checkpoint 3.
  if (outcome === null) {
    return <section class="panel" data-testid="screen-post-match" />;
  }

  const fates = perShipFates(match.state.value, match.trace.value, match.initialFleets);

  return (
    <div class="stack-lg" data-testid="screen-post-match">
      <OutcomeBanner
        outcome={outcome}
        playerFleetId={match.playerFleetId}
        seedLabel={match.seedLabel}
      />
      <FleetsAndFates fleets={fates} />
    </div>
  );
}
