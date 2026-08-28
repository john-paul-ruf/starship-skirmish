// M14 UI — Encyclopedia ShareModal (S05 checkpoint 2).
//
// Outbound-share affordance for a single build: shows the compact share TOKEN
// and the copy-paste URL (`#/share?t=<token>` — same scheme the inbound
// ShareImport screen consumes, so the URL round-trips to that screen's
// preview). Both artifacts get a COPY button that writes to the user's
// clipboard, guarded like `SkirmishSetup.onCopySeed`.
//
// XSS (§4.9): every user-authored string (the build name, the token) renders
// as a text child; `dangerouslySetInnerHTML` is lint-banned repo-wide.
//
// `Modal` (components/overlays.ts) owns the scrim, focus-trap, and Esc; this
// module composes only the panel content + footer button.

import { Modal } from '../../components/index.js';

import { shareTokenTooLong, shareUrlFor } from './model.js';

export interface ShareModalProps {
  readonly buildName: string;
  readonly token: string;
  readonly onClose: () => void;
  /**
   * Called with the label of the artifact copied (e.g. `'token'` / `'URL'`) so
   * the Encyclopedia can toast a confirmation. Optional — when absent the copy
   * still happens silently (the test env has no clipboard either).
   */
  readonly onCopied?: (what: 'token' | 'url') => void;
}

/**
 * Write `text` to the user's clipboard, guarded so a test env (or an old
 * browser missing the async clipboard API) never throws. Fire-and-forget.
 */
const copyToClipboard = (text: string): void => {
  const clipboard = (
    globalThis as {
      navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } };
    }
  ).navigator?.clipboard;
  void clipboard?.writeText?.(text);
};

export function ShareModal({ buildName, token, onClose, onCopied }: ShareModalProps) {
  const displayName = buildName.length > 0 ? buildName : '(UNNAMED BUILD)';
  // Callers on a browser get the full absolute URL; the node test env has no
  // `window` so we fall back to the relative hash form (still a valid link
  // when pasted into the same origin). `shareUrlFor` is pure — the origin
  // lookup is the only side-effect and it lives here.
  const origin = (
    globalThis as { window?: { location?: { origin?: string } } }
  ).window?.location?.origin ?? '';
  const url = shareUrlFor(token, origin);
  const tooLong = shareTokenTooLong(token);

  const onCopyToken = (): void => {
    copyToClipboard(token);
    onCopied?.('token');
  };

  const onCopyUrl = (): void => {
    copyToClipboard(url);
    onCopied?.('url');
  };

  return (
    <Modal
      title={`SHARE '${displayName}'`}
      onClose={onClose}
      aria-describedby="share-desc"
      footer={
        <div class="enc-modal-ft">
          <span class="mono-xs">ESC OR CLOSE DISMISSES.</span>
          <div class="grow" />
          <button
            type="button"
            class="btn btn-ghost"
            onClick={onClose}
            data-testid="share-build-close"
          >
            CLOSE
          </button>
        </div>
      }
    >
      <div class="stack-lg" data-testid="share-build-modal">
        <p class="t-prose" id="share-desc" style="margin:0">
          Share this build as a compact TOKEN (short, works anywhere) or as a
          copy-paste URL that opens the Import preview in another tab. Neither
          leaves your browser until you paste it.
        </p>

        <div class="panel-in enc-modal-preview">
          <div class="t-label">PLAIN TOKEN</div>
          <div class="enc-share-row">
            <code
              class="mono-xs enc-share-value"
              data-testid="share-build-token"
            >
              {token}
            </code>
            <button
              type="button"
              class="btn btn-sm"
              onClick={onCopyToken}
              data-testid="share-build-copy-token"
              title="Copy the plain token to the clipboard."
            >
              ⧉ COPY
            </button>
          </div>
        </div>

        <div class="panel-in enc-modal-preview">
          <div class="t-label">SHARE URL</div>
          <div class="enc-share-row">
            <code
              class="mono-xs enc-share-value"
              data-testid="share-build-url"
            >
              {url}
            </code>
            <button
              type="button"
              class="btn btn-sm"
              onClick={onCopyUrl}
              data-testid="share-build-copy-url"
              title="Copy the copy-paste URL to the clipboard."
            >
              ⧉ COPY
            </button>
          </div>
          {tooLong ? (
            <div
              class="mono-xs c-amber"
              data-testid="share-build-too-long"
              style="margin-top:6px"
            >
              ⚠ Token too long for a URL — copy the plain token instead.
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
