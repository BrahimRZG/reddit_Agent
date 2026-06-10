import type { Context, Next } from 'hono';
import { hashToken, constantTimeEqual } from '../lib/crypto';
import { checkRateLimit } from '../services/rate-limit-service';
import { isNonceUsed, insertNonce, maybeCleanExpiredNonces } from '../services/nonce-service';
import type { Env } from '../types';

/**
 * Bearer-token authentication middleware for protected routes.
 *
 * Validates install token credentials sent via:
 *   - Authorization: Bearer <raw_token>
 *   - X-Install-Id: <install_id>
 *   - X-Timestamp: <iso_8601_string>
 *   - X-Nonce: <uuid_v4>
 *
 * Validation order (fail on first error):
 *   1. Required headers present
 *   2. Bearer token extracted
 *   3. install_id exists in D1
 *   4. install status is 'active'
 *   5. Token hash matches (constant-time)
 *   6. Timestamp within ±5 minutes
 *   7. Rate limit passes
 *   8. Nonce not reused
 *   9. Insert nonce (only after ALL checks pass)
 *  10. Set installId on context, proceed
 *
 * Security:
 *   - Fails closed on all validation errors
 *   - Uses constant-time comparison for token hash
 *   - Never logs raw token, Authorization header, or token_hash
 *   - Returns generic error messages (no internal state leakage)
 *   - Rate limit checked BEFORE nonce insertion (rate-limited requests don't consume nonces)
 */
export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  // Step 1: Check required headers are present
  const authHeader = c.req.header('Authorization');
  const installId = c.req.header('X-Install-Id');
  const timestamp = c.req.header('X-Timestamp');
  const nonce = c.req.header('X-Nonce');

  if (!authHeader || !installId || !timestamp || !nonce) {
    return c.json(
      {
        error: {
          code: 'MISSING_AUTH_HEADERS',
          message: 'Required authentication headers are missing.',
        },
      },
      401
    );
  }

  // Step 2: Extract bearer token from Authorization header
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return c.json(
      {
        error: {
          code: 'MISSING_AUTH_HEADERS',
          message: 'Authorization header must use Bearer scheme.',
        },
      },
      401
    );
  }

  const rawToken = authHeader.slice(7); // Remove "Bearer " prefix (7 chars)
  if (!rawToken) {
    return c.json(
      {
        error: {
          code: 'MISSING_AUTH_HEADERS',
          message: 'Bearer token is empty.',
        },
      },
      401
    );
  }

  // Step 3: Look up install_id in D1
  let row: { token_hash: string; status: string } | null;
  try {
    row = await c.env.DB.prepare(
      'SELECT token_hash, status FROM install_tokens WHERE install_id = ?'
    )
      .bind(installId)
      .first<{ token_hash: string; status: string }>();
  } catch {
    // D1 unavailable — fail closed
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Authentication service unavailable.',
        },
      },
      500
    );
  }

  if (!row) {
    return c.json(
      {
        error: {
          code: 'INSTALL_NOT_FOUND',
          message: 'Install ID not recognized.',
        },
      },
      401
    );
  }

  // Step 4: Check install status is 'active'
  if (row.status === 'revoked') {
    return c.json(
      {
        error: {
          code: 'TOKEN_REVOKED',
          message: 'This install token has been revoked.',
        },
      },
      403
    );
  }

  // Step 5: Hash presented token and compare to stored hash (constant-time)
  let presentedHash: string;
  try {
    presentedHash = await hashToken(rawToken, c.env.INSTALL_TOKEN_PEPPER);
  } catch {
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Authentication service unavailable.',
        },
      },
      500
    );
  }

  if (!constantTimeEqual(presentedHash, row.token_hash)) {
    return c.json(
      {
        error: {
          code: 'INVALID_TOKEN',
          message: 'Token verification failed.',
        },
      },
      401
    );
  }

  // Step 6: Validate timestamp freshness (±5 minutes = ±300,000ms)
  const requestTime = new Date(timestamp).getTime();
  if (isNaN(requestTime)) {
    return c.json(
      {
        error: {
          code: 'TIMESTAMP_EXPIRED',
          message: 'X-Timestamp must be a valid ISO 8601 timestamp.',
        },
      },
      401
    );
  }

  const serverTime = Date.now();
  if (Math.abs(serverTime - requestTime) > 300_000) {
    return c.json(
      {
        error: {
          code: 'TIMESTAMP_EXPIRED',
          message: 'Request timestamp is too far from server time.',
        },
      },
      401
    );
  }

  // Step 7: Rate limit check (evaluated BEFORE nonce insertion)
  const endpoint = new URL(c.req.url).pathname;
  let rateLimitResult;
  try {
    rateLimitResult = await checkRateLimit(c.env.DB, installId, endpoint);
  } catch {
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Rate limit service unavailable.',
        },
      },
      500
    );
  }

  if (!rateLimitResult.allowed) {
    return c.json(
      {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please retry later.',
          retry_after_seconds: rateLimitResult.retryAfterSeconds,
        },
      },
      429
    );
  }

  // Step 8: Check nonce not reused
  let nonceUsed: boolean;
  try {
    nonceUsed = await isNonceUsed(c.env.DB, nonce);
  } catch {
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Nonce service unavailable.',
        },
      },
      500
    );
  }

  if (nonceUsed) {
    return c.json(
      {
        error: {
          code: 'NONCE_REUSED',
          message: 'This nonce has already been used.',
        },
      },
      401
    );
  }

  // Step 9: Insert nonce (only after ALL checks pass)
  try {
    await insertNonce(c.env.DB, nonce, installId);
  } catch {
    // If insert fails (e.g., concurrent request with same nonce hit PK constraint)
    return c.json(
      {
        error: {
          code: 'NONCE_REUSED',
          message: 'This nonce has already been used.',
        },
      },
      401
    );
  }

  // Probabilistically purge old nonces (non-blocking best-effort)
  maybeCleanExpiredNonces(c.env.DB).catch(() => {});

  // Step 10: All checks passed — attach installId to context and proceed
  c.set('installId', installId);

  await next();
}
