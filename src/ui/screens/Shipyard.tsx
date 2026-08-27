// M14 UI — Shipyard screen (S03 placeholder; S05 replaces this body).
//
// Owns the `shipyard` route (design §4.4). The point-buy build editor lands
// in S05 (FR-3..6); S03 ships a minimal panel proving the route mounts and
// a nav affordance back to the Encyclopedia so the e2e boot smoke can
// verify the outlet switch without touching the topbar. Export name is
// contracted (D-PLACEHOLDER).

import { useApp } from '../appContext.js';

export function Shipyard() {
  const { navigate, route } = useApp();
  const currentRoute = route.value;
  const buildId = currentRoute.name === 'shipyard' ? currentRoute.buildId : undefined;
  return (
    <div class="panel ticks" data-testid="screen-shipyard">
      <div class="panel-hd">
        <span class="t-h2">SHIPYARD — ONLINE</span>
      </div>
      <div class="panel-bd stack">
        <p class="t-prose">
          The point-buy Shipyard lands in S05. This placeholder proves routing.
        </p>
        {buildId !== undefined ? (
          <p class="mono-xs c-dim" data-testid="shipyard-build-id">
            EDITING BUILD: {buildId}
          </p>
        ) : null}
        <button
          type="button"
          class="btn btn-sm"
          data-testid="nav-encyclopedia"
          onClick={() => navigate({ name: 'encyclopedia' })}
        >
          ← ENCYCLOPEDIA
        </button>
      </div>
    </div>
  );
}
