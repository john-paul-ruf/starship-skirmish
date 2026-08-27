/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// architecture §1 (stack) + §11 (Pages deployment):
//   - base path is `/starship-skirmish/` for GitHub Pages project sites; override via VITE_BASE
//     for custom-domain or fork builds
//   - preact/compat alias for react/react-dom keeps the ecosystem escape hatch open (§1)
//   - VitePWA with generateSW precaches the whole app shell so first-load-then-offline works
//     (NFR-Platform / §11)
//   - Vitest inherits the Vite config; passWithNoTests keeps pre-declared test scripts green
export default defineConfig({
  base: process.env.VITE_BASE ?? '/starship-skirmish/',
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
    },
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      strategies: 'generateSW',
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,json,ico,svg,png}'],
      },
    }),
  ],
  test: {
    passWithNoTests: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
