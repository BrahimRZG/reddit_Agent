import type { Context, Next } from 'hono';
import { constantTimeEqual } from '../lib/crypto';
import type { Env } from '../types';

/**
 * Admin authentication middleware.
 * Expects the admin secret in the X-Admin-Secret header.
 */
export async function adminAuthMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const adminSecret = c.req.header('X-Admin-Secret');

  if (!adminSecret) {
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'X-Admin-Secret header is required.' } },
      401
    );
  }

  if (!constantTimeEqual(adminSecret, c.env.ADMIN_BOOTSTRAP_SECRET)) {
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid admin credentials.' } },
      401
    );
  }

  await next();
}
