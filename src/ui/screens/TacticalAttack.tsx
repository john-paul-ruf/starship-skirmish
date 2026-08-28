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
  positionOf as positionOfInView,
  rangePreviewFor,
  shipViewOf,
  slotKey,
  toAttackPlans,
  type Assignment,
  type FireContextRole,
  type FireSlot,
} from './tacticalAttack/model.js';

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
    return <section class="panel" data-testid="screen-tactical-attack" />;
  }

  // attack-resolve: the outcome is already final — the viewport animates the
  // beat and, on done (or immediately under reduced motion), advances.
  if (phase === 'attack-resolve') {
    return (
      <div class="stack-lg" data-testid="screen-tactical-attack">
        <header class="panel-hd">
          <span class="t-h2 grow">ATTACK RESOLVE</span>
          <span class="chip chip-cyan">SNAPSHOT RESOLUTION</span>
        </header>
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
        <div class="mono-xs c-dim">RESOLVING FIRE AGAINST A PRE-DAMAGE SNAPSHOT …</div>
      </div>
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
      <section class="panel" data-testid="screen-tactical-attack">
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
  const rangePreview = rangePreviewFor(view, selectedSlot.value);

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

  return (
    <div class="stack-lg" data-testid="screen-tactical-attack">
      <header class="panel-hd">
        <span class="t-h2 grow">ATTACK PLAN</span>
        <span class="chip" title="Decision 7 — no clock exists anywhere in the turn loop">
          NO TIMER
        </span>
        <span class="chip chip-amber" data-testid="blind-commit-label">
          OPPONENT PLANS ARE NOT OBSERVABLE
        </span>
      </header>

      <div class="mono-xs c-dim">
        TARGETING FROM POST-MOVEMENT POSITIONS · FULL STATE FOR ALL FLEETS · NO FOG OF WAR.
      </div>

      <div
        class="ta-layout"
        style="display:grid;grid-template-columns:minmax(260px,320px) minmax(0,1fr);gap:var(--s3);align-items:start"
      >
        <div
          class="ta-col-l"
          data-testid="ta-col-l"
          style="display:flex;flex-direction:column;gap:var(--s3);min-height:0"
        >
          <FleetRoster
            groups={groups}
            selectedId={selectedId.value}
            onSelect={onSelect}
            annotate={annotate}
            aria-label="Attack roster — every fleet, no fog of war"
          />
          <ShipInspector ship={selected} velocity={selectedVelocity} />
          <div class="mono-xs c-dim" style="letter-spacing:.14em">
            {`FLEET: ${fleetLabel(selfFleetId)} · ALL FLEETS VISIBLE`}
          </div>
        </div>

        <div
          class="ta-col-r"
          style="display:flex;flex-direction:column;gap:var(--s3);min-width:0"
        >
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

          <CommitBar gate={gate} onCommit={onCommit} />
        </div>
      </div>
    </div>
  );
}
