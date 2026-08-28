// M14 UI — Tactical Attack **behavioural layout contract**
// (tactical-attack-mock-parity SESSION-03).
//
// Per-screen coverage kept JSX-free by reading `TacticalAttack.tsx` as source
// text — the unit build (`tsconfig.node`) refuses `.tsx` transitive imports, so
// the shipyard tests and this suite use the same file-read + regex pattern.
//
// IMPORTANT — these regex checks are a STATIC TRIPWIRE only. They pin the source
// structure (which column each surface mounts in, the scoped grid tracks) so a
// refactor cannot silently re-introduce the false "one giant second column"
// composition SESSION-03 replaced. The REAL acceptance gate is browser geometry:
// `tests/e2e/tacticalAttack.spec.ts` measures actual bounding boxes at 1920×1080
// and 1280×720. A green source regex here is necessary, not sufficient.
//
// What this pins:
//   • The literal three-column frame — `.ta-work` wraps, in source order, the
//     left roster `.ta-col-l`, the center stage `.ta-col-c`, and the right fire
//     rail `.ta-col-fire` (mocks/tactical-attack.html:18-22).
//   • `CombatLogPanel` mounts inside the CENTER column only; `WeaponBench` +
//     `FriendlyFireBanner` + `CommitBar` mount inside the RIGHT fire rail. There
//     is no weapon/commit surface beneath the center field (D-TA-NO-BOTTOM-PLAN).
//   • The scoped stylesheet lays out three side-by-side tracks at the supported
//     desktop gate and NEVER stacks the fire rail below the center.
//   • The fire rail is a fixed header + a single `overflow-y:auto` body
//     (`.ta-fire-scroll`) + a pinned commit footer (`.panel-ft`, `flex: none`).
//   • The `.is-immersive` grid-collapse toggle (grid-collapse, not Fullscreen API).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SCREEN_PATH = fileURLToPath(
  new URL('../../../../src/ui/screens/TacticalAttack.tsx', import.meta.url),
);
const COMMITBAR_PATH = fileURLToPath(
  new URL('../../../../src/ui/screens/tacticalAttack/CommitBar.tsx', import.meta.url),
);
const CAMERAHUD_PATH = fileURLToPath(
  new URL('../../../../src/ui/screens/tacticalAttack/CameraHud.tsx', import.meta.url),
);

const screenSrc = readFileSync(SCREEN_PATH, 'utf8');
const commitBarSrc = readFileSync(COMMITBAR_PATH, 'utf8');
const cameraHudSrc = readFileSync(CAMERAHUD_PATH, 'utf8');

/** Body of the scoped `TA_STYLES = \`…\`` template literal in the screen.
 *  Walks over escaped backticks (`\``) inside CSS comments — a raw
 *  `indexOf('`')` walk trips over them and terminates the literal early. */
const TA_STYLES: string = ((): string => {
  const marker = 'TA_STYLES';
  const eq = screenSrc.indexOf('=', screenSrc.indexOf(marker));
  const open = screenSrc.indexOf('`', eq);
  if (open < 0) throw new Error('TA_STYLES template literal not found');
  let close = -1;
  for (let i = open + 1; i < screenSrc.length; i += 1) {
    const ch = screenSrc[i];
    if (ch === '\\') {
      i += 1; // skip the next char (escaped backtick, backslash, etc.)
      continue;
    }
    if (ch === '`') {
      close = i;
      break;
    }
  }
  if (close < 0) throw new Error('TA_STYLES template literal not terminated');
  return screenSrc.slice(open + 1, close);
})();

/** Index of the attack-plan three-column frame opener. All source-order
 *  assertions anchor from here (the resolve branch reuses `.ta-col-c`, so a
 *  bare `indexOf` on a column testid could land on the wrong branch). */
const workOpen = screenSrc.indexOf('<div class="ta-work"');

// ---- The literal three-column frame --------------------------------------

