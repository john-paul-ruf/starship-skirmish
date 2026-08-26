// Entry point (M16 skeleton). Real composition-root wiring — routing, worker lifecycle,
// error boundary, seed generation — lands in a later feature. For now: mount a
// DESKTOP-REQUIRED-aware placeholder so `vite build` produces a real hashed bundle and
// `vite preview` serves a page without console errors.
import { render } from 'preact';

const DESKTOP_MIN_WIDTH_PX = 1024;

function App() {
  const wideEnough =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH_PX}px)`).matches;

  if (!wideEnough) {
    return (
      <main>
        <h1>STARSHIP SKIRMISH</h1>
        <p>Desktop required — please open on a screen of at least {DESKTOP_MIN_WIDTH_PX}px wide.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>STARSHIP SKIRMISH</h1>
      <p>Scaffold online. Awaiting composition root.</p>
    </main>
  );
}

const mount = document.getElementById('app');
if (mount) {
  render(<App />, mount);
}
