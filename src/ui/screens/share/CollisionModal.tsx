// M14 UI — Share/Import: name-collision resolution modal (S06 checkpoint 2).
//
// The ONE surface (design §4.9) where the user is asked "your Encyclopedia
// already has a build with this name — what do you want to do?". Three
// choices, ONE is the default (rename), NONE is silently applied — the modal
// forces an explicit resolution before any write happens.
//
//   * RENAME  → suggested unique name pre-filled (via `suggestRenamed`); the
//               user may edit it before confirming. Both the incoming and
//               existing builds survive.
//   * REPLACE → destructive; the first colliding entry is overwritten in
//               place. Marked with the reserved-red palette (never-color-alone
//               + explicit "DESTRUCTIVE" label so the meaning survives without
//               color).
//   * CANCEL  → writes nothing; the Encyclopedia stays byte-identical.
//
// Untrusted-input discipline: the incoming preview name and existing entry
// names are text nodes (Preact escapes; no innerHTML). The name field is a
// controlled `Field` primitive — no dangerouslySetInnerHTML.
//
// A11y: the underlying `Modal` component sets `aria-modal='true'`, traps
// focus, and closes on Esc/scrim (design §4.8 / NFR-Accessibility). Role
// `alertdialog` because this modal blocks a destructive-capable action.

import { useState } from 'preact/hooks';

import { Banner, Chip, Modal } from '../../components/index.js';
import type { CollisionChoice } from './model.js';

export interface CollisionModalProps {
  /** The incoming build's display name (from the token preview). */
  readonly incomingName: string;
  /** Ids of existing entries whose nameKey collides with `incomingName`. */
  readonly collidingIds: readonly string[];
  /** Pre-populated suggestion for the rename path (via `suggestRenamed`). */
  readonly suggestedRename: string;
  /** Called with the user's resolved choice + the (possibly edited) rename. */
  readonly onResolve: (choice: CollisionChoice, editedName: string) => void;
  /** Called on Esc / scrim / CANCEL button — equivalent to `onResolve('cancel', …)`. */
  readonly onClose: () => void;
}

