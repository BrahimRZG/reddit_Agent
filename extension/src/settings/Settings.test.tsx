// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

import { Settings } from './Settings';
import { STORAGE_KEYS } from '../types';
import { ACKNOWLEDGEMENT_VERSION, REQUIRED_ACKNOWLEDGEMENT_ITEM_IDS } from '../lib/onboarding';
import type { AcknowledgementRecord } from '../types';

const ONBOARDING_KEY = STORAGE_KEYS.ONBOARDING;

const completeRecord: AcknowledgementRecord = {
  acknowledged: true,
  version: ACKNOWLEDGEMENT_VERSION,
  acknowledged_at: '2024-01-01T00:00:00.000Z',
  items: [...REQUIRED_ACKNOWLEDGEMENT_ITEM_IDS],
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

// Map-backed chrome.storage.local mock.
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
  for (const [k, v] of Object.entries(items)) store.set(k, v);
});
const mockRemove = vi.fn(async (key: string | string[]) => {
  const keys = Array.isArray(key) ? key : [key];
  for (const k of keys) store.delete(k);
});
const mockFetch = vi.fn();

vi.stubGlobal('chrome', {
  storage: { local: { get: mockGet, set: mockSet, remove: mockRemove } },
  runtime: { openOptionsPage: vi.fn() },
});
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('Settings — authenticated control gating (Req 5.5)', () => {
  it('marks the authenticated control disabled while incomplete and routes to onboarding without a network call', async () => {
    // No onboarding record stored → incomplete.
    render(<Settings />);

    await waitFor(() =>
      expect(screen.getByTestId('onboarding-status').textContent).toMatch(/incomplete/i)
    );

    const authBtn = screen.getByTestId('authenticated-action');
    expect(authBtn.getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(authBtn);

    // Routed to the Onboarding_Screen and told to complete onboarding.
    await waitFor(() =>
      expect(
        screen.getByText(/complete compliance onboarding to use authenticated actions/i)
      ).toBeTruthy()
    );
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);

    // No authenticated request was dispatched (gate blocked before any fetch).
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('enables the authenticated control once onboarding is complete', async () => {
    store.set(ONBOARDING_KEY, completeRecord);
    render(<Settings />);

    await waitFor(() =>
      expect(screen.getByTestId('onboarding-status').textContent).toMatch(/complete/i)
    );
    expect(screen.getByTestId('authenticated-action').getAttribute('aria-disabled')).toBe(
      'false'
    );
  });
});

describe('Settings — public Save & Test stays ungated (Req 5.4)', () => {
  it('keeps Save & Test invokable while onboarding is incomplete and calls GET /v1/status', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify(validStatus), { status: 200 }));

    render(<Settings />);

    // Incomplete onboarding.
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-status').textContent).toMatch(/incomplete/i)
    );

    // The public Save & Test control is enabled regardless of onboarding state.
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: /save & test connection/i }) as HTMLButtonElement)
          .disabled
      ).toBe(false)
    );

    fireEvent.click(screen.getByRole('button', { name: /save & test connection/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(String(mockFetch.mock.calls[0][0])).toContain('/v1/status');
  });
});
