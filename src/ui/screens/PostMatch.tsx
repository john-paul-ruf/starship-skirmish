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

import { useEffect } from 'preact/hooks';

import { useApp } from '../appContext.js';
import { useMatch } from '../matchContext.js';

import { OutcomeBanner } from './postMatch/OutcomeBanner.js';
import { FleetsAndFates } from './postMatch/FleetsAndFates.js';
import { CombatLog } from './postMatch/CombatLog.js';
import { EndActions } from './postMatch/EndActions.js';
import { flattenCombatLog, nameByBodyId, perShipFates } from './postMatch/model.js';

export function PostMatch() {
  const match = useMatch();
  const { navigate } = useApp();
  const outcome = match.outcome.value;
  const complete = match.phase.value === 'complete' && outcome !== null;

  // Guard: entered without a completed match (a bare deep-link to
  // `#/skirmish/result`, or mid-flight) → nothing to summarise. Redirect to
  // setup; render an empty root meanwhile so the testid stays stable.
  useEffect(() => {
    if (!complete) navigate({ name: 'skirmish-setup' });
  }, [complete, navigate]);

  if (outcome === null || !complete) {
    return <section class="panel" data-testid="screen-post-match" />;
  }

  const trace = match.trace.value;
  const fates = perShipFates(match.state.value, trace, match.initialFleets);
  const logRows = flattenCombatLog(trace);
  const names = nameByBodyId(match.initialFleets);
  const nameOf = (id: number): string => names.get(id) ?? `BODY ${String(id)}`;

  return (
    <div class="stack-lg" data-testid="screen-post-match">
      <OutcomeBanner
        outcome={outcome}
        playerFleetId={match.playerFleetId}
        seedLabel={match.seedLabel}
      />
      <FleetsAndFates fleets={fates} />
      <CombatLog rows={logRows} nameOf={nameOf} />
      <EndActions />
    </div>
  );
}
