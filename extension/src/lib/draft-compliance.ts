/**
 * Draft_Co_Pilot compliance / safety validator (Spec 06, Req 4, 5, 6, 7, 8, 9).
 *
 * Pure, deterministic logic over already-built draft text plus the Operator's
 * Draft_Input context. Every export here is a pure function of its arguments:
 * it does NOT read `Date`, `Date.now()`, `performance.now()`, `Math.random()`,
 * `crypto.*`, `chrome.storage`, or any global mutable state, and it performs NO
 * network call (`fetch`/`authenticatedFetch`) and invokes NO AI/LLM provider.
 *
 * The fixed Disclosure string and the plain-language warning messages are
 * single-sourced from `../types` (Spec 06 Task 1) so wording is never duplicated.
 */
import {
  AFFILIATION_DISCLOSURE,
  COMPLIANCE_WARNING_MESSAGES,
} from '../types';
import type {
  ComplianceWarning,
  ComplianceWarningId,
  DraftInput,
  DraftMode,
} from '../types';

// --- URL stripping (Req 4.2, 5.3) ---

/**
 * Matches external links / URLs in three forms, used to enforce the
 * No_Link_Authority (Req 4.2) and Soft_CTA_With_Disclosure (Req 5.3) no-URL
 * guarantees:
 *   1. explicit scheme  — `http://...` / `https://...`
 *   2. `www.` prefixed  — `www.example.com/...`
 *   3. bare-domain form — `example.com`, `shop.example.co.uk/path`.
 */
const URL_PATTERN =
  /(?:https?:\/\/|www\.)\S+|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|us|uk|ca|info|biz|shop|store|app|dev|me|ly|gg|xyz)\b(?:\/\S*)?/gi;

/**
 * Removes any URL / external link from `text`, then tidies the whitespace.
 */
export function stripUrls(text: string): string {
  return text
    .replace(URL_PATTERN, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,!?;:])/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

// --- Concealing_Language detection (Req 7.4) ---

export const CONCEALING_LANGUAGE_PHRASES: readonly string[] = [
  'not affiliated',
  'i just found this',
  'randomly came across',
  'no connection to them',
  'no affiliation',
  'not sponsored',
  'unaffiliated',
  'i have no stake',
  'just a random redditor',
];

export function containsConcealingLanguage(text: string): boolean {
  const haystack = text.toLowerCase();
  return CONCEALING_LANGUAGE_PHRASES.some((phrase) => haystack.includes(phrase));
}

// --- Prohibited_Language detection (Req 8.1, 8.3) ---

export const PROHIBITED_LANGUAGE_PHRASES: readonly string[] = [
  // spammy urgency
  'act now',
  'limited time',
  'limited time only',
  'hurry',
  "don't miss out",
  'dont miss out',
  'last chance',
  'while supplies last',
  'buy now',
  'order now',

  // manipulation
  'you would be crazy not to',
  "you'd be crazy not to",
  'everyone is buying',
  'guaranteed savings',
  'guaranteed to save',

  // impersonation
  'official representative',
  "i'm a verified seller",
  'i am a verified seller',
  'on behalf of the brand',

  // fabricated personal experience
  'i personally used',
  'i bought this myself',
  'this changed my life',
  'i tried it myself',
  'i use this every day',
];

export function containsProhibitedLanguage(text: string): boolean {
  const haystack = text.toLowerCase();
  return PROHIBITED_LANGUAGE_PHRASES.some((phrase) => haystack.includes(phrase));
}

// --- Compliance warnings + safety verdict (Req 5.4, 6.3, 7, 8, 9) ---

function isPromotionalMode(mode: DraftMode): boolean {
  return mode === 'soft-cta-with-disclosure' || mode === 'disclosed-link';
}

function hasNoOperatorUrl(url: string | undefined): boolean {
  return url === undefined || url.trim().length === 0;
}

export function validateCompliance(
  mode: DraftMode,
  draftText: string,
  context: DraftInput,
): { warnings: ComplianceWarning[]; safety: 'safe' | 'unsafe' } {
  const ids: ComplianceWarningId[] = [
    'manual_review',
    'subreddit_rules',
    'no_automated_action',
  ];

  const promotional = isPromotionalMode(mode);

  if (promotional) {
    ids.push('disclosure_required');
  }

  if (mode === 'soft-cta-with-disclosure') {
    ids.push('add_link_manually');
  }

  if (mode === 'disclosed-link' && hasNoOperatorUrl(context.couponsRiverUrl)) {
    ids.push('missing_link');
  }

  let safety: 'safe' | 'unsafe' = 'safe';

  if (promotional) {
    const hasDisclosure = draftText.includes(AFFILIATION_DISCLOSURE);
    const concealing = containsConcealingLanguage(draftText);

    if (!hasDisclosure) {
      safety = 'unsafe';
      ids.push('unsafe_no_disclosure');
    }

    if (concealing) {
      safety = 'unsafe';
      ids.push('unsafe_concealing');
    }
  }

  const warnings: ComplianceWarning[] = ids.map((id) => ({
    id,
    message: COMPLIANCE_WARNING_MESSAGES[id],
  }));

  return { warnings, safety };
}
