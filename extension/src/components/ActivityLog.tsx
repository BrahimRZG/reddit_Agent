import { useCallback, useEffect, useState } from 'react';
import type { ActivityEntry, ActivityLog as ActivityLogType } from '../types';
import { orderNewestFirst, toJsonDocument, toMarkdownDocument } from '../lib/activity-log';
import { clearLog, ActivityLogStorageError, readLog } from '../lib/activity-log-storage';
import { clipboardExport, downloadExport } from '../lib/activity-export';

/** Fixed, safe failure messages (never leak a stack trace, path, secret, or internals). */
const CLEAR_ERROR_MESSAGE = "Couldn't clear your activity log. Please try again.";
const COPY_ERROR_MESSAGE = "Couldn't copy to the clipboard. Please try again.";
const DOWNLOAD_ERROR_MESSAGE = "Couldn't prepare the download. Please try again.";

/** True when the runtime exposes a usable clipboard write (manual copy only). */
function clipboardAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard !== 'undefined' &&
    typeof navigator.clipboard.writeText === 'function'
  );
}

/**
 * Compliance Activity_Log panel (Spec 08-A, Req 5, 6, 7, 9).
 *
 * UI only. Loads the log via `readLog` on mount and holds the entries plus UI status
 * in local React state. Entries render newest-first via the pure `orderNewestFirst`.
 * Export uses the pure `toJsonDocument` / `toMarkdownDocument` renderers delivered via
 * the local `clipboardExport` / `downloadExport` helpers — NEVER `chrome.downloads`
 * and NEVER a network request. The panel is PASSIVE: it renders no
 * post/submit/comment/vote/publish/auto-post control of any kind; every row is a
 * record of an action the Operator already performed.
 */
