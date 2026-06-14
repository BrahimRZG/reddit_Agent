/**
 * Local persistence for the Compliance Activity_Log (Spec 08-A).
 *
 * This is the ONLY module that touches `chrome.storage.local` for the activity
 * log. It mirrors `review-queue-storage.ts` / `onboarding-storage.ts`'s typed,
 * fail-safe read pattern: a dedicated key constant, a custom error class for
 * writes, and a typed `LogReadOutcome` that never throws and never leaks
 * internals. The (de)serialization itself lives in the pure `activity-log.ts`
 * module (`serializeLog` / `deserializeLog`).
 *
 * The Activity_Log is stored only in `chrome.storage.local` — it is NEVER
 * transmitted. This module performs NO network request of any kind: no `fetch`,
 * no `authenticatedFetch`, no `XMLHttpRequest`, no AI provider (Req 8.5, 11.4).
 * Every failure message surfaced to the Operator is a fixed, safe constant —
 * never a stack trace, file path, secret, environment value, or internal
 * implementation detail (Req 9.5).
 *
 * This file currently implements Tasks 3.1 and 3.2: the `ActivityLogStorageError`
 * class, the fail-safe `readLog`, and the `writeLog` / `clearLog` persisters.
 */

import { STORAGE_KEYS } from '../types';
import type { ActivityEntry, LogReadOutcome } from '../types';
import { deserializeLog, serializeLog } from './activity-log';

/**
 * Fixed, safe message for a read failure (Req 9.2, 9.5). Leaks no stack trace,
 * file path, secret, environment value, or internal implementation detail.
 */
export const ACTIVITY_LOG_READ_ERROR_MESSAGE =
  "Couldn't read your activity log. Please try again.";

/**
 * Fixed, safe message for a parse failure (Req 9.4, 9.5). The stored value is
 * left untouched when this is surfaced.
 */
export const ACTIVITY_LOG_PARSE_ERROR_MESSAGE =
  "Your saved activity log couldn't be read and was left untouched.";

/**
 * Fixed, safe message for a write failure (Req 9.5). Like the read/parse
 * messages, it leaks no stack trace, file path, secret, environment value, or
 * internal detail.
 */
export const ACTIVITY_LOG_WRITE_ERROR_MESSAGE =
  "Couldn't save your activity log. Please try again.";

/** Custom error for activity-log write failures (parallels ReviewQueueStorageError). */
export class ActivityLogStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActivityLogStorageError';
  }
}

/**
 * Read the Activity_Log from chrome.storage.local. Mirrors the typed, fail-safe
 * read pattern (Req 9) and NEVER throws:
 *
 *  - read throws              → `{ ok: false, error: 'read_error', message }`   (Req 9.2, 9.5)
 *  - key missing / undefined  → `{ ok: true, entries: [] }`                     (Req 9.3)
 *  - present but not an array → `{ ok: false, error: 'parse_error', message }` and
 *                               the stored value is NOT overwritten             (Req 9.4)
 *  - present and array-shaped → `deserializeLog` (malformed entries dropped) →
 *                               `{ ok: true, entries }`                          (Req 9.6)
 *
 * The failure `message` is always a fixed, safe constant — the caught error's
 * text/stack is never included (Req 9.5).
 */
export async function readLog(): Promise<LogReadOutcome> {
  let raw: unknown;
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.ACTIVITY_LOG);
    raw = result[STORAGE_KEYS.ACTIVITY_LOG];
  } catch {
    // Never leak the caught error's message/stack — fixed safe constant only.
    return { ok: false, error: 'read_error', message: ACTIVITY_LOG_READ_ERROR_MESSAGE };
  }

  // Absent log is zero entries (Req 9.3).
  if (raw === undefined || raw === null) {
    return { ok: true, entries: [] };
  }

  // Present but wrong shape → safe parse failure; do NOT overwrite (Req 9.4).
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'parse_error', message: ACTIVITY_LOG_PARSE_ERROR_MESSAGE };
  }

  // Array-shaped: drop malformed individual entries (Req 9.6).
  return { ok: true, entries: deserializeLog(raw) };
}


/**
 * Persist the Activity_Log under `STORAGE_KEYS.ACTIVITY_LOG` (Req 8.3). Writes the
 * `serializeLog` plain JSON-safe structure. On failure it throws an
 * `ActivityLogStorageError` carrying a fixed, safe message (the caught error is
 * never leaked); callers catch it and surface a recoverable error.
 *
 * No network request; nothing is transmitted to the Worker_API or any external
 * service (Req 8.5, 8.6, 11.4).
 */
export async function writeLog(entries: ActivityEntry[]): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.ACTIVITY_LOG]: serializeLog(entries) });
  } catch {
    throw new ActivityLogStorageError(ACTIVITY_LOG_WRITE_ERROR_MESSAGE);
  }
}

/**
 * Clear the entire Activity_Log by persisting an empty array under
 * `STORAGE_KEYS.ACTIVITY_LOG` (Req 7.4, 7.5). On failure it throws an
 * `ActivityLogStorageError` carrying a fixed, safe message (the caught error is
 * never leaked).
 *
 * No network request; nothing is transmitted to the Worker_API or any external
 * service (Req 8.5, 8.6, 11.4).
 */
export async function clearLog(): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.ACTIVITY_LOG]: [] });
  } catch {
    throw new ActivityLogStorageError(ACTIVITY_LOG_WRITE_ERROR_MESSAGE);
  }
}
