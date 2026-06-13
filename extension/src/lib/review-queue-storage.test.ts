/**
 * Spec 07 — Review Queue — `review-queue-storage.ts` storage-adapter tests
 * (Task 6, slice 6B).
 *
 * Exercises the thin `chrome.storage.local` adapter in isolation: the typed,
 * fail-safe `readQueue` outcomes (missing → empty, throw → read_error, non-array
 * → parse_error without overwrite, array → deserialized/coerced items) and
 * `writeQueue` (serialized payload written once; safe typed error on failure).
 * The pure transforms themselves are covered by `review-queue.test.ts`; the React
 * panel, popup wiring, and security-boundary scans are later slices and are NOT
 * exercised here.
 *
 * `chrome.storage.local` is stubbed with `vi.fn()` mocks for `get`/`set` following
 * the existing `onboarding-storage.test.ts` convention (`vi.stubGlobal('chrome',
 * { storage: { local: { get, set } } })`). All cases are deterministic with no
 * real network. Safe-failure assertions are tagged with Property 9 where apt.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { readQueue, writeQueue, ReviewQueueStorageError } from './review-queue-storage';
import { serializeQueue, deserializeQueue } from './review-queue';
import {
  STORAGE_KEYS,
  QUEUE_READ_ERROR_MESSAGE,
  QUEUE_PARSE_ERROR_MESSAGE,
} from '../types';
import type { QueueItem } from '../types';

const KEY = STORAGE_KEYS.REVIEW_QUEUE;

// --- chrome.storage.local stub (matches onboarding-storage.test.ts) ----------

const mockGet = vi.fn();
const mockSet = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // Benign defaults; individual tests override with *Once variants.
  mockGet.mockResolvedValue({});
  mockSet.mockResolvedValue(undefined);
  vi.stubGlobal('chrome', { storage: { local: { get: mockGet, set: mockSet } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- Valid QueueItem fixtures (explicit ids/created_at/updated_at/checklist) --

const itemA: QueueItem = {
  id: 'item-a',
  draftText: 'A reviewed, disclosed reply about a deal.',
  source: 'draft_co_pilot',
  mode: 'disclosed-link',
  warnings: [{ id: 'disclosure_required', message: 'disclose affiliation' }],
  safety: 'safe',
  status: 'approved_for_manual_use',
  note: 'looks good to post manually',
  checklist: [
    { id: 'c-1', text: 'check subreddit rules', checked: true },
    { id: 'c-2', text: 'add disclosure', checked: false },
  ],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
};

const itemB: QueueItem = {
  id: 'item-b',
  draftText: 'A manually entered draft.',
  source: 'manual',
  status: 'needs_review',
  checklist: [],
  created_at: '2026-01-03T00:00:00.000Z',
  updated_at: '2026-01-03T00:00:00.000Z',
};

// --- readQueue ---------------------------------------------------------------

describe('readQueue', () => {
  it('missing key → { ok: true, items: [] } (Req 10.3)', async () => {
    mockGet.mockResolvedValueOnce({});
    await expect(readQueue()).resolves.toEqual({ ok: true, items: [] });
  });

  it('stored value undefined → { ok: true, items: [] } (Req 10.3)', async () => {
    mockGet.mockResolvedValueOnce({ [KEY]: undefined });
    await expect(readQueue()).resolves.toEqual({ ok: true, items: [] });
  });

  it('stored value null → { ok: true, items: [] } (Req 10.3)', async () => {
    mockGet.mockResolvedValueOnce({ [KEY]: null });
    await expect(readQueue()).resolves.toEqual({ ok: true, items: [] });
  });

  // Property 9: a failed read yields a safe failure state, never an overwrite.
  it('get rejects → read_error with the fixed safe message; set NOT called (Req 10.2, 10.5)', async () => {
    mockGet.mockRejectedValueOnce(new Error('storage unavailable'));
    const outcome = await readQueue();
    expect(outcome).toEqual({
      ok: false,
      error: 'read_error',
      message: QUEUE_READ_ERROR_MESSAGE,
    });
    expect(mockSet).not.toHaveBeenCalled();
  });

  // Property 9: present-but-unparseable → parse_error and the stored value is left untouched.
  it.each([
    ['a string', 'not-an-array'],
    ['a number', 42],
    ['an object', {}],
  ])('present non-array (%s) → parse_error; set NOT called (no overwrite) (Req 10.4, 10.5)', async (_label, value) => {
    mockGet.mockResolvedValueOnce({ [KEY]: value });
    const outcome = await readQueue();
    expect(outcome).toEqual({
      ok: false,
      error: 'parse_error',
      message: QUEUE_PARSE_ERROR_MESSAGE,
    });
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('present array of valid serialized items → { ok: true, items } matching deserializeQueue (Req 10.6)', async () => {
    const rawArray = serializeQueue([itemA, itemB]);
    mockGet.mockResolvedValueOnce({ [KEY]: rawArray });
    const outcome = await readQueue();
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.items).toEqual(deserializeQueue(rawArray));
      // round-trip fidelity: well-formed items come back intact
      expect(outcome.items).toEqual([itemA, itemB]);
    }
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('malformed individual items are dropped; well-formed items retained (Req 10.6)', async () => {
    const [rawA, rawB] = serializeQueue([itemA, itemB]) as unknown[];
    const rawArray = [
      rawA,
      null, // malformed: not an object
      { id: 'bad', draftText: 123 }, // malformed: wrong-typed/missing fields
      rawB,
    ];
    mockGet.mockResolvedValueOnce({ [KEY]: rawArray });
    const outcome = await readQueue();
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.items).toEqual(deserializeQueue(rawArray));
      const ids = outcome.items.map((i) => i.id);
      expect(ids).toEqual(['item-a', 'item-b']);
      expect(ids).not.toContain('bad');
    }
  });

  it('out-of-range stored status is coerced to needs_review (Req 3.6, 10.6)', async () => {
    const [rawA] = serializeQueue([itemA]) as Record<string, unknown>[];
    const rawArray = [{ ...rawA, status: 'bogus' }];
    mockGet.mockResolvedValueOnce({ [KEY]: rawArray });
    const outcome = await readQueue();
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.items).toHaveLength(1);
      expect(outcome.items[0].status).toBe('needs_review');
    }
  });

  // Property 9: the caught error's text/stack/paths/secrets never leak into the message.
  it('caught read error never leaks internals into the surfaced message (Req 10.5)', async () => {
    const thrown = 'SECRET path /Users/x/.env stack trace';
    mockGet.mockRejectedValueOnce(new Error(thrown));
    const outcome = await readQueue();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).toBe(QUEUE_READ_ERROR_MESSAGE);
      expect(outcome.message).not.toContain('SECRET');
      expect(outcome.message).not.toContain('stack');
      expect(outcome.message).not.toContain('/Users');
      expect(outcome.message).not.toContain(thrown);
    }
  });

  it('never throws even when the underlying read throws (Req 10.1, 10.2)', async () => {
    mockGet.mockRejectedValueOnce(new Error('boom'));
    await expect(readQueue()).resolves.toBeDefined();
  });
});

// --- writeQueue --------------------------------------------------------------

describe('writeQueue', () => {
  it('writes the serialized payload under the queue key exactly once (Req 9.3, 9.5)', async () => {
    mockSet.mockResolvedValueOnce(undefined);
    await writeQueue([itemA, itemB]);
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith({ [KEY]: serializeQueue([itemA, itemB]) });
  });

  it('set rejects → rejects with a ReviewQueueStorageError (Req 9.3)', async () => {
    mockSet.mockRejectedValueOnce(new Error('quota exceeded'));
    await expect(writeQueue([itemA])).rejects.toBeInstanceOf(ReviewQueueStorageError);
  });

  // Property 9: the write failure message is a fixed, safe constant — it never leaks the thrown error.
  it('write failure message is fixed/safe and leaks no internals (Req 10.5)', async () => {
    const thrown = 'DB secret /etc/passwd at line 42';
    mockSet.mockRejectedValueOnce(new Error(thrown));

    let captured: ReviewQueueStorageError | undefined;
    try {
      await writeQueue([itemA]);
    } catch (err) {
      captured = err as ReviewQueueStorageError;
    }
    expect(captured).toBeInstanceOf(ReviewQueueStorageError);
    expect(captured?.message).not.toContain('secret');
    expect(captured?.message).not.toContain('/etc/passwd');
    expect(captured?.message).not.toContain('line 42');
    expect(captured?.message).not.toContain(thrown);

    // Fixed: a different thrown error yields the identical safe message.
    mockSet.mockRejectedValueOnce(new Error('totally different failure text'));
    let captured2: ReviewQueueStorageError | undefined;
    try {
      await writeQueue([itemB]);
    } catch (err) {
      captured2 = err as ReviewQueueStorageError;
    }
    expect(captured2?.message).toBe(captured?.message);
    expect((captured?.message ?? '').length).toBeGreaterThan(0);
  });
});
