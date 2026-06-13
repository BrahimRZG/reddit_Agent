/**
 * Local persistence for the Review_Queue (Spec 07).
 *
 * This is the ONLY module that touches `chrome.storage.local` for the queue. It
 * mirrors `onboarding-storage.ts`'s typed, fail-safe read pattern: a dedicated
 * key constant, a custom error class for writes, and a typed `QueueReadOutcome`
 * that never throws and never leaks internals. The (de)serialization itself lives
 * in the pure `review-queue.ts` module (`serializeQueue` / `deserializeQueue`).
 *
 * The Review_Queue is stored only in `chrome.storage.local` — it is NEVER
 * transmitted. This module performs NO network request of any kind: no `fetch`,
 * no `authenticatedFetch`, no `XMLHttpRequest`, no AI provider (Req 9.6, 9.7,
 * 12.4). Every failure message surfaced to the Operator is drawn from the fixed,
 * safe constants in `../types` — never a stack trace, file path, secret,
 * environment value, or internal implementation detail (Req 10.5).
 */

import {
  STORAGE_KEYS,
  QUEUE_READ_ERROR_MESSAGE,
  QUEUE_PARSE_ERROR_MESSAGE,
} from '../types';
import type { QueueItem, QueueReadOutcome } from '../types';
import { deserializeQueue, serializeQueue } from './review-queue';

/**
 * Fixed, safe message for a write failure (Req 9.3). Like the read/parse
 * messages, it leaks no stack trace, file path, secret, environment value, or
 * internal detail.
 */
const QUEUE_WRITE_ERROR_MESSAGE = "Couldn't save your review queue. Please try again.";

/** Custom error for queue write failures (parallels OnboardingStorageError / StorageError). */
export class ReviewQueueStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewQueueStorageError';
  }
}

/**
 * Read the Review_Queue from chrome.storage.local. Mirrors `onboarding-storage`'s
 * typed, fail-safe read pattern (Req 10) and NEVER throws:
 *
 *  - read throws             → `{ ok: false, error: 'read_error', message }`  (Req 10.2, 10.5)
 *  - key missing / undefined → `{ ok: true, items: [] }`                       (Req 10.3)
 *  - present but not an array → `{ ok: false, error: 'parse_error', message }` and
 *                               the stored value is NOT overwritten             (Req 10.4)
 *  - present and array-shaped → `deserializeQueue` (malformed items dropped,
 *                               statuses coerced) → `{ ok: true, items }`        (Req 10.6)
 *
 * The failure `message` is always a fixed, safe constant — the caught error's
 * text/stack is never included (Req 10.5).
 */
export async function readQueue(): Promise<QueueReadOutcome> {
  let raw: unknown;
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.REVIEW_QUEUE);
    raw = result[STORAGE_KEYS.REVIEW_QUEUE];
  } catch {
    // Never leak the caught error's message/stack — fixed safe constant only.
    return { ok: false, error: 'read_error', message: QUEUE_READ_ERROR_MESSAGE };
  }

  // Absent queue is zero items (Req 10.3).
  if (raw === undefined || raw === null) {
    return { ok: true, items: [] };
  }

  // Present but wrong shape → safe parse failure; do NOT overwrite (Req 10.4).
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'parse_error', message: QUEUE_PARSE_ERROR_MESSAGE };
  }

  // Array-shaped: drop malformed individual items, coerce statuses (Req 10.6).
  return { ok: true, items: deserializeQueue(raw) };
}

/**
 * Persist the Review_Queue under `STORAGE_KEYS.REVIEW_QUEUE` (Req 9.3). Writes the
 * `serializeQueue` plain JSON-safe structure. On failure it throws a
 * `ReviewQueueStorageError` carrying a fixed, safe message (the caught error is
 * never leaked); the UI catches it and surfaces a recoverable error.
 *
 * No network request; nothing is transmitted to the Worker_API or any external
 * service (Req 9.6, 9.7, 12.4).
 */
export async function writeQueue(items: QueueItem[]): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.REVIEW_QUEUE]: serializeQueue(items) });
  } catch {
    throw new ReviewQueueStorageError(QUEUE_WRITE_ERROR_MESSAGE);
  }
}
