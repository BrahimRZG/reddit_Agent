/**
 * Spec 07 — Review Queue — `review-queue.ts` pure-logic tests (Task 6, slice 6A).
 *
 * Covers the pure queue transforms: well-formed creation + default status,
 * status coercion, single-target status transition, serialize/deserialize
 * round-trip, single-target delete, single-target checklist toggle, advisory
 * note/checklist edits, storage-bound enforcement, deterministic ordering, and
 * fail-safe deserialization. Storage I/O, the React panel, the popup wiring, and
 * the security-boundary scans are intentionally NOT exercised here — they are
 * later slices (review-queue-storage.test.ts, ReviewQueue.test.tsx,
 * Popup.test.tsx, security-boundary.test.ts).
 *
 * Determinism in this spec applies to the transforms over an already-constructed
 * item, so id/timestamp creation is INJECTED via deterministic stub
 * `IdFactory`/`QueueClock` seams (design.md Section 5.3). Each property test runs
 * a minimum of 100 iterations and is tagged
 * `// Feature: review-queue, Property {n}: {property text}` per design.md Section 11.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  addChecklistItem,
  addItem,
  coerceStatus,
  createItemFromDraftResult,
  createManualItem,
  deleteItem,
  deserializeQueue,
  editChecklistItem,
  editDraftText,
  orderQueue,
  removeChecklistItem,
  serializeQueue,
  setStatus,
  toggleChecklistItem,
  updateNote,
  validateChecklistText,
  validateDraftText,
  validateNote,
  type IdFactory,
  type QueueClock,
} from './review-queue';
import {
  MAX_CHECKLIST_ITEMS,
  MAX_CHECKLIST_TEXT,
  MAX_NOTE,
  MAX_QUEUE_DRAFT_TEXT,
  MAX_QUEUE_ITEMS,
} from '../types';
import type {
  ChecklistItem,
  ComplianceWarning,
  ComplianceWarningId,
  DraftMode,
  DraftResult,
  QueueItem,
  ReviewQueue,
  ReviewStatus,
} from '../types';

// --- Deterministic injected seams --------------------------------------------

/** Counter-based IdFactory producing unique, stable ids within a queue. */
function counterIds(prefix = 'id'): IdFactory {
  let n = 0;
  return { create: () => `${prefix}-${n++}` };
}

/** A fixed clock — every action records the same ISO timestamp. */
const fixedClock: QueueClock = { now: () => '2026-01-01T00:00:00.000Z' };

/** A clock pinned to an arbitrary instant, used to assert `updated_at` bumps. */
function clockAt(ts: string): QueueClock {
  return { now: () => ts };
}

// --- Literal tables (mirrored locally; never imported from production code) ---

const REVIEW_STATUSES: readonly ReviewStatus[] = [
  'needs_review',
  'approved_for_manual_use',
  'rejected',
];

const DRAFT_MODES: readonly DraftMode[] = [
  'no-link-authority',
  'soft-cta-with-disclosure',
  'disclosed-link',
];

const WARNING_IDS: readonly ComplianceWarningId[] = [
  'manual_review',
  'subreddit_rules',
  'no_automated_action',
  'disclosure_required',
  'missing_link',
  'add_link_manually',
  'unsafe_concealing',
  'unsafe_no_disclosure',
];

// --- Shared fast-check arbitraries -------------------------------------------

const statusArb = fc.constantFrom<ReviewStatus>(...REVIEW_STATUSES);
const modeArb = fc.constantFrom<DraftMode>(...DRAFT_MODES);
const safetyArb = fc.constantFrom<'safe' | 'unsafe'>('safe', 'unsafe');

const warningArb: fc.Arbitrary<ComplianceWarning> = fc.record({
  id: fc.constantFrom<ComplianceWarningId>(...WARNING_IDS),
  message: fc.string({ maxLength: 60 }),
});

/** ISO 8601 timestamps spanning 1970..~2100 (always a valid Date). */
const isoArb = fc
  .integer({ min: 0, max: 4_102_444_800_000 })
  .map((ms) => new Date(ms).toISOString());

