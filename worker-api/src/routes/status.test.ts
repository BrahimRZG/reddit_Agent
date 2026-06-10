import { describe, it, expect } from 'vitest';
import app from '../index';

describe('GET /v1/status', () => {
  it('returns 200 with exact status JSON', async () => {
    const res = await app.request('/v1/status', { method: 'GET' });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      api_version: 'v1',
      minimum_extension_version: '1.0.0',
      scanner_enabled: false,
      drafting_enabled: false,
      compare_enabled: false,
      promotional_modes_enabled: false,
    });
  });

  it('returns 405 METHOD_NOT_ALLOWED for POST', async () => {
    const res = await app.request('/v1/status', { method: 'POST' });
    expect(res.status).toBe(405);

    const body = await res.json();
    expect(body).toEqual({
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only GET is allowed on this endpoint.',
      },
    });
  });

  it('returns 405 METHOD_NOT_ALLOWED for PUT', async () => {
    const res = await app.request('/v1/status', { method: 'PUT' });
    expect(res.status).toBe(405);
  });

  it('returns 405 METHOD_NOT_ALLOWED for DELETE', async () => {
    const res = await app.request('/v1/status', { method: 'DELETE' });
    expect(res.status).toBe(405);
  });

  it('returns 405 METHOD_NOT_ALLOWED for PATCH', async () => {
    const res = await app.request('/v1/status', { method: 'PATCH' });
    expect(res.status).toBe(405);
  });
});

describe('Unknown routes', () => {
  it('returns 404 NOT_FOUND for unknown path', async () => {
    const res = await app.request('/v1/unknown', { method: 'GET' });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
      },
    });
  });

  it('returns 404 NOT_FOUND for root path', async () => {
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(404);
  });

  it('returns 404 NOT_FOUND for /v2/status', async () => {
    const res = await app.request('/v2/status', { method: 'GET' });
    expect(res.status).toBe(404);
  });
});