describe('SESSION-03 — the attack-plan body is the literal three-column frame', () => {
  it('wraps the plan surface in a single `.ta-work` frame', () => {
    expect(workOpen).toBeGreaterThanOrEqual(0);
    expect(screenSrc).toMatch(/class="ta-work"\s+data-testid="ta-work"/);
  });

  it('mounts left roster → center stage → fire rail in that source order', () => {
    const left = screenSrc.indexOf('data-testid="ta-col-l"', workOpen);
    const center = screenSrc.indexOf('data-testid="ta-col-c"', workOpen);
    const fire = screenSrc.indexOf('data-testid="ta-col-fire"', workOpen);
    expect(left).toBeGreaterThan(workOpen);
    expect(center).toBeGreaterThan(left);
    expect(fire).toBeGreaterThan(center);
  });

  it('the center column is a <main>, the two rails are <aside> landmarks', () => {
    expect(screenSrc).toMatch(/<main class="ta-col-c" data-testid="ta-col-c">/);
    expect(screenSrc).toMatch(/<aside class="ta-col-l" data-testid="ta-col-l">/);
    expect(screenSrc).toMatch(
      /<aside class="ta-col-fire" data-testid="ta-col-fire" aria-label="Fire assignment">/,
    );
  });
});

describe('SESSION-03 — combat log is center-only; weapon bench + commit are fire-rail', () => {
  it('CombatLogPanel mounts inside the CENTER column, before the fire rail', () => {
    const center = screenSrc.indexOf('data-testid="ta-col-c"', workOpen);
    const fire = screenSrc.indexOf('data-testid="ta-col-fire"', workOpen);
    const log = screenSrc.indexOf('<CombatLogPanel', center);
    expect(log).toBeGreaterThan(center);
    expect(log).toBeLessThan(fire); // the log lives under center, NOT the rail
  });

  it('FriendlyFireBanner + WeaponBench live inside the single `.ta-fire-scroll` body', () => {
    const scroll = screenSrc.indexOf('data-testid="ta-fire-scroll"', workOpen);
    const banner = screenSrc.indexOf('<FriendlyFireBanner', scroll);
    const bench = screenSrc.indexOf('<WeaponBench', scroll);
    const commit = screenSrc.indexOf('<CommitBar', scroll);
    expect(scroll).toBeGreaterThan(0);
    expect(banner).toBeGreaterThan(scroll);
    expect(bench).toBeGreaterThan(banner);
    // The commit footer is AFTER the scroll body — a pinned sibling, not inside it.
    expect(commit).toBeGreaterThan(bench);
  });

  it('CommitBar mounts inside the fire rail as its last child', () => {
    const fire = screenSrc.indexOf('data-testid="ta-col-fire"', workOpen);
    const commit = screenSrc.indexOf('<CommitBar', fire);
    expect(commit).toBeGreaterThan(fire);
  });
});

// ---- CommitBar is a contained, pinned fire-rail footer -------------------

describe('SESSION-03 — the commit bar is a contained, pinned fire-rail footer', () => {
  it('CommitBar renders `.panel-ft` and the `ta-fire-footer` marker', () => {
    expect(commitBarSrc).toMatch(/<div\s+class=(?:"|')[^"']*\bpanel-ft\b/);
    expect(commitBarSrc).toMatch(/data-testid="ta-fire-footer"/);
  });

  it('the `.ta-col-fire > .panel-ft` rule pins the footer to `flex: none`', () => {
    // Direct-child selector: it wins over any inherited flex grow/shrink so the
    // button never stretches to page width. FB2 owner note: "no bottom panel."
    expect(TA_STYLES).toMatch(/\.ta-col-fire\s*>\s*\.panel-ft\s*\{[^}]*flex:\s*none/);
  });

  it('CommitBar is not escaped out of the fixed frame with `position: fixed`', () => {
    expect(commitBarSrc).not.toMatch(/position:\s*fixed/);
    expect(TA_STYLES).not.toMatch(/\.ta-col-fire\s*>\s*\.panel-ft\s*\{[^}]*position:\s*fixed/);
  });
});

// ---- Scoped grid: three side-by-side tracks, never stacked ----------------

describe('SESSION-03 — the scoped grid lays out three side-by-side tracks', () => {
  it('.ta-work declares three grid tracks (roster · center · fire rail)', () => {
    // Three `minmax(...)` tracks in the base rule — the fire rail is the third
    // column, side-by-side, at every supported desktop width.
    expect(TA_STYLES).toMatch(
      /\.ta-work\s*\{[^}]*grid-template-columns:[^;]*minmax\([^)]*\)[^;]*minmax\([^)]*\)[^;]*minmax\([^)]*\)/,
    );
  });

  it('no rule stacks the fire rail below the center (no bare single-track collapse)', () => {
    // The ONLY single-track `.ta-work` collapse is guarded by `.is-immersive`.
    // There must be no responsive `@media` collapse and no `grid-column`/`order`
    // trick that drops the fire rail beneath the field.
    expect(TA_STYLES).not.toMatch(/@media/);
    expect(TA_STYLES).not.toMatch(/\.ta-col-fire\s*\{[^}]*grid-column/);
    expect(TA_STYLES).not.toMatch(/\.ta-col-fire\s*\{[^}]*order:/);
  });

  it('the center column contains the combat log strip (flex: none, ~168px)', () => {
    expect(TA_STYLES).toMatch(/\.ta-col-c\s*>\s*\.panel\s*\{[^}]*flex:\s*none/);
  });
});

