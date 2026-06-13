// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// Mock ONLY the storage adapter. The pure transforms in `review-queue.ts` stay
// REAL so the component exercises genuine, spec-compliant queue logic. We keep
// `ReviewQueueStorageError` REAL (spread from the actual module) so that
// `instanceof` checks in the component succeed and the write-rejection test can
// throw the genuine class.
vi.mock('../lib/review-queue-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/review-queue-storage')>();
  return {
    ...actual,
    readQueue: vi.fn(),
    writeQueue: vi.fn(),
  };
});

import { ReviewQueue } from './ReviewQueue';
import { readQueue, writeQueue, ReviewQueueStorageError } from '../lib/review-queue-storage';
import {
  MAX_QUEUE_DRAFT_TEXT,
  MAX_QUEUE_ITEMS,
  REVIEW_STATUS_LABELS,
} from '../types';
import type { DraftResult, QueueItem } from '../types';

const mockReadQueue = vi.mocked(readQueue);
const mockWriteQueue = vi.mocked(writeQueue);

// --- Deterministic id factory -------------------------------------------------
// The component creates ids via `crypto.randomUUID()`. jsdom's environment may or
// may not expose it; in either case we replace it with a deterministic,
// incrementing counter so created item / checklist ids are predictable
// ('uuid-1', 'uuid-2', ...). Reset per test in beforeEach.
let uuidCounter = 0;
function nextUuid(): string {
  uuidCounter += 1;
  return `uuid-${uuidCounter}`;
}

// --- Clipboard stub -----------------------------------------------------------
// jsdom does not implement navigator.clipboard. Stub writeText so the Copy
// control renders (clipboardAvailable() requires a writeText function) and so the
// copy assertion can observe the call. Restored in afterEach.
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

