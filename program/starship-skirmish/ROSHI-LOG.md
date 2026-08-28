# ROSHI-LOG — Starship Skirmish

> Roshi's own append-only history across cycles. One dated entry per run.
> `/program/` is `.gitignore`d at the repo root; this file is force-tracked
> (`git add -f`) alongside `arch/**` and `FORGE-CONFIG.md` so the record
> survives across working trees. `STATE.md` and `prompts/**` stay on-disk-only
> by convention.

---

## 2026-08-27 — Cycle 1 — `playtest-feedback-02`

**Envelope in:** Final Report at
`program/starship-skirmish/prompts/playtest-feedback-02/FINAL-REPORT.md`; 4/4
sessions `done` (S01–S04) in one wave; 12 Mu checkpoint commits (3/3/2/4); 2
Jikijitsu arch commits (`859da07` M13, `d828a48` M14); post-merge unit
1361/1361, lint clean, build green, entry chunk `three`-free; `test:e2e` not
run (no dev server in Mu sandbox); one pre-existing typecheck failure in
`tests/unit/ui/encyclopedia/export.test.ts` (TS6142, outside every lease).

### Reconciled this run

- **`arch/M13-render.md`** — `attachTrail` signature in the
  `skirmish-tactical-parity` SESSION-01 fragment was stale: it named only
  `windowSeconds`, but the current `src/render/trail.ts:125` accepts
  `{ windowSeconds?, pointSize? }`. The `pointSize` option arrived in the
  `playtest-feedback-02` SESSION-01 delta further down the same file (part of
  the `Line → additive Points` re-skin). Updated the older TypeScript sketch
  to include the current opt bag, with a one-line note that the primitive was
  re-skinned by the later delta (interface itself unchanged). Grounded in
  `src/render/trail.ts` and the two session fragments' consistent
  descriptions.
- **`arch/M11-trace.md`** — Added a **Known cross-module gaps** section
  documenting that `AttackBeatRecord.launchedMissileIds: readonly BodyId[]`
  carries no shooter/target correlation. This blocked the literal S02 ask
  ("missiles fly shooter→target during the attack beat") and forced an
  honest re-home to the movement beat. Sourced from `src/sim/trace/trace.ts:52`,
  the SESSION-02 handoff note (verbatim in `STATE.md`), and the Final Report
  follow-up. The suggested extension shape (`launched: readonly
  LaunchedMissile[]`) is copied verbatim from the S02 followUp and flagged as
  "for a future M11 lease, NOT a Roshi ask." Fixture hash-lock (FR-2 / Custom
  Rule 3) cited so the next lease inherits that constraint.

### Not reconciled — deliberately

- **`arch/M13-render.md` fragment structure** — kept per-session blocks
  intact. Fragments compose additively without contradicting each other; no
  duplication surfaced. A top-of-file synopsis of the current `index.ts`
  barrel was considered and declined this cycle (would be a bolt-on section
  Vow 2 discourages). Reconsider if a future cycle finds readers repeatedly
  compose deltas wrong.
- **Module Registry M13 "Key Files (planned)"** in `FORGE-CONFIG.md` — reads
  `TacticalView, wireframes, boundary, hazardAtlas, TracePlayer, pick,
  camera`; actual `src/render/` now also carries `scene, trail, ghost,
  hazards, interp, colorId, range, postfx, types, labels`. The `(planned)`
  hedge in the column header keeps the drift honest; not promoting a
  plan-time snapshot into an as-built list from a single cycle. Note it and
  revisit next cycle.
- **`FORGE-CONFIG.md` Conventions** — no additions. This is cycle 1; the "3
  cycles is signal" threshold is not met for anything.

### Registry updated

**No.** Deliberately holding per the "not reconciled" note above. If a next
cycle also shows readers acting on the stale planned-files list, promote to
as-built then.

### Conventions added to `FORGE-CONFIG.md`

**None** this cycle (Vow 4: repetition across ≥3 cycles is the threshold).

### Proposed for the framework — with cycle count

