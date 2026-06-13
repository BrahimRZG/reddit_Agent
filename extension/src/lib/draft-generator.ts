/**
 * Draft_Co_Pilot deterministic local generator (Spec 06, Req 1, 2, 3, 4, 5, 6, 8).
 *
 * `generateDraft` is a PURE, SYNCHRONOUS, DETERMINISTIC function of its
 * `DraftInput` argument: identical valid input always yields a byte-identical
 * `DraftResult`. It has NO hidden inputs. It MUST NOT read `Date`, `Date.now()`,
 * `performance.now()`, `Math.random()`, `crypto.*`, `chrome.storage`, or any
 * global mutable state, and MUST NOT call `fetch`/`authenticatedFetch` or invoke
 * any OpenAI / LLM / AI provider. Determinism applies to SUCCESSFUL generation
 * only; on any internal error or resource constraint the function returns a
 * typed `FailureState` carrying a fixed, safe message (no stack trace, file
 * path, secret, environment value, internal detail, or draft text). It NEVER
 * throws.
 *
 * All shared types and the fixed Disclosure / length constants come from
 * `../types`; all compliance/sanitization primitives come from
 * `./draft-compliance`. Nothing is duplicated here.
 */
import { AFFILIATION_DISCLOSURE, MAX_SOURCE_LENGTH } from '../types';
import type {
  CompareContext,
  DraftInput,
  DraftInputValidation,
  DraftMode,
  DraftResult,
  FailureState,
  IntentCategory,
  IntentContext,
} from '../types';
import {
  CONCEALING_LANGUAGE_PHRASES,
  PROHIBITED_LANGUAGE_PHRASES,
  containsConcealingLanguage,
  containsProhibitedLanguage,
  stripUrls,
  validateCompliance,
} from './draft-compliance';

// --- Fixed, safe Failure_State messages (Req 3.6, 3.7) -----------------------
//
// These are the ONLY strings ever placed in a FailureState.message. They contain
// no stack trace, file path, secret, environment value, internal detail, or
// draft text — just fixed, human-readable guidance.
const GENERATION_ERROR_MESSAGE = 'Draft generation failed. Please try again.';

// --- Fixed template / tuning constants (no randomness, no timestamps) --------

/** The three valid Reply_Modes (Req 2.1). Used to detect a missing/invalid mode. */
const VALID_MODES: readonly DraftMode[] = [
  'no-link-authority',
  'soft-cta-with-disclosure',
  'disclosed-link',
];

/** Deterministic upper bound on the derived topic summary length. */
const TOPIC_MAX_LENGTH = 200;

/** Deterministic caps on how much optional context is folded into a draft. */
const MAX_INTENT_CANDIDATES = 4;
const MAX_OFFER_FACTS = 3;

/**
 * Fixed Intent_Category -> emphasis phrase mapping (Req 3.9). Deterministic: a
 * category always maps to the same phrase. `generic-discussion` and `irrelevant`
 * contribute no emphasis phrase.
 */
const INTENT_CATEGORY_PHRASES: Record<IntentCategory, string> = {
  'coupon-seeking': "Since you're after a coupon code,",
  'deal-seeking': "Since you're hunting for a good deal,",
  'product-comparison': "Since you're weighing a few options,",
  'generic-discussion': '',
  irrelevant: '',
};

/** Fixed, non-promotional general advice expressible without any link (Req 4.4). */
const GENERAL_ADVICE =
  'In general it helps to compare a few options, read recent reviews, and check the ' +
  'return policy before deciding — take your time, there is no pressure.';

/** Fixed general (link-free) CouponsRiver suggestion for Soft_CTA (Req 5.2). */
const SOFT_CTA_SUGGESTION =
  "If it's useful you might check CouponsRiver for relevant options — I'd still " +
  'compare around before deciding.';

// --- Input validation (Req 1.6, 1.7, 1.8, 2.2) -------------------------------

