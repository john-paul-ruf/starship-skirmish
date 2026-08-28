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
  liveLogRows,
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
    const resolveTurn = match.turn.value;
    const resolveRows = liveLogRows(match.trace.value, resolveTurn);
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
          />
          <div class="mono-xs c-dim ta-resolve-note">
            RESOLVING FIRE AGAINST A PRE-DAMAGE SNAPSHOT …
          </div>
          <CombatLogPanel
            rows={resolveRows}
            nameOf={resolveNameOf}
            turnLabel={`TURN ${String(resolveTurn)}`}
          />
          {resolveRows.length === 0 ? (
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

  // ---- Live combat log strip (playtest-feedback-02 · S04 CP4) -----------
  //
  // The current-turn rows, surfaced verbatim from the resolved trace via
  // `liveLogRows`. Blind-commit intact: `trace` accumulates only after a
  // beat resolves; opponent plans never appear. Names come from the
  // immutable initial rosters (matches the post-match combat log) so a
  // ship destroyed earlier in the match still reads by its authored name.
  const currentTurn = match.turn.value;
  const logRows = liveLogRows(match.trace.value, currentTurn);
  const names = nameByBodyId(match.initialFleets);
  const nameOf = (id: BodyId): string => names.get(id) ?? `BODY ${String(id)}`;

  return (
    <section class="ta-shell" data-testid="screen-tactical-attack">
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
          />

          <div class="mono-xs c-cyan ta-orientation" data-testid="fire-flow-hint">
            SELECT A WEAPON → PICK A TARGET → COMMIT FIRE · OR HOLD ALL AND COMMIT
          </div>

          <FriendlyFireBanner warnings={warnings} />

          <div class="ta-bench-scroll">
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
          </div>

          <CombatLogPanel
            rows={logRows}
            nameOf={nameOf}
            turnLabel={`TURN ${String(currentTurn)}`}
          />

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

  /* playtest-feedback-03 SESSION-01 CP2: \`overflow-y: auto\` (was \`hidden\`) is
     a deliberate safety net, not the primary layout — at the project's OWN
     minimum supported viewport (1280x720, FORGE-CONFIG) the fixed chrome
     above (topbar + header + subhead) plus the commit bar + combat log left
     the bench with a HARD ZERO height under \`overflow: hidden\`, making the
     entire weapon bench (and the tail of the commit bar) invisible and
     unreachable — the mechanical root of FB1 "stuck on this, can't go back".
     A column scrollbar only appears once every floor below is exhausted. */
  .ta-col-r { display: flex; flex-direction: column; gap: var(--s3);
              min-width: 0; min-height: 0; overflow-y: auto; overflow-x: hidden; }
  /* Viewport pins under the frame: grows to fill available height, shrinks
     down to a smaller-but-still-legible tactical minimum (was 340 — lowered
     so the bench below it keeps a guaranteed floor at the 720px minimum). */
  .ta-col-r > .viewport { flex: 1 1 320px; min-height: 200px; }
  .ta-orientation { flex: none; letter-spacing: .1em; }
  /* Bench (+ combat log, mounted in CP4) scrolls independently under the
     pinned viewport (mock \`.col-r .scrolly\`). \`min-height\` is the fix: never
     let the fire-assignment controls collapse to zero under a squeeze — a
     player can always scroll to reach every weapon row. */
  .ta-bench-scroll { flex: 1 1 200px; min-height: 110px;
                     overflow-y: auto; overflow-x: hidden; }
  /* The commit action never shrinks or gets clipped by the safety scrollbar
     above — it is short, load-bearing, and must stay fully rendered. */
  .ta-col-r > .panel-ft { flex: none; }

  .ta-col-r-resolve { flex: 1 1 auto; min-height: 0; }
  .ta-col-r-resolve > .viewport { flex: 1 1 auto; min-height: 340px; }
  .ta-resolve-note { flex: none; }
  .ta-no-fire-note { flex: none; }
`;

function TacticalAttackStyles() {
  return <style>{TA_STYLES}</style>;
}
