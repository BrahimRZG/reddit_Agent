import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';
import {
  getAcknowledgement,
  readAcknowledgement,
  setAcknowledgement,
  clearAcknowledgement,
  isAcknowledgementRecord,
  OnboardingStorageError,
} from './onboarding-storage';
import { REQUIRED_ACKNOWLEDGEMENT_ITEM_IDS } from './onboarding';
import { STORAGE_KEYS } from '../types';
import { CREDENTIAL_KEYS } from './credential-storage';
import type { AcknowledgementItemId, AcknowledgementRecord } from '../types';

const ONBOARDING_KEY = 'rma_onboarding_acknowledgement';
const REQUIRED_IDS = [...REQUIRED_ACKNOWLEDGEMENT_ITEM_IDS] as AcknowledgementItemId[];

// Map-backed mock of chrome.storage.local for true round-trip tests.
const store = new Map<string, unknown>();
const mockGet = vi.fn(async (key: string | string[]) => {
  const keys = Array.isArray(key) ? key : [key];
  const result: Record<string, unknown> = {};
  for (const k of keys) {
    if (store.has(k)) result[k] = store.get(k);
  }
  return result;
});
const mockSet = vi.fn(async (items: Record<string, unknown>) => {
  for (const [k, v] of Object.entries(items)) {
    store.set(k, v);
  }
});
const mockRemove = vi.fn(async (key: string | string[]) => {
  const keys = Array.isArray(key) ? key : [key];
  for (const k of keys) {
    store.delete(k);
  }
});

vi.stubGlobal('chrome', {
  storage: { local: { get: mockGet, set: mockSet, remove: mockRemove } },
});

// Arbitrary for a shape-valid AcknowledgementRecord.
const recordArb: fc.Arbitrary<AcknowledgementRecord> = fc.record({
  acknowledged: fc.boolean(),
  version: fc
    .tuple(fc.nat({ max: 50 }), fc.nat({ max: 50 }), fc.nat({ max: 50 }))
    .map((t) => t.join('.')),
  acknowledged_at: fc
    .integer({ min: 0, max: 4_102_444_800_000 })
    .map((n) => new Date(n).toISOString()),
  items: fc.subarray(REQUIRED_IDS),
});

describe('onboarding-storage round-trip', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  // Feature: compliance-onboarding, Property 4: For any valid completed Acknowledgement_Record, writing it via setAcknowledgement and reading it back via getAcknowledgement returns a record whose acknowledged, version, acknowledged_at, and items fields equal the values written, stored under the rma_onboarding_acknowledgement key.
  it('Property 4: write-then-read round-trips under the onboarding key (>=100 runs)', async () => {
    await fc.assert(
      fc.asyncProperty(recordArb, async (record) => {
        store.clear();
        await setAcknowledgement(record);
        const read = await getAcknowledgement();
        expect(read).toEqual(record);
        expect(store.get(ONBOARDING_KEY)).toEqual(record);
      }),
      { numRuns: 150 }
    );
  });

  it('setAcknowledgement + getAcknowledgement round trip (example, Req 7.1)', async () => {
    const record: AcknowledgementRecord = {
      acknowledged: true,
      version: '1.0.0',
      acknowledged_at: '2024-01-01T00:00:00.000Z',
      items: [...REQUIRED_IDS],
    };
    await setAcknowledgement(record);
    expect(mockSet).toHaveBeenCalledWith({ [ONBOARDING_KEY]: record });
    expect(await getAcknowledgement()).toEqual(record);
  });
});

describe('onboarding-storage local-only persistence', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  // Feature: compliance-onboarding, Property 7: For any completion of Compliance_Onboarding, the Extension persists the Acknowledgement_Record only to chrome.storage.local and issues zero requests carrying the Acknowledgement_Record or any Acknowledgement_Item identifier to the Worker_API.
  it('Property 7: accept/write uses only chrome.storage.local, never fetch (>=100 runs)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await fc.assert(
      fc.asyncProperty(recordArb, async (record) => {
        store.clear();
        mockSet.mockClear();
        fetchSpy.mockClear();
        await setAcknowledgement(record);
        expect(mockSet).toHaveBeenCalledTimes(1);
        expect(fetchSpy).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });
});