/**
 * Validates the Operator-supplied Draft_Input before generation.
 *
 * Deterministic precedence (documented):
 *   1. `no_mode`   — no valid Draft_Mode selected (missing/empty/not one of the
 *                    three Reply_Modes). Mode is the most fundamental selection,
 *                    so it is checked first (Req 2.2).
 *   2. `empty`     — Source_Text has zero non-whitespace characters (Req 1.6).
 *                    Checked before `too_long` so whitespace-only input (even if
 *                    very long) is reported as empty, mirroring the Spec 05
 *                    `validateInput` convention.
 *   3. `too_long`  — Source_Text length exceeds MAX_SOURCE_LENGTH (Req 1.7, 1.8).
 *   4. `valid`     — otherwise.
 *
 * Pure: depends only on `input` and fixed constants.
 */
export function validateDraftInput(input: DraftInput): DraftInputValidation {
  if (!input || !VALID_MODES.includes(input.mode)) {
    return { kind: 'no_mode' };
  }
  if (typeof input.sourceText !== 'string' || input.sourceText.trim().length === 0) {
    return { kind: 'empty' };
  }
  if (input.sourceText.length > MAX_SOURCE_LENGTH) {
    return { kind: 'too_long', max: MAX_SOURCE_LENGTH };
  }
  return { kind: 'valid' };
}

// --- Deterministic, sanitized fragment derivation ----------------------------

/** Escape a literal phrase for safe use inside a RegExp (deterministic). */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Collapse whitespace left by removals into a tidy, deterministic shape. */
function collapseWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/ +([.,!?;:])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/**
 * Sanitize a fragment derived from Operator-supplied text so it can never carry
 * a URL/external link (Req 4.2, 5.3), Prohibited_Language (Req 8.1, 8.3, 8.4),
 * or Concealing_Language (Req 7.4) into a generated draft. Reuses the fixed
 * phrase tables and `stripUrls` from `draft-compliance` (no duplicated strings).
 * Pure and deterministic.
 */
function sanitizeFragment(text: string): string {
  let out = stripUrls(text);
  for (const phrase of PROHIBITED_LANGUAGE_PHRASES) {
    out = out.replace(new RegExp(escapeRegExp(phrase), 'gi'), '');
  }
  for (const phrase of CONCEALING_LANGUAGE_PHRASES) {
    out = out.replace(new RegExp(escapeRegExp(phrase), 'gi'), '');
  }
  return collapseWhitespace(out);
}

/** Deterministic word-boundary truncation to a fixed maximum length. */
function truncateAtWordBoundary(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trimEnd();
}

/**
 * Derive a short, deterministic topic summary from Source_Text using a FIXED
 * rule: sanitize, take the first sentence (up to the first `.`/`!`/`?`), then
 * truncate at a word boundary to TOPIC_MAX_LENGTH. No randomness, no timestamps.
 */
function deriveTopicSummary(sourceText: string): string {
  const sanitized = sanitizeFragment(sourceText);
  if (sanitized.length === 0) {
    return '';
  }

  const match = sanitized.match(/^[^.!?\n]*[.!?]?/);
  const firstSentence = match && match[0].trim().length > 0 ? match[0].trim() : sanitized;
  return truncateAtWordBoundary(firstSentence, TOPIC_MAX_LENGTH);
}

/** Deterministic, order-preserving de-duplication. */
function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

/**
 * Fold an optional Intent_Context into a deterministic emphasis sentence
 * (Req 3.9): a fixed category->phrase mapping plus the (sanitized, de-duplicated,
 * capped) candidate values. Returns '' when there is nothing to add.
 */
function deriveIntentEmphasis(intent: IntentContext | undefined): string {
  if (!intent || !intent.classification) {
    return '';
  }
  const categoryPhrase = INTENT_CATEGORY_PHRASES[intent.classification.category] ?? '';
  const values = dedupe(
    (intent.candidates ?? [])
      .map((candidate) => sanitizeFragment(candidate.value ?? ''))
      .filter((value) => value.length > 0),
  ).slice(0, MAX_INTENT_CANDIDATES);

  const candidatePhrase =
    values.length > 0 ? `a few details worth noting: ${values.join(', ')}.` : '';

  return [categoryPhrase, candidatePhrase].filter((part) => part.length > 0).join(' ').trim();
}

