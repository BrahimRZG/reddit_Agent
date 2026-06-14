/**
 * Best-effort, non-blocking recorder for the Compliance Activity_Log (Spec 08-A).
 *
 * `recordActivity` is the ONLY integration touch-point the existing features call
 * to log a compliance-relevant Operator action. It is fire-and-forget: it returns
 * `void`, is safe to call WITHOUT `await`, and NEVER throws into its caller. All
 * async work (read → append → write) runs inside a guard that swallows every
 * error, so a log failure can never block, delay, reverse, or alter the original
 * Review_Queue or Draft_Co_Pilot action that triggered it (Req 3; Property 5).
 *
 * This recorder is the layer that supplies the real (non-injected) `id` / `clock`
 * to the pure `createEntry` transform: `crypto.randomUUID` (with a safe local
 * fallback) and `new Date().toISOString()`. The pure `activity-log.ts` module
 * stays free of `crypto` / `Date` — that non-determinism lives only here.
 *
 * No network request, no AI provider, no `chrome.downloads` — only the local
 * `chrome.storage.local` access performed by the storage adapter (Req 11.4–11.6).
 */

import type { ActionType, SummaryParts } from '../types';
import { appendEntry, createEntry } from './activity-log';
import type { IdFactory, LogClock } from './activity-log';
import { readLog, writeLog } from './activity-log-storage';

/** Real clock seam: the ISO 8601 timestamp at the moment of the Operator action. */
const realClock: LogClock = {
  now: () => new Date().toISOString(),
};

/** Monotonic counter backing the fallback id generator (kept unique within a session). */
let fallbackCounter = 0;

/**
 * Real id seam. Prefers the platform `crypto.randomUUID` when available; otherwise
 * falls back to a locally generated, collision-resistant string built from a
 * timestamp and a monotonic counter. No network and no external dependency.
 */
const realIds: IdFactory = {
  create: () => {
    const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
      return cryptoObj.randomUUID();
    }
    fallbackCounter += 1;
    return `entry-${Date.now().toString(36)}-${fallbackCounter.toString(36)}`;
  },
};

/**
 * Record a compliance-relevant Operator action as a best-effort, non-blocking side
 * effect (Req 1, 3; Property 5).
 *
 * Reads the current log, appends a freshly created Activity_Entry, and persists the
 * result — all inside a guard that swallows any error. On a read failure
 * (`read_error` / `parse_error`) the append is SKIPPED rather than overwriting the
 * stored value. Returns synchronously; callers do not (and need not) `await` it.
 */
export function recordActivity(type: ActionType, summaryParts: SummaryParts): void {
  void (async () => {
    try {
      const outcome = await readLog();
      // On a read/parse failure, skip logging — never overwrite the stored value.
      if (!outcome.ok) {
        return;
      }
      const entry = createEntry(type, summaryParts, realClock, realIds);
      await writeLog(appendEntry(outcome.entries, entry));
    } catch {
      // Best-effort: swallow read/create/write errors so the original
      // Source_Action is never blocked, delayed, reversed, or altered (Req 3).
    }
  })();
}
