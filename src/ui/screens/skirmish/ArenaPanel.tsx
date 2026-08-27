// M14 UI — Skirmish Setup · arena + seed (S04 CP3).
//
// Arena radius is derived from budget by `domain.resolveArena` (Ruling C) — the
// screen computes no geometry. The seed is first-class (§4.11): generated,
// displayed as `SK-XXXX-XXXX-XXXX`, rerollable, and copyable.
//
// Render preview (D-RENDER-DYNAMIC / STATE.md "setup arena preview is optional/
// degradable"): a live three.js preview would need a placement-only `MatchState`,
// which only exists once `startMatch` mints a match — the setup screen owns no
// such seam. So the arena is a DATA-FIRST readout here, the sanctioned fallback
// that keeps the setup route from pulling three.js eagerly and from hard-failing
// when WebGL is unavailable. The seed the SIM runs on is minted app-side at
// LAUNCH; the label shown here is the setup preview.

import { Button } from '../../components/index.js';

/** Space-group a non-negative integer (`4200` → `4 200`) to match the mock. */
const groupThousands = (n: number): string =>
  String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export interface ArenaPanelProps {
  readonly radius: number;
  readonly fleetCount: number;
  readonly budget: number;
  readonly seedLabel: string;
  readonly onRerollSeed: () => void;
  readonly onCopySeed: () => void;
}

export function ArenaPanel({
  radius,
  fleetCount,
  budget,
  seedLabel,
  onRerollSeed,
  onCopySeed,
}: ArenaPanelProps) {
  return (
    <>
      <section class="panel ticks" style="flex:none" data-testid="arena-panel">
        <div class="panel-hd">
          <span class="t-h2">Arena</span>
          <span class="grow" />
          <span class="mono-xs">DATA READOUT · DERIVED FROM BUDGET</span>
        </div>
        <div class="panel-bd">
          <div class="stat">
            <span class="stat-k">Arena Radius</span>
            <span class="stat-v">
              {groupThousands(radius)}{' '}
              <span class="mono-xs">{`FROM BUDGET ${String(budget)}`}</span>
            </span>
          </div>
          <div class="stat">
            <span class="stat-k">Fleets On Field</span>
            <span class="stat-v" data-testid="arena-fleet-count">
              {String(fleetCount)}
            </span>
          </div>
          <div class="stat">
            <span class="stat-k">Start Velocity</span>
            <span class="stat-v">
              0 <span class="mono-xs">FOR ALL SHIPS</span>
            </span>
          </div>
          <div class="mono-xs" style="margin-top:var(--s2)">
            NO FLEET STARTS CLOSER TO THE BOUNDARY THAN ANY OTHER. LAST FLEET STANDING WINS.
          </div>
        </div>
      </section>

      <section class="panel" style="flex:none">
        <div class="panel-bd">
          <div class="skm-seed-row">
            <span class="t-label">Match Seed</span>
            <span class="grow" />
            <Button size="sm" onClick={onRerollSeed} aria-label="Reroll match seed">
              ↻ Reroll
            </Button>
            <Button size="sm" onClick={onCopySeed} aria-label="Copy match seed">
              Copy
            </Button>
          </div>
          <div class="t-num skm-seed-value" data-testid="seed-value">
            {seedLabel}
          </div>
          <div class="mono-xs" style="margin-top:var(--s1)">
            SAME SEED + SAME PLANS = IDENTICAL OUTCOME (§4.11). THE MATCH SEED IS MINTED AT LAUNCH.
          </div>
        </div>
      </section>
    </>
  );
}
