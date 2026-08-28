# State Tracker — Starship Skirmish / github-pages-pre-push-guard

## Program / Feature / Intent / Sessions

- **Program:** Starship Skirmish (`starship-skirmish`)
- **Feature:** `github-pages-pre-push-guard`
- **Intent:** Reject ordinary Git pushes unless the same repository-local Node and cross-engine checks used by the GitHub Pages readiness workflow pass locally.
- **Sessions:** 1
- **Authoritative program config:** `./program/starship-skirmish/FORGE-CONFIG.md`
- **Architecture source:** `./specs/architecture.md` §7.5 and §11.
- **Database impact:** none; `./specs/database.md` was read and no catalog, persistence, schema, wire-format, fixture, lockfile, or migration surface is in scope.

## Session Status

| # | Session | Modules | Owns | Status | Checkpoint | Completed | Notes |
|---|---|---|---|---|---|---|---|
| 01 | Gate Pushes on Pages Readiness | M01, M19 | `./package.json`; `./.github/workflows/ci.yml`; `./.githooks/install.mjs`; `./.githooks/pre-push`; `./tests/unit/toolchain/prePushGuard.test.ts` | done | 3/3 | 2026-08-28 | Canonicalized the Pages-readiness gate surface in package.json (verify:pages, verify:pages:node, verify:pages:browsers); GitHub Actions now consumes the two halves instead of duplicating gate names. Tracked ./.githooks/pre-push (mode 100755) fail-closed delegates to `npm run verify:pages` via `exec`. `prepare` runs ./.githooks/install.mjs — a Node-built-ins-only installer that sets repository-local core.hooksPath=./.githooks inside a worktree and no-ops otherwise. 17-test contract in tests/unit/toolchain/prePushGuard.test.ts locks hook shape, exact status propagation (fake-npm PATH prepend), isolated installer behavior in a temporary Git repo, and package/workflow parity (no divergent raw gate list). No runtime dependency added; package-lock.json byte-identical. |

## Wave Plan

| Wave | Sessions | Why concurrent |
|---|---|---|
| 1 | SESSION-01 | Single member: package scripts, workflow calls, hook installation/delegation, and their contract test are one coupled M01/M19 write set. Splitting them would create invalid intermediate references or duplicate ownership of `./package.json` and `./.github/workflows/ci.yml`. |

## Dependency Graph

```mermaid
flowchart TD
  S01[Pages pre-push guard]
```

## Architecture Reference

- **Deployment target:** GitHub Pages, project-site base `'/starship-skirmish/'`, static `./dist/`, Node 22 build environment, from `./specs/architecture.md` §11 and `./program/starship-skirmish/FORGE-CONFIG.md`.
- **Required local gates:** typecheck, lint/boundaries, unit tests, catalog-lock integrity, deterministic Node fixtures, migration-fixture integrity, harness purity, production build, and cross-engine determinism.
- **Cross-engine surface:** the current codebase has three required Playwright families: `./tests/e2e/determinism.spec.ts`, `./tests/e2e/combatDeterminism.spec.ts`, and `./tests/e2e/harnessMatchDeterminism.spec.ts`, each run through Chromium, Firefox, and WebKit projects in `./playwright.config.ts`.
- **Single source of truth:** `./package.json` owns the executable readiness commands. `./.github/workflows/ci.yml` invokes their split jobs; `./.githooks/pre-push` invokes their aggregate.
- **Activation model:** the repository tracks `./.githooks/`; npm `prepare` configures repository-local `core.hooksPath`. Nothing is copied into `./.git/hooks/`.
- **Hook boundary:** local pre-push failure blocks a normal client push. GitHub-only artifact upload/deploy, permissions, environment health, an intentional `--no-verify`, and clones that have not installed dependencies are outside that guarantee.
- **Data layer:** no changes to `./catalog/`, `./src/io/`, `./src/persist/`, or DB-owned migration artifacts.

## Scope Summary

| ID | Module | Scope | Public/API Impact |
|---|---|---|---|
| M01 | Toolchain & Build | Add canonical Pages-readiness scripts, make CI consume them, track a dependency-free pre-push hook, and auto-configure its hook path per clone. | New developer command surface: `prepare`, `verify:pages:node`, `verify:pages:browsers`, and `verify:pages`; no runtime bundle or application API impact. |
| M19 | Tests | Prove installer isolation, executable mode, exact hook delegation/status propagation, and workflow/package parity. | Adds toolchain regression coverage only; no shipping test fixture or public API change. |

