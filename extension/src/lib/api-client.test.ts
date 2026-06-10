import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { checkStatus } from './api-client';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('checkStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const validResponse = {
    ok: true,
    api_version: 'v1',
    minimum_extension_version: '1.0.0',
    scanner_enabled: false,
    drafting_enabled: false,
    compare_enabled: false,
    promotional_modes_enabled: false,
  };

  it('returns success with parsed StatusResponse', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(validResponse),
    });

    const result = await checkStatus('https://api.example.com');

    expect(result).toEqual({ success: true, data: validResponse });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/status',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('classifies timeout as type timeout', async () => {
    mockFetch.mockImplementation((_url: string, opts: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });

    const promise = checkStatus('https://api.example.com');

    // Advance past the 10s timeout
    vi.advanceTimersByTime(10_001);

    const result = await promise;
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('timeout');
    }
  });

  it('classifies TypeError as network error', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await checkStatus('https://api.example.com');

    expect(result).toEqual({
      success: false,
      error: {
        type: 'network',
        message: 'Failed to fetch',
      },
    });
  });

  it('classifies HTTP 500 as server error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    const result = await checkStatus('https://api.example.com');

    expect(result).toEqual({
      success: false,
      error: {
        type: 'server',
        status: 500,
        message: 'Server returned HTTP 500',
      },
    });
  });

  it('classifies HTTP 404 as server error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
    });

    const result = await checkStatus('https://api.example.com');

    expect(result).toEqual({
      success: false,
      error: {
        type: 'server',
        status: 404,
        message: 'Server returned HTTP 404',
      },
    });
  });

  it('classifies malformed JSON as parse error', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected token')),
    });

    const result = await checkStatus('https://api.example.com');

    expect(result).toEqual({
      success: false,
      error: {
        type: 'parse',
        message: 'Failed to parse response as JSON.',
      },
    });
  });

  it('classifies invalid response shape as parse error', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ unexpected: 'shape' }),
    });

    const result = await checkStatus('https://api.example.com');

    expect(result).toEqual({
      success: false,
      error: {
        type: 'parse',
        message: 'Response does not match expected StatusResponse shape.',
      },
    });
  });
});
