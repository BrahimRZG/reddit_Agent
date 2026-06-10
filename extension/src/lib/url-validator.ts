import type { ValidationResult } from '../types';

const MAX_URL_LENGTH = 2048;

/**
 * Validates a Worker API base URL.
 *
 * Rules:
 * 1. Must be parseable as a URL by `new URL()`
 * 2. Must use `https:` protocol
 * 3. Must not exceed 2048 characters
 * 4. On success, normalizedUrl has trailing slash removed
 *
 * @param input - The URL string to validate
 * @returns A discriminated union: success with normalizedUrl, or failure with error message
 */
export function validateWorkerApiUrl(input: string): ValidationResult {
  // Check length first (cheap check before URL parsing)
  if (input.length === 0) {
    return { valid: false, error: 'URL must not be empty.' };
  }

  if (input.length > MAX_URL_LENGTH) {
    return { valid: false, error: `URL must not exceed ${MAX_URL_LENGTH} characters.` };
  }

  // Attempt to parse as a URL
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { valid: false, error: 'URL is not well-formed.' };
  }

  // Check protocol
  if (parsed.protocol !== 'https:') {
    return { valid: false, error: 'URL must use HTTPS protocol.' };
  }

  // Normalize: remove trailing slash
  let normalizedUrl = input;
  if (normalizedUrl.endsWith('/')) {
    normalizedUrl = normalizedUrl.slice(0, -1);
  }

  return { valid: true, normalizedUrl };
}
