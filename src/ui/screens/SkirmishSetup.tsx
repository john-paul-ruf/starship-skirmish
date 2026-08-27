// M14 UI — Skirmish Setup screen (S01 placeholder, S04 body).
//
// D-PLACEHOLDER: S01 ships this with a stable export name + `data-testid`
// root; S04 replaces the body (budget / draft / opponents / tiers / arena /
// seed → LAUNCH via `startMatch`) without re-editing the screens barrel or
// the `App.tsx` outlet.

export function SkirmishSetup() {
  return (
    <section class="panel" data-testid="screen-skirmish-setup">
      SKIRMISH SETUP — placeholder
    </section>
  );
}
