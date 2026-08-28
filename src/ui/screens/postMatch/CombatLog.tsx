// M14 UI — Post-match FULL COMBAT LOG (FR-28): every entry, filterable by kind
// AND by ship focus (S02 — "focus on my ship").
//
// The deterministic record of the match, flattened turn-by-turn (movement then
// attack) by `flattenCombatLog`. Each line is composed from TEXT NODES only —
// `innerHTML` / `dangerouslySetInnerHTML` are lint-banned repo-wide, and ship
// names are user-authored strings, so nothing here is ever interpreted as HTML.
//
// Focus (S02 / D-LOG-FOCUS-DISPLAY-ONLY): a per-render signal narrows the log to
// ALL rows, only rows where a player ship is shooter/target (MINE), or only rows
// touching one specific ship. The underlying flattened sequence is NEVER
// reordered (FR-28) — focus is a display filter composed with the kind chips.

import { useComputed, useSignal } from '@preact/signals';

import { Select } from '../../components/index.js';
import type { BodyId, CombatLogEntry } from '../../../sim/index.js';

import {
  LOG_KINDS,
  logInvolves,
  type LogKind,
  type LogRow,
  type ShipOption,
} from './model.js';

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

/**
 * Ship-focus filter state. `all` matches every entry; `mine` matches entries
 * involving any player ship; `ship` narrows to a single body. Kept as a signal
 * so a change re-derives the visible rows without re-rendering the parent.
 */
type Focus =
  | { readonly kind: 'all' }
  | { readonly kind: 'mine' }
  | { readonly kind: 'ship'; readonly bodyId: BodyId };

const NO_FOCUS_VALUE = '__none__';

export interface CombatLogProps {
  readonly rows: readonly LogRow[];
  readonly nameOf: (id: BodyId) => string;
  /**
   * BodyIds belonging to the player fleet — the "MINE" universe. Optional so the
   * CP2 tree compiles before PostMatch wires it in CP3; when absent MINE simply
   * matches nothing (the button is also disabled to make that visible).
   */
  readonly playerBodyIds?: ReadonlySet<BodyId>;
  /**
   * Every ship the focus dropdown can pick, player ships first. Optional for the
   * same CP2/CP3 phasing as `playerBodyIds`; empty → the ship picker is disabled.
   */
  readonly shipOptions?: readonly ShipOption[];
}

const EMPTY_IDS: ReadonlySet<BodyId> = new Set();
const EMPTY_OPTIONS: readonly ShipOption[] = [];

export function CombatLog(props: CombatLogProps) {
  const {
    rows,
    nameOf,
    playerBodyIds = EMPTY_IDS,
    shipOptions = EMPTY_OPTIONS,
  } = props;
  // Default all-on multi-select filter (§4.11 combat-log filters).
  const active = useSignal<ReadonlySet<LogKind>>(new Set(LOG_KINDS));
  const focus = useSignal<Focus>({ kind: 'all' });

  const toggle = (kind: LogKind) => {
    const next = new Set(active.value);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    active.value = next;
  };

  const setFocusAll = () => {
    focus.value = { kind: 'all' };
  };
  const setFocusMine = () => {
    focus.value = { kind: 'mine' };
  };
  const setFocusShip = (bodyId: BodyId) => {
    focus.value = { kind: 'ship', bodyId };
  };

  const visible = useComputed(() => {
    const f = focus.value;
    return rows.filter(
      (r) => active.value.has(r.kind) && matchesFocus(r.entry, f, playerBodyIds),
    );
  });

  const focusMode = focus.value.kind;
  const focusShipId = focus.value.kind === 'ship' ? focus.value.bodyId : null;
  const shipSelectOptions = [
    { value: NO_FOCUS_VALUE, label: '— PICK A SHIP —', disabled: true },
    ...shipOptions.map((o) => ({
      value: String(o.bodyId),
      label: o.mine ? `${o.name} (MINE)` : o.name,
    })),
  ];

  const onShipChange = (event: Event) => {
    const raw = (event.target as HTMLSelectElement).value;
    if (raw === NO_FOCUS_VALUE) return;
    const id = Number(raw);
    if (Number.isFinite(id)) setFocusShip(id);
  };

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

      <div
        class="seg"
        role="group"
        aria-label="Focus combat log on a ship"
        style="flex-wrap:wrap;padding:var(--s2) var(--s3);gap:var(--s2)"
      >
        <button
          type="button"
          class={focusMode === 'all' ? 'is-active' : undefined}
          aria-pressed={focusMode === 'all'}
          onClick={setFocusAll}
          data-testid="log-focus-all"
        >
          ALL
        </button>
        <button
          type="button"
          class={focusMode === 'mine' ? 'is-active' : undefined}
          aria-pressed={focusMode === 'mine'}
          onClick={setFocusMine}
          disabled={playerBodyIds.size === 0}
          data-testid="log-focus-mine"
        >
          MINE
        </button>
        <Select
          value={focusShipId !== null ? String(focusShipId) : NO_FOCUS_VALUE}
          options={shipSelectOptions}
          onChange={onShipChange}
          disabled={shipOptions.length === 0}
          aria-label="Focus combat log on a specific ship"
          class="log-focus-ship-select"
        />
        {focusShipId !== null ? (
          <span
            class="mono-xs"
            data-testid="log-focus-ship"
            style="align-self:center"
          >
            {`FOCUS: ${nameOf(focusShipId)}`}
          </span>
        ) : null}
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

/** Compose the ship-focus decision for one entry — pure, no signal read. */
const matchesFocus = (
  entry: CombatLogEntry,
  focus: Focus,
  playerIds: ReadonlySet<BodyId>,
): boolean => {
  switch (focus.kind) {
    case 'all':
      return true;
    case 'mine':
      return logInvolves(entry, playerIds);
    case 'ship':
      return entry.sourceId === focus.bodyId || entry.targetId === focus.bodyId;
  }
};

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