describe('onboarding-storage fail-closed reads', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it('returns null when no record stored (Req 1.4)', async () => {
    expect(await getAcknowledgement()).toBeNull();
  });

  it('returns null for a malformed/partial record (Req 1.7)', async () => {
    store.set(ONBOARDING_KEY, { acknowledged: true, version: 123 });
    expect(await getAcknowledgement()).toBeNull();
  });

  it('returns null when items is not an array of strings', async () => {
    store.set(ONBOARDING_KEY, {
      acknowledged: true,
      version: '1.0.0',
      acknowledged_at: '2024-01-01T00:00:00.000Z',
      items: [1, 2, 3],
    });
    expect(await getAcknowledgement()).toBeNull();
  });

  it('getAcknowledgement returns null when the read throws (Req 1.7, 1.8)', async () => {
    mockGet.mockRejectedValueOnce(new Error('storage unavailable'));
    expect(await getAcknowledgement()).toBeNull();
  });

  it('readAcknowledgement reports read_error when the read throws (Req 1.8)', async () => {
    mockGet.mockRejectedValueOnce(new Error('storage unavailable'));
    const result = await readAcknowledgement();
    expect(result.kind).toBe('read_error');
    if (result.kind === 'read_error') {
      expect(result.message).toContain('storage unavailable');
    }
  });

  it('readAcknowledgement reports ok with null record when absent', async () => {
    const result = await readAcknowledgement();
    expect(result).toEqual({ kind: 'ok', record: null });
  });

  it('readAcknowledgement reports ok with the record when present', async () => {
    const record: AcknowledgementRecord = {
      acknowledged: true,
      version: '1.0.0',
      acknowledged_at: '2024-01-01T00:00:00.000Z',
      items: [...REQUIRED_IDS],
    };
    store.set(ONBOARDING_KEY, record);
    const result = await readAcknowledgement();
    expect(result).toEqual({ kind: 'ok', record });
  });
});

describe('onboarding-storage writes and clears', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it('setAcknowledgement throws OnboardingStorageError on write failure (Req 4.6)', async () => {
    mockSet.mockRejectedValueOnce(new Error('quota exceeded'));
    const record: AcknowledgementRecord = {
      acknowledged: true,
      version: '1.0.0',
      acknowledged_at: '2024-01-01T00:00:00.000Z',
      items: [...REQUIRED_IDS],
    };
    await expect(setAcknowledgement(record)).rejects.toThrow(OnboardingStorageError);
  });

  it('clearAcknowledgement removes the stored record', async () => {
    store.set(ONBOARDING_KEY, {
      acknowledged: true,
      version: '1.0.0',
      acknowledged_at: '2024-01-01T00:00:00.000Z',
      items: [...REQUIRED_IDS],
    });
    await clearAcknowledgement();
    expect(store.has(ONBOARDING_KEY)).toBe(false);
    expect(await getAcknowledgement()).toBeNull();
  });
});

describe('onboarding-storage key distinctness and shape guard', () => {
  it('uses the rma_onboarding_acknowledgement key, distinct from credential/base-url keys (Req 1.5)', () => {
    expect(STORAGE_KEYS.ONBOARDING).toBe(ONBOARDING_KEY);
    expect(STORAGE_KEYS.ONBOARDING).not.toBe(CREDENTIAL_KEYS.INSTALL_ID);
    expect(STORAGE_KEYS.ONBOARDING).not.toBe(CREDENTIAL_KEYS.INSTALL_TOKEN);
    expect(STORAGE_KEYS.ONBOARDING).not.toBe(STORAGE_KEYS.WORKER_API_BASE_URL);
    expect(STORAGE_KEYS.ONBOARDING).not.toBe('rma_install_id');
    expect(STORAGE_KEYS.ONBOARDING).not.toBe('rma_install_token');
  });

  it('isAcknowledgementRecord accepts a valid record and rejects malformed values', () => {
    expect(
      isAcknowledgementRecord({
        acknowledged: true,
        version: '1.0.0',
        acknowledged_at: '2024-01-01T00:00:00.000Z',
        items: ['a'],
      })
    ).toBe(true);
    expect(isAcknowledgementRecord(null)).toBe(false);
    expect(isAcknowledgementRecord('string')).toBe(false);
    expect(isAcknowledgementRecord({ acknowledged: 'yes', version: '1.0.0', acknowledged_at: '', items: [] })).toBe(
      false
    );
  });
});
