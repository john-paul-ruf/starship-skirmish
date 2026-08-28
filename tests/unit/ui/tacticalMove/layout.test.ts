// M14 UI — Tactical Movement screen layout coverage (playtest-feedback-05
// SESSION-03). Behavioural, in-lease replacement for the literal-string
// asserts SESSION-01 removed from the shared `inMatchLayout.test.ts` (see
// that file's header + `D-LAYOUT-TEST-DECOUPLE`). Grows one `describe` block
// per checkpoint.
//
// Reads `TacticalMove.tsx` + sibling `.tsx` source verbatim so the suite
// stays JSX-free (the unit build / tsconfig.node refuses to typecheck a
// `.tsx` transitive import) — mirrors the pattern in
// `tests/unit/ui/inMatchLayout.test.ts` and `shipyard/statsPanel.test.ts`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCREEN_PATH = fileURLToPath(
  new URL('../../../../src/ui/screens/TacticalMove.tsx', import.meta.url),
);

const screen = readFileSync(SCREEN_PATH, 'utf8');

/** The scoped `TM_STYLES` template-literal body (everything between the
 *  backticks), so assertions read the actual shipped CSS, not JSX markup.
 *  Scans for the closing (unescaped) backtick — the body's own CSS comments
 *  legally contain `\`` -escaped backticks that are not the terminator. */
const tmStyles = ((): string => {
  const start = screen.indexOf('const TM_STYLES = `');
  const openTick = screen.indexOf('`', start);
  let i = openTick + 1;
  while (i < screen.length && !(screen[i] === '`' && screen[i - 1] !== '\\')) i += 1;
  return screen.slice(openTick + 1, i);
})();

// ---- CP1 — one scroll region in the right panel ---------------------------

describe('CP1 one scroll region — the right panel shows a single scrollbar', () => {
  it('defines exactly one scrolling region for the plan surface: .tm-plan-scroll', () => {
    expect(tmStyles).toMatch(/\.tm-plan-scroll\s*\{[^}]*overflow-y:\s*auto/);
    expect(tmStyles).toMatch(/\.tm-plan-scroll\s*\{[^}]*flex:\s*1\s*1\s*auto/);
  });

  it('removes the old two-scroll split (.tm-plan-body / .tm-log-slot)', () => {
    expect(tmStyles).not.toContain('.tm-plan-body');
    expect(tmStyles).not.toContain('.tm-log-slot');
    expect(screen).not.toContain('class="tm-log-slot"');
  });

  it('neutralizes the combat log strip nested scroll inside the one scroll region', () => {
    // CombatLogPanel.tsx (SESSION-04's lease) sets an INLINE style on `.log`
    // — only a `.tm-plan-scroll .log` override with `!important` can beat it.
    expect(tmStyles).toMatch(
      /\.tm-plan-scroll \.log\s*\{[^}]*max-height:\s*none\s*!important[^}]*overflow:\s*visible\s*!important/,
    );
  });

  it('renders the inspector, plotter, and combat log inside one .tm-plan-scroll wrapper', () => {
    const scrollOpen = screen.indexOf('<div class="tm-plan-scroll">');
    expect(scrollOpen).toBeGreaterThan(-1);
    // Only one .tm-plan-scroll wrapper exists.
    const scrollTagEnd = scrollOpen + '<div class="tm-plan-scroll">'.length;
    expect(screen.indexOf('class="tm-plan-scroll"', scrollTagEnd)).toBe(-1);
    const scrollClose = screen.indexOf('</aside>', scrollOpen);
    const inspectorIdx = screen.indexOf('<ShipInspector', scrollOpen);
    const logIdx = screen.indexOf('<CombatLogPanel', scrollOpen);
    expect(inspectorIdx).toBeGreaterThan(scrollOpen);
    expect(inspectorIdx).toBeLessThan(scrollClose);
    expect(logIdx).toBeGreaterThan(scrollOpen);
    expect(logIdx).toBeLessThan(scrollClose);
  });

  it('keeps the left roster and center stage as their own, unmerged scroll/no-scroll regions', () => {
    expect(tmStyles).toMatch(/\.tm-roster\s*\{[^}]*overflow-y:\s*auto/);
    expect(tmStyles).toMatch(
      /\[data-testid="fleet-roster"\]\s*\{[^;]*[\s\S]*?overflow-y:\s*auto/,
    );
    expect(tmStyles).toMatch(/\.tm-stage\s*\{[^}]*overflow:\s*hidden/);
  });
});
