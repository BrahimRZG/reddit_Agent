import { Hono } from 'hono';
import type { AppEnv } from '../types';

export const authRoute = new Hono<AppEnv>();

authRoute.post('/verify', (c) => {
  const installId = c.get('installId');

  return c.json({
    valid: true,
    install_id: installId,
  });
});

authRoute.get('/verify', (c) =>
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
