// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

import { Popup } from './Popup';
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
const openOptionsPage = vi.fn();
const mockFetch = vi.fn();

vi.stubGlobal('chrome', {
  storage: { local: { get: mockGet, set: mockSet, remove: mockRemove } },
  runtime: { openOptionsPage },
});
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  mockFetch.mockResolvedValue(new Response(JSON.stringify(validStatus), { status: 200 }));
});

afterEach(() => {
  cleanup();
});

describe('Popup — onboarding gate at the entry point (Req 2.1, 5.4)', () => {
  it('shows the Onboarding_Screen while incomplete, keeps Settings reachable, and the public status check still runs', async () => {
    // No onboarding record → incomplete.
    render(<Popup />);

    // The settings affordance is always present, even while incomplete.
    const settingsButton = screen.getByRole('button', { name: /open settings/i });
    expect(settingsButton).toBeTruthy();

    // The popup surface shows the Onboarding_Screen.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /accept and continue/i })).toBeTruthy()
    );

    // The public status check (GET /v1/status) is ungated and still runs.
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(String(mockFetch.mock.calls[0][0])).toContain('/v1/status');

    // Settings remains reachable from the popup.
    fireEvent.click(settingsButton);
    expect(openOptionsPage).toHaveBeenCalledTimes(1);
  });

  it('renders the normal status UI (not the Onboarding_Screen) when onboarding is complete', async () => {
    store.set(ONBOARDING_KEY, completeRecord);

    render(<Popup />);

    await waitFor(() => expect(screen.getByText(/connected/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /accept and continue/i })).toBeNull();
  });
});
