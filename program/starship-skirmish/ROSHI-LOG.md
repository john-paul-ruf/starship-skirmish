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

---

## 2026-08-28 — Cycle 3 — `playtest-feedback-04`

**Envelope in:** Final Report at
`program/starship-skirmish/prompts/playtest-feedback-04/FINAL-REPORT.md`; 3/3
sessions `done` (S01–S03) across two waves (S01 ∥ S03, then S02 rolling into
S01's freed slot alongside S03); 9 Mu checkpoint commits (S01 4/4, S02 2/2,
S03 3/3); 1 Jikijitsu arch commit (`89427c3`, `arch/M14-ui.md` with a
mid-run marker Jikijitsu explicitly flagged for Roshi to redistribute);
post-merge unit **1457 pass / 1 fail** — the fail is the feature-caused
`tests/unit/ui/inMatchLayout.test.ts:186-188` regex-lock on the OLD
`liveLogRows` literal, which is outside every session's `Owns`; app-side
typecheck clean, lint clean, build clean, e2e S01 11/11 + S02 new spec
pass (3 pre-existing chromium "Set to Coast" timeouts reproduced on
baseline). Same pre-existing encyclopedia `TS6142` (`tsconfig.node.json` +
`--jsx`) still red at HEAD — now cycle 3 of independent observation.
Zero lease violations, zero checkpoint shortfalls, zero wave-plan
corrections.

### Reconciled this run

- **`arch/M14-ui.md`** — The SESSION-01 · playtest-feedback-04 fragment
  that Jikijitsu appended mid-run was a mixed-module delta: `## M14 — UI ·
  tactical-attack model` and `## M16 — App · match controller` under one
  M14 marker, with the marker itself flagging
  `(incl. M16 hitChanceFor note — Roshi to redistribute)`. Split per
  Jikijitsu's ask: the M14 selectors (`weaponOutOfRange` +
  `lastResolvedLogRows`) stay in `arch/M14-ui.md` under a clean
  `SESSION-01 · playtest-feedback-04 · M14 tactical-attack delta` marker;
  the M16 `hitChanceFor` gate note moves to `arch/M16-app.md` under its own
  `SESSION-01 · playtest-feedback-04 · M16 controller · hitChanceFor
  out-of-range gate` marker. Prose grounded in `89427c3`, the S01 handoff
  in `STATE.md`, and Final Report §Architecture impact — content unchanged
  by the move; only the file boundary is corrected. Added a
  cross-reference in each direction so a reader hitting one finds the other
  without hunting.
- **`arch/M14-ui.md`** — Added a `lastResolvedLogRows` "**Supersedes**"
  note pointing back to the `liveLogRows` selector introduced by
  playtest-feedback-02 · SESSION-04 earlier in the same file. Two selectors
  now live in the file with overlapping intent; the new one supersedes the
  old, and Mu handoffs confirm the old is dead in `src/**` but still test-
  referenced — reader now sees which is current without re-deriving from
  the two fragments' bodies.
- **`arch/M14-ui.md`** — Added a **D-INFOTIP-TOPLAYER** reconciliation
  note under the SESSION-01 · playtest-feedback-04 M14 fragment. The Final
  Report explicitly waived a full arch fragment for the S03 InfoTip fix
  ("`InfoTip` public API unchanged; no arch fragment needed"), and I
  honoured that. But the SESSION-06 · playtest-feedback-01 InfoTip fragment
  earlier in the same file describes §19 CSS as "additive-only, no existing
  rule is edited" — true at S06 landing, no longer true now that S03
  materially edited `.tip` / `.tip-dot` / `.tip-pop` (position: fixed +
  CSS anchor positioning). A reader today would trip on that. Grounded the
  reconciliation in current source at
  `src/ui/styles/components.css:990-1046` and commits `65dddc6`,
  `3146a95`, `bbb84eb`. No new design decision invented; captured only
  what S03 already committed under the D-INFOTIP-TOPLAYER name in its
  handoff.

### Not reconciled — deliberately

- **`arch/M14-ui.md` — SESSION-06 · playtest-feedback-01 fragment body**
  itself is NOT rewritten. Its "additive-only, no existing rule is edited"
  claim was accurate at its landing; retroactively editing it would rewrite
  history worse than the drift it fixed. The forward-pointing
  D-INFOTIP-TOPLAYER note in the new SESSION-01 · playtest-feedback-04
  fragment is the right resolution — records both the S06 state and its
  S03 supersession without falsifying either.
