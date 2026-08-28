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

import type { BodyId, CalledShotTarget, Vec3 } from '../../sim/index.js';

import { FleetRoster, ShipInspector, fleetLabel, groupByFleet } from '../components/roster/index.js';
import type { RosterEntry } from '../components/roster/index.js';
import { FleetGlyph, FLEET_META } from '../components/index.js';
import type { FleetId } from '../components/index.js';
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
  activeShooterOf,
  aoeOverlapsFriendly,
  assignmentGate,
  fireContext,
  fireSolutionsFor,
  friendlyShips,
  lastResolvedLogRows,
  liveFireSlots,
  longestLiveWeaponRange,
  positionOf as positionOfInView,
  rangePreviewsFor,
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

/** Narrow a fleet id to the 0..4 `FleetId` the `FleetGlyph` badge accepts, or
 *  `null` for anything outside the five-fleet ceiling (Decision 2). */
const fleetIdOrNull = (id: number): FleetId | null =>
  id === 0 || id === 1 || id === 2 || id === 3 || id === 4 ? id : null;

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
  /** SESSION-03 (D-TA-RAIL-SHOOTER) — the active shooter whose live slots drive
   *  the right fire rail, distinct from `selectedId` (focus / inspection). Set
   *  only when the player selects a LIVING OWN-FLEET ship (roster or canvas);
   *  focusing an enemy leaves it untouched, so the rail keeps the last valid
   *  shooter. `activeShooterOf` validates it each render and falls back to the
   *  lowest-bodyId living player ship (default on entry, self-heal on death).
   *  Assignments are staged in the fleet-wide `assignments` map keyed by
   *  (shooter, slot), so switching shooters never discards another ship's plan. */
  const activeShooterId = useSignal<BodyId | null>(null);
  /** FB3 · D-IMMERSIVE-GRID-COLLAPSE — the "full-field" toggle. When true, the
   *  scoped `.ta-shell.is-immersive` block collapses `.ta-work` to a single
   *  column and hides the roster (`.ta-col-l`), the fire rail (`.ta-col-fire`),
   *  and the center-only combat log so the Viewport fills the bounded fixed
   *  frame. Grid-collapse only, NOT `position: fixed` (stays inside
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
  // beat and, on done (or immediately under reduced motion), advances. It
  // reuses the center column solo (`.ta-col-c.ta-col-c-solo`): the viewport
  // pins under the fixed frame and the CombatLogPanel follows the shots as
  // they resolve, without the plan-time roster / fire rail.
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
        <main class="ta-col-c ta-col-c-solo" data-testid="ta-col-c">
          <Viewport
            state={state}
            phase={phase}
            attackBeat={match.attackBeat.value}
            reducedMotion={app.reducedMotion.value}
            onResolveDone={() => match.resolveAnimationDone()}
            aoePreview={null}
            aoeFriendlies={[]}
            rangePreviews={[]}
            fireSolutions={[]}
            legendFleets={[]}
            turn={match.turn.value}
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
        </main>
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
          aoeFriendlies={[]}
          rangePreviews={[]}
          fireSolutions={[]}
          legendFleets={[]}
          turn={match.turn.value}
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

  // Selecting a LIVING own-fleet ship promotes it to the active shooter (the
  // rail follows); focusing an enemy or a wreck only moves inspection/focus and
  // leaves the last valid shooter in the rail (D-TA-RAIL-SHOOTER).
  const setActiveIfFriendly = (bodyId: BodyId) => {
    const ship = shipViewOf(view, bodyId);
    if (ship !== undefined && ship.fleetId === selfFleetId && ship.hull > 0) {
      activeShooterId.value = bodyId;
    }
  };

  const onSelect = (bodyId: BodyId) => {
    selectedId.value = bodyId;
    setActiveIfFriendly(bodyId);
  };

  const shooters = friendlyShips(view, selfFleetId);
  const staged = [...assignments.value.values()];
  const gate = assignmentGate(staged, shooters);

  // The one shooter the right rail renders (D-TA-RAIL-SHOOTER). The header
  // reads its identity + live/assigned slot counts; the fleet-wide `gate` (all
  // player ships) still drives the commit total.
  const activeShooter = activeShooterOf(shooters, activeShooterId.value);
  const activeFleetId = activeShooter !== null ? fleetIdOrNull(activeShooter.fleetId) : null;
  const activeSlots = activeShooter !== null ? liveFireSlots(activeShooter) : [];
  const activeAssigned =
    activeShooter !== null
      ? staged.filter((a) => a.shooterId === activeShooter.bodyId).length
      : 0;

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
  // null), plus the world positions of any friendlies inside that blast (the
  // overlay draws `⚠ FRIENDLY IN AoE` on each). The banner carries the
  // authoritative geometry — this ring never gates commit and never contradicts
  // `aoeOverlapsFriendly`.
  let aoePreview: AoePreview | null = null;
  let aoeFriendlies: Vec3[] = [];
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
    const overlap = aoeOverlapsFriendly(a, view);
    if (overlap !== null) {
      aoeFriendlies = overlap.hits
        .map((h) => positionOfInView(view, h.friendly.bodyId))
        .filter((p): p is Vec3 => p !== undefined);
    }
    break;
  }

  // D-TA-WIRE-RANGE — every live weapon envelope of the ACTIVE SHOOTER (the ship
  // whose rail is open). The viewport draws one wire ring per envelope; the
  // overlay labels each with the authored weapon name + radius and brightens the
  // slot the player is interacting with. No to-hit number here (arch §13.3).
  const rangePreviews = rangePreviewsFor(
    view,
    activeShooter !== null ? activeShooter.bodyId : null,
    selectedSlot.value,
  );

  // D-TA-LIVE-OVERLAYS — the player's staged firing solutions (blind commit:
  // only the local assignments are ever inspected). Weapon percentages come
  // straight from the controller's `hitChanceFor`; the overlay never recomputes.
  const fireSolutions = fireSolutionsFor(view, staged, match.hitChanceFor);

  // Living-ship counts per fleet — the field legend's dynamic rows.
  const legendFleets = (() => {
    const counts = new Map<number, number>();
    for (const s of view.ships) {
      if (s.hull > 0) counts.set(s.fleetId, (counts.get(s.fleetId) ?? 0) + 1);
    }
    return [...counts.keys()]
      .sort((a, b) => a - b)
      .map((fleetId) => {
        const fid = fleetIdOrNull(fleetId);
        return {
          fleetId,
          glyph: fid !== null ? FLEET_META[fid].glyph : '◆',
          label: fleetLabel(fleetId),
          count: counts.get(fleetId) ?? 0,
        };
      });
  })();

  // Left-column engagement readout follows the SELECTED ship (inspection),
  // which may differ from the active shooter (D-TA-RAIL-SHOOTER).
  const selectedRange = longestLiveWeaponRange(view, selectedId.value);

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

      {/*
       * SESSION-03 (tactical-attack-mock-parity) — the literal three-column
       * frame from mocks/tactical-attack.html:18-22: a 288px all-fleet roster
       * (left), a fluid tactical stage carrying the center-only combat log
       * (center), and a 344px fire-assignment rail (right). No page-wide plan
       * header or bottom pane: the match phase / turn chrome lives in the
       * persistent MatchChrome above and (CP3) in the viewport HUD, so the
       * columns fill the fixed frame edge-to-edge exactly as the mock does.
       */}
      <div class="ta-work" data-testid="ta-work">
        <aside class="ta-col-l" data-testid="ta-col-l">
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
            {selectedRange !== null
              ? `ENGAGEMENT RANGE ${String(Math.round(selectedRange))}u`
              : selected !== null
                ? 'NO LIVE WEAPON RANGE'
                : 'SELECT A SHIP TO SEE ITS RANGE'}
          </div>
          <div class="mono-xs c-dim ta-col-l-ft">
            {`FLEET: ${fleetLabel(selfFleetId)} · ALL FLEETS VISIBLE`}
          </div>
        </aside>

        <main class="ta-col-c" data-testid="ta-col-c">
          <Viewport
            state={state}
            phase={phase}
            attackBeat={match.attackBeat.value}
            reducedMotion={app.reducedMotion.value}
            onResolveDone={() => match.resolveAnimationDone()}
            aoePreview={aoePreview}
            aoeFriendlies={aoeFriendlies}
            rangePreviews={rangePreviews}
            fireSolutions={fireSolutions}
            legendFleets={legendFleets}
            turn={view.turn}
            selectedId={selectedId.value}
            positionOf={positionForFocus}
            onPickBody={(id) => {
              if (id !== null) {
                selectedId.value = id;
                setActiveIfFriendly(id);
              }
            }}
            focusLabel={focusLabel}
            fullscreen={fullscreen.value}
            onToggleFullscreen={onToggleFullscreen}
          />

          <CombatLogPanel
            rows={resolved.rows}
            nameOf={nameOf}
            turnLabel={
              resolved.turn !== null ? `TURN ${String(resolved.turn)}` : 'NO COMBAT YET'
            }
          />
        </main>

        <aside class="ta-col-fire" data-testid="ta-col-fire" aria-label="Fire assignment">
          {/* The active-shooter identity header (mocks/tactical-attack.html:
              544-554): fleet glyph + build name, chassis name · class · live
              fire-slot count, the assigned/total chip for THIS shooter, and the
              post-movement targeting note. Fleet-wide commit lives in the
              footer. */}
          <header class="ta-fire-hd">
            {activeShooter !== null ? (
              <>
                <div class="ta-fire-id">
                  {activeFleetId !== null ? <FleetGlyph fleetId={activeFleetId} /> : null}
                  <div class="grow" style="min-width:0">
                    <div
                      class="t-h2 truncate ta-fire-name"
                      data-testid="fire-shooter-name"
                    >
                      {activeShooter.name}
                    </div>
                    <div class="mono-xs c-dim ta-fire-sub">
                      {`${activeShooter.ship.chassis?.name ?? activeShooter.chassisClass.toUpperCase()} · ${activeShooter.chassisClass.replace('-', ' ').toUpperCase()} · ${String(activeSlots.length)} FIRE SLOTS`}
                    </div>
                  </div>
                  <span
                    class={`chip${activeAssigned === activeSlots.length && activeSlots.length > 0 ? ' chip-cyan' : ''}`}
                    data-testid="fire-shooter-count"
                  >
                    {`${String(activeAssigned)} / ${String(activeSlots.length)}`}
                  </span>
                </div>
                <div class="mono-xs c-dim ta-fire-targeting">
                  TARGETING FROM POST-MOVEMENT POSITIONS.
                </div>
              </>
            ) : (
              <div class="mono-xs c-dim">NO SHIPS LEFT TO FIRE.</div>
            )}
          </header>

          <div class="ta-fire-scroll" data-testid="ta-fire-scroll">
            <FriendlyFireBanner warnings={warnings} />

            <WeaponBench
              view={view}
              selfFleetId={selfFleetId}
              shooter={activeShooter}
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

          <CommitBar gate={gate} onCommit={onCommit} />
        </aside>
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
              height: 100%; min-height: 0; }
  .ta-shell-resolve { }
  /* Boot (view not yet populated): Viewport owns no inline min-height of its
     own — sizing is the hosting screen's call in every phase. */
  .ta-shell-boot { padding: var(--s3); }
  .ta-shell-boot > .viewport { flex: 1 1 auto; min-height: 200px; }

  /* Resolve header — the only full-width strip, and only in attack-resolve.
     attack-plan carries no page header: MatchChrome (turn / seed / concede)
     and the viewport HUD (CP3) own the phase chrome, so the columns fill the
     fixed frame edge-to-edge exactly as the mock's headerless work area does. */
  .ta-header { flex: none; }

  /* ---- The literal three-column frame (mocks/tactical-attack.html:18-22) ----
     A single grid: 288px roster · fluid stage · 344px fire rail. The rails are
     bounded (never below 260 / 320, never past 288 / 344); the center absorbs
     the remainder; every level carries min-width/min-height:0 so the inner
     scroll regions — never the page — own overflow. The three tracks stay
     side-by-side at every supported desktop width (≥1280): the fire rail is
     NEVER stacked beneath the center (D-TA-THREE-COLUMN / D-TA-NO-BOTTOM-PLAN). */
  .ta-work { display: grid;
             grid-template-columns:
               minmax(260px, 288px) minmax(0, 1fr) minmax(320px, 344px);
             flex: 1 1 auto; min-width: 0; min-height: 0; }

  /* LEFT — all-fleet roster (scrolls internally) + inspector + range readout. */
  .ta-col-l { display: flex; flex-direction: column; gap: var(--s3);
              min-width: 0; min-height: 0; overflow: hidden;
              padding: var(--s3);
              border-right: 1px solid var(--line); background: var(--panel); }
  .ta-roster-scroll { flex: 1 1 auto; min-height: 0;
                      overflow-y: auto; overflow-x: hidden;
                      background: var(--panel); border: 1px solid var(--line);
                      border-radius: var(--r); }
  .ta-range-readout { flex: none; letter-spacing: .06em; }
  .ta-col-l-ft { flex: none; letter-spacing: .14em; }

  /* CENTER — the tactical stage: the viewport grows and the combat log is a
     fixed, center-only strip matching the mock's ~168px footprint (FR-21). No
     weapon bench or commit control ever lives here (D-TA-NO-BOTTOM-PLAN). */
  .ta-col-c { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .ta-col-c > .viewport { flex: 1 1 auto; min-height: 200px; }
  /* The combat log (CombatLogPanel renders \`.panel\`) is contained, never
     grows into a page-bottom pane; its own body caps scroll at ~132px so the
     strip holds the mock's ~168px total height. */
  .ta-col-c > .panel { flex: none; }
  /* Resolve reuses the center column solo (no side rails) with its own
     breathing room and a taller viewport floor. */
  .ta-col-c-solo { flex: 1 1 auto; gap: var(--s3); padding: var(--s3); }
  .ta-col-c-solo > .viewport { min-height: 340px; }
  .ta-resolve-note { flex: none; }
  .ta-no-fire-note { flex: none; }

  /* RIGHT — fire-assignment rail: fixed header + exactly ONE overflow-y:auto
     assignment body + fixed commit footer. The commit button width follows
     this 344px rail, never the center or the page (D-TA-NO-BOTTOM-PLAN). */
  .ta-col-fire { display: flex; flex-direction: column;
                 min-width: 0; min-height: 0; overflow: hidden;
                 border-left: 1px solid var(--line); background: var(--panel); }
  .ta-fire-hd { flex: none; padding: var(--s2) var(--s3);
                border-bottom: 1px solid var(--line);
                background: linear-gradient(180deg, rgba(34,227,255,.06), transparent);
                display: flex; flex-direction: column; gap: 6px; }
  .ta-fire-id { display: flex; align-items: center; gap: var(--s2); }
  .ta-fire-name { font-size: 13px; }
  .ta-fire-sub { letter-spacing: .06em; }
  .ta-fire-targeting { letter-spacing: .14em; }
  .ta-fire-scroll { flex: 1 1 auto; min-height: 120px;
                    overflow-y: auto; overflow-x: hidden;
                    display: flex; flex-direction: column; gap: var(--s3);
                    padding: var(--s3); }
  /* The commit action is a pinned, non-stretching footer — never a page-wide
     bottom bar (FB2 "no bottom panel"). Direct-child selector so it wins over
     any inherited flex grow / shrink. */
  .ta-col-fire > .panel-ft { flex: none; }

  /* Fire-card treatment (mocks/tactical-attack.html:560-712). Every rule is
     scoped inside TA_STYLES so no shared stylesheet edit touches other screens;
     class names namespace-prefix with \`ta-\` to avoid collisions. The mock's
     \`.acard\` treatment lives here as \`.ta-card\` with a colour-coded left
     border driven by state modifiers (\`is-set\` cyan for assigned, \`is-msl\`
     red for missile racks, \`is-oor\` dashed red for out-of-range). Hit chance
     renders both the % text (\`.ta-hit-num\`) and a Meter bar (\`.ta-hit-meter\`)
     — the two agree because \`hitChanceBarFill\` mirrors \`hitChanceTone\`
     thresholds exactly. No to-hit math lives in the CSS. */
  .ta-ship-empty { margin-top: 6px; }
  .ta-ship-cards { display: flex; flex-direction: column; gap: var(--s2); }

  .ta-card { border: 1px solid var(--line);
             border-left: 2px solid var(--line-hot);
             border-radius: var(--r);
             padding: var(--s2) var(--s3);
             background: var(--panel); }
  .ta-card.is-msl { border-left-color: var(--red); }
  .ta-card.is-set { border-left-color: var(--cyan); }
  .ta-card.is-oor { border-left-color: var(--red); border-style: dashed; }
  .ta-card-hd { display: flex; align-items: center; gap: var(--s2); }
  .ta-card-name { font-weight: 700; color: var(--ink-hi); letter-spacing: .06em; }
  .ta-card-slot { margin: 3px 0 6px; letter-spacing: .06em; }
  .ta-card-hint { margin-top: 5px; }

  .ta-hit { margin-top: 8px; }
  .ta-hit-hd { display: flex; align-items: baseline;
               justify-content: space-between; }
  .ta-hit-num { font-size: 20px; font-weight: 700; line-height: 1; }
  .ta-hit-num-oor { font-size: 14px; font-weight: 700; letter-spacing: .08em; }
  .ta-hit-meter { margin-top: 5px; }
  .ta-hit-factors { margin-top: 6px; line-height: 1.7; }
  .ta-hit-range { margin-top: 5px; }
  .ta-hit-hint { margin-top: 5px; }

  /* FB3 · D-IMMERSIVE-GRID-COLLAPSE — "full-field" immersive mode. The scoped
     block collapses the three-column grid to a single track and hides every
     plan-time affordance except the Viewport: the left roster, the right fire
     rail, and the center-only combat log all drop out so the tactical stage
     fills the vacated space. Grid-collapse, NOT \`position: fixed\`: the shell
     stays inside the bounded \`.app-main.is-fixed-frame\` (testable, no browser
     Fullscreen API flake). Esc / the CameraHud toggle restore the grid. */
  .ta-shell.is-immersive .ta-work { grid-template-columns: 1fr; }
  .ta-shell.is-immersive .ta-col-l { display: none; }
  .ta-shell.is-immersive .ta-col-fire { display: none; }
  .ta-shell.is-immersive .ta-col-c > .panel { display: none; }
`;

function TacticalAttackStyles() {
  return <style>{TA_STYLES}</style>;
}
