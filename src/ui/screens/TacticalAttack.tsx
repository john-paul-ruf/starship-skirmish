// M14 UI — Tactical Attack screen (S06 body over the S01 placeholder).
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

import { useSignal } from '@preact/signals';

import type { CalledShotTarget } from '../../sim/index.js';

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
  friendlyShips,
  shipViewOf,
  slotKey,
  toAttackPlans,
  type Assignment,
  type FireSlot,
} from './tacticalAttack/model.js';

export function TacticalAttack() {
  const match = useMatch();
  const app = useApp();
  const phase = match.phase.value;
  const state = match.state.value;
  const assignments = useSignal<ReadonlyMap<string, Assignment>>(new Map());

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
        />
        <div class="mono-xs c-dim">RESOLVING FIRE AGAINST A PRE-DAMAGE SNAPSHOT …</div>
      </div>
    );
  }

  // attack-plan.
  const view = match.view.value;
  const selfFleetId = match.playerFleetId;

  const onAssign = (slot: FireSlot, targetId: number | null) => {
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

  // Informational AoE ring for the first staged missile (no per-ship selection
  // state on this screen — the banner carries the authoritative geometry).
  let aoePreview: AoePreview | null = null;
  for (const a of staged) {
    if (a.missileIndex === undefined) continue;
    const shooter = shipViewOf(view, a.shooterId);
    const rack = shooter?.ship.missiles[a.missileIndex];
    if (shooter === undefined || rack === undefined) continue;
    aoePreview = { label: `${shooter.name} · M${String(a.missileIndex + 1)}`, radius: rack.aoeRadius };
    break;
  }

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

      <Viewport
        state={state}
        phase={phase}
        attackBeat={match.attackBeat.value}
        reducedMotion={app.reducedMotion.value}
        onResolveDone={() => match.resolveAnimationDone()}
        aoePreview={aoePreview}
      />

      <FriendlyFireBanner warnings={warnings} />

      <WeaponBench
        view={view}
        selfFleetId={selfFleetId}
        assignments={assignments.value}
        onAssign={onAssign}
        hitChanceFor={match.hitChanceFor}
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
  );
}
