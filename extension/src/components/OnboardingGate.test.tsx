// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

import { OnboardingGate } from './OnboardingGate';
import { guardAuthenticatedAction } from '../lib/onboarding-gate';
import { ACKNOWLEDGEMENT_VERSION, REQUIRED_ACKNOWLEDGEMENT_ITEM_IDS } from '../lib/onboarding';
import { STORAGE_KEYS } from '../types';
import type { AcknowledgementRecord } from '../types';

const ONBOARDING_KEY = STORAGE_KEYS.ONBOARDING;

const completeRecord: AcknowledgementRecord = {
  acknowledged: true,
  version: ACKNOWLEDGEMENT_VERSION,
  acknowledged_at: '2024-01-01T00:00:00.000Z',
  items: [...REQUIRED_ACKNOWLEDGEMENT_ITEM_IDS],
};

// Controllable chrome.storage.local mock + fetch spy.
const mockGet = vi.fn();
const mockSet = vi.fn(async () => {});
const mockRemove = vi.fn(async () => {});
const mockFetch = vi.fn();

vi.stubGlobal('chrome', {
  storage: { local: { get: mockGet, set: mockSet, remove: mockRemove } },
});
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('OnboardingGate — state machine (Req 2.1, 4.5)', () => {
  it('renders children only when onboarding is complete', async () => {
    mockGet.mockResolvedValue({ [ONBOARDING_KEY]: completeRecord });

    render(
      <OnboardingGate>
        <div data-testid="protected">authenticated content</div>
      </OnboardingGate>
    );

    await waitFor(() => expect(screen.getByTestId('protected')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /accept and continue/i })).toBeNull();
  });

  it('renders the Onboarding screen (never children) when no record exists', async () => {
    mockGet.mockResolvedValue({}); // no stored record

    render(
      <OnboardingGate>
        <div data-testid="protected">authenticated content</div>
      </OnboardingGate>
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /accept and continue/i })).toBeTruthy()
    );
    expect(screen.queryByTestId('protected')).toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
  });

  it('shows the Onboarding screen for a stale-version record (Req 4.5)', async () => {
    mockGet.mockResolvedValue({ [ONBOARDING_KEY]: { ...completeRecord, version: '0.0.1' } });

    render(
      <OnboardingGate>
        <div data-testid="protected">authenticated content</div>
      </OnboardingGate>
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /accept and continue/i })).toBeTruthy()
    );
    expect(screen.queryByTestId('protected')).toBeNull();
  });
});

describe('OnboardingGate — read-failure handling (Property 2, Req 1.7, 1.8)', () => {
  it('treats a read failure as incomplete: no children, actions blocked, recoverable error + Retry, recovers on re-read', async () => {
    // Initial read throws → gate resolves to read_error.
    mockGet.mockRejectedValueOnce(new Error('storage unavailable'));

    render(
      <OnboardingGate>
        <div data-testid="protected">authenticated content</div>
      </OnboardingGate>
    );

    // Recoverable storage error + Retry are shown; children are NOT rendered.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
    );
    expect(screen.getByRole('alert').textContent).toMatch(
      /couldn.?t read your onboarding status/i
    );
    expect(screen.queryByTestId('protected')).toBeNull();

    // The independent request-layer gate also stays blocked while the read
    // fails, and never dispatches a network call (Property 1/2).
    mockGet.mockRejectedValueOnce(new Error('storage unavailable'));
    const gate = await guardAuthenticatedAction();
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.error.code).toBe('ONBOARDING_REQUIRED');
    }
    expect(mockFetch).not.toHaveBeenCalled();

    // Retry with a successful, complete re-read → transitions to complete.
    mockGet.mockResolvedValue({ [ONBOARDING_KEY]: completeRecord });
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => expect(screen.getByTestId('protected')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('stays on the recoverable error screen when Retry still fails', async () => {
    mockGet.mockRejectedValue(new Error('storage unavailable'));

    render(
      <OnboardingGate>
        <div data-testid="protected">authenticated content</div>
      </OnboardingGate>
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
    );

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
    );
    expect(screen.queryByTestId('protected')).toBeNull();
  });
});
