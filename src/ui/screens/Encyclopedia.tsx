// M14 UI — Encyclopedia screen (S03 placeholder; S04 replaces this body).
//
// Owns the `encyclopedia` route (design §4.4 + §4.5). S03 ships a minimal
// panel that proves routing, showing the current-route + a "SHIPYARD" nav
// affordance so the e2e boot smoke can drive a navigation without depending
// on the shell's topbar. S04 replaces the body wholesale; the export name is
// contracted (D-PLACEHOLDER).

import { useApp } from '../appContext.js';

export function Encyclopedia() {
  const { navigate } = useApp();
  return (
    <div class="panel ticks" data-testid="screen-encyclopedia">
      <div class="panel-hd">
        <span class="t-h2">ENCYCLOPEDIA — ONLINE</span>
      </div>
      <div class="panel-bd stack">
        <p class="t-prose">
          The Encyclopedia surface will land in S04. This placeholder proves routing.
        </p>
        <button
          type="button"
          class="btn btn-sm"
          data-testid="nav-shipyard"
          onClick={() => navigate({ name: 'shipyard' })}
        >
          → SHIPYARD
        </button>
      </div>
    </div>
  );
}
