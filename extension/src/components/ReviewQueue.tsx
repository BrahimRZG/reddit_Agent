import { useCallback, useEffect, useState } from 'react';
import type {
  ChecklistItem,
  ComplianceWarning,
  DraftResult,
  QueueItem,
  ReviewQueue as ReviewQueueType,
  ReviewStatus,
} from '../types';
import {
  MAX_QUEUE_DRAFT_TEXT,
  REVIEW_STATUS_LABELS,
} from '../types';
import {
  addChecklistItem,
  addItem,
  createItemFromDraftResult,
  createManualItem,
  deleteItem,
  editChecklistItem,
  editDraftText,
  orderQueue,
  removeChecklistItem,
  setStatus,
  toggleChecklistItem,
  updateNote,
  validateDraftText,
  type IdFactory,
  type QueueClock,
} from '../lib/review-queue';
import { readQueue, ReviewQueueStorageError, writeQueue } from '../lib/review-queue-storage';

/** Optional props (Req 1.1–1.3). When a Spec 06 Draft_Result is supplied, the panel
 * offers a control to save it into the queue. Popup is not modified by this task, so
 * the prop is simply not passed yet — the capability stays ready for Task 5. */
interface ReviewQueueProps {
  draftResult?: DraftResult;
}

/** The exactly-three Review_Status values, surfaced via REVIEW_STATUS_LABELS (Req 3.1, 3.2). */
const STATUS_OPTIONS = Object.entries(REVIEW_STATUS_LABELS) as ReadonlyArray<
  [ReviewStatus, string]
>;

/** A fixed, safe write-failure message (mirrors the storage adapter; never leaks internals). */
const WRITE_ERROR_MESSAGE = "Couldn't save your review queue. Please try again.";

/** True when the runtime environment exposes a usable clipboard write (manual copy only). */
function clipboardAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard !== 'undefined' &&
    typeof navigator.clipboard.writeText === 'function'
  );
}

/** Map a MutateResult/AddResult rejection reason to a concise, safe inline message (Req 8.x). */
function reasonMessage(
  reason: 'empty' | 'too_long' | 'queue_full' | 'checklist_full' | 'not_found',
  max?: number,
): string {
  switch (reason) {
    case 'empty':
      return 'Enter some non-empty text first.';
    case 'too_long':
      return `Exceeds the ${(max ?? 0).toLocaleString()}-character maximum. Please shorten it.`;
    case 'queue_full':
      return `The queue is full (maximum ${max} items). Delete an item to add a new one.`;
    case 'checklist_full':
      return `This item already has the maximum of ${max} checklist items.`;
    case 'not_found':
      return 'That item could no longer be found.';
  }
}

/**
 * Review_Queue panel (Spec 07, Req 1–10, 12).
 *
 * UI only. Loads the queue via `readQueue` on mount and holds the queue plus per-item
 * edit state in local React state. Every Operator action calls a PURE transform from
 * `review-queue.ts` and then persists via `writeQueue`. Non-determinism (fresh ids and
 * timestamps) is supplied through injected `clock` / `ids` seams. The panel performs
 * NO network request and renders NO posting/submit/automation control of any kind —
 * the only data egress is the local clipboard for manual copy (Req 12.7, 12.8).
 */
