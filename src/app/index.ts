// M16 App — composition-root barrel.
//
// Only `src/main.tsx` imports from here — enforced by the ESLint
// `APP_IMPORT_PATTERN` rule (architecture §5). `boot` is the sole public
// entry point.

export { boot } from './boot.js';
export type { BootstrapOptions } from './bootstrap.js';
