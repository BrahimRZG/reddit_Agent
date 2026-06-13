/**
 * Pure queue-transformation logic for the Review_Queue (Spec 07).
 *
 * Every function in this module is PURE: it returns a brand-new value and NEVER
 * mutates its argument. The module never touches `chrome.storage`, never performs
 * any network request, never invokes any AI provider, and — apart from the
 * INJECTED `QueueClock` / `IdFactory` seams — reads no `Date.now()`,
 * `Math.random()`, `crypto.*`, or any global mutable state. Determinism in this
 * spec applies to the transforms over an already-constructed item (status
 * transition, delete, checklist toggle, serialize/deserialize); the only
 * non-determinism (a fresh `id` / `created_at` / `updated_at` recorded at an
 * Operator action) is supplied by the injected `clock` / `ids` parameters so the
 * transforms themselves stay reproducible (design.md Section 5.3).
 *
 * All shared types and bound constants come from `../types`; nothing is
 * duplicated here. The storage adapter (`review-queue-storage.ts`) is the only
 * module that performs I/O and is intentionally NOT part of this file.
 */
import {
  MAX_CHECKLIST_ITEMS,
  MAX_CHECKLIST_TEXT,
  MAX_NOTE,
  MAX_QUEUE_DRAFT_TEXT,
  MAX_QUEUE_ITEMS,
} from '../types';
import type {
  AddResult,
  ChecklistItem,
  ComplianceWarning,
  DraftMode,
  DraftResult,
  MutateResult,
  QueueFieldValidation,
  QueueItem,
  ReviewQueue,
  ReviewStatus,
} from '../types';

// --- Injected seams (design.md Section 5.3) ----------------------------------

/** Supplies the ISO 8601 timestamp recorded at the moment of an Operator action. */
export interface QueueClock {
  now(): string;
}

/** Supplies a stable, unique Item_Id / Checklist_Item_Id at an Operator action. */
export interface IdFactory {
  create(): string;
}

// --- Internal literal tables (single-sourced, no duplicated strings) ----------

/** The three enumerated Review_Status literals (Req 3.1). */
const REVIEW_STATUSES: readonly ReviewStatus[] = [
  'needs_review',
  'approved_for_manual_use',
  'rejected',
];

/** The three captured Spec 06 Draft_Mode literals (reused verbatim). */
const DRAFT_MODES: readonly DraftMode[] = [
  'no-link-authority',
  'soft-cta-with-disclosure',
  'disclosed-link',
];

// --- 2.1 Field validators ----------------------------------------------------

/**
 * Validate Operator-supplied draft text before save/edit (Req 1.7, 7.5, 8.1, 8.2).
 *   - zero non-whitespace characters → `empty`
 *   - more than MAX_QUEUE_DRAFT_TEXT characters → `too_long`
 *   - otherwise → `valid`
 */
export function validateDraftText(text: string): QueueFieldValidation {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { kind: 'empty' };
  }
  if (text.length > MAX_QUEUE_DRAFT_TEXT) {
    return { kind: 'too_long', max: MAX_QUEUE_DRAFT_TEXT };
  }
  return { kind: 'valid' };
}

/**
 * Validate a Note (Req 8.3, 8.4). An empty Note is allowed (it clears the Note),
 * so only the upper bound is enforced; empty/whitespace text is `valid`.
 */
export function validateNote(text: string): QueueFieldValidation {
  if (typeof text === 'string' && text.length > MAX_NOTE) {
    return { kind: 'too_long', max: MAX_NOTE };
  }
  return { kind: 'valid' };
}

/**
 * Validate a Checklist_Item text (Req 8.3, 8.4).
 *   - zero non-whitespace characters → `empty`
 *   - more than MAX_CHECKLIST_TEXT characters → `too_long`
 *   - otherwise → `valid`
 */
export function validateChecklistText(text: string): QueueFieldValidation {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { kind: 'empty' };
  }
  if (text.length > MAX_CHECKLIST_TEXT) {
    return { kind: 'too_long', max: MAX_CHECKLIST_TEXT };
  }
  return { kind: 'valid' };
}

// --- 2.2 Creation + addItem --------------------------------------------------

/**
 * Create a Queue_Item from a Spec 06 Draft_Result (Req 1.2, 1.3, 1.5, 2.1–2.3).
 * Captures `draftText`/`mode`/`warnings`/`safety` verbatim (warnings cloned so the
 * new item never shares a mutable array with the source), sets `source` to
 * `draft_co_pilot`, `status` to `needs_review`, an empty checklist, a fresh id,
 * and `created_at === updated_at` from the injected clock.
 */
