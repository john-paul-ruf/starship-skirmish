// M16 App — top-level error boundary.
//
// Catches every uncaught throw in the mounted tree and hands the error to
// `ErrorFallback` from the shared component library. Without this, a bug
// inside a screen would blow away the shell and leave a blank body — an
// FR-7 fail-closed violation.
//
// Implemented as a Preact class component (not `useErrorBoundary`) so the
// boundary is a real subclass that owns render behaviour, not just a hook.
// `preact` classes still support `componentDidCatch` + `getDerivedStateFromError`.

import { Component, type ComponentChildren, type ErrorInfo } from 'preact';

import { ErrorFallback } from '../ui/components/index.js';

// ---- Props / state --------------------------------------------------------

interface ErrorBoundaryProps {
  readonly children?: ComponentChildren;
}

interface ErrorBoundaryState {
  readonly error: unknown;
}

// ---- Component ------------------------------------------------------------

/**
 * Wrap the mounted shell (or any subtree). On any thrown error the boundary
 * swaps its children for `<ErrorFallback>` and offers a "retry" button that
 * clears the caught error and re-mounts the subtree.
 *
 * NOTE: `console.error` in `componentDidCatch` is deliberate — the CSP allows
 * `connect-src 'self'` only (no analytics), so the browser devtools console
 * is the only diagnostic channel available. That log is a debugging aid, not
 * a UX signal.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static override getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[starship-skirmish] uncaught in tree:', error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ComponentChildren {
    if (this.state.error !== null && this.state.error !== undefined) {
      return <ErrorFallback error={this.state.error} onReset={this.reset} />;
    }
    return this.props.children;
  }
}
