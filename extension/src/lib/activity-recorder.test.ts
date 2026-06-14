/**
 * Spec 08-A — Compliance Activity Log & Export — `activity-recorder.ts` tests
 * (Task 7.2).
 *
 * Exercises the best-effort, non-blocking `recordActivity` in isolation. The
 * storage adapter is mocked (`vi.mock('./activity-log-storage')`) so we can drive
 * read/write success and failure; the pure `activity-log.ts` transforms stay real,
 * so the appended entry's `type`/`summary` reflect the genuine renderer. The React
 * panel, popup wiring, and security scans are separate slices and are NOT here.
 *
 * `recordActivity` is fire-and-forget: it returns `undefined` synchronously and is
 * never awaited as a promise. Async assertions flush the internal microtasks via
 * `vi.waitFor`, consistent with the repo's existing async tests.
 *
 * Property 5: Logging never blocks or alters the Source Action — a read or write
 * failure must neither throw to the caller nor overwrite stored state.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';

import { recordActivity } from './activity-recorder';
import { readLog, writeLog } from './activity-log-storage';
import type { ActivityEntry } from '../types';

vi.mock('./activity-log-storage', () => ({
  readLog: vi.fn(),
  writeLog: vi.fn(),
}));

const mockReadLog = readLog as unknown as Mock;
const mockWriteLog = writeLog as unknown as Mock;

const existing: ActivityEntry = {
  id: 'existing-1',
  type: 'onboarding_completed',
  created_at: '2026-01-01T00:00:00.000Z',
  summary: 'Completed compliance onboarding — version 1.0.0',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockReadLog.mockResolvedValue({ ok: true, entries: [] });
  mockWriteLog.mockResolvedValue(undefined);
});

// --- fire-and-forget ----------------------------------------------------------

describe('recordActivity — fire-and-forget', () => {
  it('returns undefined synchronously (Req 3.1)', () => {
    expect(recordActivity('draft_saved', { itemId: 'q-1' })).toBeUndefined();
  });

  it('does not throw to the caller even when readLog rejects (Req 3.2, 3.3)', async () => {
    mockReadLog.mockRejectedValueOnce(new Error('read blew up'));
    expect(() => recordActivity('draft_copied', { itemId: 'q-2' })).not.toThrow();
    // Give the swallowed async path a chance to settle; writeLog never runs.
    await vi.waitFor(() => expect(mockReadLog).toHaveBeenCalled());
    expect(mockWriteLog).not.toHaveBeenCalled();
  });

  it('does not throw to the caller even when writeLog rejects (Req 3.2, 3.3)', async () => {
    mockReadLog.mockResolvedValueOnce({ ok: true, entries: [] });
    mockWriteLog.mockRejectedValueOnce(new Error('write blew up'));
    expect(() => recordActivity('draft_saved', { itemId: 'q-3' })).not.toThrow();
    await vi.waitFor(() => expect(mockWriteLog).toHaveBeenCalled());
  });
});

// --- success path -------------------------------------------------------------

describe('recordActivity — success path', () => {
  it('reads the existing log, appends one entry, and writes the updated log', async () => {
    mockReadLog.mockResolvedValueOnce({ ok: true, entries: [existing] });

    recordActivity('draft_saved', { itemId: 'q-99' });

    await vi.waitFor(() => expect(mockWriteLog).toHaveBeenCalledTimes(1));
    expect(mockReadLog).toHaveBeenCalledTimes(1);

    const written = mockWriteLog.mock.calls[0][0] as ActivityEntry[];
    expect(written).toHaveLength(2); // existing + the new entry
    expect(written[0]).toEqual(existing); // existing preserved, in order
    const fresh = written[written.length - 1];
    expect(fresh.type).toBe('draft_saved');
    expect(fresh.summary).toContain('q-99'); // genuine redaction-safe summary
    expect(typeof fresh.id).toBe('string');
    expect(fresh.id.length).toBeGreaterThan(0);
    expect(typeof fresh.created_at).toBe('string');
    expect(fresh.created_at.length).toBeGreaterThan(0);
  });

  it('records the status descriptor for a status_changed action', async () => {
    mockReadLog.mockResolvedValueOnce({ ok: true, entries: [] });

    recordActivity('status_changed', { itemId: 'q-7', status: 'rejected' });

    await vi.waitFor(() => expect(mockWriteLog).toHaveBeenCalledTimes(1));
    const written = mockWriteLog.mock.calls[0][0] as ActivityEntry[];
    expect(written[0].type).toBe('status_changed');
    expect(written[0].summary).toContain('q-7');
  });
});

// --- failure behavior (Property 5) -------------------------------------------

describe('recordActivity — failure behavior', () => {
  it('skips writing (no overwrite) when readLog returns read_error', async () => {
    mockReadLog.mockResolvedValueOnce({
      ok: false,
      error: 'read_error',
      message: 'safe read error',
    });

    recordActivity('draft_saved', { itemId: 'q-1' });

    await vi.waitFor(() => expect(mockReadLog).toHaveBeenCalledTimes(1));
    // Settle any trailing microtasks, then assert no write happened.
    await Promise.resolve();
    expect(mockWriteLog).not.toHaveBeenCalled();
  });

  it('skips writing (no overwrite) when readLog returns parse_error', async () => {
    mockReadLog.mockResolvedValueOnce({
      ok: false,
      error: 'parse_error',
      message: 'safe parse error',
    });

    recordActivity('draft_copied', { itemId: 'q-2' });

    await vi.waitFor(() => expect(mockReadLog).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(mockWriteLog).not.toHaveBeenCalled();
  });

  it('swallows a writeLog rejection without affecting the caller', async () => {
    mockReadLog.mockResolvedValueOnce({ ok: true, entries: [] });
    mockWriteLog.mockRejectedValueOnce(new Error('persist failed'));

    // The caller gets undefined immediately and is never rejected/thrown into.
    const returned = recordActivity('draft_saved', { itemId: 'q-5' });
    expect(returned).toBeUndefined();

    await vi.waitFor(() => expect(mockWriteLog).toHaveBeenCalledTimes(1));
  });
});
