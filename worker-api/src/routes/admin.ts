import { Hono } from 'hono';
import type { Env } from '../types';
import { hashToken } from '../lib/crypto';
import { generateRawToken } from '../services/token-service';

const adminRoute = new Hono<{ Bindings: Env }>();

adminRoute.post('/provision-token', async (c) => {
  let notes: string | null = null;
  try {
    const body = await c.req.json<{ notes?: string }>();
    if (body.notes && typeof body.notes === 'string') {
      notes = body.notes.slice(0, 256);
    }
  } catch { /* optional */ }

  const rawToken = generateRawToken();
  const installId = crypto.randomUUID();
  const tokenHash = await hashToken(rawToken, c.env.INSTALL_TOKEN_PEPPER);
  const createdAt = new Date().toISOString();

  try {
    await c.env.DB.prepare(
      'INSERT INTO install_tokens (install_id, token_hash, status, created_at, notes) VALUES (?, ?, ?, ?, ?)'
    ).bind(installId, tokenHash, 'active', createdAt, notes).run();
  } catch {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to provision token.' } }, 500);
  }

  return c.json({ install_id: installId, token: rawToken }, 201);
});

adminRoute.post('/revoke-token', async (c) => {
  let installId: string;
  try {
    const body = await c.req.json<{ install_id?: string }>();
    if (!body.install_id || typeof body.install_id !== 'string') {
      return c.json({ error: { code: 'INSTALL_NOT_FOUND', message: 'install_id is required in the request body.' } }, 404);
    }
    installId = body.install_id;
  } catch {
    return c.json({ error: { code: 'INSTALL_NOT_FOUND', message: 'Invalid request body.' } }, 404);
  }

  const row = await c.env.DB.prepare(
    'SELECT install_id, status, revoked_at FROM install_tokens WHERE install_id = ?'
  ).bind(installId).first<{ install_id: string; status: string; revoked_at: string | null }>();

  if (!row) {
    return c.json({ error: { code: 'INSTALL_NOT_FOUND', message: 'Install ID not found.' } }, 404);
  }

  if (row.status === 'revoked') {
    return c.json({ install_id: installId, status: 'revoked' as const, revoked_at: row.revoked_at! });
  }

  const revokedAt = new Date().toISOString();
  try {
    await c.env.DB.prepare(
      'UPDATE install_tokens SET status = ?, revoked_at = ? WHERE install_id = ?'
    ).bind('revoked', revokedAt, installId).run();
  } catch {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to revoke token.' } }, 500);
  }

  return c.json({ install_id: installId, status: 'revoked' as const, revoked_at: revokedAt });
});

export { adminRoute };
