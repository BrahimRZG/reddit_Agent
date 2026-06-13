/**
 * Spec 06 — Draft Co-Pilot — `draft-generator` tests.
 *
 * Pure-logic slice (Tasks 6.1–6.9): determinism, no-network/no-AI, per-mode
 * content rules, URL provenance, prohibited-language scrubbing, safe fallback,
 * safe failure state, and `validateDraftInput` edge cases.
 *
 * Each property test runs a minimum of 100 iterations and is tagged
 * `// Feature: draft-co-pilot, Property {n}: {property text}` per design Section 12.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { generateDraft, validateDraftInput } from './draft-generator';
import { PROHIBITED_LANGUAGE_PHRASES } from './draft-compliance';
import { AFFILIATION_DISCLOSURE, MAX_SOURCE_LENGTH } from '../types';
import type {
  CandidateType,
  DraftInput,
  DraftMode,
  DraftResult,
  FailureState,
  IntentCategory,
} from '../types';

// --- Shared fast-check arbitraries -------------------------------------------

const MODES: readonly DraftMode[] = [
  'no-link-authority',
  'soft-cta-with-disclosure',
  'disclosed-link',
];

const modeArb = fc.constantFrom<DraftMode>(...MODES);

/**
 * Valid Source_Text: a fixed non-empty seed prefix guarantees the text is
 * non-empty after trim, and the bounded random suffix keeps it well under
 * MAX_SOURCE_LENGTH, so determinism/property tests exercise the success path.
 */
const validSourceTextArb = fc
  .string({ maxLength: 600 })
  .map((s) => `Looking for help with this topic. ${s}`);

const categoryArb = fc.constantFrom<IntentCategory>(
  'coupon-seeking',
  'deal-seeking',
  'product-comparison',
  'generic-discussion',
  'irrelevant',
);

const candidateTypeArb = fc.constantFrom<CandidateType>(
  'keyword',
  'tool_mention',
  'merchant_mention',
  'coupon_signal',
);

// Candidate values exclude the bare word "couponsriver" so the No-Link-Authority
// assertion (no CouponsRiver mention) cannot be tripped by Operator-pasted text;
// this does not reduce meaningful coverage.
const safeValueArb = fc
  .string({ maxLength: 30 })
  .filter((v) => !/couponsriver/i.test(v));

const intentContextArb = fc.record({
  classification: fc.record({
    category: categoryArb,
    confidence: fc.float({ min: 0, max: 1, noNaN: true }),
  }),
  candidates: fc.array(fc.record({ type: candidateTypeArb, value: safeValueArb }), {
    maxLength: 6,
  }),
});

const matchArb = fc.record(
  {
    merchant: safeValueArb,
    description: safeValueArb,
    score: fc.float({ min: 0, max: 1, noNaN: true }),
    source: fc.constant('mock-couponsriver'),
    coupon_code: fc.option(fc.string({ maxLength: 10 }), { nil: undefined }),
  },
  { requiredKeys: ['merchant', 'description', 'score', 'source'] },
);

const compareContextArb = fc.record({
  candidate: fc.record({ merchant: safeValueArb }),
  match_count: fc.nat({ max: 5 }),
  matches: fc.array(matchArb, { maxLength: 5 }),
});

const couponsRiverUrlArb = fc.constantFrom(
  'https://couponsriver.com/deal/123',
  'https://www.couponsriver.com/x?ref=abc',
  'http://couponsriver.com/promo',
);

/** A fully-formed, valid Draft_Input with optional contexts present or absent. */
const validDraftInputArb: fc.Arbitrary<DraftInput> = fc.record({
  sourceText: validSourceTextArb,
  mode: modeArb,
  couponsRiverUrl: fc.option(couponsRiverUrlArb, { nil: undefined }),
  intentContext: fc.option(intentContextArb, { nil: undefined }),
  compareContext: fc.option(compareContextArb, { nil: undefined }),
});

// --- Helpers -----------------------------------------------------------------

const hasUrl = (text: string): boolean => /https?:\/\//i.test(text) || /\bwww\./i.test(text);

const here = dirname(fileURLToPath(import.meta.url));