/** A DraftResult whose fields are copied verbatim by createItemFromDraftResult. */
const draftResultArb: fc.Arbitrary<DraftResult> = fc.record({
  kind: fc.constant<'draft'>('draft'),
  mode: modeArb,
  draftText: fc.string({ maxLength: 200 }).map((s) => `draft body ${s}`),
  warnings: fc.array(warningArb, { maxLength: 5 }),
  safety: safetyArb,
});

/** Manual draft text guaranteed to carry at least one non-whitespace char. */
const manualDraftTextArb = fc.string({ maxLength: 200 }).map((s) => `x${s}`);

/** A checklist with ids unique within the item (assigned by index). */
function checklistArb(minLength = 0, maxLength = 6): fc.Arbitrary<ChecklistItem[]> {
  return fc
    .array(fc.record({ text: fc.string({ maxLength: 40 }), checked: fc.boolean() }), {
      minLength,
      maxLength,
    })
    .map((entries) => entries.map((e, i) => ({ id: `c-${i}`, text: e.text, checked: e.checked })));
}

/** Assemble a QueueItem, including optional keys only when defined. */
function buildQueueItem(parts: {
  id: string;
  draftText: string;
  source: 'draft_co_pilot' | 'manual';
  status: ReviewStatus;
  checklist: ChecklistItem[];
  created_at: string;
  updated_at: string;
  mode?: DraftMode;
  warnings?: ComplianceWarning[];
  safety?: 'safe' | 'unsafe';
  note?: string;
}): QueueItem {
  const item: QueueItem = {
    id: parts.id,
    draftText: parts.draftText,
    source: parts.source,
    status: parts.status,
    checklist: parts.checklist,
    created_at: parts.created_at,
    updated_at: parts.updated_at,
  };
  if (parts.mode !== undefined) item.mode = parts.mode;
  if (parts.warnings !== undefined) item.warnings = parts.warnings;
  if (parts.safety !== undefined) item.safety = parts.safety;
  if (parts.note !== undefined) item.note = parts.note;
  return item;
}

/** Item "spec" arbitrary (everything but the id, assigned later for uniqueness). */
const itemSpecArb = fc.record({
  draftText: fc.string({ maxLength: 80 }),
  source: fc.constantFrom<'draft_co_pilot' | 'manual'>('draft_co_pilot', 'manual'),
  status: statusArb,
  checklist: checklistArb(),
  created_at: isoArb,
  updated_at: isoArb,
  mode: fc.option(modeArb, { nil: undefined }),
  warnings: fc.option(fc.array(warningArb, { maxLength: 4 }), { nil: undefined }),
  safety: fc.option(safetyArb, { nil: undefined }),
  note: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
});

/** A queue with ids guaranteed unique within the queue (assigned by index). */
function queueArb(minLength = 1, maxLength = 8): fc.Arbitrary<ReviewQueue> {
  return fc
    .array(itemSpecArb, { minLength, maxLength })
    .map((specs) => specs.map((s, i) => buildQueueItem({ ...s, id: `q-${i}` })));
}

/** A single fully-valid QueueItem (for the round-trip property). */
const queueItemArb: fc.Arbitrary<QueueItem> = itemSpecArb.map((s) =>
  buildQueueItem({ ...s, id: 'item-0' }),
);

// --- 6.1 Property 1: Save Produces a Well-Formed Item with Default Status -----

