import type { StatusResponse, StatusResult } from '../types';

const STATUS_TIMEOUT_MS = 10_000;

/**
 * Checks the Worker API status endpoint.
 *
 * Uses AbortController with a didTimeout flag to distinguish
 * intentional timeout from other abort scenarios.
 *
 * @param baseUrl - The Worker API base URL (without trailing slash)
 * @returns StatusResult — success with data or failure with categorized error
 */
export async function checkStatus(baseUrl: string): Promise<StatusResult> {
  const controller = new AbortController();
  let didTimeout = false;

  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, STATUS_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/v1/status`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
      },
      // TODO: Spec 02 - Worker Auth & Token Lifecycle — Add HMAC signing headers here
    });

    clearTimeout(timer);

    // Handle HTTP errors
    if (!response.ok) {
      return {
        success: false,
        error: {
          type: 'server',
          status: response.status,
          message: `Server returned HTTP ${response.status}`,
        },
      };
    }

    // Parse JSON response
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return {
        success: false,
        error: {
          type: 'parse',
          message: 'Failed to parse response as JSON.',
        },
      };
    }

    // Validate basic StatusResponse shape
    if (!isValidStatusResponse(data)) {
      return {
        success: false,
        error: {
          type: 'parse',
          message: 'Response does not match expected StatusResponse shape.',
        },
      };
    }

    return { success: true, data };
  } catch (err) {
    clearTimeout(timer);

    // Distinguish timeout from network error
    if (err instanceof DOMException && err.name === 'AbortError') {
      return {
        success: false,
        error: {
          type: didTimeout ? 'timeout' : 'network',
          message: didTimeout
            ? 'Request timed out after 10 seconds.'
            : 'Request was aborted.',
        },
      };
    }

    // TypeError typically means network failure (DNS, offline, CORS, etc.)
    return {
      success: false,
      error: {
        type: 'network',
        message: err instanceof Error ? err.message : 'Network request failed.',
      },
    };
  }
}

/**
 * Type guard to validate basic StatusResponse shape.
 * Checks that all required fields exist with correct types.
 */
function isValidStatusResponse(data: unknown): data is StatusResponse {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const obj = data as Record<string, unknown>;

  return (
    typeof obj.ok === 'boolean' &&
    typeof obj.api_version === 'string' &&
    typeof obj.minimum_extension_version === 'string' &&
    typeof obj.scanner_enabled === 'boolean' &&
    typeof obj.drafting_enabled === 'boolean' &&
    typeof obj.compare_enabled === 'boolean' &&
    typeof obj.promotional_modes_enabled === 'boolean'
  );
}

import { getCredentials } from './credential-storage';

export async function authenticatedFetch(
  baseUrl: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const credentials = await getCredentials();

  if (!credentials) {
    throw new Error('No credentials configured');
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${credentials.installToken}`,
    'X-Install-Id': credentials.installId,
    'X-Timestamp': new Date().toISOString(),
    'X-Nonce': crypto.randomUUID(),
    ...(init.headers as Record<string, string> | undefined),
  };

  if (init.body !== undefined) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
  }

  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  return fetch(`${normalizedBaseUrl}${normalizedPath}`, {
    ...init,
    headers,
  });
}

export async function verifyAuth(
  baseUrl: string
): Promise<
  | { success: true; data: any }
  | {
      success: false;
      error: {
        type: 'credentials' | 'server' | 'network';
        message: string;
        status?: number;
      };
    }
> {
  try {
    const res = await authenticatedFetch(baseUrl, '/v1/auth/verify', {
      method: 'POST',
    });

    const body = (await res.json()) as any;

    if (!res.ok) {
      return {
        success: false,
        error: {
          type: 'server',
          status: res.status,
          message: body?.error?.message ?? 'Authentication failed',
        },
      };
    }

    return {
      success: true,
      data: body,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication failed';

    if (message.includes('No credentials configured')) {
      return {
        success: false,
        error: {
          type: 'credentials',
          message: 'No credentials configured',
        },
      };
    }

    return {
      success: false,
      error: {
        type: 'network',
        message: 'Authentication failed',
      },
    };
  }
}
