// M14 UI — Encyclopedia BackupBanner (S04 checkpoint 3).
//
// Design §4.8 / FR-7: `localStorage` is the only persistence and it is not
// trustworthy. The Encyclopedia surface therefore carries a DISMISSIBLE-BUT-
// RECURRING banner naming the real stakes:
//   "Your library lives in this browser only. Clearing site data deletes N
//    builds. Last export: D days ago."
//
// The dismiss is SESSION-SCOPED — it never writes a durable "dismissed" flag
// (§4.8 recurring). On the next visit the banner returns. Storage headroom
// lives in the storage rail; this banner is the "clearing site data deletes N
// builds" nudge.
//
// The shell's session-mode banner (`App.tsx`, `durable === false`) already
// handles the storage-unavailable case. This module is the AVAILABLE-but-please-
// export nudge — a different surface, a different tone (warn, not danger).

import { Banner } from '../../components/index.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Days since `iso` timestamp, floored. Non-ISO / bad input → null. */
export const daysSince = (iso: string, now: number): number | null => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / ONE_DAY_MS));
};

export interface BackupBannerProps {
  readonly totalCount: number;
  readonly lastExportAt: string | null;
  readonly onExport: () => void;
  readonly onDismiss: () => void;
  /** Injected for tests; screens pass `Date.now()`. */
  readonly nowMs: number;
}

/**
 * Compose the nudge line. Pure text — the screen renders it inside a `Banner`.
 * Exported so the `refitReceiptText` sibling of §4.7 has company here for the
 * §4.8 line, both directly testable.
 */
export const backupNudgeText = (
  totalCount: number,
  lastExportAt: string | null,
  nowMs: number,
): string => {
  const buildsWord = totalCount === 1 ? 'build' : 'builds';
  if (lastExportAt === null) {
    return `Clearing site data deletes ${String(totalCount)} ${buildsWord}. Never exported.`;
  }
  const days = daysSince(lastExportAt, nowMs);
  if (days === null) {
    return `Clearing site data deletes ${String(totalCount)} ${buildsWord}. Last export timestamp unreadable — export again.`;
  }
  const when = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${String(days)} days ago`;
  return `Clearing site data deletes ${String(totalCount)} ${buildsWord}. Last export: ${when}.`;
};

export function BackupBanner({
  totalCount,
  lastExportAt,
  onExport,
  onDismiss,
  nowMs,
}: BackupBannerProps) {
  return (
    <Banner tone="warn" role="status" class="enc-backup-banner">
      <div style="display:flex;align-items:center;gap:var(--s3);width:100%">
        <div class="grow">
          <div class="c-hi" style="font-weight:700;letter-spacing:.08em">
            YOUR LIBRARY LIVES IN THIS BROWSER ONLY.
          </div>
          <div class="t-meta" data-testid="backup-nudge-text">
            {backupNudgeText(totalCount, lastExportAt, nowMs)}
          </div>
        </div>
        <button
          type="button"
          class="btn btn-warn"
          onClick={onExport}
          data-testid="backup-export-all"
          disabled={totalCount === 0 || undefined}
          title={
            totalCount === 0
              ? 'Nothing to export yet.'
              : 'Export the whole library as JSON.'
          }
        >
          ⭱ EXPORT ALL
        </button>
        <button
          type="button"
          class="btn btn-ghost"
          onClick={onDismiss}
          data-testid="backup-dismiss"
          title="Dismiss until the next visit. This nudge is dismissible but recurring (FR-7)."
        >
          REMIND ME LATER
        </button>
      </div>
    </Banner>
  );
}
