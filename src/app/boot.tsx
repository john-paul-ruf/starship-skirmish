// M16 App — the boot function `main.tsx` calls.
//
// `boot(mount)` runs the bootstrap pipeline, wraps the shell in the
// `<AppContext.Provider>` (D-IOC-SEAM) and an `<ErrorBoundary>`, and mounts
// into the supplied element. Bootstrap failures render `<ErrorFallback>` in
// place of the shell — no exception ever escapes to the DOM.
//
// This file is intentionally thin: composition only. All real assembly lives
// in `bootstrap.ts` + `session.ts`.

import { render } from 'preact';

import { App, AppContext } from '../ui/index.js';
import { ErrorFallback } from '../ui/components/index.js';
import { bootstrap, type BootstrapOptions } from './bootstrap.js';
import { ErrorBoundary } from './errorBoundary.js';

/**
 * Mount the app into the supplied element. `opts` is forwarded to bootstrap
 * — production `main.tsx` passes nothing; tests + tools pass an injected
 * store + initial hash.
 *
 * Never throws: a bootstrap failure renders `<ErrorFallback>` instead of the
 * shell so a broken catalog lockfile is still a page you can look at.
 */
export const boot = (mount: HTMLElement, opts: BootstrapOptions = {}): void => {
  const result = bootstrap(opts);
  if (!result.ok) {
    render(<ErrorFallback error={result.error} />, mount);
    return;
  }
  render(
    <AppContext.Provider value={result.session.services}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </AppContext.Provider>,
    mount,
  );
};
