import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getCredentials,
  setCredentials,
  clearCredentials,
  hasCredentials,
  CREDENTIAL_KEYS,
} from './credential-storage';

// Mock chrome.storage.local
const mockStore = new Map<string, string>();
const mockGet = vi.fn(async (keys: string[]) => {
  const result: Record<string, string | undefined> = {};
  for (const key of keys) {
    const val = mockStore.get(key);
    if (val !== undefined) result[key] = val;
  }
  return result;
});
const mockSet = vi.fn(async (items: Record<string, string>) => {
  for (const [key, value] of Object.entries(items)) {
    mockStore.set(key, value);
  }
});
const mockRemove = vi.fn(async (keys: string[]) => {
  for (const key of keys) {
    mockStore.delete(key);
  }
});

vi.stubGlobal('chrome', {
  storage: { local: { get: mockGet, set: mockSet, remove: mockRemove } },
});

describe('credential-storage', () => {
  beforeEach(() => {
    mockStore.clear();
    vi.clearAllMocks();
  });

  it('getCredentials returns null when no credentials stored', async () => {
    expect(await getCredentials()).toBeNull();
  });

  it('setCredentials + getCredentials round trip', async () => {
    await setCredentials({ installId: 'test-id', token: 'test-token' });
    const creds = await getCredentials();
    expect(creds).toEqual({ installId: 'test-id', installToken: 'test-token' });
  });

  it('hasCredentials returns true after setCredentials', async () => {
    await setCredentials({ installId: 'id', token: 'tok' });
    expect(await hasCredentials()).toBe(true);
  });

  it('hasCredentials returns false when empty', async () => {
    expect(await hasCredentials()).toBe(false);
  });

  it('clearCredentials removes stored credentials', async () => {
    await setCredentials({ installId: 'id', token: 'tok' });
    await clearCredentials();
    expect(await getCredentials()).toBeNull();
    expect(await hasCredentials()).toBe(false);
  });

  it('rejects empty installId', async () => {
    await expect(setCredentials({ installId: '', token: 'tok' }))
      .rejects.toThrow('installId must be a non-empty string');
  });

  it('rejects empty token', async () => {
    await expect(setCredentials({ installId: 'id', token: '' }))
      .rejects.toThrow('token must be a non-empty string');
  });

  it('rejects whitespace-only installId', async () => {
    await expect(setCredentials({ installId: '   ', token: 'tok' }))
      .rejects.toThrow('installId must be a non-empty string');
  });

  it('stores under rma_ prefixed keys', async () => {
    await setCredentials({ installId: 'my-id', token: 'my-tok' });
    expect(mockStore.has(CREDENTIAL_KEYS.INSTALL_ID)).toBe(true);
    expect(mockStore.has(CREDENTIAL_KEYS.INSTALL_TOKEN)).toBe(true);
    expect(CREDENTIAL_KEYS.INSTALL_ID).toBe('rma_install_id');
    expect(CREDENTIAL_KEYS.INSTALL_TOKEN).toBe('rma_install_token');
  });

  it('does not store token_hash or admin secrets', async () => {
    await setCredentials({ installId: 'id', token: 'tok' });
    const allKeys = Array.from(mockStore.keys());
    expect(allKeys).not.toContain('token_hash');
    expect(allKeys).not.toContain('admin_secret');
    expect(allKeys).not.toContain('rma_token_hash');
    expect(allKeys).not.toContain('rma_admin_secret');
  });

  it('getCredentials returns null if only installId stored', async () => {
    mockStore.set(CREDENTIAL_KEYS.INSTALL_ID, 'id');
    expect(await getCredentials()).toBeNull();
  });

  it('getCredentials returns null if only token stored', async () => {
    mockStore.set(CREDENTIAL_KEYS.INSTALL_TOKEN, 'tok');
    expect(await getCredentials()).toBeNull();
  });
});
