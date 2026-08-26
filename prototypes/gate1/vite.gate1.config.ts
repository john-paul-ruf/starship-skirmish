// Standalone Vite config for the Gate 1 prototype (M18, disposable — FR-32).
//
// This config exists so the prototype can be served on its own port without
// touching the app build. It is invoked as:
//
//   npx vite --config prototypes/gate1/vite.gate1.config.ts
//
// The prototype root is this directory; entry HTML is `./index.html`. Vite is
// allowed to reach up to the repo root so the prototype can import the real
// deterministic sim from `../../src/sim/...` — the whole point of Gate 1 is to
// render the actual physics core (architecture §12).
//
// Port is Jikijitsu-assigned via the Orchestration Envelope: `port:gate1 = 8082`.
// strictPort makes the server refuse to silently fall back to another port —
// if 8082 is in use we want a hard failure, not a wandering URL.

import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

export default defineConfig({
  root: HERE,
  base: './',
  // The prototype imports from `../../src/sim` — allow Vite's file server to
  // reach the repo root, but no farther.
  server: {
    port: 8082,
    strictPort: true,
    host: '127.0.0.1',
    fs: { allow: [REPO_ROOT] },
  },
  // Disposable prototype — no need for the app's PWA plugin, alias table, or
  // Vitest test config. A blank Vite config is deliberate.
});
