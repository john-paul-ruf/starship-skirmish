// M14 UI — Tactical Attack screen (skirmish-tactical-parity S04 body over S06).
//
// D-PLACEHOLDER: the `TacticalAttack` export name + `data-testid=
// "screen-tactical-attack"` root are contracted by S01 — the screens barrel and
// `App.tsx` outlet import them and MUST NOT be re-edited. This file only replaces
// the body. CONCEDE is not here; it lives in the shell match-chrome (S01).
//
// The blind fire-assignment screen (FR-17/FR-20). During `attack-plan` the player
// assigns each live weapon / missile to a post-movement target, reads the honest
// hit-chance breakdown (via `hitChanceFor` — never recomputed, arch §13.3),
// optionally sets a called shot on a shields-down target (§4.5), and is WARNED —
// never blocked — when a missile blast clips a friendly (§4.6). COMMIT resolves
// the attack beat; during `attack-resolve` the viewport animates it, then hands
// off (`resolveAnimationDone`) to the next movement turn or post-match.
//
// S04 adds the FR-15 all-fleets left column (roster + inspector — no fog of
// war, mocks/tactical-attack.html col-l), roster→selection→camera.focus wiring
// via S01's `focusBody`/`setFocusSource`/`worldToScreen` seams, and a camera
// HUD. Every blind-fire invariant carries verbatim.

import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

import type { BodyId, CalledShotTarget } from '../../sim/index.js';

import { FleetRoster, ShipInspector, fleetLabel, groupByFleet } from '../components/roster/index.js';
import type { RosterEntry } from '../components/roster/index.js';
import { useApp } from '../appContext.js';
import { useMatch } from '../matchContext.js';

import { CalledShotPicker } from './tacticalAttack/CalledShotPicker.js';
import { CombatLogPanel } from './tacticalAttack/CombatLogPanel.js';
import { CommitBar } from './tacticalAttack/CommitBar.js';
import { FriendlyFireBanner } from './tacticalAttack/FriendlyFireBanner.js';
import type { FriendlyFireWarning } from './tacticalAttack/FriendlyFireBanner.js';
import { Viewport } from './tacticalAttack/Viewport.js';
import type { AoePreview } from './tacticalAttack/Viewport.js';
import { WeaponBench } from './tacticalAttack/WeaponBench.js';
import {
  aoeOverlapsFriendly,
  assignmentGate,
  fireContext,
  friendlyShips,
  lastResolvedLogRows,
  positionOf as positionOfInView,
  rangePreviewFor,
  shipRangePreview,
  shipViewOf,
  slotKey,
  toAttackPlans,
  type Assignment,
  type FireContextRole,
  type FireSlot,
} from './tacticalAttack/model.js';
import { nameByBodyId } from './postMatch/model.js';

/** Roster badge for one role. Text + color-token — never color alone (§1.1). */
const ROLE_BADGE: Readonly<Record<FireContextRole, { readonly label: string; readonly cls: string }>> = {
  shooter: { label: 'SHOOTER', cls: 'chip chip-cyan' },
  targeted: { label: 'TARGETED', cls: 'chip chip-amber' },
  'aoe-friendly': { label: '⚠ IN AoE', cls: 'chip chip-red' },
};

const roleChip = (role: FireContextRole): ComponentChildren => {
  const meta = ROLE_BADGE[role];
  return (
    <span
      key={role}
      class={meta.cls}
      data-testid="roster-role-chip"
      data-role={role}
      aria-label={meta.label}
    >
      {meta.label}
    </span>
  );
};