/** Remove block and line comments so a prose mention of a token is not a hit. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

// --- 6.1 Property 1: Successful Draft Generation Determinism ------------------

describe('generateDraft — determinism (Property 1)', () => {
  // Feature: draft-co-pilot, Property 1: Successful Draft Generation Determinism
  it('produces a deep-equal DraftResult for identical valid input across runs', () => {
    fc.assert(
      fc.property(validDraftInputArb, (input) => {
        const first = generateDraft(input);
        const second = generateDraft(input);
        expect(second).toEqual(first);
        expect(first.kind).toBe('draft');
        if (first.kind === 'draft' && second.kind === 'draft') {
          // byte-identical draft text and equal warnings/safety
          expect(second.draftText).toBe(first.draftText);
          expect(second.warnings).toEqual(first.warnings);
          expect(second.safety).toBe(first.safety);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('explicit example: identical input yields byte-identical output', () => {
    const input: DraftInput = {
      sourceText: 'What is the best laptop for students on a budget?',
      mode: 'soft-cta-with-disclosure',
      intentContext: {
        classification: { category: 'product-comparison', confidence: 0.8 },
        candidates: [{ type: 'keyword', value: 'laptop' }],
      },
      compareContext: {
        candidate: { merchant: 'Acme' },
        match_count: 1,
        matches: [
          {
            merchant: 'Acme',
            description: '10% off laptops',
            score: 0.9,
            source: 'mock-couponsriver',
          },
        ],
      },
    };
    const a = generateDraft(input);
    const b = generateDraft(input);
    expect(a).toEqual(b);
    expect(a.kind).toBe('draft');
  });

  it('static check: draft modules use no nondeterministic / network APIs', () => {
    const genSrc = stripComments(readFileSync(join(here, 'draft-generator.ts'), 'utf8'));
    const compSrc = stripComments(readFileSync(join(here, 'draft-compliance.ts'), 'utf8'));
    // Usage tokens (not bare words) so that prose/comments never cause false positives.
    const forbiddenTokens = [
      'Date.now(',
      'performance.now(',
      'Math.random(',
      'crypto.',
      'fetch(',
      'new Date(',
    ];
    for (const token of forbiddenTokens) {
      expect(genSrc.includes(token), `draft-generator.ts must not use ${token}`).toBe(false);
      expect(compSrc.includes(token), `draft-compliance.ts must not use ${token}`).toBe(false);
    }
  });
});

// --- 6.2 Property 2: No Network and No AI in Draft Generation -----------------

describe('generateDraft — no network / no AI (Property 2)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Feature: draft-co-pilot, Property 2: No Network and No AI in Draft Generation
  it('performs zero fetch calls (and invokes no AI provider) across random inputs', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    fc.assert(
      fc.property(validDraftInputArb, (input) => {
        const result = generateDraft(input);
        expect(result.kind).toBe('draft');
      }),
      { numRuns: 100 },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// --- 6.3 Property 3: No-Link Authority Excludes Promotion ---------------------

describe('generateDraft — No-Link Authority (Property 3)', () => {
  const urlSnippetArb = fc.constantFrom(
    'http://example.com/deals',
    'https://shop.example.org/x?y=1',
    'check www.coupons.net/code please',
    'visit store.example.co.uk/path now',
  );

  const noLinkSourceArb = fc
    .tuple(fc.string({ maxLength: 300 }), urlSnippetArb)
    .map(([t, u]) => `Here is my question. ${t} ${u}`)
    .filter((s) => !/couponsriver/i.test(s));

  // Feature: draft-co-pilot, Property 3: No-Link Authority Excludes Promotion
  it('contains no URL and no CouponsRiver promotion/CTA, even when source has URLs', () => {
    fc.assert(
      fc.property(noLinkSourceArb, fc.option(intentContextArb, { nil: undefined }), (src, intent) => {
        const result = generateDraft({
          sourceText: src,
          mode: 'no-link-authority',
          intentContext: intent,
        });
        expect(result.kind).toBe('draft');
        if (result.kind !== 'draft') return;
        const text = result.draftText;
        expect(hasUrl(text)).toBe(false);
        expect(text.toLowerCase()).not.toContain('couponsriver');
        expect(text).not.toContain(AFFILIATION_DISCLOSURE);
        expect(result.safety).toBe('safe');
      }),
      { numRuns: 100 },
    );
  });
});

// --- 6.4 Property 5: Disclosed Link URL Provenance ----------------------------

describe('generateDraft — Disclosed Link provenance (Property 5)', () => {
  // Feature: draft-co-pilot, Property 5: Disclosed Link URL Provenance
  it('includes a CouponsRiver URL iff the Operator supplied one; never invents one', () => {
    fc.assert(
      fc.property(
        validSourceTextArb,
        fc.boolean(),
        couponsRiverUrlArb,
        fc.option(compareContextArb, { nil: undefined }),
        (src, withUrl, url, compare) => {
          const input: DraftInput = {
            sourceText: src,
            mode: 'disclosed-link',
            couponsRiverUrl: withUrl ? url : undefined,
            compareContext: compare,
          };
          const result = generateDraft(input);
          expect(result.kind).toBe('draft');
          if (result.kind !== 'draft') return;
          const text = result.draftText;
          const hasMissingWarning = result.warnings.some((w) => w.id === 'missing_link');

          // Disclosure is always present in a promotional draft.
          expect(text).toContain(AFFILIATION_DISCLOSURE);

          if (withUrl) {
            expect(text).toContain(url);
            expect(hasMissingWarning).toBe(false);
          } else {
            expect(hasUrl(text)).toBe(false);
            expect(hasMissingWarning).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- 6.5 Property 6: Soft CTA Excludes Direct Links ---------------------------

describe('generateDraft — Soft CTA (Property 6)', () => {
  // Feature: draft-co-pilot, Property 6: Soft CTA Excludes Direct Links
  it('includes a general CouponsRiver suggestion + Disclosure and contains no URL', () => {
    fc.assert(
      fc.property(
        validSourceTextArb,
        fc.option(couponsRiverUrlArb, { nil: undefined }),
        fc.option(compareContextArb, { nil: undefined }),
        (src, url, compare) => {
          const result = generateDraft({
            sourceText: src,
            mode: 'soft-cta-with-disclosure',
            couponsRiverUrl: url,
            compareContext: compare,
          });
          expect(result.kind).toBe('draft');
          if (result.kind !== 'draft') return;
          const text = result.draftText;
          expect(text).toContain(AFFILIATION_DISCLOSURE);
          expect(text.toLowerCase()).toContain('couponsriver');
          expect(hasUrl(text)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- 6.6 Property 7: Prohibited Language Is Never Produced --------------------

describe('generateDraft — prohibited language (Property 7)', () => {
  // Feature: draft-co-pilot, Property 7: Prohibited Language Is Never Produced
  it('omits injected Prohibited_Language phrases from the draft text', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PROHIBITED_LANGUAGE_PHRASES),
        validSourceTextArb,
        modeArb,
        (phrase, src, mode) => {
          const result = generateDraft({
            sourceText: `${src} ${phrase} and a bit more text.`,
            mode,
          });
          expect(result.kind).toBe('draft');
          if (result.kind !== 'draft') return;
          expect(result.draftText.toLowerCase()).not.toContain(phrase.toLowerCase());
          // No unsupported guaranteed-savings claim ever appears.
          expect(result.draftText.toLowerCase()).not.toContain('guaranteed savings');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- 6.7 Property 9: Safe Fallback Without Optional Context -------------------

describe('generateDraft — safe fallback (Property 9)', () => {
  // Feature: draft-co-pilot, Property 9: Safe Fallback Without Optional Context
  it('succeeds with a mode-conformant DraftResult when no optional context is present', () => {
    fc.assert(
      fc.property(validSourceTextArb, modeArb, (src, mode) => {
        const result = generateDraft({ sourceText: src, mode });
        expect(result.kind).toBe('draft');
        if (result.kind !== 'draft') return;
        expect(result.mode).toBe(mode);
        expect(result.draftText.length).toBeGreaterThan(0);
        if (mode !== 'no-link-authority') {
          expect(result.draftText).toContain(AFFILIATION_DISCLOSURE);
        } else {
          expect(result.draftText).not.toContain(AFFILIATION_DISCLOSURE);
          expect(hasUrl(result.draftText)).toBe(false);
        }
        if (mode === 'disclosed-link') {
          expect(result.warnings.some((w) => w.id === 'missing_link')).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// --- 6.8 Property 9a: Safe Failure State --------------------------------------

describe('generateDraft — safe failure state (Property 9a)', () => {
  // Drive the generator down its invalid-input -> FailureState path. This is the
  // deterministic way to exercise the failure contract without modifying source.
  const invalidInputArb = fc.oneof(
    // empty / whitespace-only Source_Text, valid mode
    fc.record({ sourceText: fc.constantFrom('', '   ', '\n\t  '), mode: modeArb }),
    // over-limit Source_Text, valid mode
    fc.record({
      sourceText: fc.constant('a'.repeat(MAX_SOURCE_LENGTH + 1)),
      mode: modeArb,
    }),
    // missing / invalid mode, valid Source_Text
    fc.record({
      sourceText: validSourceTextArb,
      mode: fc.constantFrom('', 'bogus-mode', undefined as unknown as DraftMode),
    }),
  );

  const forbiddenPatterns: RegExp[] = [
    /\//, // file path / URL separators
    /\\/, // windows path separators
    /\.ts\b/i,
    /\.js\b/i,
    /\bat\b.*:\d+/, // stack-frame "at file:line"
    /Error:/i,
    /\bstack\b/i,
    /node_modules/i,
    /process\.env/i,
    /\bundefined\b/i,
    /secret/i,
  ];

  // Feature: draft-co-pilot, Property 9a: Safe Failure State
  it('returns a typed FailureState with no draft text and a leak-free message', () => {
    fc.assert(
      fc.property(invalidInputArb, (input) => {
        const result = generateDraft(input as DraftInput);
        expect(result.kind).toBe('failure');
        // No draft text field is present on a FailureState.
        expect('draftText' in result).toBe(false);
        const message = (result as FailureState).message;
        expect(typeof message).toBe('string');
        expect(message.length).toBeGreaterThan(0);
        for (const pattern of forbiddenPatterns) {
          expect(pattern.test(message), `message leaked via ${pattern}`).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// --- 6.9 validateDraftInput edge cases ----------------------------------------

describe('validateDraftInput — edge cases (Req 1.6, 1.7, 1.8, 2.2)', () => {
  const mode: DraftMode = 'no-link-authority';

  it('length 0 (empty string) -> empty', () => {
    expect(validateDraftInput({ sourceText: '', mode })).toEqual({ kind: 'empty' });
  });

  it('whitespace-only -> empty (same as empty string)', () => {
    expect(validateDraftInput({ sourceText: '   \t\n ', mode })).toEqual({ kind: 'empty' });
  });

  it('length 1 -> valid', () => {
    expect(validateDraftInput({ sourceText: 'a', mode })).toEqual({ kind: 'valid' });
  });

  it('length 10000 (exactly the max) -> valid', () => {
    expect(validateDraftInput({ sourceText: 'a'.repeat(MAX_SOURCE_LENGTH), mode })).toEqual({
      kind: 'valid',
    });
  });

  it('length 10001 -> too_long', () => {
    expect(
      validateDraftInput({ sourceText: 'a'.repeat(MAX_SOURCE_LENGTH + 1), mode }),
    ).toEqual({ kind: 'too_long', max: MAX_SOURCE_LENGTH });
  });

  it('no mode selected -> no_mode (precedence: checked before content)', () => {
    expect(
      validateDraftInput({
        sourceText: 'plenty of valid content here',
        mode: '' as unknown as DraftMode,
      }),
    ).toEqual({ kind: 'no_mode' });
  });

  it('no_mode takes precedence even when source text is also empty', () => {
    expect(
      validateDraftInput({ sourceText: '', mode: undefined as unknown as DraftMode }),
    ).toEqual({ kind: 'no_mode' });
  });
});
