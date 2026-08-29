# M01 — Toolchain & Build (as built)

> Architecture-as-built detail for module M01. Session-marked; appended by Jikijitsu from each
> worker's arch fragment. Note: `program/` is gitignored, so this file is disk-only (not in git history).

<!-- SESSION-01 · initial M01 toolchain fragment -->
## Module Registry entry (now live)

- **M01 Toolchain & Build** — root config + `public/` + `.github/workflows/`. Owns Vite/TS/ESLint
  configuration, PWA generation, the SPA entry HTML, the CI pipeline stub, and the runtime dep
  policy. Depends on nothing.
- Files present:
  `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`,
  `eslint.config.js`, `.prettierrc`, `index.html`, `src/main.tsx`, `src/vite-env.d.ts`,
  `public/.nojekyll`, `.github/workflows/ci.yml`.

## Public surface every later session inherits

- **Runtime dependency policy (§1):** `dependencies` is `three`, `preact`, `@preact/signals` —
  nothing else. Any new npm runtime dep is a reviewable schema change to `package.json`.
- **Full npm-script surface (declared up front):**
  `dev`, `build`, `preview`, `typecheck`, `lint`, `format`, `test`, `test:unit`,
  `test:determinism`, `test:catalog-lock`, `test:fixtures`, `test:harness-purity`, `harness`,
  `test:e2e`. Later features add file targets, not scripts.
- **Vitest configured with `passWithNoTests: true`** (`vite.config.ts`) so the pre-declared
  `test:*` scripts stay green before test files exist.
- **TypeScript posture (`tsconfig.json`, app):** `strict`, `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`, `isolatedModules`, `moduleResolution: bundler`, `jsx: react-jsx` +
  `jsxImportSource: preact`. `verbatimModuleSyntax` is the compile-time half of §5's
  "render may import sim TYPES only" rule — a value import from sim into render is a build error.
- **Vite build (§11 Pages):** `base: process.env.VITE_BASE ?? '/starship-skirmish/'`,
  `preact/compat` aliased for `react`/`react-dom`/`react/jsx-runtime`, `vite-plugin-pwa`
  `generateSW` precaching `**/*.{js,css,html,woff2,json,ico,svg,png}` (offline after first load).