export function TacticalAttack() {
  const match = useMatch();
  const app = useApp();
  const phase = match.phase.value;
  const state = match.state.value;
  const assignments = useSignal<ReadonlyMap<string, Assignment>>(new Map());
  /** All-fleets selection (roster + inspector + camera focus). */
  const selectedId = useSignal<BodyId | null>(null);
  /** SESSION-07 — the fire slot the player is currently interacting with;
   *  drives the tactical viewport range shell. Cleared when the player leaves
   *  the plan phase or the shooter goes away. */
  const selectedSlot = useSignal<FireSlot | null>(null);
  /** playtest-feedback-05 SESSION-04 CP2 (FB3, D-IMMERSIVE-GRID-COLLAPSE) —
   *  the "full-field" toggle. When true, the scoped `.ta-shell.is-immersive`
   *  block collapses `.ta-layout` to a single column and hides the roster,
   *  the plan-scroll, and the CommitBar so the Viewport fills the bounded
   *  fixed frame. Grid-collapse only, NOT `position: fixed` (stays inside
   *  `.app-main.is-fixed-frame`; the browser Fullscreen API can layer over
   *  this later if the owner wants OS-level fullscreen — the pf-05 State
   *  Update flags the semantics as an Open Question). Auto-resets on
   *  unmount / phase change because the signal is scoped to this component. */
  const fullscreen = useSignal(false);
  // Esc exits immersive — a single window listener while the toggle is on.
  // Guarded on `globalThis.addEventListener` so the SSR / node-test path (no
  // DOM) still typechecks + no-ops instead of throwing. The listener is
  // installed only WHILE immersive so nothing else on the screen races Esc
  // (a modal open on an assignment row still gets its own Esc handler back
  // when the toggle exits).
  const isImmersive = fullscreen.value;
  useEffect(() => {
    if (!isImmersive) return;
    const target = globalThis as {
      addEventListener?: (t: string, l: (e: KeyboardEvent) => void) => void;
      removeEventListener?: (t: string, l: (e: KeyboardEvent) => void) => void;
    };
    if (target.addEventListener === undefined) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fullscreen.value = false;
    };
    target.addEventListener('keydown', onKey);
    return () => target.removeEventListener?.('keydown', onKey);
  }, [isImmersive, fullscreen]);

  // The screen is only meaningful in the two attack phases. Any other phase
  // renders a stable, empty root so the testid never disappears.
  if (phase !== 'attack-plan' && phase !== 'attack-resolve') {
    return (
      <section class="panel ta-shell" data-testid="screen-tactical-attack">
        <TacticalAttackStyles />
      </section>
    );
  }

  // attack-resolve: the outcome is already final — the viewport animates the
  // beat and, on done (or immediately under reduced motion), advances.
  // playtest-feedback-02 · S04 CP2: share the fixed-frame `.ta-shell` +
  // `.ta-col-r` structure so the viewport pins under the frame; CP4 mounts
  // the CombatLogPanel inside `.ta-col-r-strip` so the log follows the
  // shots as they resolve.
  if (phase === 'attack-resolve') {
    // playtest-feedback-04 FB3 / D-LOG-LAST-RESOLVED: surface the newest
    // resolved turn. During `attack-resolve` of turn N, the trace has NOT yet
    // received turn N (that write lands at turn-end, after this animation) —
    // the newest resolved turn is N−1. The panel's turn label follows the
    // selector's returned turn, never the (still-planning) counter.
    const resolved = lastResolvedLogRows(match.trace.value);
    const resolveNames = nameByBodyId(match.initialFleets);
    const resolveNameOf = (id: BodyId): string =>
      resolveNames.get(id) ?? `BODY ${String(id)}`;
    return (
      <section class="ta-shell ta-shell-resolve" data-testid="screen-tactical-attack">
        <TacticalAttackStyles />
        <header class="ta-header panel-hd">
          <span class="t-h2 grow">ATTACK RESOLVE</span>
          <span class="chip chip-cyan">SNAPSHOT RESOLUTION</span>
        </header>
        <div class="ta-col-r ta-col-r-resolve">
          <Viewport
            state={state}
            phase={phase}
            attackBeat={match.attackBeat.value}
            reducedMotion={app.reducedMotion.value}
            onResolveDone={() => match.resolveAnimationDone()}
            aoePreview={null}
            rangePreview={null}
            selectedId={null}
            positionOf={() => null}
            onPickBody={() => undefined}
            focusLabel="—"
            fullscreen={false}
            onToggleFullscreen={() => undefined}
          />
          <div class="mono-xs c-dim ta-resolve-note">
            RESOLVING FIRE AGAINST A PRE-DAMAGE SNAPSHOT …
          </div>
          <CombatLogPanel
            rows={resolved.rows}
            nameOf={resolveNameOf}
            turnLabel={
              resolved.turn !== null ? `TURN ${String(resolved.turn)}` : 'NO COMBAT YET'
            }
          />
          {resolved.rows.length === 0 ? (
            <div class="mono-xs c-dim ta-no-fire-note" data-testid="no-fire-note">
              NO FIRE THIS TURN — ALL SHOTS HELD OR OUT OF RANGE
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  // attack-plan.
  const view = match.view.value;
  const selfFleetId = match.playerFleetId;

  const onAssign = (slot: FireSlot, targetId: BodyId | null) => {
    const next = new Map(assignments.value);
    const key = slotKey(slot);
    if (targetId === null) {
      next.delete(key);
    } else {
      next.set(key, {
        shooterId: slot.shooterId,
        targetId,
        ...(slot.kind === 'weapon' ? { weaponIndex: slot.index } : { missileIndex: slot.index }),
      });
    }
    assignments.value = next;
  };

  const onCalledShot = (slot: FireSlot, calledShot: CalledShotTarget | null) => {
    const key = slotKey(slot);
    const current = assignments.value.get(key);
    if (current === undefined) return; // no target assigned → nothing to call
    const next = new Map(assignments.value);
    next.set(key, {
      shooterId: current.shooterId,
      targetId: current.targetId,
      ...(current.weaponIndex !== undefined ? { weaponIndex: current.weaponIndex } : {}),
      ...(current.missileIndex !== undefined ? { missileIndex: current.missileIndex } : {}),
      ...(calledShot !== null ? { calledShot } : {}),
    });
    assignments.value = next;
  };

  const onSelect = (bodyId: BodyId) => {
    selectedId.value = bodyId;
  };

  if (view === null) {
    // Entering the phase before the view is populated — render just the
    // viewport shell; the plan UI appears on the next tick.
    return (
      <section class="ta-shell ta-shell-boot panel" data-testid="screen-tactical-attack">
        <TacticalAttackStyles />
        <Viewport
          state={state}
          phase={phase}
          attackBeat={match.attackBeat.value}
          reducedMotion={app.reducedMotion.value}
          onResolveDone={() => match.resolveAnimationDone()}
          aoePreview={null}
          rangePreview={null}
          selectedId={null}
          positionOf={() => null}
          onPickBody={() => undefined}
          focusLabel="—"
          fullscreen={false}
          onToggleFullscreen={() => undefined}
        />
      </section>
    );
  }

  const shooters = friendlyShips(view, selfFleetId);
  const staged = [...assignments.value.values()];
  const gate = assignmentGate(staged, shooters);

  // §4.6 — every missile assignment whose blast clips a friendly, named.
  const warnings: FriendlyFireWarning[] = [];
  for (const a of staged) {
    if (a.missileIndex === undefined) continue;
    const overlap = aoeOverlapsFriendly(a, view);
    if (overlap === null) continue;
    warnings.push({
      missileLabel: `${overlap.shooter.name} · M${String(a.missileIndex + 1)}`,
      overlap,
    });
  }

  // Informational AoE ring for the first staged missile: the label + the blast
  // center in world coords (Viewport projects it via `worldToScreen`, hides on
  // null). The banner carries the authoritative geometry — this ring never
  // gates commit and never contradicts `aoeOverlapsFriendly`.
  let aoePreview: AoePreview | null = null;
  for (const a of staged) {
    if (a.missileIndex === undefined) continue;
    const shooter = shipViewOf(view, a.shooterId);
    const rack = shooter?.ship.missiles[a.missileIndex];
    if (shooter === undefined || rack === undefined) continue;
    const center = positionOfInView(view, a.targetId);
    if (center === undefined) continue;
    aoePreview = {
      label: `${shooter.name} · M${String(a.missileIndex + 1)}`,
      radius: rack.aoeRadius,
      center,
    };
    break;
  }

  // SESSION-07 — range shell geometry for whichever weapon slot the player is
  // currently interacting with (WeaponBench emits focus events to update it).
  // The shell hides on any degenerate input (shooter destroyed, missile slot,
  // etc.) via `rangePreviewFor`'s null path — the bench text stays authoritative.
  // playtest-feedback-03 SESSION-01 — before any slot is focused, default to
  // the selected ship's longest-range live weapon (`shipRangePreview`) so the
  // range shell appears the moment a ship is selected, no slot focus required
  // (D-ATK-ORIENTATION). A focused slot always overrides the ship-level default.
  const rangePreview =
    selectedSlot.value !== null
      ? rangePreviewFor(view, selectedSlot.value)
      : shipRangePreview(view, selectedId.value);

  const groups = groupByFleet(view.ships, selfFleetId);
  const roleMap = fireContext(staged, view);

  const annotate = (entry: RosterEntry): ComponentChildren => {
    const roles = roleMap.get(entry.bodyId);
    if (roles === undefined || roles.length === 0) return null;
    return (
      <span
        style="display:inline-flex;gap:4px;flex-wrap:wrap;justify-content:flex-end"
        aria-label={`Fire context: ${roles.map((r) => ROLE_BADGE[r].label).join(', ')}`}
      >
        {roles.map(roleChip)}
      </span>
    );
  };

  const selected =
    selectedId.value !== null ? shipViewOf(view, selectedId.value) ?? null : null;
  const selectedVelocity =
    selected !== null
      ? state.bodies.get(selected.bodyId)?.velocity ?? null
      : null;
  const focusLabel = selected !== null ? selected.name : '—';

  const positionForFocus = (id: BodyId) => positionOfInView(view, id) ?? null;

  const onCommit = () => {
    match.commitAttack(toAttackPlans(staged, view.ships));
  };

  // ---- Live combat log strip (playtest-feedback-04 CP3 / D-LOG-LAST-RESOLVED) —
  //
  // Surfaces the NEWEST RESOLVED turn (via `lastResolvedLogRows`), not the
  // in-flight `currentTurn` — the trace batches a turn at turn-end, so during
  // `attack-plan` of turn N the newest resolved turn is N−1 (or `null` on
  // turn 1). Reading `currentTurn` here (the pre-CP3 shape) yielded an empty
  // strip the entire time the player was planning. Blind-commit intact:
  // `trace` accumulates only after a beat resolves; opponent plans never
  // appear. Names come from the immutable initial rosters (matches the
  // post-match combat log) so a ship destroyed earlier in the match still
  // reads by its authored name.
  const resolved = lastResolvedLogRows(match.trace.value);
  const names = nameByBodyId(match.initialFleets);
  const nameOf = (id: BodyId): string => names.get(id) ?? `BODY ${String(id)}`;

  const onToggleFullscreen = () => {
    fullscreen.value = !fullscreen.value;
  };

  const shellClass = `ta-shell${fullscreen.value ? ' is-immersive' : ''}`;

  return (
    <section class={shellClass} data-testid="screen-tactical-attack">
      <TacticalAttackStyles />
      <header class="ta-header panel-hd">
        <span class="t-h2 grow">ATTACK PLAN</span>
        <span class="chip" title="Decision 7 — no clock exists anywhere in the turn loop">
          NO TIMER
        </span>
        <span class="chip chip-amber" data-testid="blind-commit-label">
          OPPONENT PLANS ARE NOT OBSERVABLE
        </span>
      </header>

      <div class="mono-xs c-dim ta-subhead">
        TARGETING FROM POST-MOVEMENT POSITIONS · FULL STATE FOR ALL FLEETS · NO FOG OF WAR.
      </div>

      <div class="ta-layout">
        <div class="ta-col-l" data-testid="ta-col-l">
          <div class="ta-roster-scroll">
            <FleetRoster
              groups={groups}
              selectedId={selectedId.value}
              onSelect={onSelect}
              annotate={annotate}
              aria-label="Attack roster — every fleet, no fog of war"
            />
          </div>
          <ShipInspector ship={selected} velocity={selectedVelocity} />
          <div class="mono-xs c-dim ta-range-readout" data-testid="ship-range-readout">
            {rangePreview !== null
              ? `ENGAGEMENT RANGE ${String(Math.round(rangePreview.radius))}u`
              : selected !== null
                ? 'NO LIVE WEAPON RANGE'
                : 'SELECT A SHIP TO SEE ITS RANGE'}
          </div>
          <div class="mono-xs c-dim ta-col-l-ft">
            {`FLEET: ${fleetLabel(selfFleetId)} · ALL FLEETS VISIBLE`}
          </div>
        </div>

        <div class="ta-col-r">
          <Viewport
            state={state}
            phase={phase}
            attackBeat={match.attackBeat.value}
            reducedMotion={app.reducedMotion.value}
            onResolveDone={() => match.resolveAnimationDone()}
            aoePreview={aoePreview}
            rangePreview={rangePreview}
            selectedId={selectedId.value}
            positionOf={positionForFocus}
            onPickBody={(id) => {
              if (id !== null) selectedId.value = id;
            }}
            focusLabel={focusLabel}
            fullscreen={fullscreen.value}
            onToggleFullscreen={onToggleFullscreen}
          />

          {/*
           * playtest-feedback-04 FB2 (D-ATK-ONE-SCROLL): every plan-time
           * element between the pinned viewport and the pinned CommitBar
           * lives in ONE scroll container. Was three independent scroll
           * regions in the right column (`.ta-col-r` safety, `.ta-bench-scroll`
           * wrapping only the bench, and the log's internal `max-height:132px`);
           * now they nest inside a single primary scroll. The `.ta-bench-scroll`
           * class name is retained (external `inMatchLayout.test.ts` locks it)
           * even though the wrapper now spans hint→banner→bench→log — the
           * scroll region IS the plan surface, semantic drift Forge can rename
           * in a future refactor. The bench-never-collapses guarantee (FB1
           * regression from pf-03) carries via this wrapper's `min-height`.
           */}
          <div class="ta-bench-scroll" data-testid="ta-plan-scroll">
            <div class="mono-xs c-cyan ta-orientation" data-testid="fire-flow-hint">
              SELECT A WEAPON → PICK A TARGET → COMMIT FIRE · OR HOLD ALL AND COMMIT
            </div>

            <FriendlyFireBanner warnings={warnings} />

            <WeaponBench
              view={view}
              selfFleetId={selfFleetId}
              assignments={assignments.value}
              onAssign={onAssign}
              hitChanceFor={match.hitChanceFor}
              onSelectSlot={(slot) => {
                selectedSlot.value = slot;
              }}
              renderCalledShot={(slot, assignment, target) => (
                <CalledShotPicker
                  target={target}
                  selected={assignment.calledShot}
                  onPick={(cs) => onCalledShot(slot, cs)}
                />
              )}
            />

            <CombatLogPanel
              rows={resolved.rows}
              nameOf={nameOf}
              turnLabel={
                resolved.turn !== null ? `TURN ${String(resolved.turn)}` : 'NO COMBAT YET'
              }
            />
          </div>

          <CommitBar gate={gate} onCommit={onCommit} />
        </div>
      </div>
    </section>
  );
}

// ---- Page-scoped styles ---------------------------------------------------
//
// playtest-feedback-02 · S04. Page-local composition only — never a token
// redefinition, never a new palette, never `!important`. Mirrors
// TacticalMove's single scoped <style> tag so the design-token
// single-source (styles/tokens.css) stays intact. The fixed frame in
// components.css (`.app-shell` + `.app-main.is-fixed-frame`) supplies a
// bounded height; every rule here just fills it and hands scroll off to
// the two side/bench regions.

const TA_STYLES = `
  .ta-shell { display: flex; flex-direction: column; flex: 1 1 auto;
              height: 100%; min-height: 0;
              gap: var(--s3); padding: var(--s3); }
  .ta-shell-resolve { }
  /* Boot (view not yet populated): Viewport owns no inline min-height of its
     own (playtest-feedback-03 SESSION-01 CP2 — sizing is the hosting screen's
     call in every phase, not the component's). */
  .ta-shell-boot > .viewport { flex: 1 1 auto; min-height: 200px; }
  .ta-header { flex: none; }
  .ta-subhead { flex: none; }

  .ta-layout { display: grid;
               grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
               gap: var(--s3);
               flex: 1 1 auto; min-height: 0; }

  .ta-col-l { display: flex; flex-direction: column; gap: var(--s3);
              min-width: 0; min-height: 0; overflow: hidden; }
  .ta-roster-scroll { flex: 1 1 auto; min-height: 0;
                      overflow-y: auto; overflow-x: hidden;
                      background: var(--panel); border: 1px solid var(--line);
                      border-radius: var(--r); }
  .ta-col-l-ft { flex: none; letter-spacing: .14em; }

  /* playtest-feedback-04 SESSION-01 CP4 (D-ATK-ONE-SCROLL): the right column
     is now a fixed frame — Viewport pinned at the top, CommitBar pinned at
     the bottom, and a SINGLE inner scroll region (\`.ta-plan-scroll\`) for
     everything between. The pf-03 \`.ta-col-r { overflow-y: auto }\` safety net
     is gone: with the inner region owning scroll, the column-level safety
     was one of three stacked scrollbars the owner called a "nightmare". The
     bench-never-collapses guarantee (FB1 regression) is preserved by the
     inner wrapper's own \`min-height\` — the same floor, moved one level in. */
  .ta-col-r { display: flex; flex-direction: column; gap: var(--s3);
              min-width: 0; min-height: 0; overflow: hidden; }
  /* Viewport pins under the frame: grows to fill available height, shrinks
     down to a smaller-but-still-legible tactical minimum. */
  .ta-col-r > .viewport { flex: 1 1 320px; min-height: 200px; }
  /* Single primary scroll region for the plan-time surface — orientation
     hint + friendly-fire banner + weapon bench + combat log all live in this
     container. Only ONE scrollbar surfaces here even when the bench is long.
     Class name \`.ta-bench-scroll\` predates FB2 (it wrapped only the bench);
     kept as-is because an external layout test locks it — the DOM shape is
     the load-bearing thing here, not the class name (see the wrapper's own
     handoff note). */
  .ta-bench-scroll { display: flex; flex-direction: column; gap: var(--s3);
                     flex: 1 1 200px; min-height: 110px;
                     overflow-y: auto; overflow-x: hidden; }
  .ta-orientation { letter-spacing: .1em; }
  /* The commit action never shrinks or scrolls out of view — it is short,
     load-bearing, and must stay fully rendered at every viewport size. */
  .ta-col-r > .panel-ft { flex: none; }

  .ta-col-r-resolve { flex: 1 1 auto; min-height: 0; }
  .ta-col-r-resolve > .viewport { flex: 1 1 auto; min-height: 340px; }
  .ta-resolve-note { flex: none; }
  .ta-no-fire-note { flex: none; }

  /* playtest-feedback-05 SESSION-04 CP2 (FB3 · D-IMMERSIVE-GRID-COLLAPSE) —
     "full-field" immersive mode. The scoped block collapses the two-column
     grid to a single track and hides every plan-time affordance except the
     Viewport. Grid-collapse, NOT \`position: fixed\`: the shell stays inside
     the bounded \`.app-main.is-fixed-frame\`, so no browser Fullscreen API
     dependency (testable, no flake). Esc / the CameraHud toggle restore the
     grid. The header stays visible so the ATTACK PLAN / NO TIMER / BLIND
     COMMIT chrome remains legible while the field fills — the player never
     loses track of what phase they are in. */
  .ta-shell.is-immersive .ta-layout { grid-template-columns: 1fr; }
  .ta-shell.is-immersive .ta-col-l { display: none; }
  .ta-shell.is-immersive .ta-bench-scroll { display: none; }
  .ta-shell.is-immersive .ta-col-r > .panel-ft { display: none; }
`;

function TacticalAttackStyles() {
  return <style>{TA_STYLES}</style>;
}
