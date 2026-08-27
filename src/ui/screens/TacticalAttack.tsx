// M14 UI — Tactical Attack screen (S06 body over the S01 placeholder).
//
// D-PLACEHOLDER: the `TacticalAttack` export name + `data-testid=
// "screen-tactical-attack"` root are contracted by S01 — the screens barrel and
// `App.tsx` outlet import them and MUST NOT be re-edited. This file only replaces
// the body. CONCEDE is not here; it lives in the shell match-chrome (S01).
//
// The blind fire-assignment screen (FR-17/FR-20). The player assigns each live
// weapon / missile to a post-movement target, reads the honest hit-chance
// breakdown (via `hitChanceFor` — never recomputed, arch §13.3), and commits
// blind: opponent fire is not observable and there is no timer. COMMIT resolves
// the attack beat → animate → next movement turn or post-match.

import { useSignal } from '@preact/signals';

import { useMatch } from '../matchContext.js';

import type { CalledShotTarget } from '../../sim/index.js';

import { CalledShotPicker } from './tacticalAttack/CalledShotPicker.js';
import { WeaponBench } from './tacticalAttack/WeaponBench.js';
import {
  assignmentGate,
  friendlyShips,
  slotKey,
  type Assignment,
  type FireSlot,
} from './tacticalAttack/model.js';

export function TacticalAttack() {
  const match = useMatch();
  const view = match.view.value;
  const phase = match.phase.value;
  const assignments = useSignal<ReadonlyMap<string, Assignment>>(new Map());

  // The screen is only meaningful in the two attack phases with a live view.
  // Any other phase (or a null view mid-resolve) renders a stable, empty root so
  // the testid never disappears — the controller drives the route.
  if (view === null || (phase !== 'attack-plan' && phase !== 'attack-resolve')) {
    return <section class="panel" data-testid="screen-tactical-attack" />;
  }

  const selfFleetId = match.playerFleetId;
  const shooters = friendlyShips(view, selfFleetId);
  const gate = assignmentGate([...assignments.value.values()], shooters);

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

      <div class="mono-xs" data-testid="assign-count">
        {`COMMIT FIRE · ${String(gate.assigned)}/${String(gate.total)} ASSIGNED`}
      </div>
    </div>
  );
}