export function ActivityLog() {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<ActivityLogType>([]);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // On mount, load the log. A read_error/parse_error yields a recoverable error
  // state (Req 9.2, 9.4); the UI never crashes.
  const load = useCallback(async () => {
    setLoading(true);
    setStorageError(null);
    const outcome = await readLog();
    if (outcome.ok) {
      setEntries(outcome.entries);
    } else {
      setStorageError(outcome.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // --- Export controls (Req 5, 6) ---------------------------------------------

  const handleCopy = async (format: 'json' | 'markdown') => {
    setActionError(null);
    setStatus(null);
    if (!clipboardAvailable()) {
      setActionError(COPY_ERROR_MESSAGE);
      return;
    }
    const doc = format === 'json' ? toJsonDocument(entries) : toMarkdownDocument(entries);
    try {
      await clipboardExport(doc);
      setStatus(`Copied the activity log as ${format === 'json' ? 'JSON' : 'Markdown'}.`);
    } catch {
      setActionError(COPY_ERROR_MESSAGE);
    }
  };

  const handleDownload = (format: 'json' | 'markdown') => {
    setActionError(null);
    setStatus(null);
    const doc = format === 'json' ? toJsonDocument(entries) : toMarkdownDocument(entries);
    const filename = format === 'json' ? 'activity-log.json' : 'activity-log.md';
    const mime = format === 'json' ? 'application/json' : 'text/markdown';
    try {
      downloadExport(doc, filename, mime);
      setStatus(`Prepared the activity log download as ${format === 'json' ? 'JSON' : 'Markdown'}.`);
    } catch {
      setActionError(DOWNLOAD_ERROR_MESSAGE);
    }
  };

  // --- Clear control (Req 7.4, 7.5) -------------------------------------------

  const handleClear = async () => {
    setActionError(null);
    setStatus(null);
    try {
      await clearLog();
      setEntries([]);
      setStatus('Cleared your activity log.');
    } catch (err) {
      setActionError(err instanceof ActivityLogStorageError ? err.message : CLEAR_ERROR_MESSAGE);
    }
  };

  // --- Render -----------------------------------------------------------------

  return (
    <div className="mt-4 border-t border-gray-200 pt-4" data-testid="activity-log">
      <h2 className="text-sm font-semibold text-gray-900">Activity Log</h2>
      <p className="mt-1 text-[11px] text-gray-500">
        A local record of your compliance-relevant actions in this extension. Everything stays in
        your browser — nothing is sent anywhere. Export it any time as JSON or Markdown.
      </p>

      {loading ? (
        <p className="mt-3 text-xs text-gray-500" data-testid="activity-log-loading">
          Loading your activity log…
        </p>
      ) : storageError !== null ? (
        // Recoverable error state (Req 9.2, 9.4, 9.5) — safe message + Retry; never crashes.
        <div
          className="mt-3 rounded border border-red-300 bg-red-50 p-2"
          role="alert"
          aria-live="polite"
          data-testid="activity-log-error"
        >
          <p className="text-xs text-red-700">{storageError}</p>
          <button
            onClick={() => void load()}
            className="mt-2 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
            data-testid="activity-log-retry"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* Export + clear controls (Req 5, 6, 7.4). */}
          <div className="mt-3 flex flex-wrap gap-2" data-testid="activity-log-controls">
            {clipboardAvailable() && (
              <>
                <button
                  onClick={() => void handleCopy('json')}
                  className="px-2 py-1 text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                  data-testid="activity-log-copy-json"
                >
                  Copy JSON
                </button>
                <button
                  onClick={() => void handleCopy('markdown')}
                  className="px-2 py-1 text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                  data-testid="activity-log-copy-markdown"
                >
                  Copy Markdown
                </button>
              </>
            )}
            <button
              onClick={() => handleDownload('json')}
              className="px-2 py-1 text-[11px] font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded transition-colors"
              data-testid="activity-log-download-json"
            >
              Download JSON
            </button>
            <button
              onClick={() => handleDownload('markdown')}
              className="px-2 py-1 text-[11px] font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded transition-colors"
              data-testid="activity-log-download-markdown"
            >
              Download Markdown
            </button>
            <button
              onClick={() => void handleClear()}
              className="px-2 py-1 text-[11px] font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded transition-colors"
              data-testid="activity-log-clear"
            >
              Clear log
            </button>
          </div>

          {/* Status + action-error messages (Req 9.5). */}
          {status !== null && (
            <p
              className="mt-2 text-[11px] text-gray-600"
              role="status"
              aria-live="polite"
              data-testid="activity-log-status"
            >
              {status}
            </p>
          )}
          {actionError !== null && (
            <p
              className="mt-2 text-[11px] text-red-600"
              role="alert"
              aria-live="polite"
              data-testid="activity-log-action-error"
            >
              {actionError}
            </p>
          )}

          {/* List + empty state (Req 7.1, 7.2, 7.3). */}
          {entries.length === 0 ? (
            <p className="mt-4 text-xs text-gray-500" data-testid="activity-log-empty">
              No activity has been recorded.
            </p>
          ) : (
            <ul className="mt-4 space-y-2" data-testid="activity-log-list">
              {orderNewestFirst(entries).map((entry) => (
                <ActivityRow key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

interface ActivityRowProps {
  entry: ActivityEntry;
}

/** A single Activity_Entry view: Action_Type, created_at, and Summary (Req 7.2). */
function ActivityRow({ entry }: ActivityRowProps) {
  return (
    <li
      className="rounded border border-gray-200 p-2"
      data-testid={`activity-log-item-${entry.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-700"
          data-testid={`activity-log-type-${entry.id}`}
        >
          {entry.type}
        </span>
        <span
          className="text-[10px] text-gray-400"
          data-testid={`activity-log-time-${entry.id}`}
        >
          {entry.created_at}
        </span>
      </div>
      <p
        className="mt-1 whitespace-pre-wrap break-words text-xs text-gray-800"
        data-testid={`activity-log-summary-${entry.id}`}
      >
        {entry.summary}
      </p>
    </li>
  );
}
