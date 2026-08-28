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
