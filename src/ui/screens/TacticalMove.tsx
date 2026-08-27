// M14 UI — Tactical Movement screen (S01 placeholder, S05 body).
//
// D-PLACEHOLDER: S01 ships this with a stable export name + `data-testid`
// root; S05 replaces the body (blind arc plotting via `previewArc`,
// boundary-scream, `commitMovement`) without re-editing the screens barrel or
// the `App.tsx` outlet.

export function TacticalMove() {
  return (
    <section class="panel" data-testid="screen-tactical-move">
      TACTICAL MOVE — placeholder
    </section>
  );
}
