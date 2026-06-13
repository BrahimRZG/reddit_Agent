/**
 * Spec 06 — Draft Co-Pilot — `draft-compliance` tests.
 *
 * Pure-logic slice (Tasks 6.10–6.13): promotional disclosure, the
 * concealing-language safety verdict (safe iff disclosure AND no concealing),
 * always-on compliance warnings, and the `stripUrls` / `containsProhibitedLanguage`
 * / `containsConcealingLanguage` helper unit tests.
 *
 * Each property test runs a minimum of 100 iterations and is tagged
 * `// Feature: draft-co-pilot, Property {n}: {property text}` per design Section 12.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  CONCEALING_LANGUAGE_PHRASES,
  PROHIBITED_LANGUAGE_PHRASES,
  containsConcealingLanguage,
  containsProhibitedLanguage,
  stripUrls,
  validateCompliance,
} from './draft-compliance';
import { generateDraft } from './draft-generator';
import { AFFILIATION_DISCLOSURE } from '../types';
import type { DraftInput, DraftMode } from '../types';

// --- Shared arbitraries -------------------------------------------------------

const promotionalModeArb = fc.constantFrom<DraftMode>(
  'soft-cta-with-disclosure',
  'disclosed-link',
);

const allModeArb = fc.constantFrom<DraftMode>(
  'no-link-authority',
  'soft-cta-with-disclosure',
  'disclosed-link',
);

const validSourceTextArb = fc
  .string({ maxLength: 400 })
  .map((s) => `Looking for help with this topic. ${s}`);

const couponsRiverUrlArb = fc.constantFrom(
  'https://couponsriver.com/deal/123',
  'https://www.couponsriver.com/x?ref=abc',
);

const promoContext = (mode: DraftMode, url?: string): DraftInput => ({
  sourceText: 'source',
  mode,
  couponsRiverUrl: url,
});

// The five Concealing_Language examples that the steering message requires
// be covered by an explicit per-phrase test.
const REQUIRED_CONCEALING = [
  'not affiliated',
  'i just found this',
  'randomly came across',
  'no connection to them',
  'not sponsored',
] as const;

// --- 6.10 Property 4: Promotional Drafts Always Disclose ----------------------

describe('promotional disclosure (Property 4)', () => {
  // Feature: draft-co-pilot, Property 4: Promotional Drafts Always Disclose
  it('every promotional draft includes the Disclosure and emits disclosure_required (safe)', () => {
    fc.assert(
      fc.property(
        validSourceTextArb,
        promotionalModeArb,
        fc.option(couponsRiverUrlArb, { nil: undefined }),
        (src, mode, url) => {
          const result = generateDraft({ sourceText: src, mode, couponsRiverUrl: url });
          expect(result.kind).toBe('draft');
          if (result.kind !== 'draft') return;
          expect(result.draftText).toContain(AFFILIATION_DISCLOSURE);

          const { warnings, safety } = validateCompliance(mode, result.draftText, {
            sourceText: src,
            mode,
            couponsRiverUrl: url,
          });
          expect(warnings.some((w) => w.id === 'disclosure_required')).toBe(true);
          expect(safety).toBe('safe');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- 6.11 Property 4a: Concealing Language ⇒ Unsafe ---------------------------

describe('concealing language safety verdict (Property 4a)', () => {
  // Filler must not itself introduce a disclosure or concealing phrase, so the
  // generated combination deterministically matches the expected verdict.
  const fillerArb = fc
    .string({ maxLength: 60 })
    .filter((f) => !containsConcealingLanguage(f) && !f.includes(AFFILIATION_DISCLOSURE));

  // Feature: draft-co-pilot, Property 4a: Concealing Language Makes a Promotional Draft Unsafe
  it('a promotional draft is safe iff it discloses AND contains no concealing language', () => {
    fc.assert(
      fc.property(
        promotionalModeArb,
        fc.boolean(), // include disclosure?
        fc.boolean(), // include concealing phrase?
        fc.constantFrom(...CONCEALING_LANGUAGE_PHRASES),
        fillerArb,
        (mode, includeDisclosure, includeConcealing, phrase, filler) => {
          let text = `Here is a helpful answer. ${filler}`;
          if (includeDisclosure) text += ` ${AFFILIATION_DISCLOSURE}`;
          if (includeConcealing) text += ` ${phrase}`;

          const { safety, warnings } = validateCompliance(mode, text, promoContext(mode));
          const ids = warnings.map((w) => w.id);
          const expectedSafe = includeDisclosure && !includeConcealing;

          expect(safety).toBe(expectedSafe ? 'safe' : 'unsafe');
          if (!includeDisclosure) {
            expect(ids).toContain('unsafe_no_disclosure');
          }
          if (includeConcealing) {
            expect(ids).toContain('unsafe_concealing');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Required example (a): disclosure + no concealing -> safe.
  it('example (a): promotional draft with disclosure and no concealing language is safe', () => {
    const text = `Here is a helpful answer. ${AFFILIATION_DISCLOSURE}`;
    const { safety, warnings } = validateCompliance(
      'soft-cta-with-disclosure',
      text,
      promoContext('soft-cta-with-disclosure'),
    );
    expect(safety).toBe('safe');
    const ids = warnings.map((w) => w.id);
    expect(ids).not.toContain('unsafe_concealing');
    expect(ids).not.toContain('unsafe_no_disclosure');
  });

  // Required example (b): disclosure + concealing -> unsafe (unsafe_concealing).
  it('example (b): disclosure plus concealing language is unsafe with unsafe_concealing', () => {
    const text = `Here is a helpful answer. ${AFFILIATION_DISCLOSURE} Also, not affiliated.`;
    const { safety, warnings } = validateCompliance(
      'soft-cta-with-disclosure',
      text,
      promoContext('soft-cta-with-disclosure'),
    );
    expect(safety).toBe('unsafe');
    expect(warnings.map((w) => w.id)).toContain('unsafe_concealing');
  });

  // Required example (c): no disclosure -> unsafe (unsafe_no_disclosure).
  it('example (c): promotional draft without disclosure is unsafe with unsafe_no_disclosure', () => {
    const text = 'Here is a helpful answer with no disclosure at all.';
    const { safety, warnings } = validateCompliance(
      'disclosed-link',
      text,
      promoContext('disclosed-link'),
    );
    expect(safety).toBe('unsafe');
    expect(warnings.map((w) => w.id)).toContain('unsafe_no_disclosure');
  });

  // Per-phrase coverage of each required Concealing_Language example.
  for (const phrase of REQUIRED_CONCEALING) {
    it(`flags concealing phrase "${phrase}" even when a disclosure is present`, () => {
      const text = `${AFFILIATION_DISCLOSURE} And by the way, ${phrase}.`;
      const { safety, warnings } = validateCompliance(
        'soft-cta-with-disclosure',
        text,
        promoContext('soft-cta-with-disclosure'),
      );
      expect(safety).toBe('unsafe');
      expect(warnings.map((w) => w.id)).toContain('unsafe_concealing');
    });
  }
});

// --- 6.12 Property 8: Compliance Warnings Always Present ----------------------

describe('compliance warnings (Property 8)', () => {
  // Feature: draft-co-pilot, Property 8: Compliance Warnings Always Present
  it('always emits the base warnings; promotional adds disclosure_required; disclosed-link w/o URL adds missing_link', () => {
    fc.assert(
      fc.property(allModeArb, fc.option(couponsRiverUrlArb, { nil: undefined }), (mode, url) => {
        const text =
          mode === 'no-link-authority'
            ? 'A helpful, link-free answer.'
            : `A helpful answer. ${AFFILIATION_DISCLOSURE}`;
        const { warnings } = validateCompliance(mode, text, {
          sourceText: 'src',
          mode,
          couponsRiverUrl: url,
        });
        const ids = warnings.map((w) => w.id);

        expect(ids).toContain('manual_review');
        expect(ids).toContain('subreddit_rules');
        expect(ids).toContain('no_automated_action');

        if (mode !== 'no-link-authority') {
          expect(ids).toContain('disclosure_required');
        }
        if (mode === 'disclosed-link' && (url === undefined || url.trim().length === 0)) {
          expect(ids).toContain('missing_link');
        }
      }),
      { numRuns: 100 },
    );
  });
});

// --- 6.13 helper unit tests ---------------------------------------------------

describe('stripUrls — unit', () => {
  it('removes http and https URLs', () => {
    expect(stripUrls('see http://example.com/x here').toLowerCase()).not.toContain('http');
    expect(stripUrls('visit https://shop.example.org/a?b=1 today').toLowerCase()).not.toContain(
      'http',
    );
  });

  it('removes www-prefixed URLs', () => {
    const out = stripUrls('go to www.example.com/code now');
    expect(out.toLowerCase()).not.toContain('www.');
  });

  it('removes bare-domain URLs', () => {
    const out = stripUrls('check example.com for details');
    expect(out.toLowerCase()).not.toContain('example.com');
  });

  it('leaves non-URL text intact', () => {
    expect(stripUrls('just plain helpful text')).toBe('just plain helpful text');
  });
});

describe('containsProhibitedLanguage — unit (each category)', () => {
  it('detects spammy urgency', () => {
    expect(containsProhibitedLanguage('You should act now before it ends')).toBe(true);
  });

  it('detects manipulation / guaranteed-savings', () => {
    expect(containsProhibitedLanguage('This offers guaranteed savings for you')).toBe(true);
  });

  it('detects impersonation', () => {
    expect(containsProhibitedLanguage('I am an official representative of the brand')).toBe(true);
  });

  it('detects fabricated personal experience', () => {
    expect(containsProhibitedLanguage('I personally used this product for years')).toBe(true);
  });

  it('returns false for benign helpful text', () => {
    expect(containsProhibitedLanguage('Here is a balanced, helpful answer.')).toBe(false);
  });

  it('matches every phrase in the fixed table case-insensitively', () => {
    for (const phrase of PROHIBITED_LANGUAGE_PHRASES) {
      expect(containsProhibitedLanguage(`prefix ${phrase.toUpperCase()} suffix`)).toBe(true);
    }
  });
});

describe('containsConcealingLanguage — unit', () => {
  it('matches case-insensitively', () => {
    expect(containsConcealingLanguage('I am NOT AFFILIATED with them')).toBe(true);
    expect(containsConcealingLanguage('Not Sponsored, just sharing')).toBe(true);
  });

  it('matches each required concealing phrase', () => {
    for (const phrase of REQUIRED_CONCEALING) {
      expect(containsConcealingLanguage(`text ${phrase} text`)).toBe(true);
    }
  });

  it('does not match benign text', () => {
    expect(containsConcealingLanguage('This is a helpful and transparent answer.')).toBe(false);
  });
});
