/**
 * Spec 08-A — Compliance Activity Log & Export — `activity-log.ts` pure-logic tests
 * (Task 7.1).
 *
 * Covers the pure transforms only: `createEntry` (injected clock/id, redaction-safe
 * summary rendering, MAX_SUMMARY_LEN clamp), `appendEntry` (non-mutating + FIFO
 * bound), `orderNewestFirst` (non-mutating, created_at desc / id asc), the
 * serialize/deserialize round-trip and fail-safe filtering, and the deterministic
 * `toJsonDocument` / `toMarkdownDocument` renderers. Storage I/O, the recorder, the
 * export delivery, the React panel, and the popup wiring are intentionally NOT
 * exercised here — they are later test slices.
 *
 * Determinism applies to the transforms over already-constructed entries, so
 * id/timestamp creation is INJECTED via deterministic stub `IdFactory` / `LogClock`
 * seams (design.md Section 5.3). Each property test runs a minimum of 100 iterations
 * and is tagged `// Feature: activity-log-export, Property {n}: {property text}`.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  appendEntry,
  clampSummary,
  createEntry,
  deserializeLog,
  orderNewestFirst,
  serializeLog,
  toJsonDocument,
  toMarkdownDocument,
  type IdFactory,
  type LogClock,
} from './activity-log';
import { MAX_LOG_ENTRIES, MAX_SUMMARY_LEN, REVIEW_STATUS_LABELS } from '../types';
import type { ActionType, ActivityEntry, ReviewStatus, SummaryParts } from '../types';

// --- Deterministic injected seams --------------------------------------------

/** Counter-based IdFactory producing unique, stable ids within a log. */
function counterIds(prefix = 'id'): IdFactory {
  let n = 0;
  return { create: () => `${prefix}-${n++}` };
}

/** A fixed clock — every action records the same ISO timestamp. */
const fixedClock: LogClock = { now: () => '2026-01-01T00:00:00.000Z' };

/** A clock pinned to an arbitrary instant. */
function clockAt(ts: string): LogClock {
  return { now: () => ts };
}

// --- Literal tables (mirrored locally; never imported from production code) ---

const ACTION_TYPES: readonly ActionType[] = [
  'onboarding_completed',
  'draft_saved',
  'status_changed',
  'draft_copied',
];

const REVIEW_STATUSES: readonly ReviewStatus[] = [
  'needs_review',
  'approved_for_manual_use',
  'rejected',
];

// --- Shared fast-check arbitraries -------------------------------------------

const actionTypeArb = fc.constantFrom<ActionType>(...ACTION_TYPES);
const statusArb = fc.constantFrom<ReviewStatus>(...REVIEW_STATUSES);

/** ISO 8601 timestamps spanning 1970..~2100 (always a valid Date). */
const isoArb = fc
  .integer({ min: 0, max: 4_102_444_800_000 })
  .map((ms) => new Date(ms).toISOString());

/** SummaryParts with each non-sensitive descriptor optionally present. */
const summaryPartsArb: fc.Arbitrary<SummaryParts> = fc.record(
  {
    itemId: fc.string({ maxLength: 24 }),
    status: statusArb,
    detail: fc.string({ maxLength: 60 }),
  },
  { requiredKeys: [] },
);

/** Build a valid ActivityEntry directly (id assigned by the caller for uniqueness). */
function buildEntry(parts: {
  id: string;
  type: ActionType;
  created_at: string;
  summary: string;
}): ActivityEntry {
  return { id: parts.id, type: parts.type, created_at: parts.created_at, summary: parts.summary };
}

const entrySpecArb = fc.record({
  type: actionTypeArb,
  created_at: isoArb,
  summary: fc.string({ maxLength: 80 }),
});

/** A log with ids guaranteed unique within the log (assigned by index). */
function logArb(minLength = 0, maxLength = 8): fc.Arbitrary<ActivityEntry[]> {
  return fc
    .array(entrySpecArb, { minLength, maxLength })
    .map((specs) => specs.map((s, i) => buildEntry({ ...s, id: `e-${i}` })));
}

