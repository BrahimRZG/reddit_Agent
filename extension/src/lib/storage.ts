import { STORAGE_KEYS, DEFAULT_WORKER_API_URL } from '../types';
import { validateWorkerApiUrl } from './url-validator';

/**
 * Custom error class for storage operation failures.
 */
export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

/**
 * Reads the Worker API base URL from chrome.storage.local.
 *
 * On missing key or read failure, returns DEFAULT_WORKER_API_URL.
 * This implements the "scoped fallback" principle: use the default
 * Worker URL for status checks only when storage is unavailable.
 */
export async function getWorkerApiBaseUrl(): Promise<string> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.WORKER_API_BASE_URL);
    const storedUrl = result[STORAGE_KEYS.WORKER_API_BASE_URL];

    if (typeof storedUrl === 'string' && storedUrl.length > 0) {
      return storedUrl;
    }

    return DEFAULT_WORKER_API_URL;
  } catch {
    // Storage read failure — fall back to default
    return DEFAULT_WORKER_API_URL;
  }
}

/**
 * Validates and stores the Worker API base URL in chrome.storage.local.
 *
 * The URL is validated using validateWorkerApiUrl before persisting.
 * The normalizedUrl (trailing slash removed) is stored, not raw input.
 *
 * @throws {StorageError} if the URL is invalid or the write operation fails
 */
export async function setWorkerApiBaseUrl(url: string): Promise<void> {
  const validation = validateWorkerApiUrl(url);

  if (!validation.valid) {
    throw new StorageError(`Invalid URL: ${validation.error}`);
  }

  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.WORKER_API_BASE_URL]: validation.normalizedUrl,
    });
  } catch (err) {
    throw new StorageError(
      `Failed to write to chrome.storage.local: ${err instanceof Error ? err.message : 'Unknown error'}`
    );
  }
}
