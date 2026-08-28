// M14 UI — In-match **shell frame** coverage only.
//
// Scope (post playtest-feedback-05 SESSION-01):
//   • `.app-shell` / `.app-main[.is-fixed-frame]` CSS in `components.css`
//   • `App.tsx` route-toggle + shell `data-testid` contract
//
// Per-screen tactical column layout lives in each screen's OWN test dir so a
// layout change and its coverage land in one lease:
//   • `tests/unit/ui/tacticalMove/layout.test.ts`   (owned by SESSION-03)
//   • `tests/unit/ui/tacticalAttack/layout.test.ts` (owned by SESSION-04)
//
// Rationale — Roshi `[2/3+]` finding on playtest-feedback-04 FINAL-REPORT
// (Elder's Note on shared/unowned literal-lock test files): this file used to
// assert literal source strings out of both `TacticalMove.tsx` and
// `TacticalAttack.tsx`, coupling two disjoint screen sessions to a test
// neither owned — one such assertion went RED on `main` when pf-04 SESSION-02
// renamed a symbol. Those literal-string locks are removed here; per-screen
// coverage becomes behavioural, in-lease.
//
// This suite reads the CSS + `App.tsx` verbatim (mirrors the pattern in
// shipyard/statsPanel.test.ts) so it stays JSX-free — the unit build
// (tsconfig.node) refuses to typecheck `.tsx` transitive imports.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const COMPONENTS_CSS_PATH = fileURLToPath(
  new URL('../../../src/ui/styles/components.css', import.meta.url),
);
const APP_TSX_PATH = fileURLToPath(
  new URL('../../../src/ui/App.tsx', import.meta.url),
);

const componentsCss = readFileSync(COMPONENTS_CSS_PATH, 'utf8');
const appTsx = readFileSync(APP_TSX_PATH, 'utf8');

/** Concatenate the body of every `@media (min-width: 1024px) { ... }` block. */
const desktopMediaBody = ((): string => {
  const marker = '@media (min-width: 1024px)';
  const parts: string[] = [];
  let cursor = 0;
  for (;;) {
    const start = componentsCss.indexOf(marker, cursor);
    if (start < 0) break;
    const openBrace = componentsCss.indexOf('{', start);
    if (openBrace < 0) break;
    let depth = 1;
    let i = openBrace + 1;
    while (i < componentsCss.length && depth > 0) {
      const ch = componentsCss[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      i += 1;
    }
    parts.push(componentsCss.slice(openBrace + 1, i - 1));
    cursor = i;
  }
  return parts.join('\n');
})();

// ---- CP1 — shell frame ---------------------------------------------------

describe('CP1 shell frame — the page stops scrolling on tactical routes', () => {
  it('defines .app-shell inside the ≥1024px block with 100vh + overflow:hidden', () => {
    // Gated at the DesktopGate breakpoint so the mobile fallback
    // (mobile-gate) doesn't fight the tactical frame.
    expect(desktopMediaBody).toMatch(/\.app-shell\s*\{[^}]*height:\s*100vh/);
    expect(desktopMediaBody).toMatch(/\.app-shell\s*\{[^}]*overflow:\s*hidden/);
    expect(desktopMediaBody).toMatch(
      /\.app-shell\s*\{[^}]*flex-direction:\s*column/,
    );
  });

  it('defines .app-main as a bounded scroll region by default', () => {
    // Default = scroll-y auto so non-tactical screens (Encyclopedia,
    // Shipyard, PostMatch) still reach their bottom content.
    expect(desktopMediaBody).toMatch(
      /\.app-main\s*\{[^}]*flex:\s*1\s*1\s*auto/,
    );
    expect(desktopMediaBody).toMatch(/\.app-main\s*\{[^}]*min-height:\s*0/);
    expect(desktopMediaBody).toMatch(
      /\.app-main\s*\{[^}]*overflow-y:\s*auto/,
    );
  });

  it('defines .app-main.is-fixed-frame — tactical override to overflow:hidden', () => {
    // Under the fixed frame the tactical middle never scrolls; only the
    // side panels do (per-screen panel scroll rules live in each screen's
    // own layout test — see this file's header for the split).
    expect(desktopMediaBody).toMatch(
      /\.app-main\.is-fixed-frame\s*\{[^}]*overflow:\s*hidden/,
    );
    expect(desktopMediaBody).toMatch(
      /\.app-main\.is-fixed-frame\s*\{[^}]*flex-direction:\s*column/,
    );
  });
});

describe('CP1 App.tsx — main class toggles on tactical routes', () => {
  it('adds is-fixed-frame for tactical-move and tactical-attack only', () => {
    expect(appTsx).toContain("'tactical-move'");
    expect(appTsx).toContain("'tactical-attack'");
    expect(appTsx).toMatch(/is-fixed-frame/);
    // The route helper only elevates the two tactical routes.
    expect(appTsx).toMatch(
      /route === 'tactical-move' \|\| route === 'tactical-attack'/,
    );
  });

  it('keeps every data-testid the shell contract publishes', () => {
    // S01 shell contract — never rename these ids (e2e depends on them).
    expect(appTsx).toContain('data-testid="app-shell"');
    expect(appTsx).toContain('data-testid="app-main"');
  });
});
