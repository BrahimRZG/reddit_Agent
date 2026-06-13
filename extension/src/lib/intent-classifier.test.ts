import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import { classifyIntent } from './intent-classifier';
import type { IntentCategory } from '../types';

const CATEGORIES: readonly IntentCategory[] = [
  'coupon-seeking',
  'deal-seeking',
  'product-comparison',
  'generic-discussion',
  'irrelevant',
];

describe('classifyIntent — unit (Req 3.1, 3.5)', () => {
  it('assigns irrelevant with confidence 0.0 for no-signal text', () => {
    expect(classifyIntent('the quick brown fox jumped')).toEqual({
      category: 'irrelevant',
      confidence: 0.0,
    });
  });

  it('assigns irrelevant with confidence 0.0 for empty / whitespace-normalized text', () => {
    expect(classifyIntent('')).toEqual({ category: 'irrelevant', confidence: 0.0 });
  });

  it('classifies a representative coupon-seeking example', () => {
    const result = classifyIntent('does anyone have a coupon code or promo code for nike');
    expect(result.category).toBe('coupon-seeking');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('classifies a representative deal-seeking example', () => {
    const result = classifyIntent('looking for the best price and a discount on running shoes on sale');
    expect(result.category).toBe('deal-seeking');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('classifies a representative product-comparison example', () => {
    const result = classifyIntent('iphone vs android which is better and the difference between them');
    expect(result.category).toBe('product-comparison');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('classifies a representative generic-discussion example', () => {
    const result = classifyIntent('what do you recommend any reviews or opinions and advice');
    expect(result.category).toBe('generic-discussion');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('saturates confidence at 1.0 for strongly matching text', () => {
    const result = classifyIntent('coupon coupons coupon code promo promo code voucher');
    expect(result.category).toBe('coupon-seeking');
    expect(result.confidence).toBe(1);
  });
});

describe('classifyIntent — properties', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Feature: intent-scanner, Property 2: For any Normalized_Text, the
  // Intent_Classifier returns an identical Intent_Category and an identical
  // Confidence_Value on every invocation.
  it('Property 2: classification is deterministic and performs no network call', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    fc.assert(
      fc.property(fc.string(), (s) => {
        const a = classifyIntent(s);
        const b = classifyIntent(s);
        expect(b).toEqual(a);
      }),
      { numRuns: 200 }
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Feature: intent-scanner, Property 3: For any Normalized_Text, the
  // Intent_Classifier assigns exactly one Intent_Category drawn only from the
  // enumerated set, and no-signal text maps to `irrelevant`.
  it('Property 3: single category invariant — category is always a member of the enum', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const { category } = classifyIntent(s);
        expect(CATEGORIES).toContain(category);
      }),
      { numRuns: 200 }
    );
  });

  // Feature: intent-scanner, Property 3: For any Normalized_Text, the
  // Intent_Classifier assigns exactly one Intent_Category drawn only from the
  // enumerated set, and no-signal text maps to `irrelevant`.
  it('Property 3: no-signal text always maps to irrelevant with 0.0 confidence', () => {
    // Generate strings from an alphabet that cannot form any signal phrase.
    const noSignal = fc.stringOf(fc.constantFrom('x', 'y', 'z', 'q', ' ', '1'), { maxLength: 40 });
    fc.assert(
      fc.property(noSignal, (s) => {
        expect(classifyIntent(s)).toEqual({ category: 'irrelevant', confidence: 0.0 });
      }),
      { numRuns: 100 }
    );
  });

  // Feature: intent-scanner, Property 4: For any classification, the assigned
  // Confidence_Value is >= 0.0 and <= 1.0.
  it('Property 4: confidence is always within [0.0, 1.0]', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const { confidence } = classifyIntent(s);
        expect(confidence).toBeGreaterThanOrEqual(0.0);
        expect(confidence).toBeLessThanOrEqual(1.0);
      }),
      { numRuns: 200 }
    );
  });
});
