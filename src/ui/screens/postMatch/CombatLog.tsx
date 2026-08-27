// M14 UI — Post-match FULL COMBAT LOG (FR-28): every entry, filterable by kind.
//
// The deterministic record of the match, flattened turn-by-turn (movement then
// attack) by `flattenCombatLog`. Each line is composed from TEXT NODES only —
// `innerHTML` / `dangerouslySetInnerHTML` are lint-banned repo-wide, and ship
// names are user-authored strings, so nothing here is ever interpreted as HTML.

import { useComputed, useSignal } from '@preact/signals';

import type { BodyId, CombatLogEntry } from '../../../sim/index.js';

import { LOG_KINDS, type LogKind, type LogRow } from './model.js';

const KIND_LABEL: Readonly<Record<LogKind, string>> = {
  SHOT: 'SHOTS',
  CRIT: 'CRITS',
  MISSILE: 'MISSILES',
  COLLISION: 'COLLISIONS',
  KILL: 'KILLS',
  BOUNDARY: 'BOUNDARY',
  INTERCEPT: 'INTERCEPTS',
};

const beatTag = (beat: CombatLogEntry['beat']): string =>
  beat === 'attack' ? 'ATK' : 'MOV';

/** Amount removed from a pool this event (before → after). */
const dropped = (before: number, after: number): number => before - after;

export interface CombatLogProps {
  readonly rows: readonly LogRow[];
  readonly nameOf: (id: BodyId) => string;
}

export function CombatLog(props: CombatLogProps) {
  const { rows, nameOf } = props;
  // Default all-on multi-select filter (§4.11 combat-log filters).
  const active = useSignal<ReadonlySet<LogKind>>(new Set(LOG_KINDS));

  const toggle = (kind: LogKind) => {
    const next = new Set(active.value);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    active.value = next;
  };

  const visible = useComputed(() => rows.filter((r) => active.value.has(r.kind)));

  return (
    <section class="panel">
      <div class="panel-hd">
        <span class="t-h2 grow">FULL COMBAT LOG</span>
        <span class="mono-xs">{`${String(rows.length)} ENTRIES`}</span>
      </div>

      <div
        class="seg"
        role="group"
        aria-label="Filter combat log by kind"
        style="flex-wrap:wrap;padding:var(--s2) var(--s3)"
      >
        {LOG_KINDS.map((kind) => {
          const on = active.value.has(kind);
          return (
            <button
              key={kind}
              type="button"
              class={on ? 'is-active' : undefined}
              aria-pressed={on}
              onClick={() => toggle(kind)}
              data-testid={`log-filter-${kind}`}
            >
              {KIND_LABEL[kind]}
            </button>
          );
        })}
      </div>

      <div class="log" data-testid="combat-log" style="max-height:396px;overflow-y:auto">
        {visible.value.length === 0 ? (
          <div class="log-line mono-xs c-dim">NO ENTRIES MATCH THE ACTIVE FILTERS.</div>
        ) : (
          visible.value.map((row) => <LogLine key={row.seq} row={row} nameOf={nameOf} />)
        )}
      </div>

      <div class="panel-ft">
        <span class="mono-xs">
          {`SHOWING ${String(visible.value.length)} OF ${String(rows.length)} · EVERY SHOT RECORDS SHOOTER, TARGET, ROLL, RESULT, DAMAGE`}
        </span>
      </div>
    </section>
  );
}

interface LogLineProps {
  readonly row: LogRow;
  readonly nameOf: (id: BodyId) => string;
}

function LogLine(props: LogLineProps) {
  const { row, nameOf } = props;
  const e = row.entry;
  const rolled = e.chance > 0 || e.roll > 0;
  const shieldDrop = dropped(e.shieldBefore, e.shieldAfter);
  const hullDrop = dropped(e.hullBefore, e.hullAfter);
  const isSelf = e.sourceId === e.targetId;

  return (
    <div class="log-line" style="display:flex;gap:var(--s2);align-items:baseline">
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
        {rolled ? <span class="c-dim">{` · ROLL ${e.roll.toFixed(2)}/${e.chance.toFixed(2)}`}</span> : null}
        <span>{` · ${e.result.toUpperCase()}`}</span>
        {e.damage > 0 ? (
          <span>{` · ${String(e.damage)} DMG (${String(shieldDrop)} SHIELD / ${String(hullDrop)} HULL)`}</span>
        ) : null}
        {e.calledShot !== undefined ? (
          <span class="c-amber">{` · ◎ CALLED SHOT ${e.calledShot.kind.toUpperCase()}`}</span>
        ) : null}
      </span>
    </div>
  );
}
