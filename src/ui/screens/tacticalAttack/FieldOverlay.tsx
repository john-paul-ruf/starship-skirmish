// M14 UI — Tactical Attack field overlay (tactical-attack-mock-parity SESSION-03).
//
// A pointer-events-none DOM/SVG layer above the tactical canvas. During
// `attack-plan` it renders the mock's plan vocabulary (mocks/tactical-attack.
// html:374-515) from LIVE data — never mock literals:
//   • always-visible kill-boundary text from `state.arena.radius`;
//   • one label per live weapon range envelope (active slot highlighted);
//   • firing-solution lines (solid cyan weapon / dashed red missile / muted
//     dashed out-of-range) with midpoint pills — `68% · W1`, `M1 · TALON ↦`,
//     `⊘ OUT OF RANGE · 412 > 260`;
//   • the selected-body callout, the first missile AoE ring + friendly-in-AoE
//     warnings, a body-class legend, and the beat / turn HUD.
//
// EVERY value is supplied already projected (CSS pixels) or already published
// (the % is `Math.round(finalChance * 100)` over the controller's `final`,
// arch §13.3 — this layer computes no to-hit number). It reads no opponent plan:
// solutions derive only from the local player's staged assignments. All text is
// a real text node (no `innerHTML`); decorative SVG is `aria-hidden`.

import type { AoeRingProjection, FireSolution, ScreenPoint, ScreenSegment } from './model.js';

/** One firing solution with its line already projected to pixel space. */
export interface FieldSolutionMark {
  readonly solution: FireSolution;
  readonly seg: ScreenSegment;
}

/** One projected range-envelope label; `active` is the focused slot. */
export interface FieldRangeLabel {
  readonly key: string;
  readonly text: string;
  readonly active: boolean;
  readonly point: ScreenPoint;
}

/** A projected text callout (selected body, friendly-in-AoE). */
export interface FieldCallout {
  readonly key: string;
  readonly text: string;
  readonly tone: 'cyan' | 'amber' | 'red';
  readonly point: ScreenPoint;
}

/** One fleet row in the body-class legend. */
export interface FieldLegendFleet {
  readonly fleetId: number;
  readonly glyph: string;
  readonly label: string;
  readonly count: number;
}

export interface FieldOverlayProps {
  readonly solutions: readonly FieldSolutionMark[];
  readonly rangeLabels: readonly FieldRangeLabel[];
  readonly selected: FieldCallout | null;
  readonly aoeRing: AoeRingProjection | null;
  readonly aoeCallout: FieldCallout | null;
  readonly aoeFriendlies: readonly FieldCallout[];
  readonly legendFleets: readonly FieldLegendFleet[];
  readonly turn: number;
  readonly arenaRadius: number;
}

const TONE_VAR: Readonly<Record<'cyan' | 'amber' | 'red', string>> = {
  cyan: 'var(--cyan)',
  amber: 'var(--amber)',
  red: 'var(--red)',
};

/** Line stroke for a solution by status (never colour-alone: the pill text
 *  carries the same verdict). Solid cyan = in-range weapon, dashed red =
 *  missile launch, muted grey dashed = out-of-range. */
const lineStyleFor = (
  s: FireSolution,
): { readonly stroke: string; readonly dash: string | undefined } => {
  if (s.kind === 'missile') return { stroke: 'var(--red)', dash: '6 4' };
  if (s.status === 'out-of-range') return { stroke: '#4A5866', dash: '3 5' };
  return { stroke: 'var(--cyan)', dash: undefined };
};

/** Pill text + tone for a solution. The % is `Math.round(final * 100)` over the
 *  published `finalChance` only (arch §13.3) — no formula lives here. */
const pillFor = (
  s: FireSolution,
): { readonly text: string; readonly tone: 'cyan' | 'red' | 'dim' } => {
  if (s.kind === 'missile') return { text: `${s.label} ↦`, tone: 'red' };
  if (s.status === 'out-of-range') {
    const r = s.range !== undefined ? String(Math.round(s.range)) : '—';
    return { text: `⊘ OUT OF RANGE · ${String(Math.round(s.distance))} > ${r}`, tone: 'dim' };
  }
  const pct = s.finalChance !== undefined ? Math.round(s.finalChance * 100) : 0;
  return { text: `${String(pct)}% · ${s.label}`, tone: 'cyan' };
};