/**
 * Derive offer/savings facts SOLELY from `compareContext.matches` (Req 3.10,
 * 8.2, 8.5) — the generator never invents savings. Each fact is sanitized and
 * capped; the result is a list of "{merchant}: {description} (code: X)" lines.
 */
function deriveOfferFacts(compare: CompareContext | undefined): string[] {
  if (!compare || !Array.isArray(compare.matches)) {
    return [];
  }
  return compare.matches
    .slice(0, MAX_OFFER_FACTS)
    .map((match) => {
      const merchant = sanitizeFragment(match.merchant ?? '');
      const description = sanitizeFragment(match.description ?? '');
      const code = match.coupon_code ? sanitizeFragment(match.coupon_code) : '';
      let line = '';
      if (merchant && description) {
        line = `${merchant}: ${description}`;
      } else if (merchant) {
        line = merchant;
      } else if (description) {
        line = description;
      }
      if (line && code) {
        line += ` (code: ${code})`;
      }
      return line;
    })
    .filter((line) => line.length > 0);
}

// --- Fixed per-mode template assembly ----------------------------------------

interface DraftFragments {
  topic: string;
  intentEmphasis: string;
  offerFacts: string[];
}

/** Join non-empty paragraphs with a blank line between them (deterministic). */
function joinParagraphs(paragraphs: string[]): string {
  return paragraphs.filter((paragraph) => paragraph.trim().length > 0).join('\n\n');
}

/** The shared, link-free helpful answer used by every mode (Req 4.1). */
function buildHelpfulAnswer(topic: string): string {
  return topic.length > 0
    ? `Here's a helpful, no-pressure answer based on what you shared: ${topic}`
    : "Here's a helpful, no-pressure answer based on what you shared.";
}

/** Render the (already-sanitized) offer facts as a list block, or '' if none. */
function buildOffersBlock(offerFacts: string[]): string {
  if (offerFacts.length === 0) {
    return '';
  }
  const lines = offerFacts.map((fact) => `- ${fact}`).join('\n');
  return `A few options that may be relevant:\n${lines}`;
}

/**
 * No_Link_Authority (Req 4.1–4.5): a helpful answer plus link-free general
 * advice. Includes NO CouponsRiver mention, promotion, CTA, or offer facts; a
 * final `stripUrls` guarantees no URL survives.
 */
function buildNoLinkAuthority(fragments: DraftFragments): string {
  return stripUrls(
    joinParagraphs([
      buildHelpfulAnswer(fragments.topic),
      fragments.intentEmphasis,
      GENERAL_ADVICE,
    ]),
  );
}

/**
 * Soft_CTA_With_Disclosure (Req 5.1–5.3): helpful answer + affiliation
 * Disclosure + a general (link-free) CouponsRiver suggestion. A final
 * `stripUrls` guarantees no direct link/URL appears.
 */
function buildSoftCta(fragments: DraftFragments): string {
  return stripUrls(
    joinParagraphs([
      buildHelpfulAnswer(fragments.topic),
      fragments.intentEmphasis,
      buildOffersBlock(fragments.offerFacts),
      `${AFFILIATION_DISCLOSURE} ${SOFT_CTA_SUGGESTION}`,
    ]),
  );
}

/**
 * Disclosed_Link (Req 6.1–6.4): helpful answer + affiliation Disclosure + the
 * Operator-supplied URL ONLY when provided. The generator never invents a URL;
 * when none is supplied no URL appears. `stripUrls` is intentionally NOT applied
 * here so the legitimate Operator URL is preserved — every other fragment was
 * already URL-stripped during derivation, so the Operator URL is the only URL
 * that can appear.
 */
