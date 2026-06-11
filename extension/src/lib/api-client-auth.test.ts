import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authenticatedFetch, verifyAuth } from './api-client';

// Mock credential-storage
vi.mock('./credential-storage', () => ({
  getCredentials: vi.fn(),
}));

import { getCredentials } from './credential-storage';
const mockGetCredentials = vi.mocked(getCredentials);

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock crypto.randomUUID
vi.stubGlobal('crypto', {
  randomUUID: () => '00000000-0000-4000-8000-000000000000',
});

describe('authenticatedFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when no credentials configured', async () => {
    mockGetCredentials.mockResolvedValue(null);
    await expect(authenticatedFetch('https://api.test', '/v1/auth/verify'))
      .rejects.toThrow('No credentials configured');
  });

  it('attaches Authorization Bearer header', async () => {
    mockGetCredentials.mockResolvedValue({ installId: 'id-1', installToken: 'tok-1' });
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    await authenticatedFetch('https://api.test', '/v1/auth/verify');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.test/v1/auth/verify',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer tok-1',
        }),
      })
    );
  });

  it('attaches X-Install-Id header', async () => {
    mockGetCredentials.mockResolvedValue({ installId: 'my-install', installToken: 'tok' });
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    await authenticatedFetch('https://api.test', '/path');

    const callHeaders = mockFetch.mock.calls[0][1].headers;
    expect(callHeaders['X-Install-Id']).toBe('my-install');
  });

  it('attaches X-Timestamp as ISO string', async () => {
    mockGetCredentials.mockResolvedValue({ installId: 'id', installToken: 'tok' });
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    await authenticatedFetch('https://api.test', '/path');

    const callHeaders = mockFetch.mock.calls[0][1].headers;
    const ts = callHeaders['X-Timestamp'];
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO format
  });

  it('attaches X-Nonce as UUID', async () => {
    mockGetCredentials.mockResolvedValue({ installId: 'id', installToken: 'tok' });
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    await authenticatedFetch('https://api.test', '/path');

    const callHeaders = mockFetch.mock.calls[0][1].headers;
    expect(callHeaders['X-Nonce']).toBe('00000000-0000-4000-8000-000000000000');
  });

  it('adds Content-Type only when body is provided', async () => {
    mockGetCredentials.mockResolvedValue({ installId: 'id', installToken: 'tok' });
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    // Without body
    await authenticatedFetch('https://api.test', '/path', { method: 'GET' });
    let headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['Content-Type']).toBeUndefined();

    vi.clearAllMocks();
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    // With body
    await authenticatedFetch('https://api.test', '/path', { body: '{}' });
    headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('does not include raw token in URL or body', async () => {
    mockGetCredentials.mockResolvedValue({ installId: 'id', installToken: 'secret-tok' });
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    await authenticatedFetch('https://api.test', '/path', { body: '{"key":"val"}' });

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).not.toContain('secret-tok');
    expect(options.body).not.toContain('secret-tok');
  });
});

describe('verifyAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success on valid response', async () => {
    mockGetCredentials.mockResolvedValue({ installId: 'id', installToken: 'tok' });
    mockFetch.mockResolvedValue(new Response(
      JSON.stringify({ ok: true, install_id: 'id' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));

    const result = await verifyAuth('https://api.test');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ok).toBe(true);
      expect(result.data.install_id).toBe('id');
    }
  });

  it('returns error when no credentials configured', async () => {
    mockGetCredentials.mockResolvedValue(null);

    const result = await verifyAuth('https://api.test');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('No credentials configured');
    }
  });

  it('returns server error on non-200 response', async () => {
    mockGetCredentials.mockResolvedValue({ installId: 'id', installToken: 'tok' });
    mockFetch.mockResolvedValue(new Response(
      JSON.stringify({ error: { code: 'TOKEN_REVOKED', message: 'Token has been revoked.' } }),
      { status: 403 }
    ));

    const result = await verifyAuth('https://api.test');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('server');
      expect(result.error.status).toBe(403);
    }
  });

  it('does not expose token in error messages', async () => {
    mockGetCredentials.mockResolvedValue({ installId: 'id', installToken: 'super-secret-token' });
    mockFetch.mockRejectedValue(new Error('Network failed'));

    const result = await verifyAuth('https://api.test');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).not.toContain('super-secret-token');
    }
  });
});