## Design Decisions

1. **D-PAGES-SINGLE-COMMAND-SOURCE:** package scripts are canonical. CI and the hook consume them; neither carries a second list that can drift.
2. **D-PAGES-FAIL-CLOSED:** the hook exits with the aggregate command's exact status. Missing dependencies, missing browser engines, test failures, lint/type errors, determinism mismatches, and build failures all reject the push.
3. **D-PAGES-ALL-DETERMINISM-FAMILIES:** cross-engine readiness includes physics scenarios, assembled combat, and full bot-vs-bot harness fixtures in Chromium, Firefox, and WebKit. The older one-spec workflow is insufficient for the as-built architecture.
4. **D-PAGES-EVERY-PUSH:** do not condition on branch, remote, changed paths, or pushed ref shape. Every ordinary push pays the full gate because the requested invariant is global.
5. **D-PAGES-TRACKED-NATIVE-HOOKS:** use tracked `./.githooks/` plus repository-local `core.hooksPath`; add no Husky, hook manager, runtime dependency, or lockfile churn.
6. **D-PAGES-AUTO-ACTIVATE:** npm `prepare` configures each Git clone. It cleanly no-ops outside a worktree but fails visibly if an in-repository local config write fails.
7. **D-PAGES-NO-STALE-CACHE:** do not cache a successful commit or offer a custom skip variable. The hook always evaluates the current checkout/worktree through the canonical command.
8. **D-PAGES-HONEST-BOUNDARY:** this is strong local feedback, not remote enforcement. Git's built-in `--no-verify` remains possible; a required GitHub status check is the separate non-bypassable policy layer.
9. **D-PAGES-DEPLOY-OUT-OF-SCOPE:** keep the existing Pages deployment TODO. This feature validates the local build/test prerequisites and does not add upload/deploy actions, permissions, environments, secrets, or repository settings.

## Conflict / Risk Notes

- `./program/starship-skirmish/arch/M01-toolchain.md` recorded an earlier intent not to grow the npm script surface. The explicit hook feature requires a named shared command to avoid CI/hook drift; Jikijitsu should append this intentional M01 public-surface change after Mu's handoff.
- `npm ci` will run `prepare` inside GitHub Actions and write only ephemeral repository-local `./.git/config`. The installer must no-op when `./.git/` is absent, but it must not mask a real config failure inside a clone.
- The complete gate is intentionally expensive. Browser binaries are a prerequisite and must be installed automatically during implementation if absent; the hook itself should block with Playwright's actionable error rather than downloading software during every push.
- `./playwright.config.ts` owns a fixed web-server port. This one-session wave holds `playwright:webserver`, so there is no concurrent local runner contention in this feature.
- Client-side hooks are never a security boundary. Do not describe the result as unbypassable or as proof that GitHub's Pages service and permissions are healthy.

## Handoff Notes

### SESSION-01

**notes:** Canonicalized the Pages-readiness gate surface in package.json (verify:pages, verify:pages:node, verify:pages:browsers); GitHub Actions now consumes the two halves instead of duplicating gate names. Tracked ./.githooks/pre-push (mode 100755) fail-closed delegates to `npm run verify:pages` via `exec`. `prepare` runs ./.githooks/install.mjs — a Node-built-ins-only installer that sets repository-local core.hooksPath=./.githooks inside a worktree and no-ops otherwise. 17-test contract in tests/unit/toolchain/prePushGuard.test.ts locks hook shape, exact status propagation (fake-npm PATH prepend), isolated installer behavior in a temporary Git repo, and package/workflow parity (no divergent raw gate list). No runtime dependency added; package-lock.json byte-identical.

**followUp:** Two out-of-lease fixes are needed before `npm run verify:pages` can run green: (a) resolve the tsconfig.node.json ↔ BackupBanner.tsx JSX config gap for `tsc --noEmit -p tsconfig.node.json` (either add `jsx`/`jsxImportSource` to tsconfig.node.json, or exclude UI-adjacent test files from the node config), and (b) refresh the `harnessMatchDeterminism` browser fixtures or fix the underlying browser-side sim drift so the three engines match the recorded Node golden. Follow-up for hard remote enforcement: enable a GitHub repository rule requiring the CI workflow status — the client hook itself remains bypassable via `git push --no-verify` and per-clone (only clones that have run `npm install`/`npm ci` at least once will have `core.hooksPath` set). No Pages deployment job was added in this feature; the existing TODO in `.github/workflows/ci.yml` still tracks that work.