// --- QueueItem fixture helper -------------------------------------------------
function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 'item-1',
    draftText: 'seeded draft text',
    source: 'manual',
    status: 'needs_review',
    checklist: [],
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Build a full queue of `count` distinct, well-formed items (for the bound test). */
function makeFullQueue(count: number): QueueItem[] {
  return Array.from({ length: count }, (_, i) =>
    makeItem({
      id: `seed-${i}`,
      draftText: `seeded ${i}`,
      created_at: `2024-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
    }),
  );
}

/** Helper to read the queue array passed to the most-recent writeQueue call. */
function lastWritten(): QueueItem[] {
  const calls = mockWriteQueue.mock.calls;
  return calls[calls.length - 1][0] as QueueItem[];
}

beforeEach(() => {
  vi.clearAllMocks();
  uuidCounter = 0;
  // Deterministic id source for the component's IdFactory seam.
  const cryptoObj = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    vi.spyOn(cryptoObj as Crypto, 'randomUUID').mockImplementation(
      () => nextUuid() as `${string}-${string}-${string}-${string}-${string}`,
    );
  } else {
    vi.stubGlobal('crypto', { randomUUID: () => nextUuid() });
  }
  // Sensible defaults: empty queue, successful writes.
  mockReadQueue.mockResolvedValue({ ok: true, items: [] });
  mockWriteQueue.mockResolvedValue(undefined);
  stubClipboard();
});

afterEach(() => {
  cleanup();
  restoreClipboard();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ReviewQueue — load states (Req 6.5, 10.2, 10.4)', () => {
  it('1. shows the empty state after a successful empty read', async () => {
    mockReadQueue.mockResolvedValue({ ok: true, items: [] });

    render(<ReviewQueue />);

    // Empty-state indicator appears once the async read resolves.
    expect(await screen.findByTestId('review-queue-empty')).toBeTruthy();
    expect(screen.queryByTestId('review-queue-error')).toBeNull();
  });

  it('2. shows a recoverable error + Retry on read_error, and Retry re-reads', async () => {
    mockReadQueue.mockResolvedValue({
      ok: false,
      error: 'read_error',
      message: "Couldn't read your review queue. Please try again.",
    });

    render(<ReviewQueue />);

    const error = await screen.findByTestId('review-queue-error');
    expect(error.textContent).toMatch(/couldn'?t read your review queue/i);
    const retry = screen.getByTestId('review-queue-retry');
    expect(retry).toBeTruthy();
    expect(mockReadQueue).toHaveBeenCalledTimes(1);

    fireEvent.click(retry);
    await waitFor(() => expect(mockReadQueue).toHaveBeenCalledTimes(2));
  });

  it('3. shows a recoverable error + Retry on parse_error', async () => {
    mockReadQueue.mockResolvedValue({
      ok: false,
      error: 'parse_error',
      message: "Your saved review queue couldn't be read and was left untouched.",
    });

    render(<ReviewQueue />);

    const error = await screen.findByTestId('review-queue-error');
    expect(error.textContent).toMatch(/couldn'?t be read/i);
    expect(screen.getByTestId('review-queue-retry')).toBeTruthy();
  });
});

describe('ReviewQueue — manual save + validation (Req 1.4, 1.7, 8.2, 8.6)', () => {
  it('4. saves a valid manual draft: writeQueue called once and the row renders', async () => {
    render(<ReviewQueue />);

    const input = (await screen.findByTestId('review-queue-manual-input')) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'My manual draft body' } });
    fireEvent.click(screen.getByTestId('review-queue-save'));

    await waitFor(() => expect(mockWriteQueue).toHaveBeenCalledTimes(1));
    const written = lastWritten();
    expect(written).toHaveLength(1);
    expect(written[0].draftText).toBe('My manual draft body');
    expect(written[0].source).toBe('manual');
    expect(written[0].status).toBe('needs_review');

    // The new item (deterministic id 'uuid-1') renders with the saved draft text.
    const draft = await screen.findByTestId('review-queue-draft-uuid-1');
    expect(draft.textContent).toBe('My manual draft body');
  });

  it('5. blocks an empty/whitespace manual draft: error shown, writeQueue not called', async () => {
    render(<ReviewQueue />);

    const input = (await screen.findByTestId('review-queue-manual-input')) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '    ' } });
    fireEvent.click(screen.getByTestId('review-queue-save'));

    expect(await screen.findByTestId('review-queue-manual-error')).toBeTruthy();
    expect(mockWriteQueue).not.toHaveBeenCalled();
  });

  it('6. blocks an over-limit manual draft: error shown, writeQueue not called', async () => {
    render(<ReviewQueue />);

    const input = (await screen.findByTestId('review-queue-manual-input')) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'a'.repeat(MAX_QUEUE_DRAFT_TEXT + 1) } });
    fireEvent.click(screen.getByTestId('review-queue-save'));

    expect(await screen.findByTestId('review-queue-manual-error')).toBeTruthy();
    expect(mockWriteQueue).not.toHaveBeenCalled();
  });

  it('7. blocks a save when the queue is full (MAX_QUEUE_ITEMS): error shown, no write', async () => {
    mockReadQueue.mockResolvedValue({ ok: true, items: makeFullQueue(MAX_QUEUE_ITEMS) });

    render(<ReviewQueue />);

    const input = (await screen.findByTestId('review-queue-manual-input')) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'one more draft' } });
    fireEvent.click(screen.getByTestId('review-queue-save'));

    const error = await screen.findByTestId('review-queue-manual-error');
    expect(error.textContent).toMatch(/full/i);
    expect(mockWriteQueue).not.toHaveBeenCalled();
  });
});

describe('ReviewQueue — per-item rendering and mutations (Req 3, 4, 5, 6, 7)', () => {
  it('8. renders an item draft text, source, and status label', async () => {
    mockReadQueue.mockResolvedValue({
      ok: true,
      items: [makeItem({ id: 'item-1', draftText: 'render me', source: 'manual' })],
    });

    render(<ReviewQueue />);

    expect((await screen.findByTestId('review-queue-draft-item-1')).textContent).toBe('render me');
    expect(screen.getByTestId('review-queue-source-item-1').textContent).toMatch(/manual/i);
    expect(screen.getByTestId('review-queue-status-label-item-1').textContent).toBe(
      REVIEW_STATUS_LABELS.needs_review,
    );
    expect(screen.getByTestId('review-queue-status-item-1')).toBeTruthy();
  });

  it('9. status selector updates only status and persists', async () => {
    mockReadQueue.mockResolvedValue({
      ok: true,
      items: [makeItem({ id: 'item-1', draftText: 'keep this text', status: 'needs_review' })],
    });

    render(<ReviewQueue />);

    const select = (await screen.findByTestId('review-queue-status-item-1')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'approved_for_manual_use' } });

    await waitFor(() => expect(mockWriteQueue).toHaveBeenCalledTimes(1));
    const written = lastWritten();
    const updated = written.find((i) => i.id === 'item-1')!;
    expect(updated.status).toBe('approved_for_manual_use');
    // Other fields intact.
    expect(updated.draftText).toBe('keep this text');
  });

  it('10. note save then clear each persist via writeQueue', async () => {
    mockReadQueue.mockResolvedValue({ ok: true, items: [makeItem({ id: 'item-1' })] });

    render(<ReviewQueue />);

    const noteInput = (await screen.findByTestId(
      'review-queue-note-input-item-1',
    )) as HTMLTextAreaElement;
    fireEvent.change(noteInput, { target: { value: 'a useful note' } });
    fireEvent.click(screen.getByTestId('review-queue-note-save-item-1'));

    await waitFor(() => expect(mockWriteQueue).toHaveBeenCalledTimes(1));
    expect(lastWritten().find((i) => i.id === 'item-1')!.note).toBe('a useful note');

    fireEvent.click(screen.getByTestId('review-queue-note-clear-item-1'));
    await waitFor(() => expect(mockWriteQueue).toHaveBeenCalledTimes(2));
    expect(lastWritten().find((i) => i.id === 'item-1')!.note).toBeUndefined();
  });

  it('11. checklist add / toggle / edit / remove each persist via writeQueue', async () => {
    mockReadQueue.mockResolvedValue({ ok: true, items: [makeItem({ id: 'item-1', checklist: [] })] });

    render(<ReviewQueue />);

    // Add — creates checklist entry with deterministic id 'uuid-1'.
    const clInput = (await screen.findByTestId(
      'review-queue-checklist-input-item-1',
    )) as HTMLInputElement;
    fireEvent.change(clInput, { target: { value: 'disclose affiliation' } });
    fireEvent.click(screen.getByTestId('review-queue-checklist-add-item-1'));
    await waitFor(() => expect(mockWriteQueue).toHaveBeenCalledTimes(1));

    // Toggle.
    const toggle = await screen.findByTestId('review-queue-checklist-toggle-item-1-uuid-1');
    fireEvent.click(toggle);
    await waitFor(() => expect(mockWriteQueue).toHaveBeenCalledTimes(2));

    // Edit text.
    const editInput = screen.getByTestId(
      'review-queue-checklist-edit-input-item-1-uuid-1',
    ) as HTMLInputElement;
    fireEvent.change(editInput, { target: { value: 'review subreddit rules' } });
    fireEvent.click(screen.getByTestId('review-queue-checklist-edit-item-1-uuid-1'));
    await waitFor(() => expect(mockWriteQueue).toHaveBeenCalledTimes(3));

    // Remove.
    fireEvent.click(screen.getByTestId('review-queue-checklist-remove-item-1-uuid-1'));
    await waitFor(() => expect(mockWriteQueue).toHaveBeenCalledTimes(4));
  });

  it('12. edit draft text: valid save persists; whitespace/over-limit show error and do not persist', async () => {
    mockReadQueue.mockResolvedValue({
      ok: true,
      items: [makeItem({ id: 'item-1', draftText: 'original' })],
    });

    render(<ReviewQueue />);

    const editInput = (await screen.findByTestId(
      'review-queue-edit-input-item-1',
    )) as HTMLTextAreaElement;

    // Valid edit persists with the updated text.
    fireEvent.change(editInput, { target: { value: 'edited draft text' } });
    fireEvent.click(screen.getByTestId('review-queue-edit-save-item-1'));
    await waitFor(() => expect(mockWriteQueue).toHaveBeenCalledTimes(1));
    expect(lastWritten().find((i) => i.id === 'item-1')!.draftText).toBe('edited draft text');

    // Whitespace-only edit is rejected.
    fireEvent.change(editInput, { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('review-queue-edit-save-item-1'));
    expect(await screen.findByTestId('review-queue-edit-error-item-1')).toBeTruthy();
    expect(mockWriteQueue).toHaveBeenCalledTimes(1); // unchanged

    // Over-limit edit is rejected.
    fireEvent.change(editInput, { target: { value: 'a'.repeat(MAX_QUEUE_DRAFT_TEXT + 1) } });
    fireEvent.click(screen.getByTestId('review-queue-edit-save-item-1'));
    expect(await screen.findByTestId('review-queue-edit-error-item-1')).toBeTruthy();
    expect(mockWriteQueue).toHaveBeenCalledTimes(1); // still unchanged
  });

  it('13. delete removes the targeted item and persists', async () => {
    mockReadQueue.mockResolvedValue({ ok: true, items: [makeItem({ id: 'item-1' })] });

    render(<ReviewQueue />);

    fireEvent.click(await screen.findByTestId('review-queue-delete-item-1'));
    await waitFor(() => expect(mockWriteQueue).toHaveBeenCalledTimes(1));
    expect(lastWritten().some((i) => i.id === 'item-1')).toBe(false);
    expect(lastWritten()).toHaveLength(0);
  });
});

describe('ReviewQueue — manual-copy-only egress (Property 10/11; gate is the Popup slice)', () => {
  it('14. copy uses navigator.clipboard.writeText only and performs no network', async () => {
    // Property 11: Manual-Input-Only Scope — the only data egress is the local
    // clipboard. Property 10: No Network — no fetch occurs for any queue action.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    mockReadQueue.mockResolvedValue({
      ok: true,
      items: [makeItem({ id: 'item-1', draftText: 'copy this draft' })],
    });

    render(<ReviewQueue />);

    fireEvent.click(await screen.findByTestId('review-queue-copy-item-1'));

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledTimes(1));
    expect(writeTextMock).toHaveBeenCalledWith('copy this draft');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('ReviewQueue — recoverable write failure (Req 9.3, 10.5)', () => {
  it('15. surfaces a safe recoverable error when writeQueue rejects, without crashing', async () => {
    mockWriteQueue.mockRejectedValueOnce(new ReviewQueueStorageError('safe write message'));

    render(<ReviewQueue />);

    const input = (await screen.findByTestId('review-queue-manual-input')) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'draft that fails to save' } });
    fireEvent.click(screen.getByTestId('review-queue-save'));

    const error = await screen.findByTestId('review-queue-error');
    expect(error.textContent).toMatch(/safe write message/);
    // Recoverable: a Retry control is present and the panel did not crash.
    expect(screen.getByTestId('review-queue-retry')).toBeTruthy();
  });
});

describe('ReviewQueue — save from a Draft_Result (Req 1.1, 1.2, 1.3)', () => {
  it('16. renders the save-draft-result control and captures the Draft_Result verbatim', async () => {
    const draftResult: DraftResult = {
      kind: 'draft',
      mode: 'disclosed-link',
      draftText: 'gen draft',
      warnings: [{ id: 'disclosure_required', message: 'disclose' }],
      safety: 'safe',
    };

    render(<ReviewQueue draftResult={draftResult} />);

    const saveBtn = await screen.findByTestId('review-queue-save-draft-result');
    expect(saveBtn).toBeTruthy();

    fireEvent.click(saveBtn);

    await waitFor(() => expect(mockWriteQueue).toHaveBeenCalledTimes(1));
    const written = lastWritten();
    expect(written).toHaveLength(1);
    const item = written[0];
    expect(item.source).toBe('draft_co_pilot');
    expect(item.draftText).toBe('gen draft');
    expect(item.mode).toBe('disclosed-link');
    expect(item.safety).toBe('safe');
    expect(item.warnings).toEqual([{ id: 'disclosure_required', message: 'disclose' }]);
  });
});

describe('ReviewQueue — no posting/automation controls (Property 11)', () => {
  it('17. exposes no post/submit/publish/vote/dm control among its buttons', async () => {
    // Property 11: Manual-Input-Only Scope — the panel renders only triage and
    // manual-copy controls; it never exposes a posting/automation action. The
    // OnboardingGate containment guarantee is verified in the Popup slice, out of
    // scope for this component test.
    mockReadQueue.mockResolvedValue({ ok: true, items: [makeItem({ id: 'item-1' })] });

    const { container } = render(<ReviewQueue />);
    await screen.findByTestId('review-queue-item-item-1');

    const forbidden = /\b(post|submit|publish|auto-?post|upvote|downvote|\bvote\b|\bdm\b|direct message)\b/i;
    container.querySelectorAll('button').forEach((button) => {
      expect(button.textContent ?? '').not.toMatch(forbidden);
    });
  });
});
