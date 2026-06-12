import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';

// Mock the storage read so the gate's onboarding state is fully controllable.
vi.mock('./onboarding-storage', () => ({
  getAcknowledgement: vi.fn(),
}));
// Mock credential storage so we can assert it is NOT read while blocked.
vi.mock('./credential-storage', () => ({
  getCredentials: vi.fn(),
}));

import {
  guardAuthenticatedAction,
  guardedAuthenticatedFetch,
  guardedVerifyAuth,
} from './onboarding-gate';
import { getAcknowledgement } from './onboarding-storage';
import { getCredentials } from './credential-storage';
import { checkStatus } from './api-client';
import {
  isOnboardingComplete,
  ACKNOWLEDGEMENT_VERSION,
  REQUIRED_ACKNOWLEDGEMENT_ITEM_IDS,
} from './onboarding';
import type { AcknowledgementItemId, AcknowledgementRecord } from '../types';

const mockGetAck = vi.mocked(getAcknowledgement);
const mockGetCreds = vi.mocked(getCredentials);
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);
vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000000' });

const REQUIRED_IDS = [...REQUIRED_ACKNOWLEDGEMENT_ITEM_IDS] as AcknowledgementItemId[];

const ISO = '2024-01-01T00:00:00.000Z';

const completeRecord: AcknowledgementRecord = {
  acknowledged: true,
  version: ACKNOWLEDGEMENT_VERSION,
  acknowledged_at: ISO,
  items: [...REQUIRED_IDS],
};

const validStatus = {
  ok: true,
  api_version: 'v1',
  minimum_extension_version: '1.0.0',
  scanner_enabled: false,
  drafting_enabled: false,
  compare_enabled: false,
  promotional_modes_enabled: false,
};

// Mixed-state record arbitrary (sometimes complete, sometimes not, sometimes null).
const recordArb: fc.Arbitrary<AcknowledgementRecord> = fc.record({
  acknowledged: fc.boolean(),
  version: fc.constantFrom('0.9.0', '1.0.0', '1.1.0', '2.0.0', ''),
  acknowledged_at: fc.constant(ISO),
  items: fc.subarray(REQUIRED_IDS),
});
const recordOrNullArb = fc.option(recordArb, { nil: null });

// Guaranteed-incomplete states.
const incompleteArb = fc.oneof(
  fc.constant<AcknowledgementRecord | null>(null),
  fc.record({
    acknowledged: fc.constant(false),
    version: fc.constant(ACKNOWLEDGEMENT_VERSION),
    acknowledged_at: fc.constant(ISO),
    items: fc.constant([...REQUIRED_IDS]),
  }),
  // missing exactly one required item
  fc.integer({ min: 0, max: 5 }).map((i) => ({
    acknowledged: true as const,
    version: ACKNOWLEDGEMENT_VERSION,
    acknowledged_at: ISO,
    items: REQUIRED_IDS.filter((_, idx) => idx !== i),
  })),
  // stale version
  fc.record({
    acknowledged: fc.constant(true),
    version: fc.constant('0.0.1'),
    acknowledged_at: fc.constant(ISO),
    items: fc.constant([...REQUIRED_IDS]),
  })
);

describe('guardAuthenticatedAction — gate soundness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Feature: compliance-onboarding, Property 1: For any invocation of an Authenticated_Action, the guard permits the action if and only if isOnboardingComplete evaluates to true for the locally stored Acknowledgement_Record; when false, it returns an ONBOARDING_REQUIRED error and does not read Install_Credentials or dispatch any request.
  it('Property 1: allowed iff isOnboardingComplete (>=100 runs)', async () => {
    await fc.assert(
      fc.asyncProperty(recordOrNullArb, async (record) => {
        mockGetAck.mockResolvedValue(record);
        const result = await guardAuthenticatedAction();
        expect(result.allowed).toBe(isOnboardingComplete(record, ACKNOWLEDGEMENT_VERSION));
        if (!result.allowed) {
          expect(result.error.code).toBe('ONBOARDING_REQUIRED');
        }
      }),
      { numRuns: 200 }
    );
  });
});

