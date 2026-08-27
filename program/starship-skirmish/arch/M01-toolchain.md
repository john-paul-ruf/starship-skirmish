# M01 — Toolchain & Build (as built)

> Architecture-as-built detail for module M01. Session-marked; appended by Jikijitsu from each
> worker's arch fragment. Note: `program/` is gitignored, so this file is disk-only (not in git history).

<!-- SESSION-01 -->
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
