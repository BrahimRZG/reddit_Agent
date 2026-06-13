// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

import { Popup } from './Popup';
import { STORAGE_KEYS } from '../types';
import { ACKNOWLEDGEMENT_VERSION, REQUIRED_ACKNOWLEDGEMENT_ITEM_IDS } from '../lib/onboarding';
import type { AcknowledgementRecord } from '../types';
import { generateDraft, validateDraftInput } from '../lib/draft-generator';
import { ReviewQueue } from '../components/ReviewQueue';

// Spec 06, Task 6.15: wrap the REAL draft-generator functions as spies so we can
// assert they are never invoked before the OnboardingGate completes (Req 11.2).
// The spies delegate to the genuine implementations, so every other test in this
// file behaves identically; vi.clearAllMocks() in beforeEach resets call counts
// before each test, and the implementations are preserved (clearAllMocks does not
// reset implementations).
vi.mock('../lib/draft-generator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/draft-generator')>();
  return {
    ...actual,
    generateDraft: vi.fn(actual.generateDraft),
    validateDraftInput: vi.fn(actual.validateDraftInput),
  };
});

// Spec 07, Task 6.12: mock the ReviewQueue component (mirroring the draft-generator
// mock above) so the popup gate tests can observe whether the panel MOUNTS. The mock
// renders a lightweight sentinel <div data-testid="review-queue-mock" /> and is a
// vi.fn, so we can assert both its presence in the DOM and its mount call-count.
// Because the real ReviewQueue runs `readQueue()` on mount, a 0 mount-count proves the
// real queue's read/write/mutation logic could never have fired before the gate opened
// (Req 11.2). vi.clearAllMocks() in beforeEach resets the call count but PRESERVES the
// implementation, so the sentinel still renders in every test.
vi.mock('../components/ReviewQueue', () => ({
  ReviewQueue: vi.fn(() => <div data-testid="review-queue-mock" />),
}));
const mockReviewQueue = vi.mocked(ReviewQueue);

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

