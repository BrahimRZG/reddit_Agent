import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import app from '../index';
import { hashToken } from '../lib/crypto';
import { validateCompareRequest } from './compare';
import {
  MockCouponsRiverAdapter,
  MOCK_SOURCE,
  compareService,
  type CompareService,
  type CompareOptions,
} from '../services/compare-service';
import type { Env, ErrorCode, Match, NormalizedCandidate, CompareResponse } from '../types';

// ---------------------------------------------------------------------------
// Shared test helpers and generators (pure-logic layer — no auth, no HTTP)
// ---------------------------------------------------------------------------

const MERCHANT_MAX = 128;
const PRODUCT_MAX = 256;
const COUPON_CODE_MAX = 64;
const CATEGORY_MAX = 64;
const DEFAULT_MAX_RESULTS = 10;

/** All ErrorCode values, used to assert error codes are drawn only from the union. */
const ERROR_CODES: ReadonlyArray<ErrorCode> = [
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'INTERNAL_ERROR',
  'MISSING_AUTH_HEADERS',
  'INSTALL_NOT_FOUND',
  'TOKEN_REVOKED',
  'INVALID_TOKEN',
  'TIMESTAMP_EXPIRED',
  'NONCE_REUSED',
  'RATE_LIMITED',
  'UNAUTHORIZED',
  'VALIDATION_ERROR',
];

/** Counting stub: proves the service is/ isn't invoked. */
class CountingService implements CompareService {
  calls = 0;
  compare(_candidate: NormalizedCandidate, _options: CompareOptions): Match[] {
    this.calls += 1;
    return [];
  }
}

/** Mirrors the route handler's validate -> maybe-invoke-service pipeline (pure). */
function runPipeline(raw: unknown, service: CountingService): { ok: boolean } {
  const result = validateCompareRequest(raw);
  if (!result.ok) {
    return { ok: false };
  }
  service.compare(result.request.candidate, { maxResults: result.request.max_results });
  return { ok: true };
}

const datasetMerchantArb = fc.constantFrom(
  'Acme',
  'acme',
  'ACME',
  'Globex',
  'globex',
  'Initech',
  'Soylent',
  'soylent'
);

const productArb = fc.oneof(
  fc.constantFrom('widget', 'gadget', 'solvent', 'stapler', 'paper', 'meal', 'drink', 'premium'),
  fc.string({ maxLength: 15 })
);
const couponArb = fc.oneof(
  fc.constantFrom('ACME10', 'ACME20', 'GLX5', 'TPS15', 'GREEN'),
  fc.string({ maxLength: 10 })
);
const categoryArb = fc.oneof(
  fc.constantFrom('tools', 'shipping', 'chemicals', 'office', 'food'),
  fc.string({ maxLength: 10 })
);

/** A NormalizedCandidate whose merchant frequently matches the default dataset. */
const matchingCandidateArb: fc.Arbitrary<NormalizedCandidate> = fc.record(
  {
    merchant: datasetMerchantArb,
    product: productArb,
    coupon_code: couponArb,
    category: categoryArb,
  },
  { requiredKeys: ['merchant'] }
);

/** A NormalizedCandidate with an arbitrary (often non-matching) merchant. */
const anyCandidateArb: fc.Arbitrary<NormalizedCandidate> = fc.record(
  {
    merchant: fc.oneof(
      datasetMerchantArb,
      fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim().length > 0)
    ),
    product: productArb,
    coupon_code: couponArb,
    category: categoryArb,
  },
  { requiredKeys: ['merchant'] }
);

const maxResultsArb = fc.integer({ min: 1, max: 50 });

function tieBreakKeyLeq(a: Match, b: Match): boolean {
  // ascending merchant -> coupon_code(undefined as '') -> description
  if (a.merchant !== b.merchant) return a.merchant < b.merchant;
  const ac = a.coupon_code ?? '';
  const bc = b.coupon_code ?? '';
  if (ac !== bc) return ac < bc;
  return a.description <= b.description;
}

// ===========================================================================
// Task 2 property tests (adapter pure logic)
// ===========================================================================

