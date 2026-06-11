import { Hono } from 'hono';

const app = new Hono();

const statusPayload = {
  ok: true,
  api_version: 'v1',
  minimum_extension_version: '1.0.0',
  scanner_enabled: false,
  drafting_enabled: false,
  compare_enabled: false,
  promotional_modes_enabled: false,
};

const methodNotAllowedPayload = {
  error: {
    code: 'METHOD_NOT_ALLOWED',
    message: 'Only GET is allowed on this endpoint.',
  },
};

app.get('/v1/status', (c) => c.json(statusPayload));

app.post('/v1/status', (c) => c.json(methodNotAllowedPayload, 405));
app.put('/v1/status', (c) => c.json(methodNotAllowedPayload, 405));
app.delete('/v1/status', (c) => c.json(methodNotAllowedPayload, 405));
app.patch('/v1/status', (c) => c.json(methodNotAllowedPayload, 405));

app.notFound((c) =>
  c.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
      },
    },
    404
  )
);

app.onError((err, c) => {
  console.error('[Worker API] Unhandled error:', err.message);

  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An internal error occurred.',
      },
    },
    500
  );
});

export default app;