- **CSP** (`index.html` meta): `default-src 'self'; script-src 'self'; style-src 'self'
  'unsafe-inline'; img-src 'self' data:; font-src 'self'; worker-src 'self' blob:; connect-src
  'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. No `unsafe-eval`. `.nojekyll`
  present so Pages does not run Jekyll and eat build assets.

## Lint guarantees now live (inherited by every later session)

Two lint-enforced structural rules from architecture §5 and §7.1 — active on the empty tree, so
S02–S06 inherit them for free the moment they add files.

1. **Module boundaries** (`eslint-plugin-boundaries`, flat config):
   - Elements: `catalog, domain, sim, ai, io, persist, render, ui, workers, app` (from `src/<name>/**`).
   - `boundaries/element-types`: `sim` may import only `sim`. Everything else defaults to `allow`
     (the finer-grained cross-module rules come with the modules that need them).
   - `boundaries/external`: `sim` may import nothing from npm.
   - `no-restricted-imports` (scoped to `src/ui/**`): forbids `**/sim/physics(/**)` and
     `**/sim/rules(/**)`.
   - `no-restricted-imports` (scoped to `src/**` minus `main.tsx` / sim / ai / ui / app): forbids
     imports of `src/app/**` — only `src/main.tsx` may import the composition root.

2. **Determinism ban-list** (scoped to `src/sim/**` + `src/ai/**`):
   - `no-restricted-globals`: `Date`, `document`, `window`, `performance`.
   - `no-restricted-properties` on `Math`: `random`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`,
     `atan2`, `exp`, `log`, `log2`, `log10`, `pow`, `hypot`, `cbrt`, `fround`, `expm1`, `log1p`,
     `sinh`, `cosh`, `tanh`.
   - `no-restricted-imports`: `three`, `preact`, `@preact/*`, `three/*`, `preact/*`.

3. **Repo-wide XSS ban** (`no-restricted-syntax`): `dangerouslySetInnerHTML` and
   `Element.innerHTML` (architecture §10).

Ignored by lint: `prototypes/**`, `mocks/**`, `dist/**`, `public/**`, `node_modules/**`,
`.forge/**`, `program/**`. Prototypes are FR-32 disposable; mocks are pre-shipping content.

## CI stub

`.github/workflows/ci.yml` runs on Node 22: `typecheck → lint → test:unit → build`. Remaining
architecture §11 jobs (`test:catalog-lock`, `test:fixtures`, `test:determinism`,
`test:harness-purity`, and `actions/deploy-pages`) are TODO comments in the workflow, each citing
its §11 step.

## Housekeeping

Three byte-identical stray copies of `src/io/migrate/migrations.ts` at repo root removed:
`migrations.ts`, `migrate/migrations.ts`, `io/migrate/migrations.ts`. Canonical file untouched.

<!-- SESSION-01 · github-pages-pre-push-guard · M01 hook + verify:pages surface -->
## SESSION-01 delta (github-pages-pre-push-guard)

### M01 Toolchain & Build — new public surface

- **New tracked directory:** `./.githooks/` — holds the repository-tracked
  hook set. Files at `./.githooks/install.mjs` (Node-only installer invoked
  from the `prepare` lifecycle script) and `./.githooks/pre-push` (POSIX
  shell hook, mode `100755`).
- **New npm scripts** (canonical Pages-readiness surface — CI and the local
  pre-push hook both consume these; neither carries a second gate list):
  - `prepare` → `node ./.githooks/install.mjs`. Configures repository-local
    `core.hooksPath=./.githooks` after `npm install` / `npm ci`. No-ops
    outside a Git worktree; fails visibly if the local config write is
    rejected. No runtime dependency added.
  - `verify:pages:node` → `typecheck && lint && test:unit && test:catalog-lock
    && test:determinism && test:fixtures && test:harness-purity && build`.
  - `verify:pages:browsers` → `playwright test` over the three cross-engine
    determinism specs (`determinism.spec.ts`, `combatDeterminism.spec.ts`,
    `harnessMatchDeterminism.spec.ts`) across Chromium, Firefox, WebKit.
  - `verify:pages` → `verify:pages:node && verify:pages:browsers`.
- **Public surface note vs prior arch entry:** the earlier M01 arch note
  said the up-front script list would not grow. This feature intentionally
  extends it — a shared named command is what prevents CI and the hook from
  drifting apart. `package-lock.json` byte-identical; no dependency
  changes.

### Activation model

- `prepare` runs on ordinary `npm install`/`npm ci`, including inside
  GitHub Actions. It writes only repository-local `./.git/config`. The hook
  is never copied into `./.git/hooks/`.
- Hook boundary is explicit in `./.githooks/pre-push`: it rejects normal
  pushes when the aggregate gate fails, cannot prove GitHub service
  availability or deployment permissions, and Git's built-in
  `git push --no-verify` bypasses it. Hard remote enforcement is a
  separate GitHub repository-rule concern.

### CI workflow — parity with hook

- `./.github/workflows/ci.yml` (build job) now runs `npm run
  verify:pages:node` instead of listing each gate individually.
- Cross-engine job runs `npm run verify:pages:browsers` after installing
  browsers with `npx playwright install --with-deps`. Job dependency
  (`needs: build`), `npm ci`, Node 22, and the `push` / `pull_request`
  triggers are unchanged.
- The pending Pages `actions/upload-pages-artifact` +
  `actions/deploy-pages` job remains an explicit TODO comment (architecture
  §11 step 6) — out of scope for this feature.

<!-- SESSION-02 · og-social-card · M01 entry HTML crawler-metadata + paired M19 contract test -->
## SESSION-02 delta (og-social-card) — social-preview crawler contract

> Authored by Roshi (cycle 9), not stapled by Jikijitsu: the feature's Final Report
> declared "architecture impact: none" (no module / public runtime API changed), so no
> mid-run arch fragment was appended. But the as-built crawler contract has load-bearing
> invariants that otherwise live only in the disk-only `STATE.md`. Recording the durable
> form here. Grounded in `git` (`0dc99c8`/`85229ef` PNG; `b212b4b` metadata + test),
> current `index.html`, `tests/unit/toolchain/openGraph.test.ts`, and the Final Report.

### M01 Toolchain & Build — entry HTML `<head>` crawler-metadata surface

`index.html` (M01-owned entry document) gains a static social-preview metadata block in
`<head>`, immediately after `<title>` and alongside the existing §10 CSP meta. No build,
PWA, or dependency change — Vite already copies `public/` and the Workbox `generateSW`
PNG glob already precaches the asset, so no `vite.config.ts` edit was needed.

- **Asset:** `public/og-card.png` — a real 1200 × 630, 8-bit RGB, non-interlaced PNG
  (SESSION-01, `0dc99c8`/`85229ef`). Rides Vite's `public/` copy to `dist/og-card.png`.
- **Metadata added (one block, crawler-visible):**
  - `<link rel="canonical">` + `<meta name="theme-color" content="#05070A">` (a
    design-token dark background).
  - Ten Open Graph tags: `og:type=website`, `og:site_name`, `og:url`, `og:title`,
    `og:description`, `og:image`, `og:image:type=image/png`, `og:image:width=1200`,
    `og:image:height=630`, `og:image:alt`.
  - Five Twitter tags: `twitter:card=summary_large_image`, `twitter:title`,
    `twitter:description`, `twitter:image`, `twitter:image:alt`.
  - The pre-existing single `<meta name="description">` is retained, not duplicated.

### Load-bearing crawler contract (invariants a future `index.html` editor must preserve)

- **Absolute HTTPS Pages URLs only.** `canonical` = `og:url` =
  `https://john-paul-ruf.github.io/starship-skirmish/`; `og:image` = `twitter:image` =
  `…/og-card.png`. NO hash route, relative image, external host, or `data:` URL —
  metadata is for crawlers that never run the SPA hash router or its JS.
- **CSP is NOT relaxed.** The architecture §10 Content-Security-Policy meta
  (`default-src 'self'` … `connect-src 'self'` … `object-src 'none'`) is byte-preserved;
  the metadata widens no directive and adds no host, no `unsafe-*`. (Analytics stays
  None, forever — FORGE-CONFIG Stack.)
- **Dimensions stay in sync with the real bytes.** `og:image:width/height` (1200 × 630)
  must equal the PNG's IHDR; the paired M19 test reads the IHDR straight from disk so a
  wrong-size or renamed asset reddens CI, not silently the crawl.

### M19 Tests — paired crawler-contract test (`tests/unit/toolchain/openGraph.test.ts`)

New Node/Vitest test (no DOM — matches the existing no-DOM toolchain-test posture; owned
by M19 but M01-toolchain-scoped). Four contracts, checked against the real files:

1. **Metadata uniqueness** — each canonical / theme-color / OG / Twitter key appears
   exactly once with its expected value; the single `description` meta survives.
2. **URL coherence** — `canonical === og:url` (absolute https, trailing `/`);
   `og:image === twitter:image` (absolute https, ends `/og-card.png`); no `#` or `data:`
   in any share target.
3. **Real asset** — `public/og-card.png` starts with the 8-byte PNG signature and
   declares 1200 × 630 in its IHDR (big-endian uint32 at byte 16 / 20).
4. **CSP intact** — the locked-down `default-src` / `img-src` / `connect-src` directives
   are still present.

The test's `PROD_URL` / `IMAGE_URL` / `TITLE` / `DESCRIPTION` / `IMAGE_ALT` constants
mirror `index.html` verbatim — the two files are one contract in two places.

### Follow-up coupling (recorded for a future lease)

Adopting a custom domain must change the absolute canonical / OG / Twitter URLs in
`index.html` AND the corresponding constants in `openGraph.test.ts` **together in one
lease** — a URL edit on either side alone reddens the coherence test (Final Report
§Follow-up).

### Not touched

No new module or public runtime API; no Preact component, router route, service, catalog
entry, or analytics integration. `package.json`, `vite.config.ts`, `public/.nojekyll`,
and all runtime source unchanged.
