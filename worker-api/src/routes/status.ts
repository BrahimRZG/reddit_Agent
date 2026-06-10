import { Hono } from 'hono';
import type { StatusResponse } from '../types';

const statusRoute = new Hono();

// GET /v1/status — public health-check endpoint (unauthenticated in Spec 01)
statusRoute.get('/status', (c) => {
  const response: StatusResponse = {
    ok: true,
    api_version: 'v1',
    minimum_extension_version: '1.0.0',
    scanner_enabled: false,
    drafting_enabled: false,
    compare_enabled: false,
    promotional_modes_enabled: false,
  };
  return c.json(response);
});

// 405 for non-GET methods on /status
statusRoute.all('/status', (c) => {
  return c.json(
    {
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only GET is allowed on this endpoint.',
      },
    },
    405
  );
});

export { statusRoute };
