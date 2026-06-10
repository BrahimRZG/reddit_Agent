import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getWorkerApiBaseUrl, setWorkerApiBaseUrl, StorageError } from './storage';
import { DEFAULT_WORKER_API_URL, STORAGE_KEYS } from '../types';

// Mock chrome.storage.local
const mockGet = vi.fn();
const mockSet = vi.fn();

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: mockGet,
      set: mockSet,
    },
  },
});

describe('getWorkerApiBaseUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns stored URL when present', async () => {
    mockGet.mockResolvedValue({
      [STORAGE_KEYS.WORKER_API_BASE_URL]: 'https://my-worker.workers.dev',
    });

    const url = await getWorkerApiBaseUrl();
    expect(url).toBe('https://my-worker.workers.dev');
  });

  it('returns default URL when key is missing', async () => {
    mockGet.mockResolvedValue({});

    const url = await getWorkerApiBaseUrl();
    expect(url).toBe(DEFAULT_WORKER_API_URL);
  });

  it('returns default URL when stored value is empty string', async () => {
    mockGet.mockResolvedValue({
      [STORAGE_KEYS.WORKER_API_BASE_URL]: '',
    });

    const url = await getWorkerApiBaseUrl();
    expect(url).toBe(DEFAULT_WORKER_API_URL);
  });

  it('returns default URL on read failure', async () => {
    mockGet.mockRejectedValue(new Error('Storage unavailable'));

    const url = await getWorkerApiBaseUrl();
    expect(url).toBe(DEFAULT_WORKER_API_URL);
  });
});

describe('setWorkerApiBaseUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSet.mockResolvedValue(undefined);
  });

  it('stores normalized URL (trailing slash removed)', async () => {
    await setWorkerApiBaseUrl('https://example.workers.dev/');

    expect(mockSet).toHaveBeenCalledWith({
      [STORAGE_KEYS.WORKER_API_BASE_URL]: 'https://example.workers.dev',
    });
  });

  it('stores URL without trailing slash as-is', async () => {
    await setWorkerApiBaseUrl('https://example.workers.dev');

    expect(mockSet).toHaveBeenCalledWith({
      [STORAGE_KEYS.WORKER_API_BASE_URL]: 'https://example.workers.dev',
    });
  });

  it('throws StorageError for invalid URL', async () => {
    await expect(setWorkerApiBaseUrl('not-a-url')).rejects.toThrow(StorageError);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('throws StorageError for non-HTTPS URL', async () => {
    await expect(setWorkerApiBaseUrl('http://example.com')).rejects.toThrow(StorageError);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('throws StorageError on write failure', async () => {
    mockSet.mockRejectedValue(new Error('Quota exceeded'));

    await expect(
      setWorkerApiBaseUrl('https://example.workers.dev')
    ).rejects.toThrow(StorageError);
  });
});