- **`arch/M14-ui.md` per-session block structure** — kept intact for the
  fourth consecutive cycle. Fragments still compose additively; no
  contradiction across bodies (only the one just resolved via forward
  pointer). File is now ~570 lines and remains readable in session-timeline
  order. A top-of-file synopsis stays a Vow-2 bolt-on candidate; revisit if
  a future cycle finds readers repeatedly compose deltas wrong.
- **Module Registry `M14` Key Files** — still reads `screens/*,
  components/*, tokens.css`. This feature added no new files (all edits
  landed in existing paths). No registry drift signal this cycle.
- **Module Registry `M13` "Key Files (planned)"** — the drift cycle 1
  flagged and cycle 2 held on is now cycle 3 of stable-not-growing. This
  feature did no `render/` work, so the drift did not recur; the `(planned)`
  hedge still reads honestly. Not promoting from a plan-time snapshot to an
  as-built list on the strength of no active reader mis-step.
- **`FORGE-CONFIG.md` Conventions / Custom Rules** — no additions. The
  "3 cycles is signal" threshold (Vow 4) is not met for anything that would
  be shaped as a convention. The one 3/3 item this cycle (encyclopedia
  typecheck baseline) is owner scheduling, not a convention or custom rule,
  and belongs escalated in the log rather than folded into `FORGE-CONFIG.md`.

### Registry updated

**No.** No new module, no path scope change, no `catalog/**` edit, no
change to any `Owns` list this cycle.

### Conventions added to `FORGE-CONFIG.md`

**None** this cycle (Vow 4: repetition across ≥3 cycles is the threshold).

### Proposed for the framework — with cycle count

*(These go here, NOT into `FORGE.md`/`MU.md`/`ENSO.md`/`JIKIJITSU.md`. Roshi
recommends; a human folds them in by hand once the count justifies it. Vow
3.)*

- **[cycles: 3/3+ — CROSSES PROMOTE THRESHOLD] Owner hygiene —
  encyclopedia typecheck baseline.** Cycle 1 noted
  `tests/unit/ui/encyclopedia/export.test.ts:31` (TS6142; `BackupBanner.tsx`
  imported under a `tsconfig.node` graph with `--jsx` unset) was red at
  HEAD. Cycle 2 confirmed. Cycle 3 confirms again — S01 and S03 both
  independently triaged it under Surprises before writing a line, S02's
  Mu inherited the same red baseline. **Three cycles of independent Mu
  triage of the same one-line-fix defect argues for scheduling.** This is
  NOT framework-shaped (not a convention, not a custom rule), so it is not
  folded into `FORGE-CONFIG.md`. Recommendation to the owner / Forge: land
  a micro-feature that adds `"jsx": "preserve"` to `tsconfig.node.json` (or
  narrows its `include` to exclude `.tsx`-importing test files), give it a
  single-checkpoint session under M01, and stop paying the triage tax on
  every future Mu. The Final Report already lists this as follow-up #2
  ("[pre-existing, blocks green typecheck] 1-line M01 fix").
- **[cycles: 2/3+] Shared/unowned test files that lock literal
  cross-screen source strings.** Cycle 2 flagged the near-miss:
  `tests/unit/ui/inMatchLayout.test.ts` regex-locked `.ta-bench-scroll` in
  `TacticalAttack.tsx`; playtest-feedback-03 · S01 dodged it via a legacy-
  alias trick. Cycle 3 turned it into a full burn: the same test file
  regex-locks the OLD `liveLogRows` literal in `TacticalMove.tsx`;
  playtest-feedback-04 · S02's mandated swap to `lastResolvedLogRows` had
  no equivalent legacy-alias escape, so `npm run test:unit` shipped 1-red
  with no session empowered to fix it (file is in NEITHER S01's nor S02's
  `Owns`). This is a lease-granularity gap, not a Mu error — Final Report
  §Granularity feedback frames it identically. Suggested framework
  addition (Forge, once at 3/3+): `FORGE-CONFIG.md` Convention along the
  lines of "when a test file asserts literal source strings that only two
  or more session-owned files can produce, that test file MUST be added
  to the `Owns` of the session most likely to change what it asserts —
  or, better, the assertion refactored to observe rendered output not
  source text." Alternative: teach Forge decomposition to auto-scan
  candidate `Owns` for regex/string locks touching files that will be
  edited, and either widen the lease or split the test file. Two cycles
  now; one more instance flips it to promote.