/** A single fully-valid ActivityEntry (for the round-trip property). */
const entryArb: fc.Arbitrary<ActivityEntry> = entrySpecArb.map((s) =>
  buildEntry({ ...s, id: 'entry-0' }),
);

const ENTRY_KEYS = ['id', 'type', 'created_at', 'summary'] as const;

// --- createEntry --------------------------------------------------------------

describe('createEntry', () => {
  // Feature: activity-log-export, Property 1: Append Produces a Well-Formed, Bounded-Type Entry
  it('uses the injected clock/id and produces a well-formed, bounded entry', () => {
    fc.assert(
      fc.property(actionTypeArb, summaryPartsArb, isoArb, (type, parts, ts) => {
        const entry = createEntry(type, parts, clockAt(ts), counterIds('fixed'));
        expect(entry.id).toBe('fixed-0'); // deterministic id from the injected factory
        expect(entry.created_at).toBe(ts); // deterministic timestamp from the injected clock
        expect(ACTION_TYPES).toContain(entry.type);
        expect(entry.type).toBe(type);
        expect(typeof entry.summary).toBe('string');
        expect(Array.from(entry.summary).length).toBeLessThanOrEqual(MAX_SUMMARY_LEN);
      }),
      { numRuns: 100 },
    );
  });

  it('produces deterministic id and created_at across repeated calls with the same seams', () => {
    const a = createEntry('draft_saved', { itemId: 'q-1' }, fixedClock, counterIds('c'));
    const b = createEntry('draft_saved', { itemId: 'q-1' }, fixedClock, counterIds('c'));
    expect(a).toEqual(b);
    expect(a.id).toBe('c-0');
    expect(a.created_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('renders a safe summary for onboarding_completed with detail', () => {
    const entry = createEntry(
      'onboarding_completed',
      { detail: 'version 1.0.0' },
      fixedClock,
      counterIds(),
    );
    expect(entry.summary).toContain('version 1.0.0');
    expect(entry.summary.length).toBeGreaterThan(0);
  });

  it('renders a safe summary for draft_saved with itemId', () => {
    const entry = createEntry('draft_saved', { itemId: 'q-42' }, fixedClock, counterIds());
    expect(entry.summary).toContain('q-42');
  });

  it('renders a safe summary for status_changed with itemId and status', () => {
    const entry = createEntry(
      'status_changed',
      { itemId: 'q-7', status: 'approved_for_manual_use' },
      fixedClock,
      counterIds(),
    );
    expect(entry.summary).toContain('q-7');
    expect(entry.summary).toContain(REVIEW_STATUS_LABELS.approved_for_manual_use);
  });

  it('renders a safe summary for draft_copied with itemId or detail', () => {
    const withItem = createEntry('draft_copied', { itemId: 'q-9' }, fixedClock, counterIds());
    expect(withItem.summary).toContain('q-9');

    const withDetail = createEntry(
      'draft_copied',
      { detail: 'Draft Co-Pilot draft' },
      fixedClock,
      counterIds(),
    );
    expect(withDetail.summary).toContain('Draft Co-Pilot draft');
  });

  it('clamps an over-long summary to MAX_SUMMARY_LEN', () => {
    const longDetail = 'x'.repeat(MAX_SUMMARY_LEN + 100);
    const entry = createEntry('draft_saved', { detail: longDetail }, fixedClock, counterIds());
    expect(Array.from(entry.summary).length).toBe(MAX_SUMMARY_LEN);
  });
});

describe('clampSummary (unit)', () => {
  it('leaves a within-bound string unchanged and truncates an over-bound one', () => {
    const short = 'a'.repeat(MAX_SUMMARY_LEN);
    expect(clampSummary(short)).toBe(short);
    const long = 'a'.repeat(MAX_SUMMARY_LEN + 1);
    expect(Array.from(clampSummary(long)).length).toBe(MAX_SUMMARY_LEN);
  });
});

// --- appendEntry --------------------------------------------------------------

describe('appendEntry', () => {
  // Feature: activity-log-export, Property 2: Append Is Pure-Transform Plus Injected Identity
  it('appends without mutating the original array', () => {
    fc.assert(
      fc.property(logArb(0, 20), entryArb, (log, entry) => {
        const snapshot = log.map((e) => e.id);
        const next = appendEntry(log, entry);
        // input untouched
        expect(log.map((e) => e.id)).toEqual(snapshot);
        expect(next).not.toBe(log);
        // appended at the end when under the cap
        if (log.length < MAX_LOG_ENTRIES) {
          expect(next).toHaveLength(log.length + 1);
          expect(next[next.length - 1]).toEqual(entry);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: activity-log-export, Property 3: Log Size Is Bounded by FIFO Trim
  it('caps to MAX_LOG_ENTRIES and keeps the newest appended entries (FIFO drop)', () => {
    const full: ActivityEntry[] = Array.from({ length: MAX_LOG_ENTRIES }, (_, i) =>
      buildEntry({
        id: `e-${i}`,
        type: 'draft_saved',
        created_at: '2026-01-01T00:00:00.000Z',
        summary: `s${i}`,
      }),
    );
    const fresh = buildEntry({
      id: 'fresh',
      type: 'draft_copied',
      created_at: '2026-02-02T00:00:00.000Z',
      summary: 'newest',
    });
    const next = appendEntry(full, fresh);
    expect(next).toHaveLength(MAX_LOG_ENTRIES);
    expect(next[next.length - 1]).toEqual(fresh); // newest retained
    expect(next.some((e) => e.id === 'e-0')).toBe(false); // oldest dropped
    expect(next[0].id).toBe('e-1'); // relative order of retained entries preserved
  });
});

// --- orderNewestFirst ---------------------------------------------------------

describe('orderNewestFirst', () => {
  // Feature: activity-log-export, Property 6: Export Is Deterministic and Complete
  it('returns a new array and never mutates its input', () => {
    fc.assert(
      fc.property(logArb(0, 12), (log) => {
        const snapshot = log.map((e) => e.id);
        const ordered = orderNewestFirst(log);
        expect(ordered).not.toBe(log);
        expect(log.map((e) => e.id)).toEqual(snapshot);
        expect(ordered).toHaveLength(log.length);
      }),
      { numRuns: 100 },
    );
  });

  it('sorts created_at descending, then id ascending as a deterministic tie-break', () => {
    const a = buildEntry({ id: 'b', type: 'draft_saved', created_at: '2026-01-02T00:00:00.000Z', summary: 's' });
    const b = buildEntry({ id: 'a', type: 'draft_saved', created_at: '2026-01-02T00:00:00.000Z', summary: 's' });
    const c = buildEntry({ id: 'z', type: 'draft_saved', created_at: '2026-01-01T00:00:00.000Z', summary: 's' });
    const ordered = orderNewestFirst([a, b, c]);
    expect(ordered.map((e) => e.id)).toEqual(['a', 'b', 'z']);
  });
});

// --- serializeLog / deserializeLog -------------------------------------------

describe('serializeLog / deserializeLog', () => {
  // Feature: activity-log-export, Property 8: Entry Serialize/Deserialize Round-Trip
  it('round-trips a valid entry to a deep-equal entry across all four fields', () => {
    fc.assert(
      fc.property(entryArb, (entry) => {
        const round = deserializeLog(serializeLog([entry]));
        expect(round).toHaveLength(1);
        expect(round[0]).toEqual(entry);
      }),
      { numRuns: 100 },
    );
  });

  it('serialize produces plain entries with only the four redaction-safe fields', () => {
    const entry = buildEntry({
      id: 'e-0',
      type: 'status_changed',
      created_at: '2026-01-01T00:00:00.000Z',
      summary: 'Changed review status',
    });
    const serialized = serializeLog([entry]) as Record<string, unknown>[];
    expect(serialized).toHaveLength(1);
    expect(Object.keys(serialized[0]).sort()).toEqual([...ENTRY_KEYS].sort());
    expect(serialized[0]).toEqual(entry);
  });

  it('deserialize returns [] for non-array input', () => {
    expect(deserializeLog(undefined)).toEqual([]);
    expect(deserializeLog(null)).toEqual([]);
    expect(deserializeLog('not-an-array')).toEqual([]);
    expect(deserializeLog({ id: 'x' })).toEqual([]);
    expect(deserializeLog(42)).toEqual([]);
  });

  it('deserialize filters invalid entries while keeping valid ones', () => {
    const raw = [
      { id: 'good-1', type: 'draft_saved', created_at: '2026-01-01T00:00:00.000Z', summary: 'ok' },
      { id: 'bad-type', type: 'not_a_real_type', created_at: '2026-01-01T00:00:00.000Z', summary: 'x' },
      { id: 'missing-fields', type: 'draft_copied' },
      null,
      42,
      { id: 123, type: 'draft_saved', created_at: '2026-01-01T00:00:00.000Z', summary: 'x' }, // non-string id
      { id: 'good-2', type: 'onboarding_completed', created_at: '2026-02-01T00:00:00.000Z', summary: 'ok2' },
    ];
    const entries = deserializeLog(raw);
    expect(entries.map((e) => e.id)).toEqual(['good-1', 'good-2']);
  });

  it('deserialize normalizes a valid entry to exactly the four fields (drops extras)', () => {
    const raw = [
      {
        id: 'e-0',
        type: 'draft_saved',
        created_at: '2026-01-01T00:00:00.000Z',
        summary: 'ok',
        extra: 'should be dropped',
      },
    ];
    const entries = deserializeLog(raw);
    expect(entries).toHaveLength(1);
    expect(Object.keys(entries[0]).sort()).toEqual([...ENTRY_KEYS].sort());
  });
});

// --- toJsonDocument -----------------------------------------------------------

describe('toJsonDocument', () => {
  // Feature: activity-log-export, Property 6: Export Is Deterministic and Complete
  it('is deterministic, pretty-printed, complete, and emits no extra fields', () => {
    fc.assert(
      fc.property(logArb(0, 8), (log) => {
        const once = toJsonDocument(log);
        const twice = toJsonDocument(log);
        expect(once).toBe(twice); // byte-identical across calls

        const parsed = JSON.parse(once) as Record<string, unknown>[];
        expect(parsed).toHaveLength(log.length); // every entry included
        parsed.forEach((obj) => {
          expect(Object.keys(obj).sort()).toEqual([...ENTRY_KEYS].sort());
        });
        if (log.length > 0) {
          expect(once).toContain('\n  '); // two-space indentation
        }
      }),
      { numRuns: 100 },
    );
  });

  it('renders an empty log as the valid document "[]"', () => {
    expect(toJsonDocument([])).toBe('[]');
  });
});

// --- toMarkdownDocument -------------------------------------------------------

describe('toMarkdownDocument', () => {
  // Feature: activity-log-export, Property 6: Export Is Deterministic and Complete
  it('is deterministic across repeated calls', () => {
    fc.assert(
      fc.property(logArb(0, 8), (log) => {
        expect(toMarkdownDocument(log)).toBe(toMarkdownDocument(log));
      }),
      { numRuns: 100 },
    );
  });

  it('shows the empty-state message for an empty log', () => {
    const doc = toMarkdownDocument([]);
    expect(doc).toContain('No activity has been recorded.');
  });

  it('lists newest-first entries with action, timestamp, and summary', () => {
    const older = buildEntry({
      id: 'older',
      type: 'draft_saved',
      created_at: '2026-01-01T00:00:00.000Z',
      summary: 'older summary',
    });
    const newer = buildEntry({
      id: 'newer',
      type: 'draft_copied',
      created_at: '2026-03-03T00:00:00.000Z',
      summary: 'newer summary',
    });
    const doc = toMarkdownDocument([older, newer]);

    // every entry's action, timestamp, and summary appear
    for (const entry of [older, newer]) {
      expect(doc).toContain(entry.type);
      expect(doc).toContain(entry.created_at);
      expect(doc).toContain(entry.summary);
    }
    // newest-first: the newer entry's timestamp precedes the older one's
    expect(doc.indexOf(newer.created_at)).toBeLessThan(doc.indexOf(older.created_at));
  });
});
