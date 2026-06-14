/**
 * Pure log-transformation logic for the Compliance Activity_Log (Spec 08-A).
 *
 * Every function in this module is PURE: it returns a brand-new value and NEVER
 * mutates its argument. The module never touches `chrome.storage`, never performs
 * any network request, never invokes any AI provider, and — apart from the
 * INJECTED `LogClock` / `IdFactory` seams — reads no `Date.now()`,
 * `Math.random()`, `crypto.*`, or any global mutable state. The only
 * non-determinism (a fresh `id` / `created_at` recorded at an Operator action) is
 * supplied by the injected `clock` / `ids` parameters so the transforms
 * themselves stay reproducible (design.md Section 5.3).
 *
 * All shared types and bound constants come from `../types`; nothing is
 * duplicated here. The storage adapter (`activity-log-storage.ts`), the recorder,
 * the export delivery, and the UI are intentionally NOT part of this file.
 *
 * This file currently implements Tasks 2.1 and 2.2: the injected seams, the
 * Summary length clamp, the redaction-safe summary renderer, `createEntry`, the
 * FIFO-bounded `appendEntry`, and the newest-first ordering.
 */
import { MAX_LOG_ENTRIES, MAX_SUMMARY_LEN, REVIEW_STATUS_LABELS } from '../types';
import type { ActionType, ActivityEntry, ActivityLog, SummaryParts } from '../types';

// --- Injected seams (design.md Section 5.3) ----------------------------------

/** Supplies the ISO 8601 timestamp recorded at the moment of an Operator action. */
export interface LogClock {
  now(): string;
}

/** Supplies a stable, unique Entry_Id at an Operator action. */
export interface IdFactory {
  create(): string;
}

// --- Internal literal tables (single-sourced, no duplicated strings) ----------

/**
 * Plain, non-promotional display labels for each Action_Type. These are the only
 * action-derived text that may appear in a Summary; they carry no draft text,
 * Note text, credentials, or tokens (Req 1.6, 5.7).
 */
const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  onboarding_completed: 'Completed compliance onboarding',
  draft_saved: 'Saved a draft to the review queue',
  status_changed: 'Changed review status',
  draft_copied: 'Copied a draft for manual posting',
};

// --- 2.1 Summary clamp -------------------------------------------------------

/**
 * Clamp a Summary to MAX_SUMMARY_LEN characters (Req 4.3). Returns the input
 * unchanged when it is within the bound, otherwise a value truncated to at most
 * MAX_SUMMARY_LEN characters. Pure; counts by Unicode code point so surrogate
 * pairs are never split.
 */
export function clampSummary(text: string): string {
  const value = typeof text === 'string' ? text : '';
  const chars = Array.from(value);
  if (chars.length <= MAX_SUMMARY_LEN) {
    return value;
  }
  return chars.slice(0, MAX_SUMMARY_LEN).join('');
}

// --- 2.1 Redaction-safe summary renderer -------------------------------------

/**
 * Render a redaction-safe, human-readable Summary from non-sensitive descriptors
 * only (Req 1.6, 5.7). The Summary is composed of the Action_Type label plus any
 * supplied non-sensitive descriptors — a Review_Status label, a QueueItem id
 * reference, and a short `detail` label. It NEVER includes full draft text, Note
 * text, credentials, or tokens. Pure: depends only on its arguments.
 */
function renderSummary(type: ActionType, parts: SummaryParts): string {
  const segments: string[] = [ACTION_TYPE_LABELS[type]];

  if (parts.status !== undefined) {
    segments.push(`status: ${REVIEW_STATUS_LABELS[parts.status]}`);
  }
  if (typeof parts.itemId === 'string' && parts.itemId.length > 0) {
    segments.push(`item ${parts.itemId}`);
  }
  if (typeof parts.detail === 'string' && parts.detail.trim().length > 0) {
    segments.push(parts.detail.trim());
  }

  return segments.join(' — ');
}

// --- 2.1 Entry creation ------------------------------------------------------

/**
 * Build a redaction-safe Activity_Entry (Req 1.5, 1.6, 2.1, 2.2, 4.3).
 *
 * The Entry_Id and `created_at` timestamp are taken from the INJECTED `ids` /
 * `clock` seams (never from `crypto`/`Date` directly), keeping this transform
 * deterministic given its inputs. The Summary is assembled from non-sensitive
 * descriptors only and clamped to MAX_SUMMARY_LEN.
 */
export function createEntry(
  type: ActionType,
  summaryParts: SummaryParts,
  clock: LogClock,
  ids: IdFactory,
): ActivityEntry {
  return {
    id: ids.create(),
    type,
    created_at: clock.now(),
    summary: clampSummary(renderSummary(type, summaryParts)),
  };
}


// --- 2.2 Append with FIFO bound ----------------------------------------------

/**
 * Append an Activity_Entry to the log, enforcing the MAX_LOG_ENTRIES bound
 * (Req 4.1, 4.2, 4.4). Pure: returns a brand-new array and NEVER mutates the
 * input `log`. When appending would exceed MAX_LOG_ENTRIES, the OLDEST entries
 * are dropped first (FIFO) so the result holds exactly MAX_LOG_ENTRIES of the
 * most recent entries; the relative order of the retained entries is preserved.
 */
export function appendEntry(log: ActivityLog, entry: ActivityEntry): ActivityLog {
  const next = [...log, entry];
  if (next.length <= MAX_LOG_ENTRIES) {
    return next;
  }
  // Drop the oldest entries first (from the front), keeping the most recent
  // MAX_LOG_ENTRIES and preserving their relative order.
  return next.slice(next.length - MAX_LOG_ENTRIES);
}

// --- 2.2 Newest-first ordering -----------------------------------------------

/**
 * Return the entries ordered newest-first (Req 7.1): `created_at` descending,
 * with a stable total-order tie-break of `id` ascending. Pure: returns a
 * brand-new array and NEVER mutates the input `log`. `created_at` is an ISO 8601
 * string, so lexicographic comparison is chronological.
 */
export function orderNewestFirst(log: ActivityLog): ActivityEntry[] {
  return [...log].sort((a, b) => {
    if (a.created_at !== b.created_at) {
      return a.created_at < b.created_at ? 1 : -1; // created_at descending
    }
    if (a.id !== b.id) {
      return a.id < b.id ? -1 : 1; // id ascending tie-break
    }
    return 0;
  });
}
