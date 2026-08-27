// M14 UI — Tactical Attack screen (S01 placeholder, S06 body).
//
// D-PLACEHOLDER: S01 ships this with a stable export name + `data-testid`
// root; S06 replaces the body (blind fire assignment, hit-chance via
// `hitChanceFor`, called shots, `commitAttack`) without re-editing the screens
// barrel or the `App.tsx` outlet.

export function TacticalAttack() {
  return (
    <section class="panel" data-testid="screen-tactical-attack">
      TACTICAL ATTACK — placeholder
    </section>
  );
}
