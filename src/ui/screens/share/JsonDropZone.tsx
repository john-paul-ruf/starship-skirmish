// M14 UI — Share/Import: JSON drop zone + pre-flight (S06 checkpoint 3).
//
// The DOM half of the JSON import path — reads the dropped or file-picked
// `.json` into memory and delegates the pipeline to `runJsonImport` (in
// `./model.ts`, node-env unit-testable). All caps + rejections + apply
// happen there; this file is presentation only.
//
// PRE-FLIGHT (§10 DoS-on-self — hard caps precede EVERY allocation):
//   * `file.size > FILE_MAX_BYTES` → reject; NO file read, NO parse.
//   * `repo.headroom().remainingBytes < file.size` → reject; no read.
//   * `entries.length + valid.length > BUILDS_MAX` → reject after parse.
// Each rejection surfaces a designed error (§4.9): clear message, NO state
// change.
//
// XSS: file-name display is a text node; no `dangerouslySetInnerHTML`.

import { useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';

import type { Catalog } from '../../../catalog/index.js';
import { BUILDS_MAX, FILE_MAX_BYTES } from '../../../io/index.js';
import type { LibraryRepo } from '../../../persist/index.js';
import { ImportReportPanel } from './ImportReportPanel.js';
import {
  preflightMessage,
  runJsonImport,
  type RunJsonImportResult,
} from './model.js';

// ---- Component -----------------------------------------------------------

export interface JsonDropZoneProps {
  readonly catalog: Catalog;
  readonly repo: LibraryRepo;
}

const formatBytes = (n: number): string => {
  if (n < 1024) return `${String(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

export function JsonDropZone(props: JsonDropZoneProps) {
  const { catalog, repo } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<RunJsonImportResult | null>(null);

  const openPicker = () => {
    inputRef.current?.click();
  };

  const runFile = async (file: File): Promise<void> => {
    const source = file.name.length > 0 ? file.name : '(dropped file)';
    // Cap 1 — do NOT read the file if it is over cap.
    if (file.size > FILE_MAX_BYTES) {
      setResult({
        source,
        preflight: { kind: 'OVERSIZE', byteLen: file.size },
      });
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch (e) {
      setResult({ source, parseError: `Could not read the file: ${(e as Error).message}` });
      return;
    }
    setResult(runJsonImport(catalog, repo, { source, byteLen: file.size, text }));
  };

  const onDrop = (e: JSX.TargetedDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (files === undefined || files.length === 0) return;
    const file = files[0];
    if (file !== undefined) void runFile(file);
  };

  const onFileChange = (e: JSX.TargetedEvent<HTMLInputElement, Event>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (file !== undefined) void runFile(file);
    input.value = '';
  };

  return (
    <div class="stack-lg" data-testid="share-json-zone">
      <div
        class="panel-in"
        role="button"
        tabIndex={0}
        aria-label="Drop a fleet JSON file or click to browse"
        style={dropzoneStyle(dragOver)}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => {
          setDragOver(false);
        }}
        onDrop={onDrop}
        data-testid="share-json-dropzone"
      >
        <div style="font-size:22px;line-height:1" aria-hidden="true">⭳</div>
        <div class="t-h2" style="margin-top:var(--s2)">DROP A FLEET .JSON FILE</div>
        <div class="mono-xs" style="margin-top:var(--s1)">
          OR CLICK TO BROWSE — ANY EXPORT FROM ANY PAST VERSION IS ACCEPTED
        </div>
        <div class="mono-xs c-dim" style="margin-top:var(--s2)">
          MAX {formatBytes(FILE_MAX_BYTES)} · UP TO {String(BUILDS_MAX)} BUILDS · ADDITIVE — NEVER DELETES
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          onChange={onFileChange}
          style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0"
          data-testid="share-json-input"
          aria-hidden="true"
        />
      </div>

      {result?.preflight !== undefined ? (
        <div
          class="banner banner-danger"
          role="alert"
          style="align-items:flex-start"
          data-testid="share-json-preflight"
        >
          <span class="c-red" style="font-size:16px" aria-hidden="true">✖</span>
          <div class="grow" style="margin-left:var(--s2)">
            <div style="font-weight:700;letter-spacing:.08em;color:var(--ink-hi)">
              IMPORT REJECTED — {result.preflight.kind.replace(/_/g, ' ')}
            </div>
            <div class="t-meta">{preflightMessage(result.preflight)}</div>
          </div>
        </div>
      ) : null}

      {result?.parseError !== undefined ? (
        <div
          class="banner banner-danger"
          role="alert"
          style="align-items:flex-start"
          data-testid="share-json-parseerror"
        >
          <span class="c-red" style="font-size:16px" aria-hidden="true">✖</span>
          <div class="grow" style="margin-left:var(--s2)">
            <div style="font-weight:700;letter-spacing:.08em;color:var(--ink-hi)">
              FILE COULD NOT BE READ.
            </div>
            <div class="t-meta">{result.parseError} No changes were made.</div>
          </div>
        </div>
      ) : null}

      {result?.report !== undefined ? (
        <ImportReportPanel report={result.report} source={result.source} />
      ) : null}
    </div>
  );
}

// ---- Helpers -------------------------------------------------------------

const dropzoneStyle = (dragOver: boolean): string => {
  const base =
    'position:relative;border:1px dashed var(--line-hot);padding:var(--s6) var(--s4);text-align:center;cursor:pointer;border-radius:var(--r)';
  return dragOver
    ? `${base};border-color:var(--cyan);background:rgba(34,227,255,.06)`
    : base;
};
