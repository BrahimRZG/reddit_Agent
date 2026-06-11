import { Hono } from 'hono';
import type { Env } from '../types';

const authRoute = new Hono<{ Bindings: Env }>();

authRoute.post('/verify', (c) => {
  const installId = c.get('installId');
  return c.json({ ok: true, install_id: installId });
});

authRoute.all('/verify', (c) => {
  return c.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST is allowed on this endpoint.' } }, 405);
});

export { authRoute };