export function ReviewQueue({ draftResult }: ReviewQueueProps) {
  // Injected non-determinism seams (design.md Section 5.3). Production values:
  // ISO timestamps + crypto.randomUUID(); the pure transforms stay reproducible.
  const clock: QueueClock = { now: () => new Date().toISOString() };
  const ids: IdFactory = { create: () => crypto.randomUUID() };

  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<ReviewQueueType>([]);
  const [storageError, setStorageError] = useState<string | null>(null);

  const [manualText, setManualText] = useState('');
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [noteInputs, setNoteInputs] = useState<Record<string, string>>({});
  const [checklistInputs, setChecklistInputs] = useState<Record<string, string>>({});
  const [checklistEditInputs, setChecklistEditInputs] = useState<Record<string, string>>({});
  const [editInputs, setEditInputs] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const setMessage = (key: string, value: string) =>
    setMessages((prev) => ({ ...prev, [key]: value }));
  const clearMessage = (key: string) =>
    setMessages((prev) => {
      if (!(key in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[key];
      return next;
    });

  // On mount, load the queue. A read_error/parse_error yields a recoverable error
  // state (Req 10.2, 10.4); the UI never crashes.
  const load = useCallback(async () => {
    setLoading(true);
    setStorageError(null);
    const outcome = await readQueue();
    if (outcome.ok) {
      setQueue(outcome.items);
    } else {
      setStorageError(outcome.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Persist a new queue value. On a thrown ReviewQueueStorageError surface the
   * recoverable error state (Req 9.3); returns true only when the write succeeded. */
  const persist = async (next: ReviewQueueType): Promise<boolean> => {
    try {
      await writeQueue(next);
      setQueue(next);
      return true;
    } catch (err) {
      setStorageError(err instanceof ReviewQueueStorageError ? err.message : WRITE_ERROR_MESSAGE);
      return false;
    }
  };

  // --- Save controls -----------------------------------------------------------

  const handleSaveManual = async () => {
    clearMessage('manual');
    const validation = validateDraftText(manualText);
    if (validation.kind === 'empty') {
      setMessage('manual', 'Enter draft text to save.');
      return;
    }
    if (validation.kind === 'too_long') {
      setMessage(
        'manual',
        `Draft text exceeds the ${MAX_QUEUE_DRAFT_TEXT.toLocaleString()}-character maximum. Please shorten it.`,
      );
      return;
    }
    const added = addItem(queue, createManualItem(manualText, clock, ids));
    if (!added.ok) {
      setMessage('manual', reasonMessage(added.reason, added.max));
      return;
    }
    if (await persist(added.queue)) {
      setManualText('');
    }
  };

  const handleSaveDraftResult = async () => {
    if (!draftResult) {
      return;
    }
    clearMessage('draft-result');
    const added = addItem(queue, createItemFromDraftResult(draftResult, clock, ids));
    if (!added.ok) {
      setMessage('draft-result', reasonMessage(added.reason, added.max));
      return;
    }
    await persist(added.queue);
  };

  // --- Per-item mutations ------------------------------------------------------

  const handleStatusChange = async (id: string, status: ReviewStatus) => {
    await persist(setStatus(queue, id, status, clock));
  };

  const handleNoteSave = async (id: string) => {
    clearMessage(`note:${id}`);
    const result = updateNote(queue, id, noteInputs[id] ?? '', clock);
    if (!result.ok) {
      setMessage(`note:${id}`, reasonMessage(result.reason, result.max));
      return;
    }
    await persist(result.queue);
  };

  const handleNoteClear = async (id: string) => {
    clearMessage(`note:${id}`);
    const result = updateNote(queue, id, undefined, clock);
    if (!result.ok) {
      setMessage(`note:${id}`, reasonMessage(result.reason, result.max));
      return;
    }
    if (await persist(result.queue)) {
      setNoteInputs((prev) => ({ ...prev, [id]: '' }));
    }
  };

  const handleChecklistAdd = async (id: string) => {
    clearMessage(`checklist:${id}`);
    const result = addChecklistItem(queue, id, checklistInputs[id] ?? '', clock, ids);
    if (!result.ok) {
      setMessage(`checklist:${id}`, reasonMessage(result.reason, result.max));
      return;
    }
    if (await persist(result.queue)) {
      setChecklistInputs((prev) => ({ ...prev, [id]: '' }));
    }
  };

  const handleChecklistToggle = async (id: string, checklistId: string) => {
    await persist(toggleChecklistItem(queue, id, checklistId, clock));
  };

  const handleChecklistEdit = async (id: string, checklistId: string) => {
    const key = `${id}:${checklistId}`;
    clearMessage(`clitem:${key}`);
    const result = editChecklistItem(
      queue,
      id,
      checklistId,
      checklistEditInputs[key] ?? '',
      clock,
    );
    if (!result.ok) {
      setMessage(`clitem:${key}`, reasonMessage(result.reason, result.max));
      return;
    }
    await persist(result.queue);
  };

  const handleChecklistRemove = async (id: string, checklistId: string) => {
    await persist(removeChecklistItem(queue, id, checklistId, clock));
  };

  const handleEditDraft = async (id: string) => {
    clearMessage(`edit:${id}`);
    const result = editDraftText(queue, id, editInputs[id] ?? '', clock);
    if (!result.ok) {
      setMessage(`edit:${id}`, reasonMessage(result.reason, result.max));
      return;
    }
    await persist(result.queue);
  };

  const handleDelete = async (id: string) => {
    await persist(deleteItem(queue, id));
  };

  const handleCopy = async (id: string, text: string) => {
    if (!clipboardAvailable()) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
    } catch {
      // Clipboard write failed; manual selection remains the fallback.
      setCopiedId(null);
    }
  };

  // --- Render ------------------------------------------------------------------

  return (
    <div className="mt-4 border-t border-gray-200 pt-4" data-testid="review-queue">
      <h2 className="text-sm font-semibold text-gray-900">Review Queue</h2>
      <p className="mt-1 text-[11px] text-gray-500">
        Save reply drafts here to triage them locally before posting manually yourself. Everything
        stays in your browser — nothing is sent anywhere and nothing is posted automatically.
      </p>

      {loading ? (
        <p className="mt-3 text-xs text-gray-500" data-testid="review-queue-loading">
          Loading your review queue…
        </p>
      ) : storageError !== null ? (
        // Recoverable error state (Req 10.2, 10.4, 10.5) — safe message + Retry; never crashes.
        <div
          className="mt-3 rounded border border-red-300 bg-red-50 p-2"
          role="alert"
          aria-live="polite"
          data-testid="review-queue-error"
        >
          <p className="text-xs text-red-700">{storageError}</p>
          <button
            onClick={() => void load()}
            className="mt-2 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
            data-testid="review-queue-retry"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* Save from a Spec 06 Draft_Result (Req 1.1, 1.2, 1.3) — only when supplied. */}
          {draftResult && (
            <div className="mt-3" data-testid="review-queue-save-draft-result-section">
              <button
                onClick={() => void handleSaveDraftResult()}
                className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded transition-colors"
                data-testid="review-queue-save-draft-result"
              >
                Save generated draft to queue
              </button>
              {messages['draft-result'] && (
                <p
                  className="mt-1 text-[11px] text-red-600"
                  role="alert"
                  aria-live="polite"
                  data-testid="review-queue-draft-result-error"
                >
                  {messages['draft-result']}
                </p>
              )}
            </div>
          )}

          {/* Save a manual draft (Req 1.4, 1.7, 8.2, 8.6). */}
          <div className="mt-3">
            <label
              htmlFor="review-queue-manual-input"
              className="block text-[11px] font-medium text-gray-600"
            >
              Save a manual draft
            </label>
            <textarea
              id="review-queue-manual-input"
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              rows={4}
              placeholder="Paste or type a draft to save for review…"
              className="mt-1 w-full rounded border border-gray-300 p-2 text-xs text-gray-800 focus:border-blue-500 focus:ring-blue-500"
              data-testid="review-queue-manual-input"
            />
            <div className="mt-1 flex items-center justify-between">
              <span
                className={`text-[10px] ${
                  manualText.length > MAX_QUEUE_DRAFT_TEXT ? 'text-red-600' : 'text-gray-400'
                }`}
                data-testid="review-queue-manual-counter"
              >
                {manualText.length} / {MAX_QUEUE_DRAFT_TEXT}
              </span>
              <button
                onClick={() => void handleSaveManual()}
                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
                data-testid="review-queue-save"
              >
                Save to queue
              </button>
            </div>
            {messages.manual && (
              <p
                className="mt-1 text-[11px] text-red-600"
                role="alert"
                aria-live="polite"
                data-testid="review-queue-manual-error"
              >
                {messages.manual}
              </p>
            )}
          </div>

          {/* List + empty state (Req 6). */}
          {queue.length === 0 ? (
            <p
              className="mt-4 text-xs text-gray-500"
              data-testid="review-queue-empty"
            >
              No items are queued.
            </p>
          ) : (
            <ul className="mt-4 space-y-3" data-testid="review-queue-list">
              {orderQueue(queue).map((item) => (
                <QueueRow
                  key={item.id}
                  item={item}
                  copied={copiedId === item.id}
                  messages={messages}
                  noteValue={noteInputs[item.id] ?? item.note ?? ''}
                  checklistValue={checklistInputs[item.id] ?? ''}
                  editValue={editInputs[item.id] ?? item.draftText}
                  checklistEditInputs={checklistEditInputs}
                  onStatusChange={handleStatusChange}
                  onNoteChange={(value) =>
                    setNoteInputs((prev) => ({ ...prev, [item.id]: value }))
                  }
                  onNoteSave={handleNoteSave}
                  onNoteClear={handleNoteClear}
                  onChecklistInputChange={(value) =>
                    setChecklistInputs((prev) => ({ ...prev, [item.id]: value }))
                  }
                  onChecklistAdd={handleChecklistAdd}
                  onChecklistToggle={handleChecklistToggle}
                  onChecklistEditChange={(checklistId, value) =>
                    setChecklistEditInputs((prev) => ({
                      ...prev,
                      [`${item.id}:${checklistId}`]: value,
                    }))
                  }
                  onChecklistEdit={handleChecklistEdit}
                  onChecklistRemove={handleChecklistRemove}
                  onEditChange={(value) =>
                    setEditInputs((prev) => ({ ...prev, [item.id]: value }))
                  }
                  onEditDraft={handleEditDraft}
                  onDelete={handleDelete}
                  onCopy={handleCopy}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

interface QueueRowProps {
  item: QueueItem;
  copied: boolean;
  messages: Record<string, string>;
  noteValue: string;
  checklistValue: string;
  editValue: string;
  checklistEditInputs: Record<string, string>;
  onStatusChange: (id: string, status: ReviewStatus) => void;
  onNoteChange: (value: string) => void;
  onNoteSave: (id: string) => void;
  onNoteClear: (id: string) => void;
  onChecklistInputChange: (value: string) => void;
  onChecklistAdd: (id: string) => void;
  onChecklistToggle: (id: string, checklistId: string) => void;
  onChecklistEditChange: (checklistId: string, value: string) => void;
  onChecklistEdit: (id: string, checklistId: string) => void;
  onChecklistRemove: (id: string, checklistId: string) => void;
  onEditChange: (value: string) => void;
  onEditDraft: (id: string) => void;
  onDelete: (id: string) => void;
  onCopy: (id: string, text: string) => void;
}

/** A single Queue_Item view: status, draft text, captured metadata, note, checklist,
 * edit, delete, and manual copy (Req 6.4, 3, 4, 5, 7, 12.7, 12.8). */
function QueueRow({
  item,
  copied,
  messages,
  noteValue,
  checklistValue,
  editValue,
  checklistEditInputs,
  onStatusChange,
  onNoteChange,
  onNoteSave,
  onNoteClear,
  onChecklistInputChange,
  onChecklistAdd,
  onChecklistToggle,
  onChecklistEditChange,
  onChecklistEdit,
  onChecklistRemove,
  onEditChange,
  onEditDraft,
  onDelete,
  onCopy,
}: QueueRowProps) {
  const id = item.id;
  return (
    <li
      className="rounded border border-gray-200 p-2"
      data-testid={`review-queue-item-${id}`}
    >
      {/* Header: status label + status selector (Req 6.2, 3.2, 3.5). */}
      <div className="flex items-center justify-between gap-2">
        <span
          className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-700"
          data-testid={`review-queue-status-label-${id}`}
        >
          {REVIEW_STATUS_LABELS[item.status]}
        </span>
        <label className="flex items-center gap-1 text-[10px] text-gray-500">
          Status
          <select
            value={item.status}
            onChange={(e) => onStatusChange(id, e.target.value as ReviewStatus)}
            className="rounded border border-gray-300 text-[11px] text-gray-800"
            data-testid={`review-queue-status-${id}`}
          >
            {STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Source + mode when present (Req 6.4). */}
      <p className="mt-1 text-[10px] text-gray-400">
        <span data-testid={`review-queue-source-${id}`}>Source: {item.source}</span>
        {item.mode !== undefined && (
          <span data-testid={`review-queue-mode-${id}`}> · Mode: {item.mode}</span>
        )}
        {item.safety !== undefined && (
          <span data-testid={`review-queue-safety-${id}`}> · Safety: {item.safety}</span>
        )}
      </p>

      {/* Draft text (Req 6.2, 6.4). */}
      <p
        className="mt-1 whitespace-pre-wrap break-words text-xs text-gray-800"
        data-testid={`review-queue-draft-${id}`}
      >
        {item.draftText}
      </p>

      {/* Manual copy only (Req 12.7, 12.8). */}
      {clipboardAvailable() && (
        <div className="mt-1 flex justify-end">
          <button
            onClick={() => onCopy(id, item.draftText)}
            className="px-2 py-1 text-[11px] font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded transition-colors"
            data-testid={`review-queue-copy-${id}`}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}

      {/* Captured warnings when present (Req 6.4). */}
      {item.warnings !== undefined && item.warnings.length > 0 && (
        <div
          className="mt-2 rounded border border-amber-200 bg-amber-50 p-2"
          data-testid={`review-queue-warnings-${id}`}
        >
          <p className="text-[11px] font-semibold text-amber-800">Captured compliance reminders</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {item.warnings.map((warning: ComplianceWarning) => (
              <li key={warning.id} className="text-[11px] text-amber-900">
                {warning.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Note when present (Req 4.5). */}
      {item.note !== undefined && item.note.length > 0 && (
        <p
          className="mt-2 text-[11px] text-gray-700"
          data-testid={`review-queue-note-${id}`}
        >
          Note: {item.note}
        </p>
      )}

      {/* Note editor (Req 4.1, 4.2, 4.3, 8.4). */}
      <div className="mt-2">
        <label
          htmlFor={`review-queue-note-input-${id}`}
          className="block text-[10px] font-medium text-gray-500"
        >
          Note
        </label>
        <textarea
          id={`review-queue-note-input-${id}`}
          value={noteValue}
          onChange={(e) => onNoteChange(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded border border-gray-300 p-1.5 text-[11px] text-gray-800 focus:border-blue-500 focus:ring-blue-500"
          data-testid={`review-queue-note-input-${id}`}
        />
        <div className="mt-1 flex gap-2">
          <button
            onClick={() => onNoteSave(id)}
            className="px-2 py-1 text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
            data-testid={`review-queue-note-save-${id}`}
          >
            Save note
          </button>
          <button
            onClick={() => onNoteClear(id)}
            className="px-2 py-1 text-[11px] font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded transition-colors"
            data-testid={`review-queue-note-clear-${id}`}
          >
            Clear note
          </button>
        </div>
        {messages[`note:${id}`] && (
          <p
            className="mt-1 text-[11px] text-red-600"
            role="alert"
            aria-live="polite"
            data-testid={`review-queue-note-error-${id}`}
          >
            {messages[`note:${id}`]}
          </p>
        )}
      </div>

      {/* Checklist (Req 5). */}
      <div className="mt-2">
        <p className="text-[10px] font-medium text-gray-500">Checklist</p>
        {item.checklist.length > 0 && (
          <ul className="mt-1 space-y-1" data-testid={`review-queue-checklist-${id}`}>
            {item.checklist.map((entry: ChecklistItem) => {
              const key = `${id}:${entry.id}`;
              return (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center gap-1"
                  data-testid={`review-queue-checklist-item-${id}-${entry.id}`}
                >
                  <input
                    type="checkbox"
                    checked={entry.checked}
                    onChange={() => onChecklistToggle(id, entry.id)}
                    data-testid={`review-queue-checklist-toggle-${id}-${entry.id}`}
                  />
                  <input
                    type="text"
                    value={checklistEditInputs[key] ?? entry.text}
                    onChange={(e) => onChecklistEditChange(entry.id, e.target.value)}
                    className="flex-1 rounded border border-gray-300 p-1 text-[11px] text-gray-800 focus:border-blue-500 focus:ring-blue-500"
                    data-testid={`review-queue-checklist-edit-input-${id}-${entry.id}`}
                  />
                  <button
                    onClick={() => onChecklistEdit(id, entry.id)}
                    className="px-1.5 py-0.5 text-[10px] font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded"
                    data-testid={`review-queue-checklist-edit-${id}-${entry.id}`}
                  >
                    Update
                  </button>
                  <button
                    onClick={() => onChecklistRemove(id, entry.id)}
                    className="px-1.5 py-0.5 text-[10px] font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded"
                    data-testid={`review-queue-checklist-remove-${id}-${entry.id}`}
                  >
                    Remove
                  </button>
                  {messages[`clitem:${key}`] && (
                    <p
                      className="w-full text-[11px] text-red-600"
                      role="alert"
                      aria-live="polite"
                      data-testid={`review-queue-checklist-item-error-${id}-${entry.id}`}
                    >
                      {messages[`clitem:${key}`]}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-1 flex gap-2">
          <input
            type="text"
            value={checklistValue}
            onChange={(e) => onChecklistInputChange(e.target.value)}
            placeholder="Add a checklist item…"
            className="flex-1 rounded border border-gray-300 p-1 text-[11px] text-gray-800 focus:border-blue-500 focus:ring-blue-500"
            data-testid={`review-queue-checklist-input-${id}`}
          />
          <button
            onClick={() => onChecklistAdd(id)}
            className="px-2 py-1 text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
            data-testid={`review-queue-checklist-add-${id}`}
          >
            Add
          </button>
        </div>
        {messages[`checklist:${id}`] && (
          <p
            className="mt-1 text-[11px] text-red-600"
            role="alert"
            aria-live="polite"
            data-testid={`review-queue-checklist-error-${id}`}
          >
            {messages[`checklist:${id}`]}
          </p>
        )}
      </div>

      {/* Edit draft text (Req 7.1, 7.2, 7.5, 8.2). */}
      <div className="mt-2">
        <label
          htmlFor={`review-queue-edit-input-${id}`}
          className="block text-[10px] font-medium text-gray-500"
        >
          Edit draft text
        </label>
        <textarea
          id={`review-queue-edit-input-${id}`}
          value={editValue}
          onChange={(e) => onEditChange(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded border border-gray-300 p-1.5 text-[11px] text-gray-800 focus:border-blue-500 focus:ring-blue-500"
          data-testid={`review-queue-edit-input-${id}`}
        />
        <div className="mt-1 flex justify-between">
          <button
            onClick={() => onEditDraft(id)}
            className="px-2 py-1 text-[11px] font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
            data-testid={`review-queue-edit-save-${id}`}
          >
            Save draft text
          </button>
          <button
            onClick={() => onDelete(id)}
            className="px-2 py-1 text-[11px] font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded transition-colors"
            data-testid={`review-queue-delete-${id}`}
          >
            Delete
          </button>
        </div>
        {messages[`edit:${id}`] && (
          <p
            className="mt-1 text-[11px] text-red-600"
            role="alert"
            aria-live="polite"
            data-testid={`review-queue-edit-error-${id}`}
          >
            {messages[`edit:${id}`]}
          </p>
        )}
      </div>
    </li>
  );
}
