import { describe, it, expect } from 'vitest';
import app from '../index';

describe('POST /v1/auth/verify', () => {
  it('returns 401 MISSING_AUTH_HEADERS without any auth headers', async () => {
    const res = await app.request('/v1/auth/verify', { method: 'POST' });
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('MISSING_AUTH_HEADERS');
  });

  it('returns 401 MISSING_AUTH_HEADERS with partial headers', async () => {
    const res = await app.request('/v1/auth/verify', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer test-token',
        // Missing X-Install-Id, X-Timestamp, X-Nonce
      },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('MISSING_AUTH_HEADERS');
  });

  it('returns 405 METHOD_NOT_ALLOWED for GET', async () => {
    const res = await app.request('/v1/auth/verify', { method: 'GET' });
    expect(res.status).toBe(405);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('METHOD_NOT_ALLOWED');
  });
});

describe('GET /v1/status (remains public)', () => {
  it('returns 200 without any auth headers', async () => {
    const res = await app.request('/v1/status', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.api_version).toBe('v1');
  });

  it('does not require Authorization header', async () => {
    const res = await app.request('/v1/status', { method: 'GET' });
    expect(res.status).toBe(200);
  });

  it('does not expose install-specific data', async () => {
    const res = await app.request('/v1/status', { method: 'GET' });
    const body = (await res.json()) as any;
    expect(body.install_id).toBeUndefined();
    expect(body.token_hash).toBeUndefined();
    expect(body.token).toBeUndefined();
  });
});
