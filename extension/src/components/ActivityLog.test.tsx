// @vitest-environment jsdom
/**
 * Spec 08-A — Compliance Activity Log & Export — `ActivityLog.tsx` component tests
 * (Task 7.4).
 *
 * Drives the React panel with Testing Library. The storage adapter
 * (`activity-log-storage`) and the export delivery (`activity-export`) are mocked
 * so read/clear/export success and failure can be exercised and observed; the pure
 * `activity-log.ts` renderers stay REAL, so the documents handed to the export
 * helpers are the genuine JSON/Markdown output. The popup wiring and the
 * security-boundary scans are separate slices and are NOT exercised here.
 *
 * `chrome` is stubbed with a `downloads` spy that must never be called, and
 * `navigator.clipboard.writeText` is stubbed so the Copy controls render.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

// Mock the storage adapter but preserve the REAL ActivityLogStorageError class
// and message constants (importOriginal), so the panel's `instanceof` check and
// safe-message passthrough behave exactly as in production.
vi.mock('../lib/activity-log-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/activity-log-storage')>();
  return { ...actual, readLog: vi.fn(), clearLog: vi.fn() };
});

// Mock the local export delivery so calls/args are observable without touching
// the DOM/clipboard. The document strings are produced by the REAL renderers.
vi.mock('../lib/activity-export', () => ({
  clipboardExport: vi.fn(),
  downloadExport: vi.fn(),
}));

import { ActivityLog } from './ActivityLog';
import { readLog, clearLog, ActivityLogStorageError } from '../lib/activity-log-storage';
import { clipboardExport, downloadExport } from '../lib/activity-export';
import { toJsonDocument, toMarkdownDocument } from '../lib/activity-log';
import type { ActivityEntry, LogReadOutcome } from '../types';

const mockReadLog = vi.mocked(readLog);
const mockClearLog = vi.mocked(clearLog);
const mockClipboardExport = vi.mocked(clipboardExport);
const mockDownloadExport = vi.mocked(downloadExport);

// --- Fixtures ----------------------------------------------------------------

const entryOlder: ActivityEntry = {
  id: 'old',
  type: 'draft_saved',
  created_at: '2026-01-01T00:00:00.000Z',
  summary: 'Saved a draft to the review queue — item q-1',
};

const entryNewer: ActivityEntry = {
  id: 'new',
  type: 'draft_copied',
  created_at: '2026-03-03T00:00:00.000Z',
  summary: 'Copied a draft — item q-9',
};

// As returned by storage (unordered); the panel orders for display.
const ENTRIES: ActivityEntry[] = [entryOlder, entryNewer];

function okOutcome(entries: ActivityEntry[]): LogReadOutcome {
  return { ok: true, entries };
}

// --- chrome + clipboard stubs ------------------------------------------------

const chromeDownloadsSpy = vi.fn();
let writeTextMock: ReturnType<typeof vi.fn>;
let originalClipboardDescriptor: PropertyDescriptor | undefined;

function stubClipboard(): void {
  writeTextMock = vi.fn().mockResolvedValue(undefined);
  originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: writeTextMock },
    configurable: true,
    writable: true,
  });
}

function restoreClipboard(): void {
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
  } else {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReadLog.mockResolvedValue(okOutcome([]));
  mockClearLog.mockResolvedValue(undefined);
  mockClipboardExport.mockResolvedValue(undefined);
  mockDownloadExport.mockReturnValue(undefined);
  vi.stubGlobal('chrome', { downloads: { download: chromeDownloadsSpy } });
  stubClipboard();
});

afterEach(() => {
  cleanup();
  restoreClipboard();
  vi.unstubAllGlobals();
});

// --- 1. Initial load success -------------------------------------------------

describe('ActivityLog — initial load success', () => {
  it('renders entries newest-first with type, created_at, and summary; no empty state', async () => {
    mockReadLog.mockResolvedValueOnce(okOutcome(ENTRIES));
    render(<ActivityLog />);

    const list = await screen.findByTestId('activity-log-list');
    // newest-first: the newer entry's row precedes the older entry's row
    const rows = within(list)
      .getAllByTestId(/^activity-log-item-/)
      .map((el) => el.getAttribute('data-testid'));
    expect(rows).toEqual(['activity-log-item-new', 'activity-log-item-old']);

    // each row shows type, created_at, and summary
    expect(screen.getByTestId('activity-log-type-new').textContent).toContain('draft_copied');
    expect(screen.getByTestId('activity-log-time-new').textContent).toContain(
      '2026-03-03T00:00:00.000Z',
    );
    expect(screen.getByTestId('activity-log-summary-new').textContent).toContain(
      'Copied a draft — item q-9',
    );
    expect(screen.getByTestId('activity-log-type-old').textContent).toContain('draft_saved');
    expect(screen.getByTestId('activity-log-summary-old').textContent).toContain('item q-1');

    expect(screen.queryByTestId('activity-log-empty')).toBeNull();
  });
});

// --- 2. Empty state ----------------------------------------------------------

describe('ActivityLog — empty state', () => {
  it('shows the empty-state message when the log is empty', async () => {
    mockReadLog.mockResolvedValueOnce(okOutcome([]));
    render(<ActivityLog />);

    const empty = await screen.findByTestId('activity-log-empty');
    expect(empty.textContent).toContain('No activity has been recorded.');
    expect(screen.queryByTestId('activity-log-list')).toBeNull();
  });
});

// --- 3. Recoverable read error -----------------------------------------------

describe('ActivityLog — recoverable read error', () => {
  it.each([
    ['read_error', 'Could not read your activity log.'],
    ['parse_error', 'Your saved activity log could not be read.'],
  ] as const)('shows the safe message and a working Retry for %s', async (errorKind, safeMessage) => {
    mockReadLog
      .mockResolvedValueOnce({ ok: false, error: errorKind, message: safeMessage })
      .mockResolvedValueOnce(okOutcome(ENTRIES));

    render(<ActivityLog />);

    const errorBox = await screen.findByTestId('activity-log-error');
    expect(errorBox.textContent ?? '').toContain(safeMessage);

    const retry = screen.getByTestId('activity-log-retry');
    fireEvent.click(retry);

    // recovers to the list on the second readLog
    await screen.findByTestId('activity-log-list');
    expect(mockReadLog).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('activity-log-error')).toBeNull();
  });
});

// --- 4. Export controls ------------------------------------------------------

describe('ActivityLog — export controls', () => {
  beforeEach(() => {
    mockReadLog.mockResolvedValue(okOutcome(ENTRIES));
  });

  it('JSON copy hands the genuine JSON document to clipboardExport', async () => {
    render(<ActivityLog />);
    await screen.findByTestId('activity-log-list');

    fireEvent.click(screen.getByTestId('activity-log-copy-json'));
    await waitFor(() => expect(mockClipboardExport).toHaveBeenCalledTimes(1));
    expect(mockClipboardExport).toHaveBeenCalledWith(toJsonDocument(ENTRIES));
    expect(chromeDownloadsSpy).not.toHaveBeenCalled();
  });

  it('Markdown copy hands the genuine Markdown document to clipboardExport', async () => {
    render(<ActivityLog />);
    await screen.findByTestId('activity-log-list');

    fireEvent.click(screen.getByTestId('activity-log-copy-markdown'));
    await waitFor(() => expect(mockClipboardExport).toHaveBeenCalledTimes(1));
    expect(mockClipboardExport).toHaveBeenCalledWith(toMarkdownDocument(ENTRIES));
    expect(chromeDownloadsSpy).not.toHaveBeenCalled();
  });

  it('JSON download calls downloadExport with activity-log.json / application/json', async () => {
    render(<ActivityLog />);
    await screen.findByTestId('activity-log-list');

    fireEvent.click(screen.getByTestId('activity-log-download-json'));
    expect(mockDownloadExport).toHaveBeenCalledTimes(1);
    expect(mockDownloadExport).toHaveBeenCalledWith(
      toJsonDocument(ENTRIES),
      'activity-log.json',
      'application/json',
    );
    expect(chromeDownloadsSpy).not.toHaveBeenCalled();
  });

  it('Markdown download calls downloadExport with activity-log.md / text/markdown', async () => {
    render(<ActivityLog />);
    await screen.findByTestId('activity-log-list');

    fireEvent.click(screen.getByTestId('activity-log-download-markdown'));
    expect(mockDownloadExport).toHaveBeenCalledTimes(1);
    expect(mockDownloadExport).toHaveBeenCalledWith(
      toMarkdownDocument(ENTRIES),
      'activity-log.md',
      'text/markdown',
    );
    expect(chromeDownloadsSpy).not.toHaveBeenCalled();
  });

  it('shows a safe recoverable error when a copy export fails', async () => {
    mockClipboardExport.mockRejectedValueOnce(new Error('clipboard denied'));
    render(<ActivityLog />);
    await screen.findByTestId('activity-log-list');

    fireEvent.click(screen.getByTestId('activity-log-copy-json'));
    const err = await screen.findByTestId('activity-log-action-error');
    expect(err.textContent ?? '').toMatch(/copy/i);
    expect(err.textContent ?? '').not.toContain('clipboard denied'); // no leak
    // panel still rendered (no crash)
    expect(screen.getByTestId('activity-log-list')).toBeTruthy();
  });

  it('shows a safe recoverable error when a download export throws', async () => {
    mockDownloadExport.mockImplementationOnce(() => {
      throw new Error('blob failed');
    });
    render(<ActivityLog />);
    await screen.findByTestId('activity-log-list');

    fireEvent.click(screen.getByTestId('activity-log-download-json'));
    const err = await screen.findByTestId('activity-log-action-error');
    expect(err.textContent ?? '').toMatch(/download/i);
    expect(err.textContent ?? '').not.toContain('blob failed'); // no leak
    expect(chromeDownloadsSpy).not.toHaveBeenCalled();
  });
});

// --- 5. Clear control --------------------------------------------------------

describe('ActivityLog — clear control', () => {
  it('clears to the empty state on success', async () => {
    mockReadLog.mockResolvedValueOnce(okOutcome(ENTRIES));
    mockClearLog.mockResolvedValueOnce(undefined);
    render(<ActivityLog />);
    await screen.findByTestId('activity-log-list');

    fireEvent.click(screen.getByTestId('activity-log-clear'));

    await screen.findByTestId('activity-log-empty');
    expect(mockClearLog).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('activity-log-list')).toBeNull();
  });

  it('shows a safe recoverable error and does not crash when clear fails', async () => {
    mockReadLog.mockResolvedValueOnce(okOutcome(ENTRIES));
    mockClearLog.mockRejectedValueOnce(
      new ActivityLogStorageError('Could not clear your activity log. Please try again.'),
    );
    render(<ActivityLog />);
    await screen.findByTestId('activity-log-list');

    fireEvent.click(screen.getByTestId('activity-log-clear'));

    const err = await screen.findByTestId('activity-log-action-error');
    expect(err.textContent ?? '').toContain('Could not clear your activity log. Please try again.');
    // entries remain and the panel still renders (no crash)
    expect(screen.getByTestId('activity-log-list')).toBeTruthy();
  });
});

// --- 6. Passive UI boundary --------------------------------------------------

describe('ActivityLog — passive UI boundary', () => {
  const FORBIDDEN = /\b(post|submit|comment|upvote|downvote|vote|publish|auto-?post)\b/i;

  it('renders no post/submit/comment/vote/publish/auto-post controls', async () => {
    mockReadLog.mockResolvedValueOnce(okOutcome(ENTRIES));
    render(<ActivityLog />);
    await screen.findByTestId('activity-log-list');

    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const btn of buttons) {
      expect(btn.textContent ?? '').not.toMatch(FORBIDDEN);
    }
    // the visible control set is export + clear only
    const labels = buttons.map((b) => (b.textContent ?? '').trim()).sort();
    expect(labels).toEqual(
      ['Clear log', 'Copy JSON', 'Copy Markdown', 'Download JSON', 'Download Markdown'].sort(),
    );
  });
});
