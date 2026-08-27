// M14 UI — Share/Import screen (S06 body).
//
// Owns the `share` route (design §4.9). Two inbound paths, both untrusted
// (architecture §4 / §10 / NFR-Security):
//
//   * TOKEN — arrives in `location.hash` (S03 routes `#/share?t=…` here, the
//     bootstrap does NOT decode) or is pasted. Decode via `io.decodeShareToken`
//     (TOTAL: every failure returns a typed DecodeError) → render the full-fit
//     preview OR the designed fail-closed error. NOTHING is written until the
//     user hits ADD.
//   * JSON — dropped/selected file, pre-flight hard caps, `io.importLibrary`
//     parse → `persist.applyImport` write, per-build IMPORTED/RENAMED/…
//     report. Additive-only; a partial file imports the valid rest.
//
// FAIL-CLOSED POSTURE (design §4.9): a bad token or oversize file leaves the
// repo BYTE-IDENTICAL. This screen adds no parsing, caps, or validation of
// its own — it renders what io/persist return.
//
// XSS: names/tags from the token or the file are untrusted. Everything
// renders as text nodes (Preact escapes). `dangerouslySetInnerHTML` +
// `Element.innerHTML` are repo-wide banned by ESLint (architecture §10).
//
// D-IOC-SEAM: services come from `useApp()` — this screen never imports
// `src/app` (lint enforced). D-PLACEHOLDER: this replaces the S03 placeholder
// body; the export name `ShareImport` stays STABLE so the `screens/index.ts`
// barrel + `App.tsx` outlet never re-edit.

import { useMemo, useState } from 'preact/hooks';

import { useApp } from '../appContext.js';
import { Button, Field, Tabs, type TabsOption } from '../components/index.js';
import { TokenPreviewError, TokenPreviewOk } from './share/TokenPreview.js';
import { errorCopy, previewToken } from './share/model.js';

// ---- Tab identifiers ------------------------------------------------------

type TabId = 'token' | 'json';

const TABS: readonly TabsOption<TabId>[] = [
  { id: 'token', label: 'SHARE TOKEN' },
  { id: 'json', label: 'JSON FLEET IMPORT' },
];

// ---- Screen --------------------------------------------------------------

/**
 * The Share/Import screen. D-PLACEHOLDER: replaces the S03 placeholder body
 * while keeping the export name stable.
 */
export function ShareImport() {
  const { catalog, route, navigate } = useApp();

  // Route-carried token is the initial paste value. `route.value` is a
  // ReadonlySignal — reading `.value` inside the render subscribes.
  const currentRoute = route.value;
  const routeToken = currentRoute.name === 'share' ? currentRoute.token : undefined;

  const [tab, setTab] = useState<TabId>('token');
  const [token, setToken] = useState<string>(routeToken ?? '');

  // A route re-arrival (user pasted a new URL) should refresh the local
  // paste value once. We track the last-seen route token so re-renders don't
  // clobber a manual edit.
  const [lastRouteToken, setLastRouteToken] = useState<string | undefined>(routeToken);
  if (routeToken !== lastRouteToken) {
    setLastRouteToken(routeToken);
    setToken(routeToken ?? '');
  }

  const preview = useMemo(() => previewToken(catalog, token), [catalog, token]);

  return (
    <div class="panel ticks" data-testid="screen-share">
      <div class="panel-hd">
        <span class="t-h2">SHARE / IMPORT</span>
        <div class="grow"></div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            navigate({ name: 'encyclopedia' });
          }}
          data-testid="nav-encyclopedia"
        >
          ← ENCYCLOPEDIA
        </Button>
      </div>
      <div class="panel-bd stack-lg">
        <Tabs
          tabs={TABS}
          activeId={tab}
          onChange={setTab}
          aria-label="Share / Import mode"
        />

        {tab === 'token' ? (
          <div class="stack-lg" data-testid="share-tab-token">
            <div class="panel-in" style="padding:var(--s3)">
              <label class="t-label" for="share-token-input">
                PASTE A SHARE TOKEN OR OPEN A #/share?t=… LINK
              </label>
              <div style="margin-top:var(--s2)">
                <Field
                  id="share-token-input"
                  value={token}
                  onInput={(e) => {
                    setToken((e.currentTarget as HTMLInputElement).value);
                  }}
                  placeholder="Sb…"
                  autoComplete="off"
                  spellcheck={false}
                  data-testid="share-token-input"
                />
              </div>
              <div
                class="mono-xs c-dim"
                style="margin-top:var(--s2)"
                data-testid="share-token"
              >
                {token.length === 0 ? 'TOKEN: (none)' : `TOKEN: ${token}`}
              </div>
            </div>

            {preview.status === 'ok' ? (
              <TokenPreviewOk preview={preview} />
            ) : token.length === 0 ? null : (
              <TokenPreviewError copy={errorCopy(preview.error)} />
            )}
          </div>
        ) : (
          <div class="panel-in stack" data-testid="share-tab-json" style="padding:var(--s3)">
            <p class="t-prose">
              JSON fleet import lands in checkpoint 3 of this session. Drop-zone,
              pre-flight caps, and the per-build report will render here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
