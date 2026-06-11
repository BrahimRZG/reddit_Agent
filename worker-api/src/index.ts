import { Hono } from 'hono';
import type { AppEnv } from './types';
import { statusRoute } from './routes/status';
import { adminRoute } from './routes/admin';
import { authRoute } from './routes/auth';
import { adminAuthMiddleware } from './middleware/admin-auth';
import { authMiddleware } from './middleware/auth';

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