export function createItemFromDraftResult(
  result: DraftResult,
  clock: QueueClock,
  ids: IdFactory,
): QueueItem {
  const timestamp = clock.now();
  return {
    id: ids.create(),
    draftText: result.draftText,
    source: 'draft_co_pilot',
    mode: result.mode,
    warnings: result.warnings.map((warning) => ({ ...warning })),
    safety: result.safety,
    status: 'needs_review',
    checklist: [],
    created_at: timestamp,
    updated_at: timestamp,
  };
}

/**
 * Create a Queue_Item from a manually entered draft (Req 1.4, 1.5, 1.6, 2.1–2.3).
 * Sets `source` to `manual`, omits `mode`/`warnings`/`safety`, and mirrors the
 * same defaults. The caller is expected to have validated the text; this function
 * remains safe when given already-valid text.
 */
export function createManualItem(
  draftText: string,
  clock: QueueClock,
  ids: IdFactory,
): QueueItem {
  const timestamp = clock.now();
  return {
    id: ids.create(),
    draftText,
    source: 'manual',
    status: 'needs_review',
    checklist: [],
    created_at: timestamp,
    updated_at: timestamp,
  };
}

/**
 * Append an item to the queue, enforcing the total-count bound (Req 8.5, 8.6).
 * Returns a new queue on success; when the queue already holds MAX_QUEUE_ITEMS it
 * returns `{ ok: false, reason: 'queue_full', max }` and creates no item.
 */
export function addItem(queue: ReviewQueue, item: QueueItem): AddResult {
  if (queue.length >= MAX_QUEUE_ITEMS) {
    return { ok: false, reason: 'queue_full', max: MAX_QUEUE_ITEMS };
  }
  return { ok: true, queue: [...queue, item] };
}

// --- 2.3 Operator-only, single-target mutations ------------------------------

/** True when `id` matches an item currently in the queue. */
function hasItem(queue: ReviewQueue, id: string): boolean {
  return queue.some((item) => item.id === id);
}

/**
 * Set only the targeted item's `status` and bump its `updated_at`; every other
 * item is returned unchanged (Req 3.3, 3.4, 2.4). A missing id is a no-op that
 * returns an equivalent new array. There is no automatic/scheduled status path —
 * status changes only via this explicit call.
 */
export function setStatus(
  queue: ReviewQueue,
  id: string,
  status: ReviewStatus,
  clock: QueueClock,
): ReviewQueue {
  return queue.map((item) =>
    item.id === id ? { ...item, status, updated_at: clock.now() } : item,
  );
}

/**
 * Set or clear the Note on only the targeted item (Req 4.2, 4.3, 4.4, 8.4). An
 * `undefined` or whitespace-only note clears the Note; a non-empty note (within
 * MAX_NOTE) is stored. Bumps `updated_at`; leaves `status` and captured `safety`
 * unchanged. Returns `not_found` for a missing id and `too_long` over the bound.
 */
export function updateNote(
  queue: ReviewQueue,
  id: string,
  note: string | undefined,
  clock: QueueClock,
): MutateResult {
  if (!hasItem(queue, id)) {
    return { ok: false, reason: 'not_found' };
  }
  if (note !== undefined) {
    const validation = validateNote(note);
    if (validation.kind === 'too_long') {
      return { ok: false, reason: 'too_long', max: validation.max };
    }
  }
  const clears = note === undefined || note.trim().length === 0;
  const queueNext = queue.map((item) => {
    if (item.id !== id) {
      return item;
    }
    const next: QueueItem = { ...item, updated_at: clock.now() };
    if (clears) {
      delete next.note;
    } else {
      next.note = note;
    }
    return next;
  });
  return { ok: true, queue: queueNext };
}

/**
 * Append a Checklist_Item to only the targeted item (Req 5.1, 5.2, 8.4, 8.6).
 * Validates the text bound, enforces the per-item count bound (`checklist_full`),
 * assigns a fresh unique id and `checked = false`, and bumps `updated_at`.
 */
export function addChecklistItem(
  queue: ReviewQueue,
  id: string,
  text: string,
  clock: QueueClock,
  ids: IdFactory,
): MutateResult {
  const target = queue.find((item) => item.id === id);
  if (!target) {
    return { ok: false, reason: 'not_found' };
  }
  const validation = validateChecklistText(text);
  if (validation.kind === 'empty') {
    return { ok: false, reason: 'empty' };
  }
  if (validation.kind === 'too_long') {
    return { ok: false, reason: 'too_long', max: validation.max };
  }
  if (target.checklist.length >= MAX_CHECKLIST_ITEMS) {
    return { ok: false, reason: 'checklist_full', max: MAX_CHECKLIST_ITEMS };
  }
  const entry: ChecklistItem = { id: ids.create(), text, checked: false };
  const queueNext = queue.map((item) =>
    item.id === id
      ? { ...item, checklist: [...item.checklist, entry], updated_at: clock.now() }
      : item,
  );
  return { ok: true, queue: queueNext };
}

