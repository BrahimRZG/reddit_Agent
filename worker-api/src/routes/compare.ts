/**
 * Compare route for the CouponsRiver Compare API foundation (Spec 04).
 *
 * Exposes `POST /compare` (mounted under `/v1`, protected in `index.ts` by the
 * existing Spec 02 `authMiddleware`). Contains:
 *   - `validateCompareRequest`: a PURE validator/normalizer (no I/O, no throw).
 *   - `compareError`: a safe ErrorResponse builder with optional debug metadata.
 *   - `compareRoute`: the Hono sub-app with the POST handler and a self-contained
 *     405 method-guard fallback.
 *
 * The route depends only on the `CompareService` interface (via the module-level
 * `compareService` instance) — never on the concrete adapter.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type {
  AppEnv,
  ErrorCode,
  ErrorResponse,
  CompareResponse,
  NormalizedCandidate,
  NormalizedCompareRequest,
} from '../types';
import { compareService } from '../services/compare-service';

// --- Validation bounds (Requirement 2) ---
const MERCHANT_MAX = 128;
const PRODUCT_MAX = 256;
const COUPON_CODE_MAX = 64;
const CATEGORY_MAX = 64;
const MAX_RESULTS_MIN = 1;
const MAX_RESULTS_MAX = 50;
const DEFAULT_MAX_RESULTS = 10; // effective cap applied when max_results is omitted

/** Result of validating + normalizing a raw compare request body. */
export type ValidationResult =
  | { ok: true; request: NormalizedCompareRequest }
  | { ok: false; message: string };

type OptionalStringResult =
  | { ok: true; value: string | undefined }
  | { ok: false; message: string };

/**
 * Validates an optional string candidate field. Omitted (undefined) fields stay
 * omitted; present fields must be strings and are trimmed and length-bounded.
 */
function validateOptionalString(
  input: unknown,
  max: number,
  field: string
): OptionalStringResult {
  if (input === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof input !== 'string') {
    return { ok: false, message: `${field} must be a string.` };
  }
  const trimmed = input.trim();
  if (trimmed.length > max) {
    return { ok: false, message: `${field} exceeds the maximum allowed length.` };
  }
  return { ok: true, value: trimmed };
}

/**
 * PURE validation + normalization. No I/O, no throwing on bad input (errors are
 * returned as data). Unrecognized fields are ignored. Trimming is idempotent, so
 * normalizing an already-normalized candidate changes nothing (Property 2).
 */
export function validateCompareRequest(raw: unknown): ValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, message: 'Request body must be a JSON object.' };
  }

  const obj = raw as Record<string, unknown>;

  // merchant: required, non-empty string after trim, bounded length.
  const merchantRaw = obj.merchant;
  if (typeof merchantRaw !== 'string') {
    return { ok: false, message: 'merchant is required and must be a non-empty string.' };
  }
  const merchant = merchantRaw.trim();
  if (merchant.length === 0) {
    return { ok: false, message: 'merchant is required and must be a non-empty string.' };
  }
  if (merchant.length > MERCHANT_MAX) {
    return { ok: false, message: 'merchant exceeds the maximum allowed length.' };
  }

  // Optional string fields.
  const productResult = validateOptionalString(obj.product, PRODUCT_MAX, 'product');
  if (!productResult.ok) {
    return productResult;
  }
  const couponResult = validateOptionalString(obj.coupon_code, COUPON_CODE_MAX, 'coupon_code');
  if (!couponResult.ok) {
    return couponResult;
  }
  const categoryResult = validateOptionalString(obj.category, CATEGORY_MAX, 'category');
  if (!categoryResult.ok) {
    return categoryResult;
  }

  // max_results: optional integer in [1, 50]; default applied when omitted.
  const maxResultsRaw = obj.max_results;
  let maxResults: number;
  if (maxResultsRaw === undefined) {
    maxResults = DEFAULT_MAX_RESULTS;
  } else if (
    typeof maxResultsRaw !== 'number' ||
    !Number.isInteger(maxResultsRaw) ||
    maxResultsRaw < MAX_RESULTS_MIN ||
    maxResultsRaw > MAX_RESULTS_MAX
  ) {
    return { ok: false, message: 'max_results must be an integer between 1 and 50.' };
  } else {
    maxResults = maxResultsRaw;
  }

  const candidate: NormalizedCandidate = { merchant };
  if (productResult.value !== undefined) {
    candidate.product = productResult.value;
  }
  if (couponResult.value !== undefined) {
    candidate.coupon_code = couponResult.value;
  }
  if (categoryResult.value !== undefined) {
    candidate.category = categoryResult.value;
  }

  return { ok: true, request: { candidate, max_results: maxResults } };
}

/**
 * Builds a safe compare ErrorResponse body with optional debug metadata.
 * `error_id` is an opaque random UUID (NOT derived from any secret) and
 * `timestamp` is an ISO 8601 string. No exception object, stack trace, file
 * path, env value, secret, DB/SQL text, upstream raw response, adapter internal,
 * or auth token is ever interpolated (Requirement 5.4, 5.7; Property 9).
 */
function compareError(
  c: Context<AppEnv>,
  status: 400 | 500,
  code: ErrorCode,
  message: string
): Response {
  const body: ErrorResponse = {
    error: {
      code,
      message,
      error_id: crypto.randomUUID(), // opaque, NOT derived from any secret
      timestamp: new Date().toISOString(),
    },
  };
  return c.json(body, status);
}

const compareRoute = new Hono<AppEnv>();

// Runs ONLY after the non-POST method guard and authMiddleware (both registered
// in index.ts) have passed. authMiddleware has already validated Spec 02
// credentials and called c.set('installId', ...). The handler MAY read
// c.get('installId') for diagnostics but MUST NOT change how it is set, and
// installId is never included in the CompareResponse.
compareRoute.post('/compare', async (c) => {
  try {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return compareError(c, 400, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
    }

    const result = validateCompareRequest(raw);
    if (!result.ok) {
      return compareError(c, 400, 'VALIDATION_ERROR', result.message);
    }

    const matches = compareService.compare(result.request.candidate, {
      maxResults: result.request.max_results,
    });

    const response: CompareResponse = {
      candidate: result.request.candidate,
      match_count: matches.length,
      matches,
    };
    return c.json(response, 200);
  } catch {
    // Defensive: compare logic is pure/deterministic and should not throw,
    // but never leak internals if it does.
    return compareError(c, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  }
});

// Non-POST methods on /v1/compare -> 405. The AUTHORITATIVE method guard lives in
// index.ts and is registered BEFORE app.use('/v1/compare', authMiddleware) so a
// non-POST request is rejected without auth (Req 1.6). This in-sub-app guard
// remains as a self-contained fallback (e.g. when compareRoute is mounted/tested
// in isolation) and uses the plain ErrorResponse shape (debug fields are optional),
// consistent with the existing auth.ts / status.ts guards.
compareRoute.all('/compare', (c) =>
  c.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST is allowed on this endpoint.' } },
    405
  )
);

export { compareRoute };
