import { Hono } from 'hono';
import type { Env } from './types';
import { statusRoute } from './routes/status';
import { adminRoute } from './routes/admin';
import { authRoute } from './routes/auth';
import { adminAuthMiddleware } from './middleware/admin-auth';
import { authMiddleware } from './middleware/auth';

const app = new Hono<{ Bindings: Env }>();

// Public routes (no auth required)
app.route('/v1', statusRoute);

// Admin routes (protected by ADMIN_BOOTSTRAP_SECRET via X-Admin-Secret header)
app.use('/v1/admin/*', adminAuthMiddleware);
app.route('/v1/admin', adminRoute);

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
