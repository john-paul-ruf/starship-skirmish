/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Minimal configuration for CP1: registers Vitest so the pre-declared `test:*` npm scripts stay
// green (passWithNoTests) before any test files exist. The full build config — base path, preact
// alias, PWA plugin — lands in CP2.
export default defineConfig({
  test: {
    passWithNoTests: true,
    environment: 'node',
  },
});
