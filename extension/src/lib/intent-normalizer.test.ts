import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import { normalizeText } from './intent-normalizer';

describe('normalizeText — unit (Req 2.4)', () => {
  it('folds to a single consistent (lower) case', () => {
    expect(normalizeText('CouponsRiver DEAL')).toBe('couponsriver deal');
    expect(normalizeText('MiXeD CaSe')).toBe('mixed case');
  });

  it('collapses runs of spaces, tabs, and newlines into a single space', () => {
    expect(normalizeText('a    b')).toBe('a b');
    expect(normalizeText('a\t\tb')).toBe('a b');
    expect(normalizeText('a\n\n\nb')).toBe('a b');
    expect(normalizeText('a \t \n b')).toBe('a b');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeText('   hello   ')).toBe('hello');
    expect(normalizeText('\n\t  trimmed  \t\n')).toBe('trimmed');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normalizeText('   \t\n  ')).toBe('');
    expect(normalizeText('')).toBe('');
  });

  it('combines case folding, collapse, and trim', () => {
    expect(normalizeText('  Looking   FOR a\tCOUPON\ncode  ')).toBe('looking for a coupon code');
  });
});

describe('normalizeText — properties', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Feature: intent-scanner, Property 1: For any Input_Text, the Text_Normalizer
  // produces identical Normalized_Text on repeated invocations, and normalizing
  // already-Normalized_Text returns it unchanged (normalize(normalize(x)) == normalize(x)).
  it('Property 1: normalization is deterministic and idempotent', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const once = normalizeText(s);
        // Deterministic: same input → same output across invocations.
        expect(normalizeText(s)).toBe(once);
        // Idempotent: re-normalizing normalized text is a no-op.
        expect(normalizeText(once)).toBe(once);
      }),
      { numRuns: 200 }
    );
  });

  // Feature: intent-scanner, Property 7: No Network Without Operator Compare Trigger
  // (normalizer slice) — for any input, normalizeText triggers zero fetch calls.
  it('Property 7 (normalizer slice): performs no network call', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    fc.assert(
      fc.property(fc.string(), (s) => {
        normalizeText(s);
      }),
      { numRuns: 100 }
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
