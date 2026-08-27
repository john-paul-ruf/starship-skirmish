// M14 UI — Post-match screen (S01 placeholder, S07 body).
//
// D-PLACEHOLDER: S01 ships this with a stable export name + `data-testid`
// root; S07 replaces the body (outcome, seed + replay, per-ship fates, combat
// log, `rematch`) without re-editing the screens barrel or the `App.tsx`
// outlet.

export function PostMatch() {
  return (
    <section class="panel" data-testid="screen-post-match">
      POST-MATCH — placeholder
    </section>
  );
}