// ---- Single fire-rail scroll region ---------------------------------------

describe('SESSION-03 — the fire rail has exactly one primary scroll region', () => {
  it('.ta-fire-scroll is the single overflow-y:auto assignment body', () => {
    expect(TA_STYLES).toMatch(/\.ta-fire-scroll\s*\{[^}]*overflow-y:\s*auto/);
    expect(screenSrc).toMatch(/class="ta-fire-scroll"\s+data-testid="ta-fire-scroll"/);
  });

  it('the fire rail itself hides overflow (delegates scroll to the inner body)', () => {
    expect(TA_STYLES).toMatch(/\.ta-col-fire\s*\{[^}]*overflow:\s*hidden/);
  });

  it('the .ta-shell itself does not scroll — the app-main frame owns the boundary', () => {
    expect(TA_STYLES).not.toMatch(/\.ta-shell\s*\{[^}]*overflow-y:\s*auto/);
  });

  it('the fire-scroll body preserves a min-height floor (bench-never-collapses)', () => {
    expect(TA_STYLES).toMatch(/\.ta-fire-scroll\s*\{[^}]*min-height:\s*\d+/);
  });
});

// ---- Immersive full-field toggle -----------------------------------------

describe('SESSION-03 — .is-immersive collapses to the tactical stage inside the fixed frame', () => {
  it('exposes a boolean toggle via a fullscreen signal, not a DOM Fullscreen API dependency', () => {
    expect(screenSrc).toMatch(/const\s+fullscreen\s*=\s*useSignal\(false\)/);
  });

  it('applies .is-immersive to .ta-shell when fullscreen is true', () => {
    expect(screenSrc).toMatch(/is-immersive/);
    expect(screenSrc).toMatch(/fullscreen\.value/);
  });

  it('collapses .ta-work to a single column when immersive', () => {
    expect(TA_STYLES).toMatch(
      /\.ta-shell\.is-immersive\s+\.ta-work\s*\{[^}]*grid-template-columns:\s*1fr/,
    );
  });

  it('hides the left roster column .ta-col-l when immersive', () => {
    expect(TA_STYLES).toMatch(
      /\.ta-shell\.is-immersive\s+\.ta-col-l\s*\{[^}]*display:\s*none/,
    );
  });

  it('hides the right fire rail .ta-col-fire when immersive', () => {
    expect(TA_STYLES).toMatch(
      /\.ta-shell\.is-immersive\s+\.ta-col-fire\s*\{[^}]*display:\s*none/,
    );
  });

  it('hides the center-only combat log (.ta-col-c > .panel) when immersive', () => {
    expect(TA_STYLES).toMatch(
      /\.ta-shell\.is-immersive\s+\.ta-col-c\s*>\s*\.panel\s*\{[^}]*display:\s*none/,
    );
  });

  it('stays inside the fixed frame — no position:fixed escape from .app-main', () => {
    expect(TA_STYLES).not.toMatch(/\.ta-shell\.is-immersive[^{]*\{[^}]*position:\s*fixed/);
  });

  it('CameraHud carries a maximize/restore control (text + aria-pressed, never colour-only)', () => {
    expect(cameraHudSrc).toMatch(/FULL FIELD/);
    expect(cameraHudSrc).toMatch(/RESTORE/);
    expect(cameraHudSrc).toMatch(/aria-pressed/);
    expect(cameraHudSrc).toMatch(/data-testid="cam-fullscreen"/);
  });

  it('Escape exits immersive (window keydown handler wired only while active)', () => {
    expect(screenSrc).toMatch(/Escape/);
    expect(screenSrc).toMatch(/keydown/);
  });
});