export function CollisionModal(props: CollisionModalProps) {
  const { incomingName, collidingIds, suggestedRename, onResolve, onClose } = props;
  const [choice, setChoice] = useState<CollisionChoice>('rename');
  const [renameValue, setRenameValue] = useState<string>(suggestedRename);

  const collisionCount = collidingIds.length;

  const confirm = () => {
    onResolve(choice, renameValue);
  };

  const footer = (
    <div style="display:flex;gap:var(--s2);width:100%;align-items:center">
      <span class="mono-xs" data-testid="collision-reassurance">
        NOTHING IS WRITTEN UNTIL YOU CONFIRM.
      </span>
      <div class="grow"></div>
      <button
        type="button"
        class="btn btn-ghost"
        onClick={onClose}
        data-testid="collision-cancel-btn"
      >
        CANCEL
      </button>
      <button
        type="button"
        class={
          choice === 'replace' ? 'btn btn-danger' : 'btn btn-primary'
        }
        onClick={confirm}
        data-testid="collision-confirm-btn"
      >
        {choice === 'rename'
          ? '⭳ ADD AS RENAMED'
          : choice === 'replace'
          ? '⚠ REPLACE EXISTING'
          : '✕ CANCEL IMPORT'}
      </button>
    </div>
  );

  return (
    <Modal
      title="NAME COLLISION"
      role="alertdialog"
      onClose={onClose}
      footer={footer}
    >
      <div class="stack" data-testid="share-collision-modal">
        <Banner
          tone="danger"
          role="alert"
          class=""
        >
          <span class="c-red" style="font-size:16px" aria-hidden="true">✖</span>
          <div class="grow" style="margin-left:var(--s2)">
            <div
              style="font-weight:700;letter-spacing:.08em;color:var(--ink-hi)"
              data-testid="collision-headline"
            >
              A BUILD NAMED{' '}
              <span class="c-hi">‘{incomingName}’</span>{' '}
              ALREADY EXISTS IN YOUR ENCYCLOPEDIA.
            </div>
            <div class="t-meta">
              {collisionCount === 1
                ? '1 EXISTING BUILD MATCHES THIS NAME. NOTHING IS SILENTLY OVERWRITTEN — PICK ONE:'
                : `${String(collisionCount)} EXISTING BUILDS MATCH THIS NAME. NOTHING IS SILENTLY OVERWRITTEN — PICK ONE:`}
            </div>
          </div>
        </Banner>

        {/* Rename row */}
        <label
          class="panel-in"
          style={cardStyle(choice === 'rename', false)}
          data-testid="collision-choice-rename"
        >
          <div style="display:flex;gap:var(--s3);align-items:flex-start">
            <input
              type="radio"
              name="collision-choice"
              value="rename"
              checked={choice === 'rename'}
              onChange={() => setChoice('rename')}
              aria-label="Rename the incoming build"
              style="margin-top:3px;flex:none"
            />
            <div class="grow">
              <div style="font-weight:700;letter-spacing:.08em;color:var(--ink-hi)">
                ✎ RENAME THE INCOMING BUILD
              </div>
              <div class="t-meta" style="margin-bottom:var(--s2)">
                Recommended. Both builds are kept. Edit the name if you want something clearer.
              </div>
              <input
                type="text"
                class="field"
                value={renameValue}
                onInput={(e) => {
                  setRenameValue((e.currentTarget as HTMLInputElement).value);
                }}
                aria-label="New build name"
                maxLength={48}
                spellcheck={false}
                data-testid="collision-rename-field"
              />
              <div class="mono-xs c-dim" style="margin-top:var(--s1)">
                NAME IS STORED AS TEXT AND RENDERED AS TEXT — NEVER AS MARKUP (NFR-SECURITY).
              </div>
            </div>
          </div>
        </label>

        {/* Replace row */}
        <label
          class="panel-in"
          style={cardStyle(choice === 'replace', true)}
          data-testid="collision-choice-replace"
        >
          <div style="display:flex;gap:var(--s3);align-items:flex-start">
            <input
              type="radio"
              name="collision-choice"
              value="replace"
              checked={choice === 'replace'}
              onChange={() => setChoice('replace')}
              aria-label="Replace the existing build"
              style="margin-top:3px;flex:none"
            />
            <div class="grow">
              <div style="font-weight:700;letter-spacing:.08em;color:var(--ink-hi)">
                ⚠ REPLACE EXISTING
              </div>
              <div class="t-meta">
                <span class="c-red" style="font-weight:700">DESTRUCTIVE.</span>{' '}
                Your saved build is deleted and cannot be recovered — no trash,
                no history, no server copy.
              </div>
              <div style="margin-top:var(--s2)">
                <Chip tone="red">✖ IRREVERSIBLE</Chip>
              </div>
            </div>
          </div>
        </label>

        {/* Cancel row */}
        <label
          class="panel-in"
          style={cardStyle(choice === 'cancel', false)}
          data-testid="collision-choice-cancel"
        >
          <div style="display:flex;gap:var(--s3);align-items:flex-start">
            <input
              type="radio"
              name="collision-choice"
              value="cancel"
              checked={choice === 'cancel'}
              onChange={() => setChoice('cancel')}
              aria-label="Cancel the import"
              style="margin-top:3px;flex:none"
            />
            <div class="grow">
              <div style="font-weight:700;letter-spacing:.08em;color:var(--ink-hi)">
                ✕ CANCEL IMPORT
              </div>
              <div class="t-meta">
                Discard the incoming build. Your Encyclopedia is untouched.
              </div>
            </div>
          </div>
        </label>
      </div>
    </Modal>
  );
}

/**
 * Border + background styling for a radio card. `on` = selected; `danger` =
 * red-highlighted when selected (replace path). Uses design tokens verbatim
 * (--line, --line-hot, --cyan, --red) — no hard-coded colors.
 */
const cardStyle = (on: boolean, danger: boolean): string => {
  const border = on
    ? danger
      ? 'border-color:var(--red);box-shadow:0 0 0 1px rgba(255,46,99,.35)'
      : 'border-color:var(--cyan);box-shadow:var(--glow-1)'
    : 'border-color:var(--line)';
  const background = on
    ? danger
      ? 'background:rgba(255,46,99,.07)'
      : 'background:rgba(34,227,255,.07)'
    : 'background:var(--panel-in)';
  return `padding:var(--s3);cursor:pointer;${border};${background}`;
};
