// M14 UI — Shipyard save bar (S05, CP4).
//
// Name input + tag chip row + SAVE + COPY SHARE LINK. Persists no state
// itself — the parent (`Shipyard.tsx`) owns `nameDraft`/`tagsDraft` signals
// and orchestrates the save/share pipeline. `SaveBar` is a controlled
// composition of already-tested primitives.
//
// Save gates on FIT legality only — budget is a Skirmish Setup concern
// (§4.4 corollary; see STATE.md design decisions).

import { Chip, Field } from '../../components/index.js';

import type { ValidateError } from '../../../io/index.js';

interface SaveBarProps {
  readonly name: string;
  readonly tags: readonly string[];
  readonly tagDraft: string;
  readonly canSave: boolean;
  /** Non-empty on validate failure — surfaces name/tag caps + slot errors. */
  readonly errors: readonly ValidateError[];
  readonly onNameChange: (v: string) => void;
  readonly onTagDraftChange: (v: string) => void;
  readonly onAddTag: () => void;
  readonly onRemoveTag: (tag: string) => void;
  readonly onSave: () => void;
  readonly onShare: () => void;
}

export function SaveBar(props: SaveBarProps) {
  const {
    name,
    tags,
    tagDraft,
    canSave,
    errors,
    onNameChange,
    onTagDraftChange,
    onAddTag,
    onRemoveTag,
    onSave,
    onShare,
  } = props;

  return (
    <div class="panel" style="margin-top:12px" data-testid="shipyard-savebar">
      <div class="panel-hd">
        <span class="t-h2">ACTIONS</span>
        <span class="grow" />
        {canSave ? (
          <Chip tone="green">✓ VALID FIT</Chip>
        ) : (
          <Chip tone="amber">● NEEDS ATTENTION</Chip>
        )}
      </div>
      <div class="panel-bd stack">
        <div>
          <label class="t-label" for="shipyard-savebar-name">
            BUILD NAME
          </label>
          <Field
            id="shipyard-savebar-name"
            value={name}
            onInput={(ev) =>
              onNameChange((ev.currentTarget as HTMLInputElement).value)
            }
            spellcheck={false}
            maxLength={128}
            aria-label="Build name"
          />
        </div>
        <div>
          <label class="t-label" for="shipyard-savebar-tag">
            TAGS
          </label>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
            {tags.map((tag) => (
              <span
                key={tag}
                class="chip"
                data-testid={`shipyard-tag-${tag}`}
                style="display:flex;align-items:center;gap:4px"
              >
                {tag}
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  aria-label={`Remove tag ${tag}`}
                  onClick={() => onRemoveTag(tag)}
                  style="height:16px;padding:0 4px;font-size:10px"
                >
                  ✕
                </button>
              </span>
            ))}
            <div style="display:flex;gap:4px;flex:1 1 auto;min-width:120px">
              <Field
                id="shipyard-savebar-tag"
                value={tagDraft}
                onInput={(ev) =>
                  onTagDraftChange(
                    (ev.currentTarget as HTMLInputElement).value,
                  )
                }
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter') {
                    ev.preventDefault();
                    onAddTag();
                  }
                }}
                spellcheck={false}
                aria-label="Add tag"
                placeholder="add-tag"
                class="grow"
              />
              <button
                type="button"
                class="btn btn-sm btn-ghost"
                onClick={onAddTag}
                aria-label="Add tag"
                data-testid="shipyard-add-tag-button"
              >
                + TAG
              </button>
            </div>
          </div>
        </div>
        {errors.length > 0 ? (
          <div
            class="mono-xs"
            style="color:var(--red);line-height:1.5;padding-top:6px"
            data-testid="shipyard-savebar-errors"
          >
            {errors.map((e) => (
              <div key={e.code}>▸ {e.message}</div>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          class="btn btn-primary grow"
          onClick={onSave}
          disabled={!canSave || undefined}
          data-testid="shipyard-save-button"
        >
          ▣ SAVE TO ENCYCLOPEDIA
        </button>
        <button
          type="button"
          class="btn"
          onClick={onShare}
          disabled={!canSave || undefined}
          data-testid="shipyard-share-button"
        >
          ⧉ COPY SHARE LINK
        </button>
      </div>
    </div>
  );
}
