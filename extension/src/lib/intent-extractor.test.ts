import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import { extractCandidates } from './intent-extractor';
import type { CandidateType, DetectedCandidate } from '../types';

const CANDIDATE_TYPES: readonly CandidateType[] = [
  'keyword',
  'tool_mention',
  'merchant_mention',
  'coupon_signal',
];

function resort(list: DetectedCandidate[]): DetectedCandidate[] {
  return [...list].sort((a, b) => {
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    if (a.value !== b.value) return a.value < b.value ? -1 : 1;
    return 0;
  });
}

describe('extractCandidates — unit (Req 4.2, 4.4, 4.5)', () => {
  it('produces at least one example of each candidate type', () => {
    const result = extractCandidates('amazon notion deal save20');
    expect(result).toEqual([
      { type: 'coupon_signal', value: 'save20' },
      { type: 'keyword', value: 'deal' },
      { type: 'merchant_mention', value: 'amazon' },
      { type: 'tool_mention', value: 'notion' },
    ]);
  });

  it('removes duplicate (type, value) items', () => {
    const result = extractCandidates('deal deal deal amazon amazon');
    expect(result).toEqual([
      { type: 'keyword', value: 'deal' },
      { type: 'merchant_mention', value: 'amazon' },
    ]);
  });

  it('orders output by type then value (UTF-16 code-unit order)', () => {
    const result = extractCandidates('target nike review deal');
    expect(result).toEqual(resort(result));
    // keyword < merchant_mention alphabetically; values sorted within a type.
    expect(result).toEqual([
      { type: 'keyword', value: 'deal' },
      { type: 'keyword', value: 'review' },
      { type: 'merchant_mention', value: 'nike' },
      { type: 'merchant_mention', value: 'target' },
    ]);
  });

  it('detects coupon phrases and code-like tokens as coupon_signal', () => {
    const result = extractCandidates('use coupon code blackfriday50 for a voucher');
    expect(result).toContainEqual({ type: 'coupon_signal', value: 'coupon' });
    expect(result).toContainEqual({ type: 'coupon_signal', value: 'coupon code' });
    expect(result).toContainEqual({ type: 'coupon_signal', value: 'voucher' });
    expect(result).toContainEqual({ type: 'coupon_signal', value: 'blackfriday50' });
  });

  it('returns an empty list for text with no detectable signals', () => {
    expect(extractCandidates('the quick brown fox')).toEqual([]);
  });
});

describe('extractCandidates — properties', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Feature: intent-scanner, Property 5: For any Normalized_Text, the
  // Candidate_Extractor returns an identical and identically ordered
  // Detected_Candidate list on every invocation, using a stable deterministic
  // ordering rule.
  it('Property 5: extraction is deterministic and stably ordered', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const a = extractCandidates(s);
        const b = extractCandidates(s);
        expect(b).toEqual(a);
        // The list equals its own re-sort by (type, value).
        expect(a).toEqual(resort(a));
      }),
      { numRuns: 200 }
    );
  });

  // Feature: intent-scanner, Property 6: For any Detected_Candidate list, no two
  // items share both an equal `type` and an equal `value`, and every item has a
  // `type` drawn only from the enumerated set.
  it('Property 6: candidate uniqueness and valid types', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const result = extractCandidates(s);
        const keys = new Set<string>();
        for (const item of result) {
          expect(CANDIDATE_TYPES).toContain(item.type);
          const key = `${item.type}\u0000${item.value}`;
          expect(keys.has(key)).toBe(false);
          keys.add(key);
        }
      }),
      { numRuns: 200 }
    );
  });

  // Feature: intent-scanner, Property 7: No Network Without Operator Compare
  // Trigger (extractor slice) — for any input, extractCandidates triggers zero
  // fetch calls.
  it('Property 7 (extractor slice): performs no network call', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    fc.assert(
      fc.property(fc.string(), (s) => {
        extractCandidates(s);
      }),
      { numRuns: 100 }
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
