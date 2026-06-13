/**
 * Compare integration wrapper (Spec 05, Req 5).
 *
 * Operator-triggered ONLY. Delegates the single permitted network request to the
 * EXISTING `authenticatedFetch(baseUrl, '/v1/compare', ...)` client, reusing its
 * credential and request-signing behavior unchanged. Adds NO new endpoint, NO
 * new credential store, and NO new manifest permission. Returns a categorized
 * `CompareOutcome` discriminated union (Req 5.5, 5.6). Error messages never
 * include the install token or any other secret.
 */
import type { CompareOutcome, CompareRequestBody, CompareResponse } from '../types';
import { authenticatedFetch } from './api-client';

const COMPARE_PATH = '/v1/compare';
const COMPARE_TIMEOUT_MS = 10_000;

/** Minimal structural validation of an HTTP 200 CompareResponse body. */
function isCompareResponse(data: unknown): data is CompareResponse {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const obj = data as Record<string, unknown>;

  if (typeof obj.match_count !== 'number' || !Array.isArray(obj.matches)) {
    return false;
  }
  if (typeof obj.candidate !== 'object' || obj.candidate === null) {
    return false;
  }
  if (typeof (obj.candidate as Record<string, unknown>).merchant !== 'string') {
    return false;
  }

  for (const match of obj.matches) {
    if (typeof match !== 'object' || match === null) {
      return false;
    }
    const m = match as Record<string, unknown>;
    if (
      typeof m.merchant !== 'string' ||
      typeof m.description !== 'string' ||
      typeof m.score !== 'number' ||
      typeof m.source !== 'string'
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Sends a single POST /v1/compare request via the existing
 * Authenticated_API_Client and maps the result to a CompareOutcome:
 * - HTTP 200 + valid CompareResponse → `{ status: 'success', data }` (Req 5.5);
 * - abort / timeout → `failure` with `ApiError.type: 'timeout'`;
 * - thrown error / no credentials / network → `failure` with `'network'`;
 * - non-200 → `failure` with `'server'` (carrying `status`);
 * - unparseable / unexpected body → `failure` with `'parse'` (Req 5.6).
 */
export async function runCompareLookup(
  baseUrl: string,
  request: CompareRequestBody
): Promise<CompareOutcome> {
  const controller = new AbortController();
  let didTimeout = false;
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, COMPARE_TIMEOUT_MS);

  let response: Response;
  try {
    response = await authenticatedFetch(baseUrl, COMPARE_PATH, {
      method: 'POST',
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (didTimeout || (err instanceof DOMException && err.name === 'AbortError')) {
      return {
        status: 'failure',
        error: { type: 'timeout', message: 'Compare request timed out.' },
      };
    }
    // Includes the "No credentials configured" case and network failures.
    // The thrown error never carries the token, so this message is safe.
    return {
      status: 'failure',
      error: {
        type: 'network',
        message: err instanceof Error ? err.message : 'Compare request failed.',
      },
    };
  }
  clearTimeout(timer);

  if (!response.ok) {
    return {
      status: 'failure',
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
      status: 'failure',
      error: { type: 'parse', message: 'Failed to parse response as JSON.' },
    };
  }

  if (!isCompareResponse(data)) {
    return {
      status: 'failure',
      error: { type: 'parse', message: 'Response does not match expected CompareResponse shape.' },
    };
  }

  return { status: 'success', data };
}