- **[cycles: 2/3+ · RECEDED — likely resolved by prior toolchain work]
  Verification-gate reachability (`test:e2e` no-dev-server).** Cycles 1–2
  observed `test:e2e` structurally unreachable in the Mu sandbox. Cycle 3
  shows e2e RAN — S01 11/11 (2 new pass), S02 new spec pass, S03 no e2e —
  because `playwright.config.ts` now carries the `webServer` block that
  `arch/M16-app.md` SESSION-03 (finite-thrust-movement, cycle earlier)
  documents. What broke twice appears fixed by that infra landing. Not
  incremented this cycle; noting as **receded** rather than "held" because
  a concrete fix landed and observable behaviour matches it. If cycle 4
  sees another sandbox-e2e failure, restart the tally at 1/3+.
- **[cycles: 1/3+ · held] Forge granularity — "stuck / can't proceed"
  playtest notes may hide latent bugs.** Cycle 2 introduced this. Cycle 3
  had no "stuck / can't proceed" flavoured feedback — the four items were
  discoverability (FB1 lie), UX pain (FB2 scrollbars), missing surface
  (FB3 log), and visual clip (FB4 tooltip). Pattern did not recur; held at
  1/3+.
- **[cycles: 1/3+ · held] Sim-record extensions before their render
  consumer.** Cycle 3 did no `sim/trace` or `render` work in one wave;
  coupling could not recur. Held.
- **[RETIRED · was 1/3+] `MU.md` — sanctioned recipe for pre-existing-
  error triage.** Cycle 1 flagged Mu stash use to triage pre-existing
  typecheck errors. Cycles 2 AND 3 show zero stash use — Mu now triages
  the encyclopedia TS6142 by lease-scoped inspection and Surprises
  reporting alone (S01, S03 handoffs both demonstrate the pattern). Two
  cycles without a recurrence retires the proposal; if it ever returns,
  restart at 1/3+.

### Verification (Roshi's output is prose)

1. Every claim traces to git or the attached record. The mixed-module
   fragment claim is verifiable at `89427c3` (`git log -1 --stat --
   program/starship-skirmish/arch/M14-ui.md`) and the marker text itself.
   The InfoTip supersession claim traces to
   `src/ui/styles/components.css:990-1046` (current) and commits
   `65dddc6` / `3146a95` / `bbb84eb`. The "1457 pass / 1 fail" number is
   verbatim from Final Report §Verification. The 3-cycle encyclopedia
   TS6142 baseline is cycle 1 ROSHI-LOG "Owner hygiene" bullet, cycle 2
   same bullet, cycle 3 S01 + S03 Surprises + Final Report Residual gap.
2. Re-read after writing: the two new `arch/M14-ui.md` reconciliations
   (M16 subsection removal + D-INFOTIP-TOPLAYER note) do not contradict
   each other or anything above them in the same file — the
   D-INFOTIP-TOPLAYER note points forward from the SESSION-06 fragment
   without amending it; the `weaponOutOfRange` fragment paired with the
   `hitChanceFor` note in `arch/M16-app.md` reads consistently across the
   two files via reciprocal cross-references.
3. `FORGE.md`, `MU.md`, `ENSO.md`, `JIKIJITSU.md` — byte-identical, not
   touched.

---

## 2026-08-28 — Cycle 4 — `playtest-feedback-05`

**Envelope in:** Final Report at
`program/starship-skirmish/prompts/playtest-feedback-05/FINAL-REPORT.md`;
4/4 sessions `done` (S01–S04) across two rolling waves (S01 ∥ S02, then
S03 ∥ S04 overlapping S02); 14 Mu checkpoint commits (S01 2/2, S02 4/4,
S03 4/4, S04 4/4); 1 Jikijitsu arch commit (`e302d93`,
`arch/M13-render.md` — the S02 `explosionFx` fragment). Post-merge unit
**1526 pass / 0 fail** — S01 cleared the pf-04 RED
`inMatchLayout.test.ts` `liveLogRows` line by exactly the mechanism the
cycle-3 ROSHI-LOG framework proposal recommended. App-side typecheck
clean, lint clean, build clean; Move CP4 velocity-readout e2e passed
(the 3 pre-existing "Set to Coast" chromium timeouts reproduced on
baseline, unchanged); Attack e2e authored but deferred (no dev server
in that worker); Render e2e deferred (blast behaviour covered in unit
tests). Same pre-existing encyclopedia `TS6142`
(`tsconfig.node.json` + `--jsx`) still red at HEAD — now cycle 4 of
independent observation. Zero lease violations, zero checkpoint
shortfalls, zero wave-plan corrections.