/**
 * Invert `checked` on only the targeted Checklist_Item, leaving the `text` and
 * `checked` of every other entry unchanged (Req 5.3). Bumps the owning item's
 * `updated_at` only when the entry exists; a missing id/checklistId is a no-op
 * returning an equivalent new array.
 */
export function toggleChecklistItem(
  queue: ReviewQueue,
  id: string,
  checklistId: string,
  clock: QueueClock,
): ReviewQueue {
  return queue.map((item) => {
    if (item.id !== id || !item.checklist.some((entry) => entry.id === checklistId)) {
      return item;
    }
    return {
      ...item,
      checklist: item.checklist.map((entry) =>
        entry.id === checklistId ? { ...entry, checked: !entry.checked } : entry,
      ),
      updated_at: clock.now(),
    };
  });
}

/**
 * Update the `text` of only the targeted Checklist_Item (Req 5.4, 8.4). Validates
 * the text bound; bumps the owning item's `updated_at`. Returns `not_found` when
 * the id or checklistId does not exist.
 */
export function editChecklistItem(
  queue: ReviewQueue,
  id: string,
  checklistId: string,
  text: string,
  clock: QueueClock,
): MutateResult {
  const target = queue.find((item) => item.id === id);
  if (!target || !target.checklist.some((entry) => entry.id === checklistId)) {
    return { ok: false, reason: 'not_found' };
  }
  const validation = validateChecklistText(text);
  if (validation.kind === 'empty') {
    return { ok: false, reason: 'empty' };
  }
  if (validation.kind === 'too_long') {
    return { ok: false, reason: 'too_long', max: validation.max };
  }
  const queueNext = queue.map((item) =>
    item.id === id
      ? {
          ...item,
          checklist: item.checklist.map((entry) =>
            entry.id === checklistId ? { ...entry, text } : entry,
          ),
          updated_at: clock.now(),
        }
      : item,
  );
  return { ok: true, queue: queueNext };
}

/**
 * Remove only the targeted Checklist_Item from its owning item (Req 5.5), bumping
 * `updated_at` only when an entry was removed. A missing id/checklistId is a no-op
 * returning an equivalent new array.
 */
export function removeChecklistItem(
  queue: ReviewQueue,
  id: string,
  checklistId: string,
  clock: QueueClock,
): ReviewQueue {
  return queue.map((item) => {
    if (item.id !== id || !item.checklist.some((entry) => entry.id === checklistId)) {
      return item;
    }
    return {
      ...item,
      checklist: item.checklist.filter((entry) => entry.id !== checklistId),
      updated_at: clock.now(),
    };
  });
}

/**
 * Edit a Queue_Item's draft text (Req 7.1, 7.2, 7.5, 8.2). Validates non-whitespace
 * and the 10000-character bound; on success updates only that item's `draftText`,
 * PRESERVES its `id` and `created_at`, and bumps `updated_at`. On failure returns
 * `empty`/`too_long` (or `not_found`) and leaves the existing draft text unchanged.
 */
export function editDraftText(
  queue: ReviewQueue,
  id: string,
  draftText: string,
  clock: QueueClock,
): MutateResult {
  if (!hasItem(queue, id)) {
    return { ok: false, reason: 'not_found' };
  }
  const validation = validateDraftText(draftText);
  if (validation.kind === 'empty') {
    return { ok: false, reason: 'empty' };
  }
  if (validation.kind === 'too_long') {
    return { ok: false, reason: 'too_long', max: validation.max };
  }
  const queueNext = queue.map((item) =>
    item.id === id ? { ...item, draftText, updated_at: clock.now() } : item,
  );
  return { ok: true, queue: queueNext };
}

/**
 * Remove only the item bearing the targeted id, retaining every other item
 * unchanged (Req 7.4). A missing id is a no-op returning an equivalent new array.
 */
export function deleteItem(queue: ReviewQueue, id: string): ReviewQueue {
  return queue.filter((item) => item.id !== id);
}

// --- 2.4 Coercion, ordering, serialize/deserialize ---------------------------

/**
 * Coerce any stored status to a valid Review_Status (Req 3.6): the value when it
 * is one of the three literals, otherwise `needs_review`.
 */
export function coerceStatus(value: unknown): ReviewStatus {
  return REVIEW_STATUSES.includes(value as ReviewStatus)
    ? (value as ReviewStatus)
    : 'needs_review';
}

/**
 * Return a stable, deterministic display order without mutating the input
 * (Req 6.3): `created_at` descending, then `id` ascending as a total-order
 * tiebreak. ISO 8601 timestamps sort lexicographically in chronological order.
 */
