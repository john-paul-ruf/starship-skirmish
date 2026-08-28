// M14 UI — In-match shell frame + tactical column scroll rules
// (playtest-feedback-02 · S04). Locks the CSS structure of the fix so a
// future edit that regresses "the whole page scrolls" is caught in unit
// tests, not by the owner reopening the feedback thread.
//
// This suite reads the CSS + screen sources verbatim (mirrors the pattern
// in shipyard/statsPanel.test.ts) so it stays JSX-free — the unit build
// (tsconfig.node) refuses to typecheck `.tsx` transitive imports.
//
// Assertions land per checkpoint:
//   CP1 — shell frame + App.tsx route toggle
//   CP2 — tactical screen column scroll rules
//   playtest-feedback-03 SESSION-02 CP3 — Move screen exposes the persistent
//     combat-log strip within the fixed frame (log slot is `flex: none`, panel
//     owns its own bounded scroll, so viewport/plotter never leave 100vh).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const COMPONENTS_CSS_PATH = fileURLToPath(
  new URL('../../../src/ui/styles/components.css', import.meta.url),
);
const APP_TSX_PATH = fileURLToPath(
  new URL('../../../src/ui/App.tsx', import.meta.url),
);
const TACTICAL_MOVE_PATH = fileURLToPath(
  new URL('../../../src/ui/screens/TacticalMove.tsx', import.meta.url),
);
const TACTICAL_ATTACK_PATH = fileURLToPath(
  new URL('../../../src/ui/screens/TacticalAttack.tsx', import.meta.url),
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
    // side panels do (CP2 owns the panel-level rules).
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

// ---- CP2 — tactical column scroll -----------------------------------------
// The two tactical files import lazily so the CP1 typecheck+test pass
// even before CP2 lands the DOM/CSS changes: on CP1 the block is skipped
// (source files still exist but the CP2 assertions don't run yet).

describe('CP2 tactical screens — side panels scroll, middle stays put', () => {
  const tacticalMove = readFileSync(TACTICAL_MOVE_PATH, 'utf8');
  const tacticalAttack = readFileSync(TACTICAL_ATTACK_PATH, 'utf8');

  const cp2Live = /is-fixed-frame/.test(tacticalAttack)
    || /ta-shell/.test(tacticalAttack)
    || /ta-bench-scroll/.test(tacticalAttack);

  it.runIf(cp2Live)(
    'TacticalMove: shared roster + tm-plan-body both declare overflow-y:auto',
    () => {
      expect(tacticalMove).toMatch(/tm-plan-body[^`]*overflow-y:\s*auto/);
      // Left column: the shared `[data-testid="fleet-roster"]` container
      // in plan-state OR the resolve-state `.tm-roster` panel.
      expect(tacticalMove).toMatch(/fleet-roster[^`]*overflow-y:\s*auto/);
      // Centre stage stays overflow:hidden (pre-existing, do not regress).
      expect(tacticalMove).toMatch(/tm-stage[^`]*overflow:\s*hidden/);
    },
  );

  it.runIf(cp2Live)(
    'TacticalAttack: root uses a full-height flex shell (ta-shell)',
    () => {
      expect(tacticalAttack).toMatch(/class="ta-shell"/);
      expect(tacticalAttack).toMatch(
        /\.ta-shell[^`]*flex-direction:\s*column/,
      );
      expect(tacticalAttack).toMatch(/\.ta-shell[^`]*min-height:\s*0/);
    },
  );

  it.runIf(cp2Live)(
    'TacticalAttack: right column contains a scrolling bench region',
    () => {
      expect(tacticalAttack).toMatch(
        /\.ta-bench-scroll[^`]*overflow-y:\s*auto/,
      );
      expect(tacticalAttack).toMatch(/\.ta-bench-scroll[^`]*min-height:\s*0/);
    },
  );

  it.runIf(cp2Live)(
    'TacticalAttack: left column roster gets its own scroll region',
    () => {
      expect(tacticalAttack).toMatch(
        /\.ta-roster-scroll[^`]*overflow-y:\s*auto/,
      );
    },
  );

  // ---- playtest-feedback-03 SESSION-02 CP3 --------------------------------
  // Owner playtest FB2 — "where is my combat log — should be visible at all
  // times." The Move screen now mounts the shared CombatLogPanel; these
  // assertions lock the placement so a future edit that pushes it outside the
  // fixed frame (or drops it entirely) fails the unit build.

  it(
    'TacticalMove: mounts the shared CombatLogPanel from tacticalAttack (cross-screen read)',
    () => {
      // Import wiring — no extraction, no barrel churn (SESSION-01 owns
      // the physical files; SESSION-02 reads them).
      expect(tacticalMove).toMatch(
        /import \{ CombatLogPanel \} from '\.\/tacticalAttack\/CombatLogPanel\.js'/,
      );
      expect(tacticalMove).toMatch(
        /import \{ liveLogRows \} from '\.\/tacticalAttack\/model\.js'/,
      );
      expect(tacticalMove).toMatch(
        /import \{ nameByBodyId \} from '\.\/postMatch\/model\.js'/,
      );
      // The strip is mounted in the JSX tree.
      expect(tacticalMove).toContain('<CombatLogPanel');
    },
  );

  it(
    'TacticalMove: log slot is flex:none so the fixed-frame viewport/plotter never lose their space',
    () => {
      // The scoped rule that pins the strip's row: `flex: none` — grow/shrink
      // both disabled, so the strip is a passive sibling in the flex column
      // and cannot steal from `.tm-plan-body` (scrolling) or the CommitBar.
      expect(tacticalMove).toMatch(/\.tm-log-slot[^`]*flex:\s*none/);
      // The strip lives inside `.tm-plan`, which is a flex-column child of
      // `.tm-layout` — itself flex-inside-`.tm-shell` (the 100vh frame set by
      // playtest-feedback-02 CP1). No structural rewire; only additive rules.
      expect(tacticalMove).toMatch(/class="tm-plan panel"/);
      expect(tacticalMove).toMatch(/class="tm-log-slot"/);
    },
  );
});