### Reconciled this run

- **`arch/M14-ui.md`** — pf-02 SESSION-04 fragment carried a load-bearing
  list of scoped classes that included `.ta-bench-scroll`. Cycle 4
  SESSION-04 CP4 renamed that class to `.ta-plan-scroll` in-lease.
  Added a forward-pointing **Superseded** note under that class list;
  did NOT edit the original fragment body (same cycle-3 discipline
  applied to the InfoTip §19 CSS reconciliation — retroactively
  editing a fragment that was true at its landing rewrites history
  worse than the drift it fixes). Grounded in
  `src/ui/screens/TacticalAttack.tsx:430,527,594` and commit
  `76dbddd`.
- **`arch/M14-ui.md`** — pf-04 SESSION-01 fragment's `lastResolvedLogRows`
  "Supersedes" note said `liveLogRows` was "still referenced by two
  test files" and "A prune is a follow-up lease, not landed here." That
  follow-up lease landed this cycle (pf-05 SESSION-04 CP4 pruned the
  selector + its 5-test block; pf-05 SESSION-01 resolved the
  cross-screen `inMatchLayout.test.ts` reference by exactly the
  D-LAYOUT-TEST-DECOUPLE mechanism cycle-3 ROSHI-LOG had recommended).
  Updated the note in-place with a **Prune landed** subsection —
  additive, not a rewrite, records the actual resolution. Grounded in
  `src/ui/screens/tacticalAttack/model.ts:458-465`,
  `tests/unit/ui/tacticalAttack/combatLog.test.ts:13`, and commits
  `76dbddd` / `e00833e` / `6c861ea`.
- **`arch/M14-ui.md`** — appended a compact combined `SESSION-03 +
  SESSION-04 · playtest-feedback-05` M14 tactical-screen delta
  fragment. Jikijitsu stapled no S03 or S04 arch commit this cycle
  (both sessions fit inside the existing M14 surface — Jikijitsu's
  call was correct for mid-run), but the Final Report explicitly names
  four items under `Architecture impact` that a future reader would
  otherwise have to re-derive from STATE.md handoffs: (1) the two new
  pure model helpers `velocityReadout` (S03 tacticalMove/model.ts) and
  `hitChanceBarFill` (S04 tacticalAttack/model.ts); (2)
  **D-IMMERSIVE-GRID-COLLAPSE** — the shared `.is-immersive` scoped
  grid-collapse pattern both screens now use for in-frame FULL FIELD
  mode; (3) **D-COMMIT-PER-SCREEN-REF** — CommitBar contained + pinned
  on both screens but positioned per each screen's endorsed reference
  (top on Move, bottom on Attack); (4) the ship-by-ship bench parity
  wiring that keeps hit-chance single-sourced through `hitChanceFor`
  (architecture §13.3 intact). Cross-screen READ contract explicitly
  noted preserved. All prose grounded in the Final Report §Architecture
  impact + handoff notes verbatim in STATE.md + current source at
  `src/ui/screens/tacticalMove/model.ts:448-456` and
  `src/ui/screens/tacticalAttack/model.ts:418-419`.

### Not reconciled — deliberately

- **`arch/M13-render.md` SESSION-02 · playtest-feedback-05 fragment** —
  Jikijitsu's `e302d93` staple lists a small internal-only public
  surface for `explosionFx.ts` and explicitly notes the barrel is
  untouched. Fragment reads consistently against current source
  (`src/render/explosionFx.ts` matches signatures + `not re-exported
  from src/render/index.ts` is verifiable). No reconciliation needed.
- **`arch/M11-trace.md` `AttackBeatRecord.launchedMissileIds` gap**
  memorialised cycle 1 — this cycle did no sim/trace work; the gap
  stays open pending a future M11 lease. Nothing to touch.
