// Entry point (M16). The ONLY file allowed to import `src/app` — enforced by
// the ESLint `APP_IMPORT_PATTERN` rule (architecture §5). Loads the design
// system stylesheet exactly once here, then hands the `#app` element to
// `boot()` which runs the bootstrap pipeline and mounts the shell.
//
// Chose main.tsx (not boot.tsx) as the stylesheet's single import site: the
// design tokens are a boot-time concern, not a composition concern.

import './ui/styles/index.css';

import { boot } from './app/index.js';

const mount = document.getElementById('app');
if (mount !== null) {
  boot(mount);
}