export function orderQueue(queue: ReviewQueue): QueueItem[] {
  return [...queue].sort((a, b) => {
    if (a.created_at !== b.created_at) {
      return a.created_at < b.created_at ? 1 : -1; // created_at DESC
    }
    if (a.id !== b.id) {
      return a.id < b.id ? -1 : 1; // id ASC
    }
    return 0;
  });
}

// --- Runtime shape guards (for deserialize) ----------------------------------

function isComplianceWarning(value: unknown): value is ComplianceWarning {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const w = value as Record<string, unknown>;
  return typeof w.id === 'string' && typeof w.message === 'string';
}

function isChecklistItem(value: unknown): value is ChecklistItem {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const c = value as Record<string, unknown>;
  return typeof c.id === 'string' && typeof c.text === 'string' && typeof c.checked === 'boolean';
}

/**
 * Validate and normalize a single stored entry into a well-formed QueueItem, or
 * return `null` when it is malformed (so `deserializeQueue` can drop it). Optional
 * fields are reconstructed only when present so a serialize/deserialize round-trip
 * preserves the exact field set. The status is coerced (Req 3.6).
 */
function toQueueItem(value: unknown): QueueItem | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const r = value as Record<string, unknown>;

  if (
    typeof r.id !== 'string' ||
    typeof r.draftText !== 'string' ||
    (r.source !== 'draft_co_pilot' && r.source !== 'manual') ||
    typeof r.created_at !== 'string' ||
    typeof r.updated_at !== 'string' ||
    !Array.isArray(r.checklist) ||
    !r.checklist.every(isChecklistItem)
  ) {
    return null;
  }

  // Optional fields: present-but-malformed makes the whole item malformed.
  if (r.mode !== undefined && !DRAFT_MODES.includes(r.mode as DraftMode)) {
    return null;
  }
  if (r.safety !== undefined && r.safety !== 'safe' && r.safety !== 'unsafe') {
    return null;
  }
  if (r.warnings !== undefined && (!Array.isArray(r.warnings) || !r.warnings.every(isComplianceWarning))) {
    return null;
  }
  if (r.note !== undefined && typeof r.note !== 'string') {
    return null;
  }

  const item: QueueItem = {
    id: r.id,
    draftText: r.draftText,
    source: r.source,
    status: coerceStatus(r.status),
    checklist: (r.checklist as ChecklistItem[]).map((entry) => ({
      id: entry.id,
      text: entry.text,
      checked: entry.checked,
    })),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
  if (r.mode !== undefined) {
    item.mode = r.mode as DraftMode;
  }
  if (r.warnings !== undefined) {
    item.warnings = (r.warnings as ComplianceWarning[]).map((warning) => ({ ...warning }));
  }
  if (r.safety !== undefined) {
    item.safety = r.safety as 'safe' | 'unsafe';
  }
  if (r.note !== undefined) {
    item.note = r.note;
  }
  return item;
}

/**
 * Map the queue to a plain, JSON-safe structure for `chrome.storage.local`
 * (Req 9.5). Copies only the present keys (so the round-trip preserves the exact
 * field set) and deep-clones the nested arrays so the result shares no mutable
 * reference with the input.
 */
export function serializeQueue(queue: ReviewQueue): unknown {
  return queue.map((item) => {
    const out: Record<string, unknown> = {
      id: item.id,
      draftText: item.draftText,
      source: item.source,
      status: item.status,
      checklist: item.checklist.map((entry) => ({
        id: entry.id,
        text: entry.text,
        checked: entry.checked,
      })),
      created_at: item.created_at,
      updated_at: item.updated_at,
    };
    if (item.mode !== undefined) {
      out.mode = item.mode;
    }
    if (item.warnings !== undefined) {
      out.warnings = item.warnings.map((warning) => ({ ...warning }));
    }
    if (item.safety !== undefined) {
      out.safety = item.safety;
    }
    if (item.note !== undefined) {
      out.note = item.note;
    }
    return out;
  });
}

/**
 * Validate stored data into a list of well-formed Queue_Items (Req 3.6, 9.5, 10.6).
 * Non-array input yields an empty list; each entry is validated by a runtime shape
 * guard, has its status coerced, and is DROPPED when malformed while well-formed
 * items are retained. For a valid QueueItem `x`,
 * `deserializeQueue(serializeQueue([x]))[0]` deep-equals `x` across all fields.
 */
export function deserializeQueue(raw: unknown): QueueItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const items: QueueItem[] = [];
  for (const entry of raw) {
    const item = toQueueItem(entry);
    if (item) {
      items.push(item);
    }
  }
  return items;
}
