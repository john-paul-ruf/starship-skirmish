// M14 UI — Share/Import: per-build JSON-import report (S06 checkpoint 3).
//
// Renders the outcome of a `persist.applyImport` run — one row per candidate,
// four possible kinds (IMPORTED / RENAMED / SKIPPED / FAILED), plus a header
// summary of counts. Design §4.9 "STATES / RESULTS" table.
//
// UNTRUSTED-INPUT DISCIPLINE (NFR-Security, lint-enforced):
//   * Every build name / rename target is a text node — Preact escapes.
//   * The failure `reason` string is `io`/`persist`'s own message — text-node
//     rendered; no interpolation into markup or attributes.

import { Chip } from '../../components/index.js';
import type { ImportReport } from '../../../persist/index.js';
import { reportCounts, summarizeReport } from './model.js';

const KIND_TONE: Record<
  'IMPORTED' | 'RENAMED' | 'REPLACED' | 'SKIPPED' | 'FAILED',
  'green' | 'cyan' | 'amber' | 'red' | 'neutral'
> = {
  IMPORTED: 'green',
  RENAMED: 'cyan',
  REPLACED: 'amber',
  SKIPPED: 'neutral',
  FAILED: 'red',
};

const KIND_GLYPH: Record<
  'IMPORTED' | 'RENAMED' | 'REPLACED' | 'SKIPPED' | 'FAILED',
  string
> = {
  IMPORTED: '✓',
  RENAMED: '✎',
  REPLACED: '⇄',
  SKIPPED: '⊘',
  FAILED: '✖',
};

export interface ImportReportPanelProps {
  readonly report: ImportReport;
  /** File name (or synthetic label) — rendered as a text node. */
  readonly source: string;
}

export function ImportReportPanel(props: ImportReportPanelProps) {
  const { report, source } = props;
  const rows = summarizeReport(report);
  const counts = reportCounts(report);

  return (
    <div class="panel-in" data-testid="share-import-report">
      <div
        style="display:flex;align-items:center;gap:var(--s2);padding:var(--s2) var(--s3);border-bottom:1px solid var(--line);flex-wrap:wrap"
      >
        <span class="t-label">
          LAST IMPORT — <span data-testid="share-import-source">{source}</span>
        </span>
        <div class="grow"></div>
        <Chip>{`${String(counts.total)} IN FILE`}</Chip>
        {counts.imported > 0 ? (
          <Chip tone="green">{`✓ ${String(counts.imported)} IMPORTED`}</Chip>
        ) : null}
        {counts.renamed > 0 ? (
          <Chip tone="cyan">{`✎ ${String(counts.renamed)} RENAMED`}</Chip>
        ) : null}
        {counts.replaced > 0 ? (
          <Chip tone="amber">{`⇄ ${String(counts.replaced)} REPLACED`}</Chip>
        ) : null}
        {counts.skipped > 0 ? <Chip>{`⊘ ${String(counts.skipped)} SKIPPED`}</Chip> : null}
        {counts.failed > 0 ? (
          <Chip tone="red">{`✖ ${String(counts.failed)} FAILED`}</Chip>
        ) : null}
        {report.degraded ? (
          <Chip tone="amber">⚠ STORAGE DEGRADED — SESSION-ONLY</Chip>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p class="mono-xs c-dim" style="padding:var(--s3)">
          The file contained no builds. Nothing was imported. Nothing was
          changed.
        </p>
      ) : (
        <table class="tbl">
          <thead>
            <tr>
              <th style="width:32%">BUILD</th>
              <th style="width:20%">RESULT</th>
              <th>DETAIL</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} data-testid={`share-import-row-${String(idx)}`}>
                <td class="c-hi">{row.label}</td>
                <td>
                  <Chip tone={KIND_TONE[row.kind]}>
                    {`${KIND_GLYPH[row.kind]} ${row.kind}`}
                  </Chip>
                </td>
                <td class="mono-xs">{row.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div
        class="panel-ft"
        style="display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap"
      >
        <span class="mono-xs">
          IMPORT IS ADDITIVE — IT NEVER DELETES AN EXISTING BUILD. PARTIALLY
          INVALID FILES IMPORT WHAT IS VALID AND REPORT THE REST.
        </span>
      </div>
    </div>
  );
}