describe('Popup — Draft Co-Pilot gate behavior (Spec 06, Req 11.2, 11.3, 11.4, 11.5)', () => {
  // Feature: draft-co-pilot, Property 13: the Draft_Co_Pilot lives inside the
  // OnboardingGate and does not mount/render/run any draft logic until
  // Compliance_Onboarding is complete; completing it preserves Specs 01/05.

  it('does not render DraftCoPilot when onboarding is incomplete (Req 11.2)', async () => {
    // No onboarding record in `store` → incomplete (missing).
    render(<Popup />);

    // The Onboarding_Screen is shown instead of the gated app body.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /accept and continue/i })).toBeTruthy()
    );

    // The Draft_Co_Pilot panel (and therefore its input/preview/controls) is not mounted.
    expect(screen.queryByTestId('draft-co-pilot')).toBeNull();
    expect(screen.queryByTestId('draft-generate-button')).toBeNull();
    expect(screen.queryByTestId('draft-preview')).toBeNull();
  });

  it('does not render DraftCoPilot in the read_error gate state (Req 11.2)', async () => {
    // Drive OnboardingGate into its fail-closed read_error state by making the
    // onboarding storage read throw. readAcknowledgement maps a thrown
    // chrome.storage.local.get into { kind: 'read_error' }, which the gate
    // resolves to incomplete/read_error and never renders children. The
    // OnboardingGate's mount effect (child) runs before Popup's (parent), so the
    // first storage read is the onboarding read.
    mockGet.mockRejectedValueOnce(new Error('read failed'));

    render(<Popup />);

    // The recoverable read-error UI is shown (text + Retry), not the app body.
    await waitFor(() =>
      expect(screen.getByText(/couldn'?t read your onboarding status/i)).toBeTruthy()
    );
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();

    // The Draft_Co_Pilot panel is not mounted in the read_error state.
    expect(screen.queryByTestId('draft-co-pilot')).toBeNull();
    expect(screen.queryByTestId('draft-generate-button')).toBeNull();
    expect(screen.queryByTestId('draft-preview')).toBeNull();
  });

  it('renders DraftCoPilot when onboarding is complete, below the Intent Scanner (Req 11.3, 11.4, 11.5)', async () => {
    store.set(ONBOARDING_KEY, completeRecord);

    render(<Popup />);

    // Normal app body renders once onboarding is complete.
    await waitFor(() => expect(screen.getByText(/connected/i)).toBeTruthy());

    // The Draft_Co_Pilot panel is mounted (Req 11.3).
    const draftPanel = screen.getByTestId('draft-co-pilot');
    expect(draftPanel).toBeTruthy();

    // The Spec 05 Intent_Scanner gate behavior is unchanged — it still renders (Req 11.5).
    const intentHeading = screen.getByText(/intent scanner/i);
    expect(intentHeading).toBeTruthy();

    // Intent_Scanner appears BEFORE the Draft_Co_Pilot in document order, as a
    // distinct section below it (Req 11.4). DOCUMENT_POSITION_FOLLOWING means the
    // draft panel follows the intent heading.
    const position = intentHeading.compareDocumentPosition(draftPanel);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('Popup — draft generation is not invoked before gate completion (Spec 06, Req 11.2)', () => {
  // Feature: draft-co-pilot, Property 13: no draft generation logic runs before
  // Compliance_Onboarding completion.

  it('does not invoke generateDraft while onboarding is incomplete', async () => {
    // No onboarding record → incomplete.
    render(<Popup />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /accept and continue/i })).toBeTruthy()
    );

    // The panel never mounted, so no draft generation could have run.
    expect(generateDraft).not.toHaveBeenCalled();
    expect(validateDraftInput).not.toHaveBeenCalled();
  });

  it('does not invoke generateDraft in the read_error gate state', async () => {
    mockGet.mockRejectedValueOnce(new Error('read failed'));

    render(<Popup />);

    await waitFor(() =>
      expect(screen.getByText(/couldn'?t read your onboarding status/i)).toBeTruthy()
    );

    expect(generateDraft).not.toHaveBeenCalled();
    expect(validateDraftInput).not.toHaveBeenCalled();
  });
});

describe('Popup — Review Queue gate behavior (Spec 07, Req 11.1–11.5)', () => {
  // Feature: review-queue, Property 13: Gate Containment — the Review_Queue lives
  // inside the OnboardingGate and does not mount/render/run any queue logic
  // (including readQueue-on-mount) until Compliance_Onboarding is complete;
  // completing it preserves the Spec 05 Intent_Scanner and Spec 06 Draft_Co_Pilot
  // sections below which the Review_Queue renders (Req 11.1–11.5).

  it('incomplete onboarding does not render ReviewQueue', async () => {
    // No onboarding record in `store` → incomplete (missing).
    render(<Popup />);

    // The Onboarding_Screen is shown instead of the gated app body.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /accept and continue/i })).toBeTruthy()
    );

    // The Review_Queue panel is not mounted and its sentinel is absent (Req 11.2).
    expect(screen.queryByTestId('review-queue-mock')).toBeNull();
    expect(mockReviewQueue).not.toHaveBeenCalled();
  });

  it('read_error onboarding does not render ReviewQueue', async () => {
    // Drive OnboardingGate into its fail-closed read_error state by making the
    // onboarding storage read throw. The gate resolves to read_error and never
    // renders children, so the Review_Queue never mounts (Req 11.2).
    mockGet.mockRejectedValueOnce(new Error('read failed'));

    render(<Popup />);

    // The recoverable read-error UI is shown (text + Retry), not the app body.
    await waitFor(() =>
      expect(screen.getByText(/couldn'?t read your onboarding status/i)).toBeTruthy()
    );
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();

    // The Review_Queue panel is not mounted in the read_error state (Req 11.2).
    expect(screen.queryByTestId('review-queue-mock')).toBeNull();
    expect(mockReviewQueue).not.toHaveBeenCalled();
  });

  it('completed onboarding renders ReviewQueue, below IntentScanner and DraftCoPilot', async () => {
    store.set(ONBOARDING_KEY, completeRecord);

    render(<Popup />);

    // Normal app body renders once onboarding is complete (Req 11.3).
    await waitFor(() => expect(screen.getByText(/connected/i)).toBeTruthy());

    // The Review_Queue panel is mounted (Req 11.3).
    const reviewQueue = screen.getByTestId('review-queue-mock');
    expect(reviewQueue).toBeTruthy();

    // The Spec 05 Intent_Scanner and the Spec 06 Draft_Co_Pilot sections are both
    // preserved and still render (Req 11.5).
    const intentHeading = screen.getByText(/intent scanner/i);
    const draftPanel = screen.getByTestId('draft-co-pilot');
    expect(intentHeading).toBeTruthy();
    expect(draftPanel).toBeTruthy();

    // DOM ordering (Req 11.4): the Review_Queue renders as a distinct section BELOW
    // both the Intent_Scanner and the Draft_Co_Pilot. DOCUMENT_POSITION_FOLLOWING
    // means the second node follows the first in document order.
    //   Intent_Scanner heading → Draft_Co_Pilot panel → Review_Queue panel
    expect(
      intentHeading.compareDocumentPosition(draftPanel) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      draftPanel.compareDocumentPosition(reviewQueue) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});

describe('Popup — Review Queue load logic is not invoked before gate completion (Req 11.2)', () => {
  // Feature: review-queue, Property 13: Gate Containment. Because OnboardingGate does
  // not render its children before Compliance_Onboarding completes (and fails closed
  // on read_error), the (mocked) ReviewQueue never mounts. The mock stands in for the
  // real component, whose mount effect runs readQueue(); a 0 mount-count therefore
  // proves the real queue's read/write/mutation logic would never fire pre-completion.

  it('incomplete onboarding → ReviewQueue mount spy not called', async () => {
    // No onboarding record → incomplete.
    render(<Popup />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /accept and continue/i })).toBeTruthy()
    );

    // The panel never mounted, so its real readQueue-on-mount effect never ran.
    expect(mockReviewQueue).toHaveBeenCalledTimes(0);
  });

  it('read_error → ReviewQueue mount spy not called', async () => {
    mockGet.mockRejectedValueOnce(new Error('read failed'));

    render(<Popup />);

    await waitFor(() =>
      expect(screen.getByText(/couldn'?t read your onboarding status/i)).toBeTruthy()
    );

    // The panel never mounted in the read_error state, so its real readQueue-on-mount
    // effect never ran.
    expect(mockReviewQueue).toHaveBeenCalledTimes(0);
  });

  it('keeps Settings reachable while onboarding is incomplete (Req 11.5, 13.x)', async () => {
    // Re-assert (without altering the existing entry-point test) that the always-on
    // Settings affordance remains reachable while the gate withholds the app body.
    render(<Popup />);

    const settingsButton = screen.getByRole('button', { name: /open settings/i });
    expect(settingsButton).toBeTruthy();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /accept and continue/i })).toBeTruthy()
    );

    fireEvent.click(settingsButton);
    expect(openOptionsPage).toHaveBeenCalledTimes(1);
  });
});
