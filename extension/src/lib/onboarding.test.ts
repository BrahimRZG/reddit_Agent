import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  ACKNOWLEDGEMENT_VERSION,
  REQUIRED_ACKNOWLEDGEMENT_ITEMS,
  REQUIRED_ACKNOWLEDGEMENT_ITEM_IDS,
  validateAcknowledgement,
  isOnboardingComplete,
  buildAcknowledgementRecord,
} from './onboarding';
import type { AcknowledgementItemId, AcknowledgementRecord } from '../types';

const REQUIRED_IDS = [...REQUIRED_ACKNOWLEDGEMENT_ITEM_IDS] as AcknowledgementItemId[];

/** Compares two [major, minor, patch] tuples: -1 / 0 / 1. */
function compareTuples(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

describe('validateAcknowledgement', () => {
  // Feature: compliance-onboarding, Property 3: For any candidate acknowledgement (any set of accepted item identifiers), validateAcknowledgement reports the candidate as valid if and only if every required Acknowledgement_Item identifier is present in the accepted set.
  it('Property 3: valid iff every required id is present (>=100 runs)', () => {
    fc.assert(
      fc.property(fc.subarray(REQUIRED_IDS), fc.array(fc.string()), (subset, noise) => {
        const items = [...subset, ...noise];
        const expectedValid = REQUIRED_IDS.every((id) => items.includes(id));
        const result = validateAcknowledgement({ items });
        expect(result.valid).toBe(expectedValid);
        if (!result.valid) {
          const expectedMissing = REQUIRED_IDS.filter((id) => !items.includes(id));
          expect([...result.missing].sort()).toEqual([...expectedMissing].sort());
        }
      }),
      { numRuns: 200 }
    );
  });

  it('rejects the empty set with all six missing (Req 7.2)', () => {
    const result = validateAcknowledgement({ items: [] });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect([...result.missing].sort()).toEqual([...REQUIRED_IDS].sort());
    }
  });

  it('rejects a five-of-six set (Req 7.2)', () => {
    const fiveOfSix = REQUIRED_IDS.slice(0, 5);
    const result = validateAcknowledgement({ items: fiveOfSix });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.missing).toEqual([REQUIRED_IDS[5]]);
    }
  });

  it('accepts the full set (Req 7.2)', () => {
    expect(validateAcknowledgement({ items: REQUIRED_IDS }).valid).toBe(true);
  });

  it('accepts the full set with duplicates and unknown noise ids', () => {
    expect(
      validateAcknowledgement({ items: [...REQUIRED_IDS, ...REQUIRED_IDS, 'unknown'] }).valid
    ).toBe(true);
  });

  it('treats null/undefined candidate as invalid', () => {
    expect(validateAcknowledgement(null).valid).toBe(false);
    expect(validateAcknowledgement(undefined).valid).toBe(false);
  });
});

describe('isOnboardingComplete', () => {
  const completeRecord = (): AcknowledgementRecord => ({
    acknowledged: true,
    version: ACKNOWLEDGEMENT_VERSION,
    acknowledged_at: new Date().toISOString(),
    items: [...REQUIRED_IDS],
  });

  // Feature: compliance-onboarding, Property 5: For any stored Acknowledgement_Record whose version is lower than the current ACKNOWLEDGEMENT_VERSION, isOnboardingComplete evaluates to false (so the Onboarding_Screen is shown again).
  it('Property 5: stale stored version => incomplete (>=100 runs)', () => {
    const semverTuple = fc.tuple(
      fc.nat({ max: 30 }),
      fc.nat({ max: 30 }),
      fc.nat({ max: 30 })
    );
    fc.assert(
      fc.property(semverTuple, semverTuple, (a, b) => {
        const cmp = compareTuples(a, b);
        if (cmp === 0) return; // equal versions are not "lower"; skip
        const [lo, hi] = cmp < 0 ? [a, b] : [b, a];
        const record: AcknowledgementRecord = {
          acknowledged: true,
          version: lo.join('.'),
          acknowledged_at: new Date().toISOString(),
          items: [...REQUIRED_IDS],
        };
        expect(isOnboardingComplete(record, hi.join('.'))).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  it('returns true for a complete record at the current version', () => {
    expect(isOnboardingComplete(completeRecord())).toBe(true);
  });

  it('returns true for a record whose version is newer than current', () => {
    const record = { ...completeRecord(), version: '2.0.0' };
    expect(isOnboardingComplete(record, '1.0.0')).toBe(true);
  });

  it('treats a record one minor below current as incomplete (Req 7.4)', () => {
    const record = { ...completeRecord(), version: '1.0.0' };
    expect(isOnboardingComplete(record, '1.1.0')).toBe(false);
  });

  it('returns false for null record', () => {
    expect(isOnboardingComplete(null)).toBe(false);
  });

  it('returns false when acknowledged is not true', () => {
    expect(isOnboardingComplete({ ...completeRecord(), acknowledged: false })).toBe(false);
  });

  it('returns false when version is empty', () => {
    expect(isOnboardingComplete({ ...completeRecord(), version: '' })).toBe(false);
  });

  it('returns false when a required item is missing', () => {
    expect(isOnboardingComplete({ ...completeRecord(), items: REQUIRED_IDS.slice(0, 5) })).toBe(
      false
    );
  });
});

describe('constants and buildAcknowledgementRecord', () => {
  it('ACKNOWLEDGEMENT_VERSION matches major.minor.patch (Req 4.4)', () => {
    expect(ACKNOWLEDGEMENT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('defines exactly six required items a-f', () => {
    expect(REQUIRED_ACKNOWLEDGEMENT_ITEMS).toHaveLength(6);
    expect(REQUIRED_ACKNOWLEDGEMENT_ITEM_IDS).toEqual([
      'manual_assistant_not_bot',
      'no_automation',
      'manual_review_submit',
      'follow_subreddit_rules',
      'disclose_affiliation',
      'no_abuse',
    ]);
    for (const item of REQUIRED_ACKNOWLEDGEMENT_ITEMS) {
      expect(item.label.length).toBeGreaterThan(0);
    }
  });

  // Feature: compliance-onboarding, Property 8: For any Acknowledgement_Record produced at acceptance (acknowledged === true), the record contains a non-empty ISO 8601 acknowledged_at timestamp and a version equal to the ACKNOWLEDGEMENT_VERSION current at acceptance time.
  it('Property 8: built record has acknowledged/version/ISO timestamp (>=100 runs)', () => {
    fc.assert(
      fc.property(fc.integer(), () => {
        const record = buildAcknowledgementRecord();
        expect(record.acknowledged).toBe(true);
        expect(record.version).toBe(ACKNOWLEDGEMENT_VERSION);
        expect(record.acknowledged_at.length).toBeGreaterThan(0);
        const parsed = new Date(record.acknowledged_at);
        expect(Number.isNaN(parsed.getTime())).toBe(false);
        // ISO 8601 round-trips exactly through Date
        expect(parsed.toISOString()).toBe(record.acknowledged_at);
        expect([...record.items].sort()).toEqual([...REQUIRED_IDS].sort());
      }),
      { numRuns: 100 }
    );
  });
});
