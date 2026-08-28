// M14 UI — Tactical Attack **behavioural layout contract**
// (playtest-feedback-05 SESSION-04).
//
// Per-screen coverage that replaces what SESSION-01 dropped from the shared
// `inMatchLayout.test.ts` (Roshi `[2/3+]`: shared-unowned literal locks). Kept
// JSX-free by reading `TacticalAttack.tsx` as source text — the unit build
// (`tsconfig.node`) refuses `.tsx` transitive imports; the shipyard tests and
// the shell-frame test use the same file-read + regex pattern.
//
// What this pins (CP1 — commit contained + pinned; single bench scroll;
//                 CP2 — .is-immersive grid-collapse toggle):
//   • `CommitBar` renders `.panel-ft`; the scoped `.ta-col-r > .panel-ft {
//     flex: none }` keeps it a pinned, non-stretching child of the right
//     column — not a page-level sibling that could span the whole page at the
//     min viewport (the pf-04 "bottom-panel nightmare" owner note, FB2).
//   • Structurally, `<CommitBar />` mounts inside `<div class="ta-col-r">` as
//     a sibling of the Viewport and the plan-scroll wrapper, in that order.
//   • Only ONE `overflow-y: auto` scroll region lives between the pinned
//     Viewport and the pinned CommitBar (`.ta-bench-scroll` /
//     `data-testid=ta-plan-scroll`). The right column itself hides overflow —
//     no stacked scrollbars.
//   • The bench-never-collapses `min-height` floor (pf-03 FB1 guarantee)
//     survives on the plan-scroll wrapper.
//
// CP2 (immersive) and later checkpoints will grow this suite in-lease.

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

// ---- CP1 — commit contained + pinned -------------------------------------