function buildDisclosedLink(fragments: DraftFragments, operatorUrl: string): string {
  const paragraphs = [
    buildHelpfulAnswer(fragments.topic),
    fragments.intentEmphasis,
    buildOffersBlock(fragments.offerFacts),
    AFFILIATION_DISCLOSURE,
  ];
  if (operatorUrl.length > 0) {
    paragraphs.push(`Here's the CouponsRiver link I mentioned: ${operatorUrl}`);
  }
  return joinParagraphs(paragraphs);
}

/** Assemble the draft text for `mode` from already-sanitized fragments. */
function buildDraftText(
  mode: DraftMode,
  fragments: DraftFragments,
  operatorUrl: string,
): string {
  switch (mode) {
    case 'no-link-authority':
      return buildNoLinkAuthority(fragments);
    case 'soft-cta-with-disclosure':
      return buildSoftCta(fragments);
    case 'disclosed-link':
      return buildDisclosedLink(fragments, operatorUrl);
    default:
      // Unreachable for a valid DraftMode; keeps the switch exhaustive/safe.
      return buildNoLinkAuthority(fragments);
  }
}

/** The two promotional Reply_Modes. */
function isPromotional(mode: DraftMode): boolean {
  return mode === 'soft-cta-with-disclosure' || mode === 'disclosed-link';
}

// --- Public generator (Req 3.1–3.11) -----------------------------------------

/**
 * Pure, synchronous, deterministic draft generation.
 *
 * Returns a `DraftResult` on success or a typed `FailureState` on failure; it
 * NEVER throws. Determinism holds for successful generation: identical valid
 * `DraftInput` yields a byte-identical `DraftResult`.
 *
 * Pipeline:
 *   1. Validate; invalid input returns a safe `FailureState` (the UI also
 *      pre-checks, but the generator is safe when called directly).
 *   2. Derive sanitized, deterministic facets (topic, intent emphasis, offer
 *      facts) — no randomness, no timestamps, no hidden inputs.
 *   3. Assemble the fixed per-mode template.
 *   4. Defensive safety backstop: if any Prohibited_Language (or, for a
 *      promotional draft, Concealing_Language) somehow survived, rebuild from
 *      the fixed template text alone (no derived fragments), which is guaranteed
 *      safe.
 *   5. Attach warnings + safety via `validateCompliance` and return.
 */
export function generateDraft(input: DraftInput): DraftResult | FailureState {
  try {
    const validation = validateDraftInput(input);
    if (validation.kind !== 'valid') {
      return {
        kind: 'failure',
        code: 'generation_error',
        message: GENERATION_ERROR_MESSAGE,
      };
    }

    const mode = input.mode;
    const operatorUrl =
      typeof input.couponsRiverUrl === 'string' ? input.couponsRiverUrl.trim() : '';

    // No_Link_Authority must carry no CouponsRiver promotion, so it never folds
    // in Compare_Context offer facts (Req 4.3).
    const fragments: DraftFragments = {
      topic: deriveTopicSummary(input.sourceText),
      intentEmphasis: deriveIntentEmphasis(input.intentContext),
      offerFacts: mode === 'no-link-authority' ? [] : deriveOfferFacts(input.compareContext),
    };

    let draftText = buildDraftText(mode, fragments, operatorUrl);

    // Defensive backstop (Req 8.1, 8.3, 8.4, 7.4): the derived fragments are
    // already sanitized and the templates are fixed-safe, so this should never
    // trigger — but if it did, fall back to the fixed template with no derived
    // content. Deterministic in both branches.
    if (
      containsProhibitedLanguage(draftText) ||
      (isPromotional(mode) && containsConcealingLanguage(draftText))
    ) {
      draftText = buildDraftText(
        mode,
        { topic: '', intentEmphasis: '', offerFacts: [] },
        operatorUrl,
      );
    }

    const { warnings, safety } = validateCompliance(mode, draftText, input);

    return { kind: 'draft', mode, draftText, warnings, safety };
  } catch {
    // Never throw: map any internal error/resource constraint to a safe,
    // typed FailureState with no leaked internals and no draft text (Req 3.6–3.8).
    return {
      kind: 'failure',
      code: 'generation_error',
      message: GENERATION_ERROR_MESSAGE,
    };
  }
}