const PILL_TONE: Readonly<Record<'cyan' | 'red' | 'dim', string>> = {
  cyan: 'var(--cyan)',
  red: 'var(--red)',
  dim: '#7E8C99',
};

/** Static body-class legend rows shared with the mock (shape + text, never
 *  colour alone). Fleet rows are prepended from live counts. */
const STATIC_LEGEND: readonly { readonly glyph: string; readonly color: string; readonly text: string }[] = [
  { glyph: '✳', color: 'var(--hazard)', text: 'DEBRIS — INERT MASS' },
  { glyph: '➤', color: 'var(--missile)', text: 'MISSILE — TRACKING' },
  { glyph: '◇', color: 'var(--spent)', text: 'MISSILE — SPENT · ARMED' },
  { glyph: '◌', color: 'var(--red)', text: 'KILL BOUNDARY' },
  { glyph: '◍', color: 'var(--cyan)', text: 'WEAPON RANGE RING' },
  { glyph: '◉', color: 'var(--red)', text: 'MISSILE AoE PREVIEW' },
];

export function FieldOverlay(props: FieldOverlayProps) {
  const {
    solutions,
    rangeLabels,
    selected,
    aoeRing,
    aoeCallout,
    aoeFriendlies,
    legendFleets,
    turn,
    arenaRadius,
  } = props;

  return (
    <div
      class="ta-field-overlay"
      data-testid="field-overlay"
      style="position:absolute;inset:0;pointer-events:none;overflow:hidden"
    >
      {/* Firing-solution + AoE lines/rings. */}
      <svg
        aria-hidden="true"
        style="position:absolute;inset:0;width:100%;height:100%;overflow:visible"
      >
        {solutions.map((m) => {
          const st = lineStyleFor(m.solution);
          return (
            <line
              key={m.solution.key}
              x1={m.seg.x1}
              y1={m.seg.y1}
              x2={m.seg.x2}
              y2={m.seg.y2}
              stroke={st.stroke}
              stroke-width="1.5"
              stroke-dasharray={st.dash}
              opacity="0.9"
            />
          );
        })}
        {aoeRing !== null ? (
          <circle
            data-testid="aoe-ring"
            cx={aoeRing.cx}
            cy={aoeRing.cy}
            r={aoeRing.r}
            fill="none"
            stroke="var(--red)"
            stroke-width="1.5"
            stroke-dasharray="6 4"
            opacity="0.85"
          />
        ) : null}
      </svg>

      {/* Firing-solution pills at each line midpoint. */}
      {solutions.map((m) => {
        const pill = pillFor(m.solution);
        return (
          <div
            key={m.solution.key}
            data-testid="solution-pill"
            style={`position:absolute;left:${String(m.seg.mx)}px;top:${String(m.seg.my)}px;transform:translate(-50%,-50%);white-space:nowrap;padding:1px 6px;border-radius:9px;font-size:10px;font-weight:700;letter-spacing:.08em;background:rgba(5,7,10,.92);color:${PILL_TONE[pill.tone]};border:1px solid ${PILL_TONE[pill.tone]}`}
          >
            {pill.text}
          </div>
        );
      })}

      {/* One label per live weapon range envelope; active slot brightened. */}
      {rangeLabels.map((l) => (
        <div
          key={l.key}
          data-testid="range-label"
          style={`position:absolute;left:${String(l.point.x)}px;top:${String(l.point.y)}px;transform:translate(-50%,-50%);white-space:nowrap;padding:0 4px;font-size:9px;letter-spacing:.14em;background:rgba(5,7,10,.82);color:var(--cyan);border:1px solid rgba(34,227,255,${l.active ? '.55' : '.22'});opacity:${l.active ? '1' : '.72'}`}
        >
          {l.text}
        </div>
      ))}

      {/* Selected-body callout. */}
      {selected !== null ? (
        <div
          data-testid="selected-callout"
          style={`position:absolute;left:${String(selected.point.x)}px;top:${String(selected.point.y)}px;transform:translate(-50%,-50%);white-space:nowrap;padding:1px 5px;font-size:9px;font-weight:700;letter-spacing:.14em;background:rgba(5,7,10,.85);color:${TONE_VAR[selected.tone]};border:1px solid ${TONE_VAR[selected.tone]}`}
        >
          {selected.text}
        </div>
      ) : null}

      {/* Missile AoE callout + friendly-in-AoE warnings. */}
      {aoeCallout !== null ? (
        <div
          data-testid="aoe-callout"
          style={`position:absolute;left:${String(aoeCallout.point.x)}px;top:${String(aoeCallout.point.y)}px;transform:translate(-50%,-50%);white-space:nowrap;padding:2px 6px;font-size:9px;font-weight:700;letter-spacing:.14em;background:rgba(5,7,10,.92);color:var(--red);border:1px solid rgba(255,46,99,.6)`}
        >
          {aoeCallout.text}
        </div>
      ) : null}
      {aoeFriendlies.map((c) => (
        <div
          key={c.key}
          data-testid="aoe-friendly-callout"
          style={`position:absolute;left:${String(c.point.x)}px;top:${String(c.point.y)}px;transform:translate(-50%,-50%);white-space:nowrap;padding:2px 6px;font-size:9px;font-weight:700;letter-spacing:.14em;background:rgba(5,7,10,.92);color:var(--amber);border:1px solid rgba(255,176,32,.6)`}
        >
          {c.text}
        </div>
      ))}

      {/* Always-visible kill-boundary text (FR-16 / Ruling F) from arena radius. */}
      <div
        class="boundary-label"
        data-testid="boundary-top"
        style="position:absolute;left:50%;top:8px;transform:translateX(-50%)"
      >
        {`KILL BOUNDARY · R ${String(Math.round(arenaRadius))}`}
      </div>
      <div
        class="boundary-label"
        style="position:absolute;left:50%;bottom:8px;transform:translateX(-50%)"
      >
        EXIT = IMMEDIATE DESTRUCTION
      </div>
      <div class="boundary-label" style="position:absolute;left:8px;top:50%;transform:translateY(-50%)">
        ◌
      </div>
      <div class="boundary-label" style="position:absolute;right:8px;top:50%;transform:translateY(-50%)">
        ◌
      </div>

      {/* Top-left beat / turn HUD. */}
      <div
        class="hud"
        data-testid="beat-hud"
        style="position:absolute;left:12px;top:12px;padding:8px 12px"
      >
        <div class="t-label">BEAT 3 / 4 — ATTACK PLAN</div>
        <div class="mono-xs c-dim" style="margin-top:2px">
          {`POSITIONS ARE POST-MOVEMENT · TURN ${String(turn)}`}
        </div>
      </div>

      {/* Bottom-left body-class legend (shape + text, never colour alone). */}
      <div
        class="hud"
        data-testid="field-legend"
        style="position:absolute;left:12px;bottom:12px;padding:10px 12px;max-width:230px"
      >
        <div class="t-label" style="margin-bottom:6px">BODY CLASSES</div>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 8px;font-size:10px;letter-spacing:.08em">
          {legendFleets.flatMap((f) => [
            <span
              key={`g${String(f.fleetId)}`}
              style={`text-align:center;color:var(--fleet-${String(f.fleetId)})`}
            >
              {f.glyph}
            </span>,
            <span key={`t${String(f.fleetId)}`}>
              {`${f.label} — ${String(f.count)} SHIP${f.count === 1 ? '' : 'S'}`}
            </span>,
          ])}
          {STATIC_LEGEND.flatMap((row) => [
            <span key={`sg${row.text}`} style={`text-align:center;color:${row.color}`}>
              {row.glyph}
            </span>,
            <span key={`st${row.text}`}>{row.text}</span>,
          ])}
        </div>
      </div>
    </div>
  );
}
