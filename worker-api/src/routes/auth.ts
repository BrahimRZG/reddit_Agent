import { Hono } from 'hono';
import type { Env, Variables } from '../types';

export const authRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

authRoute.post('/verify', (c) => {
  const installId = c.get('installId');

  return c.json({
    ok: true,
    install_id: installId,
  });
});

authRoute.all('/verify', (c) => {
  return c.json(
    {
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Method not allowed',
      },
    },
    405,
  );
});