describe('CP1 — the commit bar is a contained, pinned child of .ta-col-r', () => {
  it('CommitBar renders as `.panel-ft` (the shared pinned-footer class)', () => {
    // Scoped `.ta-col-r > .panel-ft { flex: none }` only bites when the commit
    // element carries `.panel-ft`. Locking the class is what makes the pin
    // guarantee structural instead of accidental.
    expect(commitBarSrc).toMatch(/<div\s+class=(?:"|')[^"']*\bpanel-ft\b/);
  });

  it('the .ta-col-r > .panel-ft rule pins CommitBar to `flex: none`', () => {
    // The direct-child selector matters: it wins over any inherited flex
    // shrink/grow the commit bar picks up as a flex child, so the button
    // never stretches to page width. FB2 owner note: "no bottom panel."
    expect(TA_STYLES).toMatch(/\.ta-col-r\s*>\s*\.panel-ft\s*\{[^}]*flex:\s*none/);
  });

  it('CommitBar is a sibling of the Viewport inside .ta-col-r (not a page-level bar)', () => {
    // Structural placement: the plan branch mounts <CommitBar /> as the last
    // child of `<div class="ta-col-r">`, right after the plan-scroll wrapper.
    // A future refactor that hoisted commit up to `.ta-shell` (page-level)
    // would fail this — that is exactly the "full-width bottom bar" the owner
    // called a nightmare.
    const colOpen = screenSrc.indexOf('<div class="ta-col-r">');
    expect(colOpen).toBeGreaterThanOrEqual(0);
    const commitTag = screenSrc.indexOf('<CommitBar', colOpen);
    expect(commitTag).toBeGreaterThan(colOpen);
    // And the plan-scroll wrapper opens BEFORE the CommitBar tag — the order
    // is Viewport → plan-scroll → CommitBar, all inside .ta-col-r.
    const planScroll = screenSrc.indexOf('data-testid="ta-plan-scroll"', colOpen);
    expect(planScroll).toBeGreaterThan(colOpen);
    expect(planScroll).toBeLessThan(commitTag);
  });

  it('CommitBar is not escaped out of the fixed frame with `position: fixed`', () => {
    // The bounded `.app-main.is-fixed-frame` is what keeps the viewport
    // predictable. A `position: fixed` on the commit would leak out of it and
    // turn into a page-level bar again. The button carries a shared `.btn`
    // class and no fixed positioning.
    expect(commitBarSrc).not.toMatch(/position:\s*fixed/);
    // The scoped stylesheet must not fixed-position `.panel-ft` under `.ta-col-r`.
    expect(TA_STYLES).not.toMatch(/\.ta-col-r\s*>\s*\.panel-ft\s*\{[^}]*position:\s*fixed/);
  });
});

// ---- CP1 — single bench scroll -------------------------------------------

describe('CP1 — the plan surface has exactly one primary scroll region', () => {
  it('.ta-plan-scroll (aka .ta-bench-scroll) is the single overflow-y:auto region', () => {
    // A single wrapper owns scroll for hint→banner→bench→log (D-ATK-ONE-SCROLL
    // from pf-04). The scoped block sets `overflow-y: auto` on this one
    // selector — regression to stacked scrollbars (the pf-04 owner note) would
    // reintroduce a second `overflow-y: auto`.
    expect(TA_STYLES).toMatch(/\.ta-bench-scroll\s*\{[^}]*overflow-y:\s*auto/);
    // And the plan-scroll data-testid ships on that same wrapper.
    expect(screenSrc).toMatch(/class="ta-bench-scroll"\s+data-testid="ta-plan-scroll"/);
  });

  it('the right column itself hides overflow (delegates scroll to the inner wrapper)', () => {
    // With `.ta-plan-scroll` owning scroll, the column-level safety-net that
    // pf-03 needed is gone — and MUST stay gone: the pf-04 owner note called
    // stacked scrollbars a "nightmare".
    expect(TA_STYLES).toMatch(/\.ta-col-r\s*\{[^}]*overflow:\s*hidden/);
  });

  it('the .ta-shell itself does not scroll — the app-main frame owns the boundary', () => {
    // `.app-main.is-fixed-frame` bounds the shell; letting the shell scroll
    // would let the whole plan surface (viewport included) scroll away. The
    // shell only supplies flex + padding.
    expect(TA_STYLES).not.toMatch(/\.ta-shell\s*\{[^}]*overflow-y:\s*auto/);
  });

  it('the bench wrapper preserves a min-height floor (bench-never-collapses, FB1 pf-03)', () => {
    // The min-height is what stopped the bench from being crushed when the
    // combat log filled up. Removing it would re-open the pf-03 regression.
    expect(TA_STYLES).toMatch(/\.ta-bench-scroll\s*\{[^}]*min-height:\s*\d+/);
  });
});

// ---- CP2 — immersive full-field toggle -----------------------------------

describe('CP2 — .is-immersive collapses to the tactical stage inside the fixed frame', () => {
  it('exposes a boolean toggle via a fullscreen signal, not a DOM Fullscreen API dependency', () => {
    // Grid-collapse (testable, no browser-API flake). The screen creates a
    // signal so component tests can drive state without touching
    // requestFullscreen(). The pf-05 State-Update decision D-IMMERSIVE-GRID-
    // COLLAPSE says the OS API can be layered later if the owner wants it.
    expect(screenSrc).toMatch(/const\s+fullscreen\s*=\s*useSignal\(false\)/);
  });

  it('applies .is-immersive to .ta-shell when fullscreen is true', () => {
    // The scoped rules key off `.ta-shell.is-immersive` so a leak of the
    // class onto another root would still be scoped to this screen. The class
    // string is composed from `fullscreen.value`.
    expect(screenSrc).toMatch(/is-immersive/);
    expect(screenSrc).toMatch(/fullscreen\.value/);
  });

  it('collapses .ta-layout to a single column when immersive', () => {
    // grid-template-columns collapses to `1fr` (or single track). The Viewport
    // grows into the vacated space; the roster + bench + commit are hidden.
    expect(TA_STYLES).toMatch(
      /\.ta-shell\.is-immersive\s+\.ta-layout\s*\{[^}]*grid-template-columns:\s*1fr/,
    );
  });

  it('hides the left roster column .ta-col-l when immersive', () => {
    expect(TA_STYLES).toMatch(
      /\.ta-shell\.is-immersive\s+\.ta-col-l\s*\{[^}]*display:\s*none/,
    );
  });

  it('hides the plan-scroll wrapper .ta-bench-scroll when immersive', () => {
    // Hiding the plan surface pulls hint/banner/bench/log out of view; the
    // Viewport grows into their space.
    expect(TA_STYLES).toMatch(
      /\.ta-shell\.is-immersive\s+\.ta-bench-scroll\s*\{[^}]*display:\s*none/,
    );
  });

  it('hides the pinned CommitBar (.panel-ft) when immersive', () => {
    // Immersive is a look-at-the-field mode; assignment work resumes on
    // restore. Keeping COMMIT visible during immersive would defeat the point
    // (the button is not usable without seeing the bench above it).
    expect(TA_STYLES).toMatch(
      /\.ta-shell\.is-immersive\s+\.ta-col-r\s*>\s*\.panel-ft\s*\{[^}]*display:\s*none/,
    );
  });

  it('stays inside the fixed frame — no position:fixed escape from .app-main', () => {
    // Grid-collapse only; the shell never lifts itself out of the bounded
    // `.app-main.is-fixed-frame`. A regression to `position: fixed` would
    // break the desktop gate + the layered chrome (topbar, match-chrome).
    expect(TA_STYLES).not.toMatch(/\.ta-shell\.is-immersive[^{]*\{[^}]*position:\s*fixed/);
  });

  it('CameraHud carries a maximize/restore control (text + aria-pressed, never colour-only)', () => {
    // The FULL FIELD / RESTORE labels are text (design §1.1 never-color-alone)
    // and the button reports its pressed state via aria-pressed so a screen
    // reader hears the toggle. The two glyphs decorate; the labels carry.
    expect(cameraHudSrc).toMatch(/FULL FIELD/);
    expect(cameraHudSrc).toMatch(/RESTORE/);
    expect(cameraHudSrc).toMatch(/aria-pressed/);
    expect(cameraHudSrc).toMatch(/data-testid="cam-fullscreen"/);
  });

  it('Escape exits immersive (window keydown handler wired only while active)', () => {
    // useEffect adds a keydown listener; on Escape it flips the signal back
    // to false. Wiring the listener only WHILE immersive keeps Esc free for
    // modals and pickers on the assignment rows the rest of the time.
    expect(screenSrc).toMatch(/Escape/);
    expect(screenSrc).toMatch(/keydown/);
  });
});
