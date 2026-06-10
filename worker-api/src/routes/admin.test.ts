import { describe, expect, it } from 'vitest';
import app from '../index';

const env = {
  ADMIN_BOOTSTRAP_SECRET: 'test-admin-secret',
  INSTALL_TOKEN_PEPPER: 'test-pepper',
  DB: {} as D1Database,
};

describe('POST /v1/admin/provision-token', () => {
  it('returns 401 without X-Admin-Secret header', async () => {
    const res = await app.request('/v1/admin/provision-token', {
      method: 'POST',
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 with invalid admin secret', async () => {
    const res = await app.request(
      '/v1/admin/provision-token',
      {
        method: 'POST',
        headers: { 'X-Admin-Secret': 'wrong-secret' },
      },
      env,
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('reaches handler with valid admin secret and fails closed without DB implementation', async () => {
    const res = await app.request(
      '/v1/admin/provision-token',
      {
        method: 'POST',
        headers: { 'X-Admin-Secret': 'test-admin-secret' },
      },
      env,
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('POST /v1/admin/revoke-token', () => {
  it('returns 401 without X-Admin-Secret header', async () => {
    const res = await app.request('/v1/admin/revoke-token', {
      method: 'POST',
      body: JSON.stringify({ install_id: 'test-id' }),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 with invalid admin secret', async () => {
    const res = await app.request(
      '/v1/admin/revoke-token',
      {
        method: 'POST',
        headers: { 'X-Admin-Secret': 'wrong-secret' },
        body: JSON.stringify({ install_id: 'test-id' }),
      },
      env,
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
