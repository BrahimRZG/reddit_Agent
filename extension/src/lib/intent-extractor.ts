/**
 * Candidate_Extractor (Spec 05, Req 4).
 *
 * Pure, deterministic extraction of Detected_Candidate signals from
 * Normalized_Text. Output is deduplicated by `(type, value)` and sorted by a
 * fixed total order (`type`, then `value`, both in UTF-16 code-unit order) so
 * identical input always yields an identical, identically ordered list. Uses
 * only local, in-memory logic and performs NO network call.
 */
import type { CandidateType, DetectedCandidate } from '../types';

/** General shopping/intent keywords surfaced as `keyword` candidates. */
const KEYWORD_TERMS: readonly string[] = [
  'deal',
  'deals',
  'discount',
  'discounts',
  'sale',
  'cheap',
  'cheapest',
  'price',
  'prices',
  'review',
  'reviews',
  'compare',
  'comparison',
  'recommend',
  'recommendation',
  'alternative',
  'bargain',
  'clearance',
  'savings',
];

/** Known tool/product names surfaced as `tool_mention` candidates. */
const TOOL_TERMS: readonly string[] = [
  'notion',
  'figma',
  'slack',
  'zoom',
  'photoshop',
  'lightroom',
  'excel',
  'evernote',
  'canva',
  'grammarly',
  'quickbooks',
  'salesforce',
  'trello',
  'asana',
  'jira',
  'obsidian',
  'airtable',
];

/** Known merchant names surfaced as `merchant_mention` candidates. */
const MERCHANT_TERMS: readonly string[] = [
  'amazon',
  'walmart',
  'target',
  'nike',
  'adidas',
  'ebay',
  'etsy',
  'costco',
  'apple',
  'samsung',
  'sephora',
  'macys',
  'best buy',
  'home depot',
  'newegg',
];

/** Coupon-related phrases surfaced as `coupon_signal` candidates. */
const COUPON_SIGNAL_TERMS: readonly string[] = [
  'coupon',
  'coupons',
  'coupon code',
  'promo',
  'promo code',
  'discount code',
  'voucher',
  'redeem code',
  'referral code',
];

/**
 * Matches a code-like token: lowercase alphanumeric, length 4..24, containing at
 * least one letter AND at least one digit (e.g. `save20`). Surfaced as a
 * `coupon_signal` candidate. Anchored + used with `.test()` only (no `g` flag),
 * so it holds no mutable state.
 */
const CODE_TOKEN_RE = /^(?=.*[a-z])(?=.*[0-9])[a-z0-9]{4,24}$/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compilePhrase(phrase: string): RegExp {
  return new RegExp(`\\b${escapeRegExp(phrase)}\\b`);
}

interface CompiledTerm {
  value: string;
  matcher: RegExp;
}

function compileAll(terms: readonly string[]): CompiledTerm[] {
  return terms.map((value) => ({ value, matcher: compilePhrase(value) }));
}

/** Precompiled, read-only matcher tables keyed by candidate type. */
const COMPILED: Record<Exclude<CandidateType, 'coupon_signal'> | 'coupon_signal', CompiledTerm[]> = {
  keyword: compileAll(KEYWORD_TERMS),
  tool_mention: compileAll(TOOL_TERMS),
  merchant_mention: compileAll(MERCHANT_TERMS),
  coupon_signal: compileAll(COUPON_SIGNAL_TERMS),
};

/** Deterministic UTF-16 code-unit comparison (locale-independent). */
function cmpStr(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Produces zero or more Detected_Candidate items from Normalized_Text.
 *
 * - Each item has a `type` from CandidateType and a string `value` (Req 4.2).
 * - Duplicates sharing both `type` and `value` are removed (Req 4.5).
 * - The list is sorted by `(type, value)` in UTF-16 code-unit order, giving a
 *   stable, deterministic ordering (Req 4.3, 4.4).
 */
export function extractCandidates(normalized: string): DetectedCandidate[] {
  const collected: DetectedCandidate[] = [];

  const pushMatches = (type: CandidateType, terms: CompiledTerm[]): void => {
    for (const { value, matcher } of terms) {
      if (matcher.test(normalized)) {
        collected.push({ type, value });
      }
    }
  };

  pushMatches('keyword', COMPILED.keyword);
  pushMatches('tool_mention', COMPILED.tool_mention);
  pushMatches('merchant_mention', COMPILED.merchant_mention);
  pushMatches('coupon_signal', COMPILED.coupon_signal);

  // Code-like tokens (e.g. `save20`) become coupon_signal candidates.
  for (const rawToken of normalized.split(/\s+/)) {
    const token = rawToken.replace(/^[^a-z0-9]+/, '').replace(/[^a-z0-9]+$/, '');
    if (CODE_TOKEN_RE.test(token)) {
      collected.push({ type: 'coupon_signal', value: token });
    }
  }

  // Deduplicate by (type, value).
  const seen = new Set<string>();
  const unique: DetectedCandidate[] = [];
  for (const candidate of collected) {
    const key = `${candidate.type}\u0000${candidate.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(candidate);
    }
  }

  // Stable total order: by type, then by value.
  unique.sort((a, b) => {
    const byType = cmpStr(a.type, b.type);
    return byType !== 0 ? byType : cmpStr(a.value, b.value);
  });

  return unique;
}