*(These go here, NOT into `FORGE.md`/`MU.md`/`ENSO.md`/`JIKIJITSU.md`. Roshi
recommends; a human folds them in by hand once the count justifies it. Vow
3.)*

- **[cycles: 1/3+] `MU.md` — sanctioned recipe for pre-existing-error
  triage.** 2/4 sessions this cycle (S01, S04) reached for the envelope-
  banned `git stash` specifically to answer "is this typecheck error mine?"
  Post-hoc `git` audit cleared both — no cross-lease write, no other
  session's committed work was swept — so this is envelope-discipline breach,
  not lease violation. The trap: the envelope bans stash but offers no
  sanctioned substitute for scoping verification to lease-owned paths under a
  shared tree. Suggest MU.md give an explicit safe recipe (e.g. `tsc --noEmit`
  against a lease-scoped tsconfig subset, or `git diff --stat -- <lease
  paths>` + a "trust: verify against YOUR files" precept). Two occurrences
  in one cycle is a strong signal within-cycle but only cycle 1 across the
  program. If cycle 2 sees it again, promote.
- **[cycles: 1/3+] `JIKIJITSU.md` and/or `FORGE-CONFIG.md` — verification-gate
  reachability.** S04 declared `test:e2e` as a required per-checkpoint gate;
  the Mu sandbox has no dev server, so the gate was structurally
  unreachable and every UI session logs a guaranteed miss. Options: (a)
  provision a dev-server hook in the Orchestration Envelope for e2e-gated
  sessions; (b) reclassify e2e as a post-merge CI/human gate, not a
  per-checkpoint Mu gate. Only observed once, but the failure mode is
  structural (not situational), so worth flagging early. Promote once a
  second UI-heavy feature confirms it repeats.
- **[cycles: 1/3+] Forge granularity — front sim-record extensions before
  their render consumer.** S02 could not deliver its literal ask because
  `AttackBeatRecord` lacks per-missile shooter/target data (see M11 gap doc
  added this cycle). When a render feature depends on a `sim/trace` record
  shape the record does not currently carry, Forge should either accept the
  scoped adaptation as the deliverable, or front a small M11 record-extension
  session **before** the render session so the render session's literal goal
  is reachable. First observation of this specific coupling.
- **[cycles: 1/3+] Owner hygiene — schedule a one-line fix for the
  encyclopedia typecheck baseline.** `tests/unit/ui/encyclopedia/export.test.ts:31`
  (TS6142; `BackupBanner.tsx` under a `tsconfig.node` graph with `--jsx`
  unset) has been red at HEAD across this cycle. It is the specific bait
  that triggered both stash incidents and makes every Mu's self-verification
  noisier than it needs to be. Not a framework change; a one-off owner/Forge
  scheduling note. If it survives another cycle, upgrade the recommendation.

### Verification (Roshi's output is prose)

1. Every claim in the rewritten M11 and M13 sections traces to `git log`
   (`d828a48`, `859da07`, and predecessors), current source
   (`src/render/trail.ts:125`, `src/sim/trace/trace.ts:52`), the S01/S02
   handoff notes verbatim in STATE.md, or the Final Report. Nothing
   invented.
2. Re-read after writing: no self-contradiction between the M13 trail
   signature update and the playtest-feedback-02 SESSION-01 delta directly
   below it (both now agree the opts include `pointSize`); no
   contradiction between the M11 "Known gap" section and the trace
   builders / types above it.
3. `FORGE.md`, `MU.md`, `ENSO.md`, `JIKIJITSU.md` — byte-identical, not
   touched.

---

## 2026-08-28 — Cycle 2 — `playtest-feedback-03`

**Envelope in:** Final Report at
`program/starship-skirmish/prompts/playtest-feedback-03/FINAL-REPORT.md`; 3/3
sessions `done` (S01–S03) across two waves (S01 ∥ S03, then S02); 10 Mu
checkpoint commits (S01 4/3 planned, S02 3+1 verify, S03 2/2); 2 Jikijitsu
arch commits (`756fdbd` M14 SESSION-03, `db346f8` M14 SESSION-02); post-merge
unit 1440/1440, lint clean, build green, app-side typecheck clean. `test:e2e`
partial (S01 9/9, S03 1/1 via render-stub; S02 killed at 120s — no dev
server); the same pre-existing encyclopedia `TS6142` from cycle 1 still red
at HEAD (outside every lease, from archived `shipyard-suite` SESSION-04).
Zero lease violations, zero checkpoint shortfalls, zero wave-plan
corrections.

