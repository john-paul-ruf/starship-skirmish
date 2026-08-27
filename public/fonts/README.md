# public/fonts

**Content drop, not a code TODO.** `src/ui/styles/fonts.css` declares
`@font-face` rules that reference the binaries below; until they land the
`--font-mono` / `--font-ui` stacks fall back to the OS monospace and
system-UI faces and the app stays fully functional. When the binaries
arrive, drop them in this directory alongside this README.

## Required binaries

| File | Face / weight | Notes |
|------|---------------|-------|
| `JetBrainsMono-Regular.woff2` | JetBrains Mono 400 | body / readout (design §1.2) |
| `JetBrainsMono-Medium.woff2`  | JetBrains Mono 500 | label |
| `JetBrainsMono-Bold.woff2`    | JetBrains Mono 700 | display / h1 / h2 / numeric |
| `Inter-Regular.woff2`         | Inter 400          | `.t-prose` only |

## Rules

- **Self-hosted only.** The app CSP declares `font-src 'self'`
  (`index.html`), and NFR-Platform (offline after first load) forbids
  CDN fonts. Never add a Google Fonts / `https://` `@import` in
  `src/ui/styles/**`.
- **`woff2` only.** Every browser Starship Skirmish targets supports
  `woff2`; there is no fallback format worth its bytes.
- **Subset if you can.** JetBrains Mono in particular ships thousands of
  glyphs the console never uses. A Latin-1 + specials subset is enough
  for every string in the design spec.
- **No hinting on desktop.** These render on WebGL2-capable browsers at
  1280px+; auto-hint output is fine.

## Follow-up

Font subsetting is a separate content task — flag for Forge whether it
should be a micro-session.
