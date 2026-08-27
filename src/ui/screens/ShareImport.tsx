// M14 UI — Share/Import screen (S03 placeholder; S06 replaces this body).
//
// Owns the `share` route (design §4.10 / §4.11). The full paste/preview/import
// surface + `decodeShareToken` call lands in S06 (FR-2, FR-8 boundary). S03
// ships a placeholder that echoes the incoming token so the boot smoke can
// verify a `#/share?t=…` hash landed on this screen without S06 in place.
// Export name is contracted (D-PLACEHOLDER).

import { useApp } from '../appContext.js';

export function ShareImport() {
  const { navigate, route } = useApp();
  const currentRoute = route.value;
  const token = currentRoute.name === 'share' ? currentRoute.token : undefined;
  return (
    <div class="panel ticks" data-testid="screen-share">
      <div class="panel-hd">
        <span class="t-h2">SHARE / IMPORT — ONLINE</span>
      </div>
      <div class="panel-bd stack">
        <p class="t-prose">
          The Share paste+preview surface lands in S06. This placeholder proves
          the token routed through.
        </p>
        {token !== undefined ? (
          <p class="mono-xs c-dim" data-testid="share-token">
            TOKEN: {token}
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