- **`arch/M14-ui.md` per-session block structure** — kept intact for the
  fifth consecutive cycle. Fragments still compose additively; no
  contradiction across bodies (only the two just-resolved via forward
  pointers). File is now ~640 lines and remains readable in
  session-timeline order. The Vow-2 bolt-on-vs-edit tension was
  weighed for the pf-05 delta and resolved toward one combined
  SESSION-03 + SESSION-04 fragment rather than two per-session
  fragments — the same feature, coherent as one description of the
  shared tactical-screen surface as it now stands.
- **Module Registry `M14` Key Files** — reads `screens/*,
  components/*, tokens.css`. New helpers landed inside the
  `screens/*` wildcard; no drift signal.
- **Module Registry `M13` "Key Files (planned)"** — cycle 1 flagged
  drift, cycle 2 held, cycle 3 held (no render work), cycle 4 ADDED a
  file (`explosionFx.ts`) but the Jikijitsu arch fragment explicitly
  notes it is NOT barrel-exported (module-internal). A reader today
  finds it via the arch fragment, not via the registry. The
  `(planned)` hedge still reads honestly. Fifth-consecutive cycle
  holding — not promoting from a plan-time snapshot to an as-built
  list on the strength of no active reader mis-step.
- **`FORGE-CONFIG.md` Conventions / Custom Rules** — no additions this
  cycle. The two items at 3/3+ (encyclopedia typecheck baseline;
  shared-test literal-lock) are: (a) not a convention (owner
  scheduling), and (b) actively resolved by orchestration execution
  this cycle rather than by a convention edit. Neither fits the
  Conventions / Custom Rules shape.

### Registry updated

**No.** No new module, no path scope change, no `catalog/**` edit, no
change to any `Owns` list this cycle.

### Conventions added to `FORGE-CONFIG.md`

**None** this cycle (Vow 4: repetition across ≥3 cycles is the
threshold, AND the recurrence must be convention-shaped).

### Proposed for the framework — with cycle count

*(These go here, NOT into `FORGE.md`/`MU.md`/`ENSO.md`/`JIKIJITSU.md`.
Roshi recommends; a human folds them in by hand once the count
justifies it. Vow 3.)*

- **[cycles: 4/3+ — STILL OPEN, ESCALATE] Owner hygiene —
  encyclopedia typecheck baseline.** Cycle 3 crossed the promote
  threshold; a one-line M01 fix was recommended and NOT scheduled.
  Cycle 4: `tests/unit/ui/encyclopedia/export.test.ts:31` (TS6142;
  `BackupBanner.tsx` under `tsconfig.node` with `--jsx` unset) is
  still red at HEAD. Final Report Residual Gap #1 names it
  explicitly. Every Mu this cycle inherited it as baseline noise. The
  cure remains a one-line M01 change (add `"jsx": "preserve"` to
  `tsconfig.node.json`, or narrow its `include` to exclude
  `.tsx`-importing test files) plus one green-tree commit. **Not a
  framework change — an owner scheduling ask.** Escalation this cycle
  is prose only; the recommendation shape is unchanged from cycle 3.
- **[RESOLVED · was 2/3+] Shared/unowned test files that lock literal
  cross-screen source strings.** Cycle 2 flagged the near-miss (S01
  dodged via a legacy-alias trick); cycle 3 showed the full burn
  (pf-04 shipped 1-red with no session empowered to fix). Cycle 4:
  the pf-05 Forge decomposition allocated a dedicated S01 lease
  (`tests/unit/ui/inMatchLayout.test.ts`) whose sole purpose was
  precisely D-LAYOUT-TEST-DECOUPLE — dropping every literal-string
  assertion out of the shared file and reducing it to shell-frame
  coverage. That fix landed at CP2, cleared the pf-04 RED, and
  unblocked the Wave-2 S03 ∥ S04 concurrency (both screens' scoped
  layout tests moved inside their own leases). Orchestration
  execution resolved this without a framework change: Forge saw the
  pattern in the pf-04 Final Report + cycle-3 ROSHI-LOG and
  decomposed accordingly. **Retired**; if the pattern ever recurs
  under new orchestration, restart the tally at 1/3+.