### Reconciled this run

- **`arch/M14-ui.md`** — Session-tag disambiguation. Jikijitsu appended the
  two feature deltas as bare `<!-- SESSION-03 -->` and `<!-- SESSION-02 -->`
  markers, colliding with pre-existing same-numbered tags earlier in the
  file (line 12: `<!-- SESSION-02 -->` from `shipyard-suite`; line 113:
  `<!-- SESSION-03 -->` from `tactical-skirmish`). Reformatted to
  `<!-- SESSION-03 · playtest-feedback-03 · M14 shipyard delta -->` and
  `<!-- SESSION-02 · playtest-feedback-03 · M14 tactical-move delta -->`,
  matching the convention established by `playtest-feedback-01` SESSION-06
  and `playtest-feedback-02` SESSION-04 fragments earlier in the same file.
  Prose bodies below each tag unchanged — content already grounded in
  `STATE.md` handoffs, Final Report, and git (`756fdbd`, `db346f8`).

### Not reconciled — deliberately

- **`arch/M14-ui.md` per-session block structure** — kept per-session
  blocks intact for the same reason cycle 1 kept M13's structure: fragments
  compose additively, no contradiction surfaced, and a top-of-file synopsis
  would be a Vow-2-discouraged bolt-on. File is now 483 lines and readable
  in session-timeline order. If a future cycle finds readers repeatedly
  compose deltas wrong, reconsider then.
- **`arch/M13-render.md` `TrailLayer` opts** — already reconciled cycle 1;
  no new render work this cycle. Nothing to touch.
- **`arch/M11-trace.md` `AttackBeatRecord.launchedMissileIds` gap** —
  memorialised cycle 1; still an open note for a future M11 lease. This
  cycle did no sim/trace work. Nothing to touch.
- **Module Registry `M14` Key Files** — reads `screens/*, components/*,
  tokens.css`. New `catalogInfo.ts` lives at `src/ui/screens/shipyard/
  catalogInfo.ts` — inside the `screens/*` wildcard, no drift signal.
  Registry unchanged.
- **Module Registry `M13` "Key Files (planned)"** — the drift cycle 1
  flagged (`src/render/` carries more files than the registry lists) is
  now observed cycle 2 in a feature that added zero render files: the
  drift is stable, not growing. The `(planned)` hedge on the column
  header still reads honestly. Do not promote to as-built until a future
  cycle actively surfaces a reader misled by it — this is now cycle 2 of
  patient observation on that specific item.
- **`FORGE-CONFIG.md` Conventions** — no additions. The "3 cycles is
  signal" threshold (Vow 4) is not met for anything.

### Registry updated

**No.** No new module, no path scope change, no `catalog/**` edit, no
change to any `Owns` list this cycle.

### Conventions added to `FORGE-CONFIG.md`

**None** this cycle (Vow 4: repetition across ≥3 cycles is the threshold).

### Proposed for the framework — with cycle count

*(These go here, NOT into `FORGE.md`/`MU.md`/`ENSO.md`/`JIKIJITSU.md`. Roshi
recommends; a human folds them in by hand once the count justifies it. Vow
3.)*

- **[cycles: 2/3+] `JIKIJITSU.md` and/or `FORGE-CONFIG.md` —
  verification-gate reachability.** Cycle 1 flagged this: S04 declared
  `test:e2e` as a required per-checkpoint gate; the Mu sandbox had no dev
  server, so the gate was structurally unreachable. Cycle 2 repeats it:
  S02's `tacticalMove` e2e was killed at 120s ("no dev server available in
  this environment"), and the Final Report calls it out under Residual
  Gaps #1. Same structural failure, second consecutive cycle, in a feature
  set (in-match tactical UI) where e2e is the highest-value gate. Same two
  options as cycle 1: (a) provision a dev-server hook in the Orchestration
  Envelope for e2e-gated sessions; (b) reclassify e2e as a post-merge
  CI/human gate rather than a per-checkpoint Mu gate. One more cycle
  observing this and it clears the promote threshold.