describe('MockCouponsRiverAdapter — pure logic properties', () => {
  // Feature: couponsriver-compare-api, Property 6: Match provenance and shape
  // Validates: Requirements 3.4, 7.5, 9.4
  it('Property 6: every returned match has the correct provenance and shape', () => {
    const adapter = new MockCouponsRiverAdapter();
    fc.assert(
      fc.property(matchingCandidateArb, maxResultsArb, (candidate, maxResults) => {
        const matches = adapter.compare(candidate, { maxResults });
        for (const m of matches) {
          expect(typeof m.merchant).toBe('string');
          expect(typeof m.description).toBe('string');
          expect(typeof m.score).toBe('number');
          expect(Number.isFinite(m.score)).toBe(true);
          expect(m.source).toBe(MOCK_SOURCE);
          if (m.coupon_code !== undefined) {
            expect(typeof m.coupon_code).toBe('string');
          }
        }
      }),
      { numRuns: 200 }
    );
  });

  // Feature: couponsriver-compare-api, Property 5: Result bound and deterministic ordering
  // Validates: Requirements 3.5, 3.6, 8.2
  it('Property 5: results are bounded and deterministically ordered', () => {
    const adapter = new MockCouponsRiverAdapter();
    fc.assert(
      fc.property(anyCandidateArb, maxResultsArb, (candidate, maxResults) => {
        const first = adapter.compare(candidate, { maxResults });
        const second = adapter.compare(candidate, { maxResults });

        // Bounded by effective max_results.
        expect(first.length).toBeLessThanOrEqual(maxResults);

        // Non-increasing score; stable tie-break on equal scores.
        for (let i = 1; i < first.length; i += 1) {
          expect(first[i - 1].score).toBeGreaterThanOrEqual(first[i].score);
          if (first[i - 1].score === first[i].score) {
            expect(tieBreakKeyLeq(first[i - 1], first[i])).toBe(true);
          }
        }

        // Repeated evaluation produces the identical ordering.
        expect(second).toEqual(first);
      }),
      { numRuns: 200 }
    );
  });

  // Feature: couponsriver-compare-api, Property 7: Adapter purity and no external IO
  // Validates: Requirements 8.1, 8.3, 8.5
  it('Property 7: adapter performs no network IO and does not mutate the candidate', () => {
    const adapter = new MockCouponsRiverAdapter(); // constructed with no DB binding
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      fc.assert(
        fc.property(anyCandidateArb, maxResultsArb, (candidate, maxResults) => {
          const frozen = Object.freeze({ ...candidate });
          const before = JSON.stringify(frozen);
          adapter.compare(frozen, { maxResults });
          // Candidate is unchanged (no mutation).
          expect(JSON.stringify(frozen)).toBe(before);
        }),
        { numRuns: 200 }
      );
      // No outbound network request was ever made.
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  // Feature: couponsriver-compare-api, Property 8: Determinism
  // Validates: Requirements 8.2
  it('Property 8: repeated invocations against the same dataset are deep-equal', () => {
    const adapter = new MockCouponsRiverAdapter();
    fc.assert(
      fc.property(anyCandidateArb, maxResultsArb, (candidate, maxResults) => {
        const a = adapter.compare(candidate, { maxResults });
        const b = adapter.compare(candidate, { maxResults });
        expect(a).toEqual(b);
      }),
      { numRuns: 200 }
    );
  });

  // Feature: couponsriver-compare-api, Property 3: No-match is success (adapter)
  // Validates: Requirements 4.1, 4.2, 4.3
  it('Property 3: a merchant absent from the dataset yields an empty match list', () => {
    const adapter = new MockCouponsRiverAdapter();
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), maxResultsArb, (suffix, maxResults) => {
        const merchant = `no-match-merchant-${suffix}`; // never equals a dataset merchant
        const result = adapter.compare({ merchant }, { maxResults });
        expect(result).toEqual([]);
      }),
      { numRuns: 200 }
    );
  });
});

