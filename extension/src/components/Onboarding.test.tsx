// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// Mock the storage module so accept does not touch chrome.storage.local.
vi.mock('../lib/onboarding-storage', () => {
  class OnboardingStorageError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'OnboardingStorageError';
    }
  }
  return {
    setAcknowledgement: vi.fn(),
    OnboardingStorageError,
  };
});

import { Onboarding } from './Onboarding';
import { setAcknowledgement, OnboardingStorageError } from '../lib/onboarding-storage';
import { ACKNOWLEDGEMENT_VERSION, REQUIRED_ACKNOWLEDGEMENT_ITEM_IDS } from '../lib/onboarding';
import type { AcknowledgementRecord } from '../types';

const mockSet = vi.mocked(setAcknowledgement);

const acceptButton = () =>
  screen.getByRole('button', { name: /accept and continue/i }) as HTMLButtonElement;

beforeEach(() => {
  mockSet.mockReset();
  mockSet.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('Onboarding — content (Req 2.2–2.8, 3.1)', () => {
  it('renders the manual-assistant framing, the six unchecked checkboxes, the version, and a disabled accept control', () => {
    render(<Onboarding />);

    // Manual-assistant / not-a-bot framing (Req 2.2).
    expect(screen.getByText(/not a Reddit bot/i)).toBeTruthy();

    // Acknowledgement version is displayed (Req 2.8).
    expect(screen.getByTestId('acknowledgement-version').textContent).toContain(
      ACKNOWLEDGEMENT_VERSION
    );

    // Six checkboxes, all unchecked by default (Req 3.1).
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes).toHaveLength(6);
    checkboxes.forEach((cb) => expect(cb.checked).toBe(false));

    // Each disclosure statement renders as the checkbox label (Req 2.2–2.7).
    expect(
      screen.getByRole('checkbox', {
        name: /manual Reddit research and drafting assistant, not a Reddit automation bot/i,
      })
    ).toBeTruthy();
    expect(
      screen.getByRole('checkbox', {
        name: /not use the Extension to automate Reddit posting, voting, messaging, joining, following, or form submission/i,
      })
    ).toBeTruthy();
    expect(
      screen.getByRole('checkbox', {
        name: /review, edit, and manually submit all Reddit content/i,
      })
    ).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: /follow subreddit rules and Reddit policies/i })
    ).toBeTruthy();
    expect(
      screen.getByRole('checkbox', {
        name: /disclose affiliation when content is promotional or coupon-related/i,
      })
    ).toBeTruthy();
    expect(
      screen.getByRole('checkbox', {
        name: /spam, vote manipulation, impersonation, or ban evasion/i,
      })
    ).toBeTruthy();

    // Accept control starts disabled (Req 3.2).
    expect(acceptButton().getAttribute('aria-disabled')).toBe('true');
  });
});

describe('Onboarding — accept enable/disable (Req 3.2, 3.3)', () => {
  it('keeps accept disabled until all six items are checked, then enables it', () => {
    render(<Onboarding />);
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];

    // Five of six checked → still disabled (Req 3.2).
    for (let i = 0; i < 5; i++) {
      fireEvent.click(checkboxes[i]);
    }
    expect(acceptButton().getAttribute('aria-disabled')).toBe('true');

    // Sixth checked → enabled (Req 3.3).
    fireEvent.click(checkboxes[5]);
    expect(acceptButton().getAttribute('aria-disabled')).toBe('false');

    // Unchecking one re-disables (Req 3.2).
    fireEvent.click(checkboxes[0]);
    expect(acceptButton().getAttribute('aria-disabled')).toBe('true');
  });
});

describe('Onboarding — accept persistence (Req 3.4, 4.1–4.3)', () => {
  it('persists a complete record with acknowledged:true and all ids, then calls onComplete', async () => {
    const onComplete = vi.fn();
    render(<Onboarding onComplete={onComplete} />);

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    checkboxes.forEach((cb) => fireEvent.click(cb));

    fireEvent.click(acceptButton());

    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1));

    const record = mockSet.mock.calls[0][0] as AcknowledgementRecord;
    expect(record.acknowledged).toBe(true);
    expect(record.version).toBe(ACKNOWLEDGEMENT_VERSION);
    expect([...record.items].sort()).toEqual([...REQUIRED_ACKNOWLEDGEMENT_ITEM_IDS].sort());
    expect(record.acknowledged_at.length).toBeGreaterThan(0);
    expect(Number.isNaN(new Date(record.acknowledged_at).getTime())).toBe(false);

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });
});

describe('Onboarding — defensive guard (Req 3.5)', () => {
  it('does not persist and shows the missing-item message when accept is invoked while incomplete', () => {
    const onComplete = vi.fn();
    render(<Onboarding onComplete={onComplete} />);

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    // Only five of six checked.
    for (let i = 0; i < 5; i++) {
      fireEvent.click(checkboxes[i]);
    }

    // The control is marked disabled (aria-disabled) while incomplete, but the
    // defensive guard still runs if activated: it must not write and must show
    // the missing-item message (Req 3.5).
    fireEvent.click(acceptButton());

    expect(mockSet).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/accept every item/i);
  });
});

describe('Onboarding — write failure (Req 4.6)', () => {
  it('shows an inline error and stays incomplete when the write fails', async () => {
    mockSet.mockReset();
    mockSet.mockRejectedValueOnce(new OnboardingStorageError('Failed to write onboarding record: quota exceeded'));
    const onComplete = vi.fn();
    render(<Onboarding onComplete={onComplete} />);

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    checkboxes.forEach((cb) => fireEvent.click(cb));
    fireEvent.click(acceptButton());

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/quota exceeded/i)
    );
    // Stays incomplete: onComplete not called and the form (checkboxes) still shown.
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
  });
});

describe('Onboarding — completed-state summary (Task 6.2, Req 4.1, 4.2)', () => {
  it('renders the summary (version + timestamp) instead of the form when a complete record exists', () => {
    const record: AcknowledgementRecord = {
      acknowledged: true,
      version: ACKNOWLEDGEMENT_VERSION,
      acknowledged_at: '2024-01-01T00:00:00.000Z',
      items: [...REQUIRED_ACKNOWLEDGEMENT_ITEM_IDS],
    };
    render(<Onboarding record={record} />);

    expect(screen.getByTestId('onboarding-complete-summary')).toBeTruthy();
    expect(screen.getByTestId('summary-version').textContent).toContain(ACKNOWLEDGEMENT_VERSION);
    expect(screen.getByTestId('summary-timestamp').textContent?.length ?? 0).toBeGreaterThan(0);

    // Form is not shown.
    expect(screen.queryByRole('button', { name: /accept and continue/i })).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});
