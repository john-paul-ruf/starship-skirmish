// M14 UI — Post-match end actions: rematch + return (§4.11, Flow 2 exit).
//
// REMATCH (same seed) replays the identical seed deterministically; REMATCH
// (new seed) keeps the same fleets/arena but re-rolls; RETURN heads back to the
// Encyclopedia. Rematch crosses the controller (`rematch`, which re-enters the
// movement phase and navigates); the return crosses `useApp().navigate`. Raw
// buttons carry the `data-testid` hooks the `Button` primitive does not forward.

import { useApp } from '../../appContext.js';
import { useMatch } from '../../matchContext.js';

export function EndActions() {
  const match = useMatch();
  const { navigate } = useApp();

  return (
    <section class="panel ticks">
      <div
        class="panel-bd"
        style="display:flex;gap:var(--s3);flex-wrap:wrap;align-items:center"
      >
        <button
          type="button"
          class="btn btn-primary btn-lg"
          data-testid="rematch-same"
          onClick={() => match.rematch({ newSeed: false })}
        >
          ↻ REMATCH · SAME SEED
        </button>
        <button
          type="button"
          class="btn btn-lg"
          data-testid="rematch-new"
          onClick={() => match.rematch({ newSeed: true })}
        >
          REMATCH · NEW SEED
        </button>
        <span class="grow" />
        <button
          type="button"
          class="btn btn-lg"
          data-testid="return-encyclopedia"
          onClick={() => navigate({ name: 'encyclopedia' })}
        >
          RETURN TO ENCYCLOPEDIA
        </button>
      </div>
      <div class="panel-ft">
        <div class="mono-xs">
          REMATCH REPLAYS THE SAME FLEETS AND ARENA. SAME SEED = IDENTICAL REPLAY
          (§4.11) — YOUR PLANS DECIDE WHETHER IT ENDS THE SAME WAY.
        </div>
      </div>
    </section>
  );
}
