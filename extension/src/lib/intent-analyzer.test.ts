import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import { analyzeInput, validateInput, MAX_INPUT_LENGTH } from './intent-analyzer';
import { normalizeText } from './intent-normalizer';
import { classifyIntent } from './intent-classifier';
import { extractCandidates } from './intent-extractor';

describe('validateInput — unit (Req 1.4, 1.5)', () => {
  it('reports empty for zero non-whitespace characters', () => {
    expect(validateInput('')).toEqual({ kind: 'empty' });
    expect(validateInput('   \t\n ')).toEqual({ kind: 'empty' });
  });

  it('reports too_long for input exceeding the maximum', () => {
    expect(validateInput('a'.repeat(MAX_INPUT_LENGTH + 1))).toEqual({
      kind: 'too_long',
      max: MAX_INPUT_LENGTH,
    });
  });

  it('accepts input exactly at the maximum length', () => {
    const at = 'a'.repeat(MAX_INPUT_LENGTH);
    expect(validateInput(at)).toEqual({ kind: 'valid', text: at });
  });

  it('reports empty (not too_long) for whitespace-only input over the limit', () => {
    expect(validateInput(' '.repeat(MAX_INPUT_LENGTH + 5))).toEqual({ kind: 'empty' });
  });
});

describe('analyzeInput — unit (Req 1.3, 1.4, 1.5)', () => {
  it('returns invalid:empty for empty/whitespace input', () => {
    expect(analyzeInput('   ')).toEqual({ kind: 'invalid', reason: 'empty' });
  });

  it('returns invalid:too_long for over-length input', () => {
    expect(analyzeInput('x'.repeat(MAX_INPUT_LENGTH + 1))).toEqual({
      kind: 'invalid',
      reason: 'too_long',
    });
  });

  it('returns an analyzed result whose parts match calling the pure functions directly', () => {
    const input = '  Looking for a COUPON code and a deal on Nike  ';
    const result = analyzeInput(input);
    expect(result.kind).toBe('analyzed');
    if (result.kind === 'analyzed') {
      const normalized = normalizeText(input);
      expect(result.normalized).toBe(normalized);
      expect(result.classification).toEqual(classifyIntent(normalized));
      expect(result.candidates).toEqual(extractCandidates(normalized));
    }
  });

  it('returns a fresh result per call and never reuses a previous input', () => {
    const a = analyzeInput('coupon code promo voucher');
    const b = analyzeInput('iphone vs android which is better');
    // B reflects B's input, not A's.
    expect(b).toEqual(analyzeInput('iphone vs android which is better'));
    expect(b).not.toEqual(a);
    // Re-running A still yields A's result (no cross-contamination).
    expect(analyzeInput('coupon code promo voucher')).toEqual(a);
  });
});

describe('analyzeInput — properties', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Feature: intent-scanner, Property 7: No Network Without Operator Compare
  // Trigger (orchestrator slice) — for any input, analyzeInput is deterministic
  // and triggers zero fetch calls.
  it('Property 7 (orchestrator slice): deterministic and network-free', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    fc.assert(
      fc.property(fc.string(), (s) => {
        const first = analyzeInput(s);
        const second = analyzeInput(s);
        expect(second).toEqual(first);
      }),
      { numRuns: 200 }
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