- **[cycles: 2/3+] Owner hygiene — encyclopedia typecheck baseline.**
  Cycle 1 noted `tests/unit/ui/encyclopedia/export.test.ts:31` (TS6142;
  `BackupBanner.tsx` under a `tsconfig.node` graph with `--jsx` unset) was
  red at HEAD. Cycle 2 confirms it is still red — Final Report explicitly
  cites it under Residual Gaps #2 with the same TS6142, same file, same
  root cause. It is now the baseline noise every Mu has to independently
  triage. Two cycles of independent Mu triage of the same defect argues
  for either a small toolchain (M01) fix or an encyclopedia-test config
  fix — not framework, but scheduled owner work. If it survives cycle 3,
  upgrade from "hygiene note" to "priority Forge feature."
- **[cycles: 1/3+] Forge granularity — "stuck / can't proceed" playtest
  notes may hide latent bugs, not just discoverability gaps.** Cycle 2's
  new signal, from the Final Report's Granularity feedback: Forge framed
  FB1 as pure discoverability (`D-ATK-ORIENTATION`), but at the project's
  own documented 1280×720 minimum viewport the weapon bench computed to
  0px and the COMMIT FIRE button was clipped — the screen was literally
  unreachable, not merely undiscoverable. Mu correctly widened S01 and
  added a 4th checkpoint for the layout fix. Suggested `FORGE.md` /
  `FORGE-CONFIG.md` recommendation: when decomposing a playtest note that
  says "stuck / can't go back / can't proceed," budget one checkpoint (or
  a discrete "layout hardening at min-viewport" session) for the
  possibility of a real blocking bug alongside the discoverability fix.
  First observation of this specific decomposition trap — needs two more
  cycles to confirm it's a pattern, not a one-off.
- **[cycles: 1/3+ · receded from cycle 1] `MU.md` — sanctioned recipe for
  pre-existing-error triage.** Cycle 1 flagged that 2/4 Mu reached for the
  envelope-banned `git stash` to answer "is this typecheck error mine?"
  Cycle 2 shows zero stash incidents across S01/S02/S03 — Mu triaged the
  encyclopedia TS6142 by lease-scoped inspection alone. Not incremented
  this cycle; the note stays alive at 1/3+ so a future recurrence
  restarts the tally. If cycle 3 sees no stash reach either, retire the
  proposal.
- **[cycles: 1/3+ · held from cycle 1] Forge granularity — front sim-
  record extensions before their render consumer.** Cycle 2 had no
  sim/trace or render work, so the coupling could not recur. Not
  incremented; note held pending a future feature that touches
  `sim/trace` + `render` in the same wave.

### Verification (Roshi's output is prose)

1. Every claim traces to git or the attached record. The `<!-- SESSION-XX -->`
   tag collision is verifiable in `arch/M14-ui.md` at the four line numbers
   cited (12, 113, 379-old, 436-old). The two arch commits are
   `git log --oneline -- program/starship-skirmish/arch/M14-ui.md`. The
   "no dev server" and encyclopedia TS6142 claims are verbatim from
   Final Report Residual Gaps §1–§2 and STATE.md SESSION-02 handoff. The
   FB1 layout-bug root cause is verbatim from Final Report §Feedback items
   FB1 and Granularity feedback.
2. Re-read after writing: no contradiction between the two disambiguated
   session tags and their prose bodies below (bodies unchanged, tags now
   distinguish them from the `shipyard-suite` / `tactical-skirmish`
   fragments earlier in the file). ROSHI-LOG cycle 2 entry does not
   contradict cycle 1's notes — it explicitly increments or holds each
   prior proposal and cites which.
3. `FORGE.md`, `MU.md`, `ENSO.md`, `JIKIJITSU.md` — byte-identical, not
   touched.
