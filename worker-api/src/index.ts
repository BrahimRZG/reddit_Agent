import { Hono } from 'hono';
import type { AppEnv } from './types';
import { statusRoute } from './routes/status';
import { adminRoute } from './routes/admin';
import { authRoute } from './routes/auth';
import { adminAuthMiddleware } from './middleware/admin-auth';
import { authMiddleware } from './middleware/auth';
import { compareRoute } from './routes/compare';

const app = new Hono<AppEnv>();

// Public routes (no auth required)
app.route('/v1', statusRoute);

// Admin routes (protected by ADMIN_BOOTSTRAP_SECRET via X-Admin-Secret header)
app.use('/v1/admin/*', adminAuthMiddleware);
app.route('/v1/admin', adminRoute);

// Auth verification route method guard must run before auth middleware.
app.get('/v1/auth/verify', (c) =>
  c.json(
    {
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only POST is allowed on this endpoint.',
      },
    },
    405
  )
);

// Authenticated routes (protected by bearer-token auth middleware)
app.use('/v1/auth/*', authMiddleware);
app.route('/v1/auth', authRoute);

// Compare method guard must run BEFORE auth (mirrors the /v1/auth/verify precedent),
// so any non-POST request returns 405 even when valid auth headers are absent (Req 1.6).
// Non-POST methods are listed explicitly (rather than .all) so POST is NOT shadowed and
// falls through to authMiddleware.
app.on(['GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'], '/v1/compare', (c) =>
  c.json(
    {
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only POST is allowed on this endpoint.',
      },
    },
    405
  )
);

// Protect POST /v1/compare with the EXISTING Spec 02 authMiddleware, reused UNCHANGED (Req 6.1).
app.use('/v1/compare', authMiddleware);

// Mount the compare POST handler; it runs only AFTER authMiddleware passes (Req 6.3, 6.4).
app.route('/v1', compareRoute);

// 404 catch-all
app.notFound((c) => {
  return c.json({ error: { code: 'NOT_FOUND', message: 'The requested resource was not found.' } }, 404);
});

// Global error handler
app.onError((err, c) => {
  console.error('[Worker API] Unhandled error:', err.message);
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } }, 500);
});

export default app;