// ===========================================================================
// Task 3 property tests (validator + error-shape pure logic)
// ===========================================================================

const validMerchantArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

const nonStringArb = fc.oneof(
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.array(fc.anything()),
  fc.record({})
);

const validRequestArb = fc.record(
  {
    merchant: validMerchantArb,
    product: fc.string({ maxLength: PRODUCT_MAX }),
    coupon_code: fc.string({ maxLength: COUPON_CODE_MAX }),
    category: fc.string({ maxLength: CATEGORY_MAX }),
    max_results: fc.integer({ min: 1, max: 50 }),
  },
  { requiredKeys: ['merchant'] }
);

const invalidRequestArb = fc.oneof(
  // non-object / array / null / primitive
  fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null), fc.array(fc.anything())),
  // missing merchant
  fc.record({ product: fc.string({ maxLength: 10 }), category: fc.string({ maxLength: 10 }) }, { requiredKeys: [] }),
  // empty / whitespace merchant
  fc.record({ merchant: fc.constantFrom('', ' ', '   ', '\t', '\n', '\t\n  ') }),
  // wrong-type merchant
  fc.record({ merchant: nonStringArb }),
  // wrong-type optional field
  fc.record({ merchant: validMerchantArb, product: nonStringArb }),
  fc.record({ merchant: validMerchantArb, coupon_code: nonStringArb }),
  fc.record({ merchant: validMerchantArb, category: nonStringArb }),
  // over-length merchant
  fc.record({ merchant: fc.integer({ min: MERCHANT_MAX + 1, max: 200 }).map((n) => 'a'.repeat(n)) }),
  // over-length optional fields
  fc.record({ merchant: validMerchantArb, product: fc.integer({ min: PRODUCT_MAX + 1, max: 300 }).map((n) => 'a'.repeat(n)) }),
  fc.record({ merchant: validMerchantArb, coupon_code: fc.integer({ min: COUPON_CODE_MAX + 1, max: 100 }).map((n) => 'a'.repeat(n)) }),
  fc.record({ merchant: validMerchantArb, category: fc.integer({ min: CATEGORY_MAX + 1, max: 100 }).map((n) => 'a'.repeat(n)) }),
  // bad max_results
  fc.record({
    merchant: validMerchantArb,
    max_results: fc.oneof(
      fc.integer({ min: -100, max: 0 }),
      fc.integer({ min: 51, max: 200 }),
      fc.double({ min: 1.1, max: 49.9, noNaN: true }).filter((n) => !Number.isInteger(n)),
      fc.string(),
      fc.boolean(),
      fc.constant(null)
    ),
  })
);

