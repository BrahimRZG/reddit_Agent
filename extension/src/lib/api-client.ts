import type { StatusResponse, StatusResult, AuthVerifyResponse, AuthResult } from '../types';
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

// --- Spec 02: Authenticated API Client ---

const AUTH_TIMEOUT_MS = 10_000;

/**
 * Sends an authenticated request to a protected Worker API endpoint.
 *
 * Attaches headers:
 *   - Authorization: Bearer <install_token>
 *   - X-Install-Id: <install_id>
 *   - X-Timestamp: current ISO 8601 timestamp
 *   - X-Nonce: fresh UUID v4
 *   - Accept: application/json
 *   - Content-Type: application/json (only when body exists)
 *
 * Security:
 *   - Never logs the install token
 *   - Never exposes token in thrown errors or returned error messages
 *   - Fails gracefully if no credentials are configured
 *
 * @param baseUrl - The Worker API base URL (without trailing slash)
 * @param path - The endpoint path (e.g., '/v1/auth/verify')
 * @param options - Optional fetch options (method defaults to POST, body optional)
 * @returns Response object or throws on missing credentials
 */
export async function authenticatedFetch(
  baseUrl: string,
  path: string,
  options: { method?: string; body?: string } = {}
): Promise<Response> {
  const credentials = await getCredentials();
  if (!credentials) {
    throw new Error('No credentials configured. Please set up your install token.');
  }

  const method = options.method ?? 'POST';
  const controller = new AbortController();
  let didTimeout = false;

  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, AUTH_TIMEOUT_MS);

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${credentials.installToken}`,
    'X-Install-Id': credentials.installId,
    'X-Timestamp': new Date().toISOString(),
    'X-Nonce': crypto.randomUUID(),
    'Accept': 'application/json',
  };

  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: options.body ?? undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError' && didTimeout) {
      throw new Error('Request timed out.');
    }
    throw new Error('Network request failed.');
  }
}

/**
 * Verifies that the stored credentials are valid by calling POST /v1/auth/verify.
 *
 * @param baseUrl - The Worker API base URL (without trailing slash)
 * @returns AuthResult — success with { ok, install_id } or failure with categorized error
 */
export async function verifyAuth(baseUrl: string): Promise<AuthResult> {
  try {
    const response = await authenticatedFetch(baseUrl, '/v1/auth/verify', {
      method: 'POST',
      body: '{}',
    });

    if (!response.ok) {
      // Parse error response for code
      let errorMessage = `Server returned HTTP ${response.status}`;
      try {
        const errorBody = await response.json() as { error?: { code?: string; message?: string } };
        if (errorBody.error?.message) {
          errorMessage = errorBody.error.message;
        }
      } catch {
        // Failed to parse error body — use defaults
      }

      return {
        success: false,
        error: {
          type: 'server',
          status: response.status,
          message: errorMessage,
        },
      };
    }

    // Parse success response
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return {
        success: false,
        error: {
          type: 'parse',
          message: 'Failed to parse verify response.',
        },
      };
    }

    // Validate shape
    if (!isValidAuthVerifyResponse(data)) {
      return {
        success: false,
        error: {
          type: 'parse',
          message: 'Verify response does not match expected shape.',
        },
      };
    }

    return { success: true, data };
  } catch (err) {
    // authenticatedFetch throws on missing credentials or network failure
    const message = err instanceof Error ? err.message : 'Authentication verification failed.';

    // Determine error type
    if (message.includes('timed out')) {
      return { success: false, error: { type: 'timeout', message } };
    }
    if (message.includes('No credentials configured')) {
      return { success: false, error: { type: 'network', message } };
    }
    return { success: false, error: { type: 'network', message } };
  }
}

/**
 * Type guard to validate AuthVerifyResponse shape.
 */
function isValidAuthVerifyResponse(data: unknown): data is AuthVerifyResponse {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  return obj.ok === true && typeof obj.install_id === 'string';
}
