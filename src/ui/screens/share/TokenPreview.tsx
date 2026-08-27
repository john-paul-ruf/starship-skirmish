// M14 UI — Share/Import: token preview + designed decode-failure surface (S06).
//
// Renders whatever `previewToken(catalog, token)` produced:
//   * `status === 'ok'`  → full-fit preview (chassis + `SlotPips` fit line +
//                          points + schema/catalog chips). READ-ONLY — no
//                          repo interaction happens on this path.
//   * `status === 'error'` → the design §4.9 fail-closed panel. The reassurance
//                            "No changes were made to your Encyclopedia" is
//                            unconditional — every decode failure MUST show it.
//
// UNTRUSTED-INPUT DISCIPLINE (NFR-Security, lint-enforced):
//   * The preview `name` came from a foreign token. It renders as a text-node
//     child of a span — Preact escapes; no `dangerouslySetInnerHTML`.
//   * The error's `message` and any decoded field render the same way.
//   * We never interpolate the token or any decoded value into a URL or into
//     an attribute that would execute code.

import { SlotPips, Chip } from '../../components/index.js';
import type { Preview, DecodeErrorCopy } from './model.js';

// ---- Success preview -----------------------------------------------------

export interface TokenPreviewOkProps {
  readonly preview: Extract<Preview, { status: 'ok' }>;
}

export function TokenPreviewOk(props: TokenPreviewOkProps) {
  const { preview } = props;
  const { build, chassis, klass, layout, filled, points } = preview;
  const filledCount = filled.filter((f) => f).length;
  const totalSlots = layout.length;

  return (
    <section class="panel" data-testid="share-preview">
      <div class="panel-hd">
        <span class="t-label">IMPORT PREVIEW</span>
        <div class="grow"></div>
        <span class="mono-xs">NOT YET IN YOUR ENCYCLOPEDIA</span>
      </div>
      <div class="panel-bd stack-lg">
        {/* identity */}
        <div style="display:flex;align-items:flex-start;gap:var(--s4);flex-wrap:wrap">
          <div class="grow" style="min-width:0">
            <div
              class="t-h1"
              style="margin:0 0 var(--s1);word-break:break-word"
              data-testid="share-preview-name"
            >
              {build.name}
            </div>
            <div class="mono-xs" data-testid="share-preview-chassis">
              {chassis.name.toUpperCase()} · {klass.name.toUpperCase()}
            </div>
            <div style="display:flex;gap:var(--s1);flex-wrap:wrap;margin-top:var(--s2)">
              <Chip>schemaVersion {String(build.schemaVersion)}</Chip>
              <Chip>catalogVersion {String(build.catalogVersion)}</Chip>
              <Chip tone="green">✓ CHECKSUM OK</Chip>
            </div>
          </div>
          <div style="text-align:right;line-height:1;flex:none">
            <div class="t-num-xl c-amber" data-testid="share-preview-points">
              {String(points)}
            </div>
            <div class="t-label">PTS</div>
          </div>
        </div>

        {/* fit line */}
        <div class="panel-in" style="padding:var(--s3)">
          <div
            style="display:flex;align-items:center;gap:var(--s2);margin-bottom:var(--s2)"
          >
            <span class="t-label">FIT</span>
            <div class="grow"></div>
            <span class="mono-xs">
              {String(filledCount)} FILLED · {String(totalSlots - filledCount)} EMPTY ·
              EMPTY BAYS ARE LEGAL
            </span>
          </div>
          <SlotPips layout={layout} filled={filled} />
        </div>
      </div>
    </section>
  );
}

// ---- Failure surface (design §4.9) ---------------------------------------

export interface TokenPreviewErrorProps {
  readonly copy: DecodeErrorCopy;
}

export function TokenPreviewError(props: TokenPreviewErrorProps) {
  const { copy } = props;
  return (
    <section class="panel" data-testid="share-error">
      <div class="panel-hd">
        <span class="t-label">DECODE FAILED</span>
        <div class="grow"></div>
        <span class="chip chip-red">✖ FAIL CLOSED</span>
      </div>
      <div class="panel-bd stack">
        <div
          class="banner banner-danger"
          role="alert"
          style="align-items:flex-start"
        >
          <span class="c-red" style="font-size:16px" aria-hidden="true">✖</span>
          <div class="grow">
            <div
              style="font-weight:700;letter-spacing:.08em;color:var(--ink-hi)"
              data-testid="share-error-title"
            >
              {copy.title}
            </div>
            <div class="t-meta" data-testid="share-error-reassurance">
              {copy.reassurance}
            </div>
          </div>
        </div>
        <p class="mono-xs" data-testid="share-error-detail">
          {copy.detail}
        </p>
      </div>
    </section>
  );
}