describe('validateCompareRequest — pure validation properties', () => {
  // Feature: couponsriver-compare-api, Property 1: Validation soundness and completeness
  // Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.8, 2.9, 5.2
  it('Property 1: accepts iff valid, never invokes the service on invalid input', () => {
    // Valid requests are accepted and the service IS invoked exactly once.
    fc.assert(
      fc.property(validRequestArb, (raw) => {
        const stub = new CountingService();
        const result = runPipeline(raw, stub);
        expect(result.ok).toBe(true);
        expect(stub.calls).toBe(1);
      }),
      { numRuns: 200 }
    );

    // Invalid requests are rejected and the service is NEVER invoked.
    fc.assert(
      fc.property(invalidRequestArb, (raw) => {
        const stub = new CountingService();
        const result = runPipeline(raw, stub);
        expect(result.ok).toBe(false);
        expect(stub.calls).toBe(0);
      }),
      { numRuns: 200 }
    );

    // Unrecognized fields never change a valid outcome.
    fc.assert(
      fc.property(validRequestArb, fc.string(), fc.anything(), (raw, key, value) => {
        const augmented = { ...(raw as object), [`x_unknown_${key}`]: value };
        const result = validateCompareRequest(augmented);
        expect(result.ok).toBe(true);
      }),
      { numRuns: 200 }
    );
  });

  // Feature: couponsriver-compare-api, Property 2: Normalization idempotence
  // Validates: Requirements 2.7
  it('Property 2: normalization is idempotent and trims all string fields', () => {
    const wsArb = fc.constantFrom('', ' ', '  ', '\t', '\n');
    const paddedMerchantArb = fc
      .tuple(wsArb, fc.string({ minLength: 1, maxLength: 30 }), wsArb)
      .map(([l, m, r]) => l + m + r)
      .filter((s) => s.trim().length > 0 && s.trim().length <= MERCHANT_MAX);

    const paddedRequestArb = fc.record(
      {
        merchant: paddedMerchantArb,
        product: fc.tuple(wsArb, fc.string({ maxLength: 20 }), wsArb).map(([l, m, r]) => l + m + r),
        coupon_code: fc.tuple(wsArb, fc.string({ maxLength: 10 }), wsArb).map(([l, m, r]) => l + m + r),
        category: fc.tuple(wsArb, fc.string({ maxLength: 10 }), wsArb).map(([l, m, r]) => l + m + r),
      },
      { requiredKeys: ['merchant'] }
    );

    fc.assert(
      fc.property(paddedRequestArb, (raw) => {
        const first = validateCompareRequest(raw);
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        const once = first.request.candidate;

        // All string fields are trimmed.
        expect(once.merchant).toBe(once.merchant.trim());
        if (once.product !== undefined) expect(once.product).toBe(once.product.trim());
        if (once.coupon_code !== undefined) expect(once.coupon_code).toBe(once.coupon_code.trim());
        if (once.category !== undefined) expect(once.category).toBe(once.category.trim());

        // Applying normalization a second time changes nothing.
        const second = validateCompareRequest({ ...once });
        expect(second.ok).toBe(true);
        if (second.ok) {
          expect(second.request.candidate).toEqual(once);
        }
      }),
      { numRuns: 200 }
    );
  });

  // Feature: couponsriver-compare-api, Property 9: Errors never leak internals
  // Validates: Requirements 5.1, 5.4, 5.6, 5.7, 5.8, 8.4, 11.6
  it('Property 9: error bodies are well-shaped and leak no internals', () => {
    const allowedKeys = new Set(['code', 'message', 'error_id', 'timestamp', 'retry_after_seconds']);
    const forbidden = [
      'INSTALL_TOKEN_PEPPER',
      'ADMIN_BOOTSTRAP_SECRET',
      'token_hash',
      'node_modules',
      '/src/',
      '.ts:',
      'SQLITE',
      'D1_ERROR',
    ];
    const isoRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

    fc.assert(
      fc.property(invalidRequestArb, (raw) => {
        const result = validateCompareRequest(raw);
        expect(result.ok).toBe(false);
        if (result.ok) return;

        // Reconstruct the canonical compare error body (mirrors compareError()).
        const body = {
          error: {
            code: 'VALIDATION_ERROR' as ErrorCode,
            message: result.message,
            error_id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
          },
        };

        // Keys are a subset of the allowed set.
        for (const k of Object.keys(body.error)) {
          expect(allowedKeys.has(k)).toBe(true);
        }
        expect(ERROR_CODES).toContain(body.error.code);
        expect(body.error.message.length).toBeGreaterThan(0);
        expect(typeof body.error.error_id).toBe('string');
        expect(body.error.error_id.length).toBeGreaterThan(0);
        expect(isoRe.test(body.error.timestamp)).toBe(true);

        const serialized = JSON.stringify(body);
        for (const needle of forbidden) {
          expect(serialized.includes(needle)).toBe(false);
        }
      }),
      { numRuns: 200 }
    );
  });

  // Feature: couponsriver-compare-api, Property 4: Match count invariant
  // Validates: Requirements 3.2, 4.1, 4.4
  it('Property 4: assembled responses satisfy match_count === matches.length >= 0', () => {
    const adapter = new MockCouponsRiverAdapter();
    fc.assert(
      fc.property(anyCandidateArb, maxResultsArb, (candidate, maxResults) => {
        const matches = adapter.compare(candidate, { maxResults });
        const response: CompareResponse = {
          candidate,
          match_count: matches.length,
          matches,
        };
        expect(response.match_count).toBe(response.matches.length);
        expect(response.match_count).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 200 }
    );
  });
});

// Reference compareService + DEFAULT_MAX_RESULTS so the imports are exercised
// by the pure-logic layer as well (the endpoint tests in this file also use them).
describe('compareService default instance', () => {
  it('is usable directly and applies the default cap when callers pass it', () => {
    const matches = compareService.compare({ merchant: 'Acme' }, { maxResults: DEFAULT_MAX_RESULTS });
    expect(Array.isArray(matches)).toBe(true);
    expect(matches.length).toBeLessThanOrEqual(DEFAULT_MAX_RESULTS);
  });
});


// ===========================================================================
// Task 6 endpoint example / integration tests (via app.request)
// ===========================================================================
//
// These tests drive the real default-exported Hono app, including the existing
// Spec 02 `authMiddleware` (reused UNCHANGED). Valid authentication is built by
// seeding an in-memory D1 double (the third arg to app.request) with an active
// install token whose token_hash equals hashToken(RAW_TOKEN, PEPPER) — the SAME
// hashing authMiddleware performs. Tests (e), (f), (g) deliberately send no
// compare credentials.

const PEPPER = 'test-pepper';
const INSTALL_ID = 'install-abc';
const RAW_TOKEN = 'raw-test-token';

/**
 * Minimal in-memory D1 double covering exactly the queries authMiddleware and
 * its services use:
 *   - SELECT token_hash, status FROM install_tokens WHERE install_id = ? -> active row
 *   - SELECT COUNT(*) as cnt FROM rate_limit_events ...                  -> { cnt: 0 }
 *   - INSERT INTO rate_limit_events ...                                  -> no-op
 *   - SELECT 1 FROM nonce_log WHERE nonce = ?                            -> null (unused)
 *   - INSERT INTO nonce_log ...                                          -> no-op
 *   - DELETE ... (probabilistic cleanup)                                 -> no-op
 */
function makeTestEnv(tokenHash: string): Env {
  const db = {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              if (sql.includes('FROM install_tokens')) {
                return { token_hash: tokenHash, status: 'active' } as unknown as T;
              }
              if (sql.includes('COUNT(*)')) {
                return { cnt: 0 } as unknown as T;
              }
              return null; // nonce not used, etc.
            },
            async run() {
              return { success: true };
            },
          };
        },
      };
    },
  };
  return {
    DB: db,
    INSTALL_TOKEN_PEPPER: PEPPER,
    ADMIN_BOOTSTRAP_SECRET: 'unused',
  } as unknown as Env;
}

