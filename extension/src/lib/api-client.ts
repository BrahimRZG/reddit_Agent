import type { StatusResponse, StatusResult, AuthVerifyResponse, AuthResult } from '../types';
import { getCredentials } from './credential-storage';

const STATUS_TIMEOUT_MS = 10_000;

export async function checkStatus(baseUrl: string): Promise<StatusResult> {
  const controller = new AbortController();
  let didTimeout = false;
  const timer = setTimeout(() => { didTimeout = true; controller.abort(); }, STATUS_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/v1/status`, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timer);

    if (!response.ok) {
      return { success: false, error: { type: 'server', status: response.status, message: `Server returned HTTP ${response.status}` } };
    }

    let data: unknown;
    try { data = await response.json(); } catch {
      return { success: false, error: { type: 'parse', message: 'Failed to parse response as JSON.' } };
    }

    if (!isValidStatusResponse(data)) {
      return { success: false, error: { type: 'parse', message: 'Response does not match expected StatusResponse shape.' } };
    }

    return { success: true, data };
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { success: false, error: { type: didTimeout ? 'timeout' : 'network', message: didTimeout ? 'Request timed out after 10 seconds.' : 'Request was aborted.' } };
    }
    return { success: false, error: { type: 'network', message: err instanceof Error ? err.message : 'Network request failed.' } };
  }
}

function isValidStatusResponse(data: unknown): data is StatusResponse {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return typeof obj.ok === 'boolean' && typeof obj.api_version === 'string' && typeof obj.minimum_extension_version === 'string' && typeof obj.scanner_enabled === 'boolean' && typeof obj.drafting_enabled === 'boolean' && typeof obj.compare_enabled === 'boolean' && typeof obj.promotional_modes_enabled === 'boolean';
}

// --- Spec 02: Authenticated API Client ---

const AUTH_TIMEOUT_MS = 10_000;

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
  const timer = setTimeout(() => { didTimeout = true; controller.abort(); }, AUTH_TIMEOUT_MS);

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
    const response = await fetch(`${baseUrl}${path}`, { method, headers, body: options.body ?? undefined, signal: controller.signal });
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

export async function verifyAuth(baseUrl: string): Promise<AuthResult> {
  try {
    const response = await authenticatedFetch(baseUrl, '/v1/auth/verify', { method: 'POST', body: '{}' });

    if (!response.ok) {
      let errorMessage = `Server returned HTTP ${response.status}`;
      try {
        const errorBody = await response.json() as { error?: { message?: string } };
        if (errorBody.error?.message) errorMessage = errorBody.error.message;
      } catch { /* use default */ }
      return { success: false, error: { type: 'server', status: response.status, message: errorMessage } };
    }

    let data: unknown;
    try { data = await response.json(); } catch {
      return { success: false, error: { type: 'parse', message: 'Failed to parse verify response.' } };
    }

    if (!isValidAuthVerifyResponse(data)) {
      return { success: false, error: { type: 'parse', message: 'Verify response does not match expected shape.' } };
    }

    return { success: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Authentication verification failed.';
    if (message.includes('timed out')) return { success: false, error: { type: 'timeout', message } };
    return { success: false, error: { type: 'network', message } };
  }
}

function isValidAuthVerifyResponse(data: unknown): data is AuthVerifyResponse {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return obj.ok === true && typeof obj.install_id === 'string';
}
