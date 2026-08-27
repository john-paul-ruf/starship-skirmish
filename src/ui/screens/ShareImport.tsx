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
import { Tabs, type TabsOption } from '../components/index.js';
import { CollisionModal } from './share/CollisionModal.js';
import { JsonDropZone } from './share/JsonDropZone.js';
import { TokenPreviewError, TokenPreviewOk } from './share/TokenPreview.js';
import {
  errorCopy,
  previewToken,
  resolveAddAction,
  suggestRenamed,
  type CollisionChoice,
  type Preview,
} from './share/model.js';

// ---- Tab identifiers ------------------------------------------------------

type TabId = 'token' | 'json';

const TABS: readonly TabsOption<TabId>[] = [
  { id: 'token', label: 'SHARE TOKEN' },
  { id: 'json', label: 'JSON FLEET IMPORT' },
];

// ---- Identity minters (UI boundary — §6) ---------------------------------

/**
 * Mint a fresh v4 UUID. Persist's `applyImport` mints these too but on our
 * paths we mint here at the UI boundary (as S05 does for the Shipyard save).
 * Falls back to a v4-shaped pseudo-uuid built from `crypto.getRandomValues`
 * on the off-chance `randomUUID` is missing (older Safari inside a subframe).
 */
const mintId = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.randomUUID !== undefined) return c.randomUUID();
  const bytes = new Uint8Array(16);
  c?.getRandomValues?.(bytes);
  // Force the v4 + variant bits.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

const now = (): string => new Date().toISOString();

// ---- Screen --------------------------------------------------------------

/**
 * The Share/Import screen. D-PLACEHOLDER: replaces the S03 placeholder body
 * while keeping the export name stable.
 */
export function ShareImport() {
  const { catalog, repo, route, navigate, toast } = useApp();

  // Route-carried token is the initial paste value. `route.value` is a
  // ReadonlySignal — reading `.value` inside the render subscribes.
  const currentRoute = route.value;
  const routeToken = currentRoute.name === 'share' ? currentRoute.token : undefined;

  const [tab, setTab] = useState<TabId>('token');
  const [token, setToken] = useState<string>(routeToken ?? '');
  const [collision, setCollision] = useState<null | {
    preview: Extract<Preview, { status: 'ok' }>;
    collidingIds: readonly string[];
    suggestedRename: string;
  }>(null);

  // A route re-arrival (user pasted a new URL) should refresh the local
  // paste value once. We track the last-seen route token so re-renders don't
  // clobber a manual edit.
  const [lastRouteToken, setLastRouteToken] = useState<string | undefined>(routeToken);
  if (routeToken !== lastRouteToken) {
    setLastRouteToken(routeToken);
    setToken(routeToken ?? '');
  }

  const preview = useMemo(() => previewToken(catalog, token), [catalog, token]);

  // ---- ADD button click handler (checkpoint 2) --------------------------

  const commitAction = (choice: CollisionChoice, editedName: string) => {
    if (collision === null) return;
    const action = resolveAddAction({
      preview: collision.preview,
      choice,
      editedName,
      collidingIds: collision.collidingIds,
      mintId,
      now,
    });
    setCollision(null);
    if (action.writeAs === 'cancel') return;
    const result = repo.put(action.build);
    if (!result.ok) {
      toast(`Could not save: ${result.reason}`, 'danger');
      return;
    }
    const actionLabel =
      action.writeAs === 'replace' ? 'replaced' : action.action === 'renamed' ? 'renamed' : 'added';
    toast(`Build ${actionLabel} — ${action.build.name}`, 'default');
    navigate({ name: 'encyclopedia' });
  };

  const onAddClicked = () => {
    if (preview.status !== 'ok') return;
    const collidingIds = repo.findByNameKey(preview.nameKey);
    if (collidingIds.length === 0) {
      // Direct-insert path — no collision, no modal.
      const action = resolveAddAction({
        preview,
        choice: 'rename',
        collidingIds: [],
        mintId,
        now,
      });
      if (action.writeAs !== 'insert') return;
      const result = repo.put(action.build);
      if (!result.ok) {
        toast(`Could not save: ${result.reason}`, 'danger');
        return;
      }
      toast(`Build added — ${action.build.name}`, 'default');
      navigate({ name: 'encyclopedia' });
      return;
    }
    // Collision path — open the modal with a pre-populated rename suggestion.
    setCollision({
      preview,
      collidingIds,
      suggestedRename: suggestRenamed(preview.build.name, (nk) => repo.findByNameKey(nk)),
    });
  };

  const dismissCollision = () => {
    setCollision(null);
  };

  return (
    <div class="panel ticks" data-testid="screen-share">
      <div class="panel-hd">
        <span class="t-h2">SHARE / IMPORT</span>
        <div class="grow"></div>
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          onClick={() => {
            navigate({ name: 'encyclopedia' });
          }}
          data-testid="nav-encyclopedia"
        >
          ← ENCYCLOPEDIA
        </button>
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
                <input
                  type="text"
                  class="field"
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
              <>
                <TokenPreviewOk preview={preview} />
                <div style="display:flex;gap:var(--s2);align-items:center">
                  <span class="mono-xs c-dim">
                    NOTHING IS WRITTEN UNTIL YOU CONFIRM.
                  </span>
                  <div class="grow"></div>
                  <button
                    type="button"
                    class="btn btn-primary"
                    onClick={onAddClicked}
                    data-testid="share-add-btn"
                  >
                    ⭳ ADD TO ENCYCLOPEDIA
                  </button>
                </div>
              </>
            ) : token.length === 0 ? null : (
              <TokenPreviewError copy={errorCopy(preview.error)} />
            )}
          </div>
        ) : (
          <div data-testid="share-tab-json">
            <JsonDropZone catalog={catalog} repo={repo} />
          </div>
        )}
      </div>

      {collision !== null ? (
        <CollisionModal
          incomingName={collision.preview.build.name}
          collidingIds={collision.collidingIds}
          suggestedRename={collision.suggestedRename}
          onResolve={commitAction}
          onClose={dismissCollision}
        />
      ) : null}
    </div>
  );
}