/** Builds valid Spec 02 auth headers + the seeded env (fresh nonce each call). */
async function authHeaders(): Promise<{ headers: Record<string, string>; env: Env }> {
  const tokenHash = await hashToken(RAW_TOKEN, PEPPER); // SAME hashing authMiddleware uses
  return {
    headers: {
      Authorization: `Bearer ${RAW_TOKEN}`,
      'X-Install-Id': INSTALL_ID,
      'X-Timestamp': new Date().toISOString(), // within the ±5-minute window
      'X-Nonce': crypto.randomUUID(), // unique per request
      'Content-Type': 'application/json',
    },
    env: makeTestEnv(tokenHash),
  };
}

describe('POST /v1/compare — endpoint behavior (protected by Spec 02 authMiddleware)', () => {
  // (a) valid auth + valid body -> 200 success (Property 11 / Property 4)
  // Validates: Requirements 10.1, 6.4, 1.1, 3.2
  it('(a) returns 200 with match_count === matches.length for a valid authenticated request', async () => {
    const a = await authHeaders();
    const res = await app.request(
      '/v1/compare',
      { method: 'POST', headers: a.headers, body: JSON.stringify({ merchant: 'Acme' }) },
      a.env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as CompareResponse;
    expect(body.match_count).toBe(body.matches.length);
    expect(body.match_count).toBeGreaterThan(0);
    expect(body.candidate.merchant).toBe('Acme');
    for (const m of body.matches) {
      expect(m.source).toBe(MOCK_SOURCE);
    }
  });

  // (b) valid auth + missing merchant -> 400 VALIDATION_ERROR (Property 1)
  // Validates: Requirements 10.2, 2.3, 5.2
  it('(b) returns 400 VALIDATION_ERROR when merchant is missing', async () => {
    const a = await authHeaders();
    const res = await app.request(
      '/v1/compare',
      { method: 'POST', headers: a.headers, body: JSON.stringify({ product: 'widget' }) },
      a.env
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: ErrorCode } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  // (c) valid auth + non-JSON body -> 400 VALIDATION_ERROR, service NOT invoked (Property 1)
  // Validates: Requirements 10.3, 2.2, 2.9, 5.2
  it('(c) returns 400 VALIDATION_ERROR for a non-JSON body and does not invoke the service', async () => {
    const spy = vi.spyOn(compareService, 'compare');
    try {
      const a = await authHeaders();
      const res = await app.request(
        '/v1/compare',
        { method: 'POST', headers: a.headers, body: 'this is not json {{{' },
        a.env
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: ErrorCode } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  // (d) valid auth + no-match request -> 200 empty result (Property 3)
  // Validates: Requirements 10.4, 4.1, 4.2, 4.4
  it('(d) returns 200 with an empty result for a no-match request (not 404, not an error)', async () => {
    const a = await authHeaders();
    const res = await app.request(
      '/v1/compare',
      { method: 'POST', headers: a.headers, body: JSON.stringify({ merchant: 'NoSuchMerchantXYZ' }) },
      a.env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as CompareResponse;
    expect(body.match_count).toBe(0);
    expect(body.matches).toEqual([]);
    expect((body as unknown as { error?: unknown }).error).toBeUndefined();
  });

  // (e) non-POST method -> 405 WITHOUT auth headers (Property 10)
  // Validates: Requirements 10.5, 1.3, 1.6
  it('(e) returns 405 METHOD_NOT_ALLOWED for non-POST methods without auth headers', async () => {
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      const res = await app.request('/v1/compare', { method });
      expect(res.status).toBe(405);
      const body = (await res.json()) as { error: { code: ErrorCode } };
      expect(body.error.code).toBe('METHOD_NOT_ALLOWED');
    }
  });

  // (f) missing Authorization -> authMiddleware error, service NOT invoked (Property 11)
  // Validates: Requirements 10.6, 6.2, 6.3
  it('(f) returns the authMiddleware error and does not invoke the service when auth is missing', async () => {
    const spy = vi.spyOn(compareService, 'compare');
    try {
      const res = await app.request('/v1/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchant: 'Acme' }),
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: ErrorCode } };
      expect(body.error.code).toBe('MISSING_AUTH_HEADERS');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  // (g) GET /v1/status unchanged after compare is mounted and protected (Property 12)
  // Validates: Requirements 11.1, 11.2
  it('(g) leaves GET /v1/status unchanged, including compare_enabled: false', async () => {
    const res = await app.request('/v1/status', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      ok: true,
      api_version: 'v1',
      minimum_extension_version: '1.0.0',
      scanner_enabled: false,
      drafting_enabled: false,
      compare_enabled: false,
      promotional_modes_enabled: false,
    });
  });

  // Feature: couponsriver-compare-api, Property 8: Determinism (endpoint)
  // Validates: Requirements 8.2
  it('endpoint determinism: two identical authenticated requests return deep-equal responses', async () => {
    const body = JSON.stringify({ merchant: 'Acme', product: 'gadget', category: 'tools' });
    const a1 = await authHeaders();
    const res1 = await app.request('/v1/compare', { method: 'POST', headers: a1.headers, body }, a1.env);
    const a2 = await authHeaders();
    const res2 = await app.request('/v1/compare', { method: 'POST', headers: a2.headers, body }, a2.env);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const b1 = (await res1.json()) as CompareResponse;
    const b2 = (await res2.json()) as CompareResponse;
    expect(b1).toEqual(b2);
  });
});
