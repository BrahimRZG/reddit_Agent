import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runCompareLookup } from './intent-compare';
import type { CompareRequestBody, CompareResponse } from '../types';

// Mock the EXISTING authenticated client; the wrapper must delegate to it.
vi.mock('./api-client', () => ({
  authenticatedFetch: vi.fn(),
}));

import { authenticatedFetch } from './api-client';
const mockAuthFetch = vi.mocked(authenticatedFetch);

const request: CompareRequestBody = { merchant: 'acme', product: 'widget' };

const successBody: CompareResponse = {
  candidate: { merchant: 'acme', product: 'widget' },
  match_count: 1,
  matches: [
    { merchant: 'Acme', coupon_code: 'ACME10', description: '10% off all widgets', score: 7, source: 'mock-couponsriver' },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('runCompareLookup — Compare reuses existing client & contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Feature: intent-scanner, Property 8: For any Operator-triggered
  // Compare_Lookup, the Intent_Scanner sends the request to the existing
  // protected /v1/compare endpoint using the existing Authenticated_API_Client,
  // without adding any new endpoint, credential store, or manifest permission.
  it('Property 8: delegates a single POST /v1/compare via authenticatedFetch with a JSON body', async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse(successBody, 200));

    const outcome = await runCompareLookup('https://api.test', request);

    expect(mockAuthFetch).toHaveBeenCalledTimes(1);
    const [baseUrl, path, options] = mockAuthFetch.mock.calls[0];
    expect(baseUrl).toBe('https://api.test');
    expect(path).toBe('/v1/compare');
    expect(options).toEqual(
      expect.objectContaining({ method: 'POST', body: JSON.stringify(request) })
    );
    expect(outcome.status).toBe('success');
    if (outcome.status === 'success') {
      expect(outcome.data).toEqual(successBody);
    }
  });

  it('maps HTTP 200 + valid CompareResponse to success (Req 5.5)', async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse(successBody, 200));
    const outcome = await runCompareLookup('https://api.test', request);
    expect(outcome).toEqual({ status: 'success', data: successBody });
  });

  it('maps a thrown network error to failure: network (Req 5.6)', async () => {
    mockAuthFetch.mockRejectedValue(new Error('Network failed'));
    const outcome = await runCompareLookup('https://api.test', request);
    expect(outcome.status).toBe('failure');
    if (outcome.status === 'failure') {
      expect(outcome.error.type).toBe('network');
    }
  });

  it('maps a missing-credentials throw to failure: network without leaking secrets', async () => {
    mockAuthFetch.mockRejectedValue(
      new Error('No credentials configured. Complete install/auth before authenticated requests.')
    );
    const outcome = await runCompareLookup('https://api.test', request);
    expect(outcome.status).toBe('failure');
    if (outcome.status === 'failure') {
      expect(outcome.error.type).toBe('network');
    }
  });

  it('maps an abort to failure: timeout (Req 5.6)', async () => {
    mockAuthFetch.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    const outcome = await runCompareLookup('https://api.test', request);
    expect(outcome.status).toBe('failure');
    if (outcome.status === 'failure') {
      expect(outcome.error.type).toBe('timeout');
    }
  });

  it('maps a non-200 response to failure: server with status (Req 5.6)', async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse({ error: { code: 'RATE_LIMITED', message: 'slow down' } }, 429));
    const outcome = await runCompareLookup('https://api.test', request);
    expect(outcome.status).toBe('failure');
    if (outcome.status === 'failure') {
      expect(outcome.error.type).toBe('server');
      expect(outcome.error.status).toBe(429);
    }
  });

  it('maps unparseable JSON to failure: parse (Req 5.6)', async () => {
    mockAuthFetch.mockResolvedValue(new Response('not json at all', { status: 200 }));
    const outcome = await runCompareLookup('https://api.test', request);
    expect(outcome.status).toBe('failure');
    if (outcome.status === 'failure') {
      expect(outcome.error.type).toBe('parse');
    }
  });

  it('maps an unexpected 200 body shape to failure: parse (Req 5.6)', async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse({ unexpected: true }, 200));
    const outcome = await runCompareLookup('https://api.test', request);
    expect(outcome.status).toBe('failure');
    if (outcome.status === 'failure') {
      expect(outcome.error.type).toBe('parse');
    }
  });
});
