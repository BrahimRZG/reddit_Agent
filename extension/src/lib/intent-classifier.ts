/**
 * Intent_Classifier (Spec 05, Req 3).
 *
 * Pure, deterministic classification of Normalized_Text to exactly one
 * Intent_Category and a bounded Confidence_Value, derived SOLELY from the
 * supplied string. Uses fixed, module-level signal tables and a deterministic
 * scoring fold. It reads no hidden input (`Date`, randomness, storage) and
 * performs NO network call.
 */
import type { Classification, IntentCategory } from '../types';

/** The four signal-bearing categories (everything else is `irrelevant`). */
type SignalCategory = Exclude<IntentCategory, 'irrelevant'>;

/**
 * Fixed signal phrases per category. Matching is word-boundary aware (see
 * `compilePhrase`) so e.g. `vs` does not match inside `tvs`. Tables are constant
 * and never mutated, preserving determinism.
 */
const SIGNAL_TABLE: Record<SignalCategory, readonly string[]> = {
  'coupon-seeking': [
    'coupon',
    'coupons',
    'coupon code',
    'promo',
    'promo code',
    'promo codes',
    'voucher',
    'discount code',
    'redeem code',
    'referral code',
  ],
  'deal-seeking': [
    'deal',
    'deals',
    'sale',
    'on sale',
    'discount',
    'discounts',
    'cheap',
    'cheapest',
    'best price',
    'lowest price',
    'bargain',
    'clearance',
    'price drop',
    'savings',
  ],
  'product-comparison': [
    'vs',
    'versus',
    'compare',
    'comparison',
    'compared to',
    'better than',
    'alternative',
    'alternatives',
    'which is better',
    'pros and cons',
    'difference between',
  ],
  'generic-discussion': [
    'recommend',
    'recommendation',
    'recommendations',
    'review',
    'reviews',
    'opinion',
    'opinions',
    'thoughts',
    'experience',
    'worth it',
    'advice',
    'anyone use',
    'question',
    'help',
  ],
};

/**
 * Deterministic tie-break order: when two categories share the top score, the
 * earlier category in this list wins. Also fixes the iteration order of the fold.
 */
const CATEGORY_PRIORITY: readonly SignalCategory[] = [
  'coupon-seeking',
  'deal-seeking',
  'product-comparison',
  'generic-discussion',
];

/** Number of distinct matched signals at which confidence saturates to 1.0. */
const CONFIDENCE_SATURATION = 3;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compiles a phrase into a stateless, word-boundary-anchored matcher. */
function compilePhrase(phrase: string): RegExp {
  return new RegExp(`\\b${escapeRegExp(phrase)}\\b`);
}

/**
 * Precompiled matchers per category. Built once at module load from the constant
 * tables; the RegExps are used with `.test()` only (no `g` flag), so they hold no
 * mutable state and matching is deterministic.
 */
const COMPILED: Record<SignalCategory, readonly RegExp[]> = {
  'coupon-seeking': SIGNAL_TABLE['coupon-seeking'].map(compilePhrase),
  'deal-seeking': SIGNAL_TABLE['deal-seeking'].map(compilePhrase),
  'product-comparison': SIGNAL_TABLE['product-comparison'].map(compilePhrase),
  'generic-discussion': SIGNAL_TABLE['generic-discussion'].map(compilePhrase),
};

/** Counts how many distinct phrases of a category are present in the text. */
function countMatches(text: string, matchers: readonly RegExp[]): number {
  let count = 0;
  for (const matcher of matchers) {
    if (matcher.test(text)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Assigns exactly one Intent_Category and a Confidence_Value in [0.0, 1.0].
 *
 * Scores each signal category by its number of distinct matched phrases, then
 * selects the highest-scoring category (ties broken by CATEGORY_PRIORITY). When
 * no signal matches any category, returns `{ category: 'irrelevant', confidence: 0.0 }`
 * (Req 3.5). Confidence is `min(1, score / CONFIDENCE_SATURATION)`, guaranteeing
 * the bound invariant (Req 3.2).
 */
export function classifyIntent(normalized: string): Classification {
  let bestCategory: SignalCategory | null = null;
  let bestScore = 0;

  for (const category of CATEGORY_PRIORITY) {
    const score = countMatches(normalized, COMPILED[category]);
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  if (bestCategory === null || bestScore === 0) {
    return { category: 'irrelevant', confidence: 0.0 };
  }

  const confidence = Math.min(1, bestScore / CONFIDENCE_SATURATION);
  return { category: bestCategory, confidence };
}
