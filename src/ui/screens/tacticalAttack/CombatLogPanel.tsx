// M14 UI — In-match combat log strip (playtest-feedback-02 · S04 CP3).
//
// A compact, scroll-bounded strip under the tactical attack viewport that
// answers the owner's second playtest note — "Where is the combat log? I
// should see what hit and missed and why." Every field the strip renders
// (shooter, target, chance/roll, result, damage, called shot) already lives
// on `CombatLogEntry`; this component only surfaces the sequence and never
// re-derives to-hit numbers (arch §13.3 — `hitChanceFor` is the sole
// source; here we just read `entry.chance` / `entry.roll` verbatim).
//
// Text nodes only — the ship names are user-authored strings, and
// `dangerouslySetInnerHTML` / `innerHTML` are lint-banned repo-wide (§4.9).
//
// D-LOG-SURFACE-ONLY: the panel reads `flattenCombatLog(trace)` through the
// pure `lastResolvedLogRows` selector (tacticalAttack/model), which surfaces
// the newest fully-resolved turn (pf-04 FB3 · D-LOG-LAST-RESOLVED). No
// `sim/trace` change, no new controller field. Blind-commit intact: the
// trace only carries resolved beats.

import type { LogKind, LogRow } from '../postMatch/model.js';
import type { BodyId, CombatLogEntry } from '../../../sim/index.js';

const beatTag = (beat: CombatLogEntry['beat']): string =>
  beat === 'attack' ? 'ATK' : 'MOV';

/** Amount dropped from a pool this event (before → after). */
const dropped = (before: number, after: number): number => before - after;

/**
 * The tone class for one row. Killing shots read as `.is-kill` (red wash)
 * and crits as `.is-crit` (amber wash) — the two classes `components.css
 * §12 COMBAT LOG` already ships. Every other kind flows unadorned; the
 * KIND tag on the left of the row carries the identity.
 */
const rowClass = (kind: LogKind): string => {
  if (kind === 'KILL') return 'log-line is-kill';
  if (kind === 'CRIT') return 'log-line is-crit';
  return 'log-line';
};

export interface CombatLogPanelProps {
  readonly rows: readonly LogRow[];
  readonly nameOf: (id: BodyId) => string;
  /** "TURN 4" — the current turn label shown in the panel header. */
  readonly turnLabel: string;
}

/**
 * The strip. Header + scrolling body, matching the mock's `.logstrip`
 * shape (see `mocks/tactical-attack.html:518-539`) but rendered from live
 * data. Empty state reads `NO FIRE RESOLVED YET` so the strip has
 * presence even before the first beat lands.
 */
export function CombatLogPanel(props: CombatLogPanelProps) {
  const { rows, nameOf, turnLabel } = props;
  return (
    <section
      class="panel"
      data-testid="combat-log-strip"
      aria-label="Live combat log"
    >
      <div class="panel-hd" style="background:none">
        <span class="t-h2">COMBAT LOG</span>
        <span class="chip" data-testid="combat-log-strip-turn">
          {turnLabel}
        </span>
        <span class="grow" />
        <span class="mono-xs c-dim">
          SHOOTER · TARGET · ROLL · RESULT · DMG
        </span>
      </div>
      <div
        class="log"
        data-testid="combat-log-strip-body"
        style="max-height:132px;overflow-y:auto;overflow-x:hidden"
      >
        {rows.length === 0 ? (
          <div class="log-line mono-xs c-dim" data-testid="combat-log-strip-empty">
            NO FIRE RESOLVED YET
          </div>
        ) : (
          rows.map((row) => (
            <CombatLogRow key={row.seq} row={row} nameOf={nameOf} />
          ))
        )}
      </div>
    </section>
  );
}

interface CombatLogRowProps {
  readonly row: LogRow;
  readonly nameOf: (id: BodyId) => string;
}

/**
 * One rendered strip row: `T{turn}.{ATK|MOV} · KIND · shooter → target ·
 * ROLL roll/chance · RESULT · DMG (shield/hull)`. Called-shot targets
 * carry a trailing `◎ CALLED SHOT <kind>` tag. Self-inflicted entries
 * (boundary exits, `sourceId === targetId`) omit the `→ target` clause.
 */
function CombatLogRow(props: CombatLogRowProps) {
  const { row, nameOf } = props;
  const e = row.entry;
  const rolled = e.chance > 0 || e.roll > 0;
  const shieldDrop = dropped(e.shieldBefore, e.shieldAfter);
  const hullDrop = dropped(e.hullBefore, e.hullAfter);
  const isSelf = e.sourceId === e.targetId;
  return (
    <div class={rowClass(row.kind)}>
      <span class="log-t">{`T${String(e.turn)}.${beatTag(e.beat)}`}</span>
      <span
        class="mono-xs"
        style="flex:none;border:1px solid var(--line);border-radius:var(--r-sm);padding:0 4px"
      >
        {row.kind}
      </span>
      <span class="grow">
        <span class="c-hi">{nameOf(e.sourceId)}</span>
        {isSelf ? null : <span>{` → ${nameOf(e.targetId)}`}</span>}
        {rolled ? (
          <span class="c-dim">
            {` · ROLL ${e.roll.toFixed(2)}/${e.chance.toFixed(2)}`}
          </span>
        ) : null}
        <span>{` · ${e.result.toUpperCase()}`}</span>
        {e.damage > 0 ? (
          <span>
            {` · ${String(e.damage)} DMG (${String(shieldDrop)} SHIELD / ${String(hullDrop)} HULL)`}
          </span>
        ) : null}
        {e.calledShot !== undefined ? (
          <span class="c-amber">
            {` · ◎ CALLED SHOT ${e.calledShot.kind.toUpperCase()}`}
          </span>
        ) : null}
      </span>
    </div>
  );
}
