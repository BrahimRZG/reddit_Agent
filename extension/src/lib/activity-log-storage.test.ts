/**
 * Spec 08-A — Compliance Activity Log & Export — `activity-log-storage.ts`
 * storage-adapter tests (Task 7.2).
 *
 * Exercises the thin `chrome.storage.local` adapter in isolation: the typed,
 * fail-safe `readLog` outcomes (missing → empty, throw → read_error, non-array →
 * parse_error without overwrite, array → deserialized/filtered entries), plus
 * `writeLog` / `clearLog` (serialized payload written once; safe typed error on
 * failure, no leaked internals). The pure transforms are covered by
 * `activity-log.test.ts`; the recorder, React panel, popup wiring, and
 * security-boundary scans are separate slices and are NOT exercised here.
 *
 * `chrome.storage.local` is stubbed with `vi.fn()` mocks for `get`/`set` following
 * the existing `review-queue-storage.test.ts` / `onboarding-storage.test.ts`
 * convention. All cases are deterministic with no real network. Safe-failure
 * assertions are tagged with Property 9 where apt.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  readLog,
  writeLog,
  clearLog,
  ActivityLogStorageError,
  ACTIVITY_LOG_READ_ERROR_MESSAGE,
  ACTIVITY_LOG_PARSE_ERROR_MESSAGE,
} from './activity-log-storage';
import { serializeLog, deserializeLog } from './activity-log';
import { STORAGE_KEYS } from '../types';
import type { ActivityEntry } from '../types';

const KEY = STORAGE_KEYS.ACTIVITY_LOG;

// --- chrome.storage.local stub (matches review-queue-storage.test.ts) --------

const mockGet = vi.fn();
const mockSet = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({});
  mockSet.mockResolvedValue(undefined);
  vi.stubGlobal('chrome', { storage: { local: { get: mockGet, set: mockSet } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- Valid ActivityEntry fixtures --------------------------------------------

const entryA: ActivityEntry = {
  id: 'a',
  type: 'draft_saved',
  created_at: '2026-01-01T00:00:00.000Z',
  summary: 'Saved a draft to the review queue — item q-1',
};

const entryB: ActivityEntry = {
  id: 'b',
  type: 'status_changed',
  created_at: '2026-01-02T00:00:00.000Z',
  summary: 'Changed review status — status: Approved for manual use — item q-1',
};

// --- readLog -----------------------------------------------------------------

describe('readLog', () => {
  it('missing key → { ok: true, entries: [] } (Req 9.3)', async () => {
    mockGet.mockResolvedValueOnce({});
    await expect(readLog()).resolves.toEqual({ ok: true, entries: [] });
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('stored value undefined → { ok: true, entries: [] } (Req 9.3)', async () => {
    mockGet.mockResolvedValueOnce({ [KEY]: undefined });
    await expect(readLog()).resolves.toEqual({ ok: true, entries: [] });
  });

  it('stored value null → { ok: true, entries: [] } (Req 9.3)', async () => {
    mockGet.mockResolvedValueOnce({ [KEY]: null });
    await expect(readLog()).resolves.toEqual({ ok: true, entries: [] });
  });

  it('present array of valid entries → { ok: true, entries } matching deserializeLog (Req 9.6)', async () => {
    const rawArray = serializeLog([entryA, entryB]);
    mockGet.mockResolvedValueOnce({ [KEY]: rawArray });
    const outcome = await readLog();
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.entries).toEqual(deserializeLog(rawArray));
      expect(outcome.entries).toEqual([entryA, entryB]);
    }
    expect(mockSet).not.toHaveBeenCalled();
  });

  // Property 9: present-but-unparseable → parse_error and the stored value is left untouched.
  it.each([
    ['a string', 'not-an-array'],
    ['a number', 42],
    ['an object', {}],
  ])('present non-array (%s) → parse_error; set NOT called (no overwrite) (Req 9.4, 9.5)', async (_label, value) => {
    mockGet.mockResolvedValueOnce({ [KEY]: value });
    const outcome = await readLog();
    expect(outcome).toEqual({
      ok: false,
      error: 'parse_error',
      message: ACTIVITY_LOG_PARSE_ERROR_MESSAGE,
    });
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('malformed individual entries are dropped; well-formed entries retained (Req 9.6)', async () => {
    const [rawA, rawB] = serializeLog([entryA, entryB]) as unknown[];
    const rawArray = [
      rawA,
      null, // malformed: not an object
      { id: 'bad', type: 'not_a_real_type', created_at: 'x', summary: 'y' }, // bad type
      { id: 123, type: 'draft_saved', created_at: 'x', summary: 'y' }, // non-string id
      rawB,
    ];
    mockGet.mockResolvedValueOnce({ [KEY]: rawArray });
    const outcome = await readLog();
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.entries).toEqual(deserializeLog(rawArray));
      expect(outcome.entries.map((e) => e.id)).toEqual(['a', 'b']);
    }
  });

  // Property 9: a failed read yields a safe failure state, never an overwrite.
  it('get rejects → read_error with the fixed safe message; set NOT called (Req 9.2, 9.5)', async () => {
    mockGet.mockRejectedValueOnce(new Error('storage unavailable'));
    const outcome = await readLog();
    expect(outcome).toEqual({
      ok: false,
      error: 'read_error',
      message: ACTIVITY_LOG_READ_ERROR_MESSAGE,
    });
    expect(mockSet).not.toHaveBeenCalled();
  });

  // Property 9: the caught error's text/stack/paths/secrets never leak into the message.
  it('caught read error never leaks internals into the surfaced message (Req 9.5)', async () => {
    const thrown = 'SECRET path /Users/x/.env stack trace';
    mockGet.mockRejectedValueOnce(new Error(thrown));
    const outcome = await readLog();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toBe(ACTIVITY_LOG_READ_ERROR_MESSAGE);
      expect(outcome.message).not.toContain('SECRET');
      expect(outcome.message).not.toContain('/Users');
      expect(outcome.message).not.toContain(thrown);
    }
  });

  it('never throws even when the underlying read throws (Req 9.1, 9.2)', async () => {
    mockGet.mockRejectedValueOnce(new Error('boom'));
    await expect(readLog()).resolves.toBeDefined();
  });
});

// --- writeLog ----------------------------------------------------------------

describe('writeLog', () => {
  it('writes the serialized payload under the activity-log key exactly once (Req 8.3)', async () => {
    mockSet.mockResolvedValueOnce(undefined);
    await writeLog([entryA, entryB]);
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith({ [KEY]: serializeLog([entryA, entryB]) });
  });

  it('set rejects → rejects with an ActivityLogStorageError (Req 8.3)', async () => {
    mockSet.mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(writeLog([entryA])).rejects.toBeInstanceOf(ActivityLogStorageError);
  });

  it('write failure message is fixed/safe and leaks no internals (Req 9.5)', async () => {
    const thrown = 'DB secret /etc/passwd at line 42';
    mockSet.mockRejectedValueOnce(new Error(thrown));

    let captured: ActivityLogStorageError | undefined;
    try {
      await writeLog([entryA]);
    } catch (err) {
      captured = err as ActivityLogStorageError;
    }
    expect(captured).toBeInstanceOf(ActivityLogStorageError);
    expect(captured?.message).not.toContain('secret');
    expect(captured?.message).not.toContain('/etc/passwd');
    expect(captured?.message).not.toContain('line 42');
    expect(captured?.message).not.toContain(thrown);

    // Fixed: a different thrown error yields the identical safe message.
    mockSet.mockRejectedValueOnce(new Error('totally different failure text'));
    let captured2: ActivityLogStorageError | undefined;
    try {
      await writeLog([entryB]);
    } catch (err) {
      captured2 = err as ActivityLogStorageError;
    }
    expect(captured2?.message).toBe(captured?.message);
    expect((captured?.message ?? '').length).toBeGreaterThan(0);
  });
});

// --- clearLog ----------------------------------------------------------------

describe('clearLog', () => {
  it('writes an empty array under the activity-log key exactly once (Req 7.4, 7.5)', async () => {
    mockSet.mockResolvedValueOnce(undefined);
    await clearLog();
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith({ [KEY]: [] });
  });

  it('set rejects → rejects with an ActivityLogStorageError carrying a safe message (Req 7.5, 9.5)', async () => {
    const thrown = 'disk full /var/secret';
    mockSet.mockRejectedValueOnce(new Error(thrown));
    let captured: ActivityLogStorageError | undefined;
    try {
      await clearLog();
    } catch (err) {
      captured = err as ActivityLogStorageError;
    }
    expect(captured).toBeInstanceOf(ActivityLogStorageError);
    expect(captured?.message).not.toContain('/var/secret');
    expect(captured?.message).not.toContain(thrown);
    expect((captured?.message ?? '').length).toBeGreaterThan(0);
  });
});