describe('gate fail-closed behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Feature: compliance-onboarding, Property 2: For any state in which the Acknowledgement_Record is missing, unreadable, or structurally invalid, isOnboardingComplete evaluates to false and the gate blocks Authenticated_Actions; a read failure does not imply completion even if a record may exist, and gated actions never read credentials or dispatch a request.
  it('Property 2: incomplete states stay blocked and never read creds or fetch (>=100 runs)', async () => {
    await fc.assert(
      fc.asyncProperty(incompleteArb, async (record) => {
        mockGetAck.mockResolvedValue(record);
        mockGetCreds.mockClear();
        mockFetch.mockClear();

        const gate = await guardAuthenticatedAction();
        expect(gate.allowed).toBe(false);

        await expect(
          guardedAuthenticatedFetch('https://api.test', '/v1/auth/verify', { method: 'POST' })
        ).rejects.toThrow();

        const verifyResult = await guardedVerifyAuth('https://api.test');
        expect(verifyResult.success).toBe(false);

        expect(mockGetCreds).not.toHaveBeenCalled();
        expect(mockFetch).not.toHaveBeenCalled();
      }),
      { numRuns: 120 }
    );
  });
});

describe('public status availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Feature: compliance-onboarding, Property 6: For any onboarding state (complete or incomplete), the public Status_Endpoint connectivity check (checkStatus -> GET /v1/status) remains invokable and does not pass through or get blocked by the onboarding gate.
  it('Property 6: checkStatus succeeds for any onboarding state and never consults the gate (>=100 runs)', async () => {
    await fc.assert(
      fc.asyncProperty(recordOrNullArb, async (record) => {
        mockGetAck.mockResolvedValue(record);
        mockGetAck.mockClear();
        mockFetch.mockReset();
        mockFetch.mockResolvedValue(new Response(JSON.stringify(validStatus), { status: 200 }));

        const result = await checkStatus('https://api.test');
        expect(result.success).toBe(true);
        // The public status path does not read the onboarding record.
        expect(mockGetAck).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });
});

describe('gating examples', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks an authenticated action with ONBOARDING_REQUIRED while incomplete (Req 7.3)', async () => {
    mockGetAck.mockResolvedValue(null);
    const gate = await guardAuthenticatedAction();
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.error.code).toBe('ONBOARDING_REQUIRED');
    }
  });

  it('permits an authenticated action once complete (Req 7.3)', async () => {
    mockGetAck.mockResolvedValue(completeRecord);
    const gate = await guardAuthenticatedAction();
    expect(gate.allowed).toBe(true);
  });

  it('guardedAuthenticatedFetch delegates to authenticatedFetch when complete', async () => {
    mockGetAck.mockResolvedValue(completeRecord);
    mockGetCreds.mockResolvedValue({ installId: 'id', installToken: 'tok' });
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));

    const res = await guardedAuthenticatedFetch('https://api.test', '/v1/auth/verify', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(mockGetCreds).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.test/v1/auth/verify');
  });

  it('guardedAuthenticatedFetch throws ONBOARDING_REQUIRED without reading creds or fetching when incomplete', async () => {
    mockGetAck.mockResolvedValue(null);
    let caught: unknown;
    try {
      await guardedAuthenticatedFetch('https://api.test', '/v1/auth/verify', { method: 'POST' });
    } catch (err) {
      caught = err;
    }
    expect((caught as { code?: string }).code).toBe('ONBOARDING_REQUIRED');
    expect(mockGetCreds).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('guardedVerifyAuth returns an ONBOARDING_REQUIRED result when incomplete', async () => {
    mockGetAck.mockResolvedValue(null);
    const result = await guardedVerifyAuth('https://api.test');
    expect(result.success).toBe(false);
    if (!result.success && 'code' in result.error) {
      expect(result.error.code).toBe('ONBOARDING_REQUIRED');
      expect(result.error.type).toBe('onboarding');
    }
    expect(mockGetCreds).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('guardedVerifyAuth delegates and returns success when complete', async () => {
    mockGetAck.mockResolvedValue(completeRecord);
    mockGetCreds.mockResolvedValue({ installId: 'id', installToken: 'tok' });
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, install_id: 'id' }), { status: 200 })
    );
    const result = await guardedVerifyAuth('https://api.test');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.install_id).toBe('id');
    }
  });

  it('checkStatus succeeds (mocked 200) while onboarding is incomplete (Req 7.5)', async () => {
    mockGetAck.mockResolvedValue(null);
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(new Response(JSON.stringify(validStatus), { status: 200 }));
    const result = await checkStatus('https://api.test');
    expect(result.success).toBe(true);
  });
});
