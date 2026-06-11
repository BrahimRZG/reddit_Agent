import type { ValidationResult } from '../types';

const MAX_URL_LENGTH = 2048;

/**
 * Validates a Worker API base URL.
 *
 * Rules:
 * 1. Must be parseable as a URL by `new URL()`
 * 2. Must use `https:` protocol, except localhost for development testing
 * 3. Must not exceed 2048 characters
 * 4. On success, normalizedUrl has trailing slash removed
 */
export function validateWorkerApiUrl(input: string): ValidationResult {
  const trimmedInput = input.trim();

  if (trimmedInput.length === 0) {
    return { valid: false, error: 'URL must not be empty.' };
  }

  if (trimmedInput.length > MAX_URL_LENGTH) {
    return {
      valid: false,
      error: `URL must not exceed ${MAX_URL_LENGTH} characters.`,
    };
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmedInput);
  } catch {
    return { valid: false, error: 'URL is not well-formed.' };
  }

  const isHttps = parsed.protocol === 'https:';
  const isLocalHttp =
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');

  if (!isHttps && !isLocalHttp) {
    return {
      valid: false,
      error: 'URL must use HTTPS protocol, except localhost for development.',
    };
  }

  let normalizedUrl = trimmedInput;

  while (normalizedUrl.endsWith('/')) {
    normalizedUrl = normalizedUrl.slice(0, -1);
  }

  return { valid: true, normalizedUrl };
}
