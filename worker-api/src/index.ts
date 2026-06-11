import { Hono } from 'hono';
import { statusRoute } from './routes/status';

const app = new Hono();

app.use('*', async (c, next) => {
  await next();

  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Accept');
});

app.options('*', (c) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Accept');

  return c.body(null, 204);
});

// Mount versioned routes
app.route('/v1', statusRoute);

// TODO: Spec 02 - Worker Auth & Token Lifecycle — Add auth middleware here

// 404 catch-all
app.notFound((c) => {
  return c.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
      },
    },
    404
  );
});

// Global error handler
app.onError((err, c) => {
  console.error('[Worker API] Unhandled error:', err.message);

  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
      },
    },
    500
  );
});

export default app;