describe('createItemFromDraftResult / createManualItem (Property 1)', () => {
  // Feature: review-queue, Property 1: Save Produces a Well-Formed Item with Default Status
  it('builds a well-formed Queue_Item from a Draft_Result, capturing source fields verbatim', () => {
    fc.assert(
      fc.property(draftResultArb, (result) => {
        const item = createItemFromDraftResult(result, fixedClock, counterIds());
        expect(typeof item.id).toBe('string');
        expect(item.id.length).toBeGreaterThan(0);
        expect(item.status).toBe('needs_review');
        expect(item.created_at).toBe(item.updated_at);
        expect(item.checklist).toEqual([]);
        expect(item.source).toBe('draft_co_pilot');
        // captured verbatim
        expect(item.draftText).toBe(result.draftText);
        expect(item.mode).toBe(result.mode);
        expect(item.warnings).toEqual(result.warnings);
        expect(item.safety).toBe(result.safety);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: review-queue, Property 1: Save Produces a Well-Formed Item with Default Status
  it('builds a well-formed manual Queue_Item with source=manual and no captured Spec 06 fields', () => {
    fc.assert(
      fc.property(manualDraftTextArb, (draftText) => {
        const item = createManualItem(draftText, fixedClock, counterIds());
        expect(item.id.length).toBeGreaterThan(0);
        expect(item.status).toBe('needs_review');
        expect(item.created_at).toBe(item.updated_at);
        expect(item.checklist).toEqual([]);
        expect(item.source).toBe('manual');
        expect(item.draftText).toBe(draftText);
        expect(item.mode).toBeUndefined();
        expect(item.warnings).toBeUndefined();
        expect(item.safety).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  // Feature: review-queue, Property 1: Save Produces a Well-Formed Item with Default Status
  it('assigns ids unique within the queue when items share one IdFactory', () => {
    fc.assert(
      fc.property(fc.array(manualDraftTextArb, { minLength: 1, maxLength: 30 }), (texts) => {
        const ids = counterIds();
        const items = texts.map((t) => createManualItem(t, fixedClock, ids));
        const idSet = new Set(items.map((i) => i.id));
        expect(idSet.size).toBe(items.length);
      }),
      { numRuns: 100 },
    );
  });

  it('example: a Draft_Result item captures mode/warnings/safety exactly', () => {
    const result: DraftResult = {
      kind: 'draft',
      mode: 'disclosed-link',
      draftText: 'A helpful, disclosed reply.',
      warnings: [{ id: 'disclosure_required', message: 'disclose affiliation' }],
      safety: 'safe',
    };
    const item = createItemFromDraftResult(result, fixedClock, counterIds());
    expect(item).toMatchObject({
      source: 'draft_co_pilot',
      status: 'needs_review',
      mode: 'disclosed-link',
      safety: 'safe',
      draftText: 'A helpful, disclosed reply.',
    });
    expect(item.warnings).toEqual(result.warnings);
    // warnings are cloned, not shared with the source
    expect(item.warnings).not.toBe(result.warnings);
  });
});

// --- 6.2 Property 2: Review Status Is Bounded to the Three Enumerated Values --

describe('coerceStatus (Property 2)', () => {
  // Feature: review-queue, Property 2: Review Status Is Bounded to the Three Enumerated Values
  it('returns one of the three literals and maps anything out-of-set to needs_review', () => {
    fc.assert(
      fc.property(fc.oneof(statusArb, fc.anything()), (value) => {
        const result = coerceStatus(value);
        expect(REVIEW_STATUSES).toContain(result);
        if (typeof value === 'string' && (REVIEW_STATUSES as readonly string[]).includes(value)) {
          expect(result).toBe(value);
        } else {
          expect(result).toBe('needs_review');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('examples: valid pass through; junk coerces to needs_review', () => {
    expect(coerceStatus('approved_for_manual_use')).toBe('approved_for_manual_use');
    expect(coerceStatus('rejected')).toBe('rejected');
    expect(coerceStatus('needs_review')).toBe('needs_review');
    expect(coerceStatus('archived')).toBe('needs_review');
    expect(coerceStatus(undefined)).toBe('needs_review');
    expect(coerceStatus(42)).toBe('needs_review');
    expect(coerceStatus(null)).toBe('needs_review');
  });
});

// --- 6.3 Property 3: Status Transition Is Operator-Only and Targets One Item --

describe('setStatus (Property 3)', () => {
  // Feature: review-queue, Property 3: Status Transition Is Operator-Only and Targets Exactly One Item
  it('updates only the targeted item status + updated_at and leaves others unchanged', () => {
    fc.assert(
      fc.property(queueArb(), statusArb, fc.nat(), (queue, target, rawIndex) => {
        const index = rawIndex % queue.length;
        const targetId = queue[index].id;
        const ts = '2030-06-15T12:00:00.000Z';
        const next = setStatus(queue, targetId, target, clockAt(ts));

        expect(next).toHaveLength(queue.length);
        next.forEach((item, i) => {
          if (item.id === targetId) {
            expect(item.status).toBe(target);
            expect(item.updated_at).toBe(ts);
            // identity preserved
            expect(item.id).toBe(queue[i].id);
            expect(item.created_at).toBe(queue[i].created_at);
          } else {
            expect(item).toEqual(queue[i]);
          }
        });
        // input not mutated
        expect(queue[index].updated_at).not.toBe(ts);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: review-queue, Property 3: Status Transition Is Operator-Only and Targets Exactly One Item
  it('a missing id changes no status (no automatic/implicit transition)', () => {
    fc.assert(
      fc.property(queueArb(), statusArb, (queue, target) => {
        const next = setStatus(queue, 'does-not-exist', target, fixedClock);
        expect(next.map((i) => i.status)).toEqual(queue.map((i) => i.status));
      }),
      { numRuns: 100 },
    );
  });
});

// --- 6.4 Property 4: Queue Item Serialize/Deserialize Round-Trip --------------

describe('serializeQueue / deserializeQueue (Property 4)', () => {
  // Feature: review-queue, Property 4: Queue Item Serialize/Deserialize Round-Trip
  it('round-trips a valid Queue_Item to a deep-equal item across all fields', () => {
    fc.assert(
      fc.property(queueItemArb, (item) => {
        const round = deserializeQueue(serializeQueue([item]));
        expect(round).toHaveLength(1);
        expect(round[0]).toEqual(item);
      }),
      { numRuns: 100 },
    );
  });
});

// --- 6.5 Property 5: Delete Removes Exactly the Targeted Item -----------------

describe('deleteItem (Property 5)', () => {
  // Feature: review-queue, Property 5: Delete Removes Exactly the Targeted Item
  it('removes only the targeted id, keeps every other item unchanged, count - 1', () => {
    fc.assert(
      fc.property(queueArb(), fc.nat(), (queue, rawIndex) => {
        const index = rawIndex % queue.length;
        const targetId = queue[index].id;
        const next = deleteItem(queue, targetId);

        expect(next).toHaveLength(queue.length - 1);
        expect(next.some((i) => i.id === targetId)).toBe(false);
        expect(next).toEqual(queue.filter((i) => i.id !== targetId));
      }),
      { numRuns: 100 },
    );
  });

  // Feature: review-queue, Property 5: Delete Removes Exactly the Targeted Item
  it('a missing id removes nothing', () => {
    fc.assert(
      fc.property(queueArb(), (queue) => {
        expect(deleteItem(queue, 'missing-id')).toEqual(queue);
      }),
      { numRuns: 100 },
    );
  });
});

// --- 6.6 Property 6: Checklist Toggle Flips Exactly One Item ------------------

describe('toggleChecklistItem (Property 6)', () => {
  const itemWithChecklistArb = fc
    .record({ spec: itemSpecArb, checklist: checklistArb(1, 8) })
    .map(({ spec, checklist }) => buildQueueItem({ ...spec, id: 'item-0', checklist }));

  // Feature: review-queue, Property 6: Checklist Toggle Flips Exactly One Item
  it('inverts checked on only the targeted entry, leaving others text/checked unchanged', () => {
    fc.assert(
      fc.property(itemWithChecklistArb, fc.nat(), (item, rawIndex) => {
        const entryIndex = rawIndex % item.checklist.length;
        const checklistId = item.checklist[entryIndex].id;
        const next = toggleChecklistItem([item], item.id, checklistId, fixedClock);
        const nextItem = next[0];

        expect(nextItem.checklist).toHaveLength(item.checklist.length);
        nextItem.checklist.forEach((entry, i) => {
          const original = item.checklist[i];
          expect(entry.text).toBe(original.text);
          if (entry.id === checklistId) {
            expect(entry.checked).toBe(!original.checked);
          } else {
            expect(entry.checked).toBe(original.checked);
          }
        });
      }),
      { numRuns: 100 },
    );
  });
});

// --- 6.7 Property 7: Notes and Checklist Edits Are Advisory -------------------

describe('advisory note/checklist operations (Property 7)', () => {
  const itemArb = fc
    .record({ spec: itemSpecArb, checklist: checklistArb(1, 6) })
    .map(({ spec, checklist }) => buildQueueItem({ ...spec, id: 'item-0', checklist }));

  type AdvisoryOp = 'note' | 'note_clear' | 'add' | 'toggle' | 'edit' | 'remove';
  const opArb = fc.constantFrom<AdvisoryOp>(
    'note',
    'note_clear',
    'add',
    'toggle',
    'edit',
    'remove',
  );

  function applyOp(item: QueueItem, op: AdvisoryOp): QueueItem {
    const queue: ReviewQueue = [item];
    const firstChecklistId = item.checklist[0].id;
    switch (op) {
      case 'note': {
        const r = updateNote(queue, item.id, 'a useful advisory note', fixedClock);
        return r.ok ? r.queue[0] : item;
      }
      case 'note_clear': {
        const r = updateNote(queue, item.id, undefined, fixedClock);
        return r.ok ? r.queue[0] : item;
      }
      case 'add': {
        const r = addChecklistItem(queue, item.id, 'new step', fixedClock, counterIds('nc'));
        return r.ok ? r.queue[0] : item;
      }
      case 'toggle':
        return toggleChecklistItem(queue, item.id, firstChecklistId, fixedClock)[0];
      case 'edit': {
        const r = editChecklistItem(queue, item.id, firstChecklistId, 'edited text', fixedClock);
        return r.ok ? r.queue[0] : item;
      }
      case 'remove':
        return removeChecklistItem(queue, item.id, firstChecklistId, fixedClock)[0];
    }
  }

  // Feature: review-queue, Property 7: Notes and Checklist Edits Are Advisory
  it('never changes the item status or captured safety', () => {
    fc.assert(
      fc.property(itemArb, opArb, (item, op) => {
        const next = applyOp(item, op);
        expect(next.status).toBe(item.status);
        expect(next.safety).toBe(item.safety);
      }),
      { numRuns: 100 },
    );
  });
});

// --- 6.8 Property 8: Storage Bounds Are Enforced -----------------------------

describe('storage bounds (Property 8)', () => {
  function fillerChecklist(count: number): ChecklistItem[] {
    return Array.from({ length: count }, (_, i) => ({ id: `f-${i}`, text: `t${i}`, checked: false }));
  }

  function fillerQueue(count: number): ReviewQueue {
    return Array.from({ length: count }, (_, i) =>
      buildQueueItem({
        id: `q-${i}`,
        draftText: `d${i}`,
        source: 'manual',
        status: 'needs_review',
        checklist: [],
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      }),
    );
  }

  // Feature: review-queue, Property 8: Storage Bounds Are Enforced
  it('validateDraftText: empty rejected, > 10000 too_long, otherwise valid', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 12_000 }), (len) => {
        const result = validateDraftText('a'.repeat(len));
        if (len === 0) {
          expect(result).toEqual({ kind: 'empty' });
        } else if (len > MAX_QUEUE_DRAFT_TEXT) {
          expect(result).toEqual({ kind: 'too_long', max: MAX_QUEUE_DRAFT_TEXT });
        } else {
          expect(result).toEqual({ kind: 'valid' });
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: review-queue, Property 8: Storage Bounds Are Enforced
  it('validateNote: > 2000 too_long, otherwise valid (empty note allowed)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2_600 }), (len) => {
        const result = validateNote('a'.repeat(len));
        if (len > MAX_NOTE) {
          expect(result).toEqual({ kind: 'too_long', max: MAX_NOTE });
        } else {
          expect(result).toEqual({ kind: 'valid' });
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: review-queue, Property 8: Storage Bounds Are Enforced
  it('validateChecklistText: empty rejected, > 280 too_long, otherwise valid', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 400 }), (len) => {
        const result = validateChecklistText('a'.repeat(len));
        if (len === 0) {
          expect(result).toEqual({ kind: 'empty' });
        } else if (len > MAX_CHECKLIST_TEXT) {
          expect(result).toEqual({ kind: 'too_long', max: MAX_CHECKLIST_TEXT });
        } else {
          expect(result).toEqual({ kind: 'valid' });
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: review-queue, Property 8: Storage Bounds Are Enforced
  it('addChecklistItem returns checklist_full at or beyond 50 entries, accepts under', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 55 }), (count) => {
        const item = buildQueueItem({
          id: 'item-0',
          draftText: 'd',
          source: 'manual',
          status: 'needs_review',
          checklist: fillerChecklist(count),
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        });
        const result = addChecklistItem([item], 'item-0', 'valid step', fixedClock, counterIds('nc'));
        if (count >= MAX_CHECKLIST_ITEMS) {
          expect(result).toEqual({ ok: false, reason: 'checklist_full', max: MAX_CHECKLIST_ITEMS });
        } else {
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.queue[0].checklist).toHaveLength(count + 1);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: review-queue, Property 8: Storage Bounds Are Enforced
  it('addItem returns queue_full at or beyond 200 items, accepts under', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 205 }), (count) => {
        const queue = fillerQueue(count);
        const newItem = createManualItem('a fresh draft', fixedClock, counterIds('new'));
        const result = addItem(queue, newItem);
        if (count >= MAX_QUEUE_ITEMS) {
          expect(result).toEqual({ ok: false, reason: 'queue_full', max: MAX_QUEUE_ITEMS });
        } else {
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.queue).toHaveLength(count + 1);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// --- Boundary unit tests (exact-value coverage) ------------------------------

describe('validator boundaries (unit)', () => {
  it('draft text: 0 empty, 1 valid, 10000 valid, 10001 too_long', () => {
    expect(validateDraftText('')).toEqual({ kind: 'empty' });
    expect(validateDraftText('a')).toEqual({ kind: 'valid' });
    expect(validateDraftText('a'.repeat(MAX_QUEUE_DRAFT_TEXT))).toEqual({ kind: 'valid' });
    expect(validateDraftText('a'.repeat(MAX_QUEUE_DRAFT_TEXT + 1))).toEqual({
      kind: 'too_long',
      max: MAX_QUEUE_DRAFT_TEXT,
    });
  });

  it('draft text: whitespace-only is empty (same as empty string)', () => {
    expect(validateDraftText('   \\t\\n ')).toEqual({ kind: 'empty' });
  });

  it('note: 2000 valid, 2001 too_long', () => {
    expect(validateNote('a'.repeat(MAX_NOTE))).toEqual({ kind: 'valid' });
    expect(validateNote('a'.repeat(MAX_NOTE + 1))).toEqual({ kind: 'too_long', max: MAX_NOTE });
  });

  it('checklist text: 0 empty, 1 valid, 280 valid, 281 too_long', () => {
    expect(validateChecklistText('')).toEqual({ kind: 'empty' });
    expect(validateChecklistText('a')).toEqual({ kind: 'valid' });
    expect(validateChecklistText('a'.repeat(MAX_CHECKLIST_TEXT))).toEqual({ kind: 'valid' });
    expect(validateChecklistText('a'.repeat(MAX_CHECKLIST_TEXT + 1))).toEqual({
      kind: 'too_long',
      max: MAX_CHECKLIST_TEXT,
    });
  });
});

describe('count boundaries (unit)', () => {
  function checklistOf(count: number): ChecklistItem[] {
    return Array.from({ length: count }, (_, i) => ({ id: `f-${i}`, text: `t${i}`, checked: false }));
  }
  function queueOf(count: number): ReviewQueue {
    return Array.from({ length: count }, (_, i) =>
      buildQueueItem({
        id: `q-${i}`,
        draftText: `d${i}`,
        source: 'manual',
        status: 'needs_review',
        checklist: [],
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      }),
    );
  }

  it('checklist items: the 50th is accepted, the 51st is checklist_full', () => {
    const at49 = buildQueueItem({
      id: 'item-0',
      draftText: 'd',
      source: 'manual',
      status: 'needs_review',
      checklist: checklistOf(MAX_CHECKLIST_ITEMS - 1), // 49 present → adding makes the 50th
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    const accept50 = addChecklistItem([at49], 'item-0', 'step', fixedClock, counterIds('nc'));
    expect(accept50.ok).toBe(true);

    const at50 = buildQueueItem({
      id: 'item-0',
      draftText: 'd',
      source: 'manual',
      status: 'needs_review',
      checklist: checklistOf(MAX_CHECKLIST_ITEMS), // 50 present → adding the 51st rejected
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    const reject51 = addChecklistItem([at50], 'item-0', 'step', fixedClock, counterIds('nc'));
    expect(reject51).toEqual({ ok: false, reason: 'checklist_full', max: MAX_CHECKLIST_ITEMS });
  });

  it('queue items: the 200th is accepted, the 201st is queue_full', () => {
    const accept200 = addItem(queueOf(MAX_QUEUE_ITEMS - 1), createManualItem('d', fixedClock, counterIds('n')));
    expect(accept200.ok).toBe(true);

    const reject201 = addItem(queueOf(MAX_QUEUE_ITEMS), createManualItem('d', fixedClock, counterIds('n')));
    expect(reject201).toEqual({ ok: false, reason: 'queue_full', max: MAX_QUEUE_ITEMS });
  });
});

// --- editDraftText bound + whitespace behavior (unit) -------------------------

describe('editDraftText bounds (unit)', () => {
  const base = buildQueueItem({
    id: 'item-0',
    draftText: 'original draft text',
    source: 'manual',
    status: 'approved_for_manual_use',
    checklist: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  });

  it('rejects whitespace-only edits and leaves the existing draft text unchanged', () => {
    const result = editDraftText([base], 'item-0', '   ', fixedClock);
    expect(result).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects over-bound edits and leaves the existing draft text unchanged', () => {
    const result = editDraftText([base], 'item-0', 'a'.repeat(MAX_QUEUE_DRAFT_TEXT + 1), fixedClock);
    expect(result).toEqual({ ok: false, reason: 'too_long', max: MAX_QUEUE_DRAFT_TEXT });
  });

  it('accepts a valid edit, preserves id + created_at, and bumps updated_at', () => {
    const ts = '2031-02-03T04:05:06.000Z';
    const result = editDraftText([base], 'item-0', 'a refined draft', clockAt(ts));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const item = result.queue[0];
      expect(item.draftText).toBe('a refined draft');
      expect(item.id).toBe('item-0');
      expect(item.created_at).toBe('2026-01-01T00:00:00.000Z');
      expect(item.updated_at).toBe(ts);
    }
  });
});

// --- orderQueue: deterministic, non-mutating, idempotent ---------------------

describe('orderQueue', () => {
  function item(id: string, created_at: string): QueueItem {
    return buildQueueItem({
      id,
      draftText: 'd',
      source: 'manual',
      status: 'needs_review',
      checklist: [],
      created_at,
      updated_at: created_at,
    });
  }

  it('orders by created_at descending, then id ascending', () => {
    const a = item('b', '2026-01-02T00:00:00.000Z');
    const b = item('a', '2026-01-02T00:00:00.000Z');
    const c = item('z', '2026-01-01T00:00:00.000Z');
    const ordered = orderQueue([a, b, c]);
    expect(ordered.map((i) => i.id)).toEqual(['a', 'b', 'z']);
  });

  it('does not mutate its input', () => {
    const input = [
      item('b', '2026-01-02T00:00:00.000Z'),
      item('a', '2026-01-02T00:00:00.000Z'),
      item('z', '2026-01-01T00:00:00.000Z'),
    ];
    const snapshot = input.map((i) => i.id);
    const ordered = orderQueue(input);
    expect(input.map((i) => i.id)).toEqual(snapshot);
    expect(ordered).not.toBe(input);
  });

  it('is idempotent: ordering an already-ordered queue is a no-op order', () => {
    fc.assert(
      fc.property(queueArb(1, 10), (queue) => {
        const once = orderQueue(queue);
        const twice = orderQueue(once);
        expect(twice.map((i) => i.id)).toEqual(once.map((i) => i.id));
      }),
      { numRuns: 100 },
    );
  });
});

// --- deserializeQueue: fail-safe normalization -------------------------------

describe('deserializeQueue (fail-safe)', () => {
  function validRaw(id: string, status: string): Record<string, unknown> {
    return {
      id,
      draftText: 'd',
      source: 'manual',
      status,
      checklist: [],
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
  }

  it('returns [] for non-array input', () => {
    expect(deserializeQueue(undefined)).toEqual([]);
    expect(deserializeQueue(null)).toEqual([]);
    expect(deserializeQueue('not-an-array')).toEqual([]);
    expect(deserializeQueue({ id: 'x' })).toEqual([]);
    expect(deserializeQueue(42)).toEqual([]);
  });

  it('drops malformed individual items while retaining well-formed ones', () => {
    const raw = [
      validRaw('good-1', 'needs_review'),
      { id: 'bad', draftText: 123 }, // malformed: wrong field types / missing fields
      null,
      validRaw('good-2', 'rejected'),
    ];
    const items = deserializeQueue(raw);
    expect(items.map((i) => i.id)).toEqual(['good-1', 'good-2']);
  });

  it('coerces an out-of-range stored status to needs_review', () => {
    const items = deserializeQueue([validRaw('good-1', 'totally_bogus_status')]);
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('needs_review');
  });
});
