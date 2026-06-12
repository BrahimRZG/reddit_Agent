/**
 * Compare service for the CouponsRiver Compare API foundation (Spec 04).
 *
 * Defines the replaceable `CompareService` interface and a clearly-marked
 * MOCK / in-memory adapter (`MockCouponsRiverAdapter`). The route depends only
 * on the interface, so a real CouponsRiver adapter can replace the mock later
 * with no change to the route or the request/response contract.
 *
 * Purity & safety guarantees (Requirement 8 / design Properties 7, 8):
 *   - NO outbound network request (no fetch).
 *   - NO D1 / database access (no Env binding is used).
 *   - NO mutation of the supplied candidate.
 *   - Deterministic: the same candidate against the same dataset always yields
 *     a deep-equal result.
 */
import type { NormalizedCandidate, Match } from '../types';

/** Options that influence a compare operation. */
export interface CompareOptions {
  /** Effective, already-validated upper bound on returned matches (1..50). */
  maxResults: number;
}

/**
 * Replaceable compare data source. The route depends ONLY on this interface
 * (Requirements 7.1, 7.2). A real CouponsRiver adapter can implement this later
 * with no route or contract change (Requirement 7.6).
 *
 * Returns the ordered, bounded matches for the candidate. The route assembles
 * the CompareResponse envelope (candidate echo + match_count) so the
 * match_count invariant is enforced at a single boundary (Property 4).
 */
export interface CompareService {
  compare(candidate: NormalizedCandidate, options: CompareOptions): Match[];
}

/** Identifies matches as originating from the Spec 04 mock adapter. */
export const MOCK_SOURCE = 'mock-couponsriver';

/** Internal dataset record shape (mock only; not part of the public contract). */
interface CouponRecord {
  merchant: string;
  coupon_code?: string;
  description: string;
  category?: string;
  product_keywords?: string[];
  base_score: number;
}

/**
 * In-memory dataset backing the mock adapter. Mock-only data; not part of the
 * public contract. Multiple records share a merchant so ordering / tie-break
 * behavior is exercised deterministically.
 */
const DEFAULT_MOCK_DATASET: ReadonlyArray<CouponRecord> = [
  {
    merchant: 'Acme',
    coupon_code: 'ACME10',
    description: '10% off all widgets',
    category: 'tools',
    product_keywords: ['widget', 'gadget'],
    base_score: 5,
  },
  {
    merchant: 'Acme',
    coupon_code: 'ACME20',
    description: '20% off premium gadgets',
    category: 'tools',
    product_keywords: ['gadget'],
    base_score: 4,
  },
  {
    merchant: 'Acme',
    description: 'Free shipping on orders over $50',
    category: 'shipping',
    base_score: 2,
  },
  {
    merchant: 'Globex',
    coupon_code: 'GLX5',
    description: '$5 off cleaning solvent',
    category: 'chemicals',
    product_keywords: ['solvent'],
    base_score: 3,
  },
  {
    merchant: 'Initech',
    coupon_code: 'TPS15',
    description: '15% off office supplies',
    category: 'office',
    product_keywords: ['stapler', 'paper'],
    base_score: 4,
  },
  {
    merchant: 'Soylent',
    coupon_code: 'GREEN',
    description: 'Buy one get one free meal',
    category: 'food',
    product_keywords: ['meal', 'drink'],
    base_score: 6,
  },
];

/**
 * Deterministic UTF-16 code-unit string comparison (locale-independent), so
 * ordering is stable and reproducible across environments.
 */
function cmpStr(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * PURE scoring: starts from the record's base score (merchant already matched)
 * and adds fixed, deterministic increments for optional candidate fields.
 *   +3 coupon_code match (case-insensitive)
 *   +2 product is a case-insensitive substring of a keyword or the description
 *   +1 category match (case-insensitive)
 */
function scoreRecord(rec: CouponRecord, candidate: NormalizedCandidate): number {
  let score = rec.base_score;

  if (
    candidate.coupon_code !== undefined &&
    rec.coupon_code !== undefined &&
    candidate.coupon_code.toLowerCase() === rec.coupon_code.toLowerCase()
  ) {
    score += 3;
  }

  if (candidate.product !== undefined) {
    const needle = candidate.product.toLowerCase();
    const inKeywords = (rec.product_keywords ?? []).some((k) => k.toLowerCase().includes(needle));
    const inDescription = rec.description.toLowerCase().includes(needle);
    if (inKeywords || inDescription) {
      score += 2;
    }
  }

  if (
    candidate.category !== undefined &&
    rec.category !== undefined &&
    candidate.category.toLowerCase() === rec.category.toLowerCase()
  ) {
    score += 1;
  }

  return score;
}

/**
 * PURE total order over matches: descending score, then a stable, deterministic
 * tie-break by merchant -> coupon_code (undefined treated as '') -> description,
 * all ascending. Independent of dataset insertion order (Property 5).
 */
function compareMatches(a: Match, b: Match): number {
  if (a.score !== b.score) {
    return b.score - a.score; // descending score
  }
  const byMerchant = cmpStr(a.merchant, b.merchant);
  if (byMerchant !== 0) {
    return byMerchant;
  }
  const byCoupon = cmpStr(a.coupon_code ?? '', b.coupon_code ?? '');
  if (byCoupon !== 0) {
    return byCoupon;
  }
  return cmpStr(a.description, b.description);
}

/**
 * !!! MOCK / PLACEHOLDER IMPLEMENTATION — NOT A REAL DATA SOURCE !!!
 *
 * In-memory adapter for Spec 04. Performs NO network request, NO D1/DB access,
 * and does NOT mutate the supplied candidate. Fully deterministic. To be
 * replaced later by a real CouponsRiver adapter implementing `CompareService`
 * — with no change to the route or the request/response contract.
 */
export class MockCouponsRiverAdapter implements CompareService {
  private readonly dataset: ReadonlyArray<CouponRecord>;

  constructor(dataset: ReadonlyArray<CouponRecord> = DEFAULT_MOCK_DATASET) {
    this.dataset = dataset;
  }

  compare(candidate: NormalizedCandidate, options: CompareOptions): Match[] {
    const merchantKey = candidate.merchant.toLowerCase();

    const scored: Match[] = this.dataset
      .filter((rec) => rec.merchant.toLowerCase() === merchantKey) // case-insensitive merchant match required
      .map((rec): Match => ({
        merchant: rec.merchant,
        ...(rec.coupon_code !== undefined ? { coupon_code: rec.coupon_code } : {}),
        description: rec.description,
        score: scoreRecord(rec, candidate),
        source: MOCK_SOURCE,
      }));

    scored.sort(compareMatches); // descending score, then stable deterministic tie-break
    return scored.slice(0, options.maxResults);
  }
}

/** Module-level default instance the route depends on (dependency injection seam). */
export const compareService: CompareService = new MockCouponsRiverAdapter();
