import type {
  StatusResponse,
  StatusResult,
  AuthVerifyResponse,
  VerifyAuthResult,
} from '../types';
import { getCredentials } from './credential-storage';

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


// --- Spec 02: Authenticated requests ---

/**
 * Normalizes a HeadersInit value into a plain Record<string, string>.
 *
 * Keeping headers as a plain object (rather than a Headers instance) lets
 * callers and tests read individual header values directly.
 */
function toHeaderRecord(init?: HeadersInit): Record<string, string> {
  if (!init) {
    return {};
  }
  if (init instanceof Headers) {
    const out: Record<string, string> = {};
    init.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(init)) {
    const out: Record<string, string> = {};
    for (const [key, value] of init) {
      out[key] = value;
    }
    return out;
  }
  return { ...init };
}

/**
 * Performs an authenticated request against the Worker API.
 *
 * Reads the install credentials from local storage and attaches the
 * authentication headers. The raw install token is sent only in the
 * `Authorization` header — never in the URL or request body.
 *
 * @param baseUrl - The Worker API base URL (without trailing slash)
 * @param path - The request path (e.g. `/v1/auth/verify`)
 * @param options - Optional fetch options (method, body, extra headers, etc.)
 * @returns The fetch Response, unmodified
 * @throws {Error} when no install credentials are configured
 */
export async function authenticatedFetch(
  baseUrl: string,
  path: string,
  options?: RequestInit
): Promise<Response> {
  const credentials = await getCredentials();
  if (credentials === null) {
    throw new Error('No credentials configured. Complete install/auth before authenticated requests.');
  }

  // Merge caller-provided headers first so the required auth headers always win.
  const headers: Record<string, string> = {
    ...toHeaderRecord(options?.headers),
    'Authorization': `Bearer ${credentials.installToken}`,
    'X-Install-Id': credentials.installId,
    'X-Timestamp': new Date().toISOString(),
    'X-Nonce': crypto.randomUUID(),
  };

  // Only declare a JSON content type when a request body is actually sent.
  if (options?.body !== undefined && options?.body !== null) {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });
}

/**
 * Verifies the install credentials against the Worker API
 * (`POST /v1/auth/verify`).
 *
 * Returns a discriminated-union result. Error messages never contain the
 * install token or any other secret.
 *
 * @param baseUrl - The Worker API base URL (without trailing slash)
 * @returns VerifyAuthResult — success with verify data or failure with categorized error
 */
export async function verifyAuth(baseUrl: string): Promise<VerifyAuthResult> {
  let response: Response;
  try {
    response = await authenticatedFetch(baseUrl, '/v1/auth/verify', { method: 'POST' });
  } catch (err) {
    // Includes the "No credentials configured" case and network failures.
    // The thrown error never carries the token, so this message is safe.
    return {
      success: false,
      error: {
        type: 'network',
        message: err instanceof Error ? err.message : 'Authenticated request failed.',
      },
    };
  }

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

  if (!isAuthVerifyResponse(data)) {
    return {
      success: false,
      error: {
        type: 'parse',
        message: 'Response does not match expected AuthVerifyResponse shape.',
      },
    };
  }

  return { success: true, data: { ok: data.ok, install_id: data.install_id } };
}

/**
 * Type guard for the POST /v1/auth/verify response body.
 */
function isAuthVerifyResponse(data: unknown): data is AuthVerifyResponse {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  return typeof obj.ok === 'boolean' && typeof obj.install_id === 'string';
}