- **[cycles: 2/3+ · HELD from cycle 3] Verification-gate
  reachability — Playwright `webServer` provisioning.** Cycles 1 and
  2 flagged `test:e2e` structurally unreachable in the Mu sandbox;
  cycle 3 saw the fix land (`playwright.config.ts` `webServer`
  block) and receded to "resolved by concrete infra." Cycle 4:
  MIXED signal — S03 Move e2e (CP4 velocity-readout) PASSED, but S04
  Attack e2e was authored and DEFERRED because "that worker had no
  dev server" (Final Report §Verification results). Same fix
  present, per-worker provisioning still inconsistent. Not
  incremented past the cycle-1/cycle-2 count because the infra
  itself is in place; the observed variance appears to be per-Mu
  sandbox environment, not per-repo config. Hold at 2/3+ with a
  note: if cycle 5 shows the same "worker had no dev server"
  variance on another feature, upgrade the tally to 3/3+ and
  recommend Jikijitsu's Orchestration Envelope explicitly declare
  dev-server availability per lease.
- **[cycles: 1/3+ · HELD from cycle 2] Forge granularity — "stuck /
  can't proceed" playtest notes may hide latent bugs.** Cycle 4 had
  no "stuck / can't proceed" flavoured feedback (all six items were
  UX pain / render clarity / layout polish, none a hard block).
  Pattern did not recur; held.
- **[cycles: 1/3+ · HELD from cycle 1] Sim-record extensions before
  their render consumer.** Cycle 4 did no sim/trace work; S02's
  render-only explosion FX was DELIBERATELY scoped as a
  render-render-only visualisation of the AoE the sim already emits
  (`D-BLAST-RENDER-ONLY` — Final Report §Follow-up 1 flags mechanic-
  extension as a separate feature). Coupling could not recur.
  Held.
- **[cycles: 1/3+] Enso-brush transport reliability — new observation
  (do NOT promote yet).** Final Report §Granularity feedback for
  Forge notes S03 "used Mu's internal Enso brush pass for its first
  three checkpoints. The internal await transport failed, but Mu
  resumed checkpoint 4 under its recovery contract and returned one
  complete session handoff." Jikijitsu's own framing: "runtime
  plumbing issue, not a lease or checkpoint granularity defect." I
  agree — this is transport reliability inside Mu's tool layer, not
  a framework doc issue. NOT a proposed change to
  `MU.md`/`ENSO.md`; noting only so cycle 5+ can compare if the
  same transport surface fails again.

### Verification (Roshi's output is prose)

1. Every claim traces to git or the attached record. The
   `.ta-bench-scroll` → `.ta-plan-scroll` rename is verifiable at
   `src/ui/screens/TacticalAttack.tsx:430,527,594` and commit
   `76dbddd`. The `liveLogRows` prune is verifiable at
   `src/ui/screens/tacticalAttack/model.ts:458-465`,
   `tests/unit/ui/tacticalAttack/combatLog.test.ts:13`, and commits
   `76dbddd` (prune) / `e00833e` (S01 CP2) / `6c861ea` (S01 CP1). The
   two new pure helpers exist at
   `src/ui/screens/tacticalMove/model.ts:448-456` and
   `src/ui/screens/tacticalAttack/model.ts:418-419`. The single arch
   commit is `git log -1 --stat -- program/starship-skirmish/arch/`
   → `e302d93`. The "1526 pass / 0 fail" number and the "Attack e2e
   deferred (no dev server in that worker)" and encyclopedia TS6142
   claims are verbatim from Final Report §Verification results and
   §Residual gap. The D-LAYOUT-TEST-DECOUPLE resolution executes the
   cycle-3 ROSHI-LOG proposal verbatim (cross-reference the
   [cycles: 2/3+] bullet under cycle 3's Proposed section).
2. Re-read after writing: the two forward-pointing supersession
   notes in `arch/M14-ui.md` do NOT edit the fragment bodies they
   supersede — they add trailing subsections that read as "as of
   pf-05, this became X" without falsifying "at pf-02/pf-04 landing,
   this was Y." The new pf-05 M14 tactical-screen delta cross-
   references the pf-02 SESSION-04 §20 shell-frame contract and the
   pf-04 SESSION-01 `weaponOutOfRange` selector correctly (both
   reads verified). No contradiction between the new fragment and
   the two prior-fragment supersession notes (they name the same
   rename and the same prune with the same commits).
3. `FORGE.md`, `MU.md`, `ENSO.md`, `JIKIJITSU.md` — byte-identical,
   not touched.
