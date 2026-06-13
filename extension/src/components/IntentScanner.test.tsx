// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

import { IntentScanner } from './IntentScanner';
import type { CompareResponse } from '../types';

// Mock the EXISTING authenticated client so the optional Compare path is driven
// without real network access; runCompareLookup runs for real on top of it.
vi.mock('../lib/api-client', () => ({
  authenticatedFetch: vi.fn(),
}));
import { authenticatedFetch } from '../lib/api-client';
const mockAuthFetch = vi.mocked(authenticatedFetch);

// chrome.storage.local stub used by getWorkerApiBaseUrl during Compare.
const mockStorageGet = vi.fn(async () => ({ rma_worker_api_base_url: 'https://api.test' }));
vi.stubGlobal('chrome', { storage: { local: { get: mockStorageGet } } });

const successBody: CompareResponse = {
  candidate: { merchant: 'amazon' },
  match_count: 2,
  matches: [
    { merchant: 'Amazon', coupon_code: 'SAVE10', description: '10% off electronics', score: 8, source: 'mock-couponsriver' },
    { merchant: 'Amazon', description: 'Free shipping over $25', score: 5, source: 'mock-couponsriver' },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function analyze(value: string): void {
  fireEvent.change(screen.getByRole('textbox'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: /^analyze$/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockStorageGet.mockResolvedValue({ rma_worker_api_base_url: 'https://api.test' });
});

afterEach(() => {
  cleanup();
});

describe('IntentScanner — full local-analysis flow (Req 1.1, 6.1–6.6, 7.1–7.5)', () => {
  it('renders the input control and Compare control after analysis, with category, confidence, candidates, and all four reminders', () => {
    render(<IntentScanner />);

    // Input control is present from the start (Req 1.1).
    expect(screen.getByRole('textbox')).toBeTruthy();

    analyze('amazon coupon code save20 deal');

    // Category + confidence (Req 6.1, 6.2).
    expect(screen.getByTestId('intent-category').textContent).toBe('Coupon seeking');
    expect(screen.getByTestId('intent-confidence').textContent).toMatch(/%$/);

    // Candidate list (Req 6.3).
    const list = screen.getByTestId('candidate-list');
    expect(list.textContent).toContain('amazon');
    expect(list.textContent).toContain('save20');

    // Compare control is present after a successful analysis (Req 5.1).
    expect(screen.getByRole('button', { name: /compare with couponsriver/i })).toBeTruthy();

    // All four compliance reminders (Req 7.1–7.4).
    const reminders = screen.getByTestId('compliance-reminders');
    expect(reminders.querySelectorAll('li')).toHaveLength(4);
    expect(reminders.textContent).toMatch(/no automated reddit action/i);
    expect(reminders.textContent).toMatch(/subreddit rules/i);
    expect(reminders.textContent).toMatch(/disclos/i);
    expect(reminders.textContent).toMatch(/advisory/i);
  });

  it('shows the empty-candidate indicator when no candidates are detected (Req 6.4)', () => {
    render(<IntentScanner />);
    analyze('which is better');

    expect(screen.getByTestId('intent-category').textContent).toBe('Product comparison');
    expect(screen.getByTestId('no-candidates')).toBeTruthy();
    expect(screen.queryByTestId('candidate-list')).toBeNull();
  });

  it('shows a validation message and withholds results for empty input (Req 1.4)', () => {
    render(<IntentScanner />);
    analyze('    ');

    expect(screen.getByRole('alert').textContent).toMatch(/enter some text/i);
    expect(screen.queryByTestId('analysis-results')).toBeNull();
  });

  it('shows the max-length message for over-limit input (Req 1.5)', () => {
    render(<IntentScanner />);
    analyze('a'.repeat(10001));

    expect(screen.getByRole('alert').textContent).toMatch(/10,000-character maximum/i);
    expect(screen.queryByTestId('analysis-results')).toBeNull();
  });
});

describe('IntentScanner — optional Compare (Req 5.1, 5.5, 5.6, 6.5)', () => {
  it('renders the match count and matches on a successful Compare', async () => {
    mockAuthFetch.mockResolvedValue(jsonResponse(successBody, 200));
    render(<IntentScanner />);
    analyze('amazon coupon code save20 deal');

    fireEvent.click(screen.getByRole('button', { name: /compare with couponsriver/i }));

    await waitFor(() => expect(screen.getByTestId('compare-success')).toBeTruthy());
    expect(screen.getByTestId('compare-success').textContent).toMatch(/2 matches found/i);
    const matches = screen.getByTestId('compare-matches');
    expect(matches.textContent).toContain('10% off electronics');
    expect(matches.textContent).toContain('SAVE10');

    // Reused the existing client at the existing endpoint (Req 5.3, 5.4).
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);
    expect(mockAuthFetch.mock.calls[0][1]).toBe('/v1/compare');
  });

  it('renders a categorized failure indicator while preserving local results (Req 5.6)', async () => {
    mockAuthFetch.mockRejectedValue(new Error('Network failed'));
    render(<IntentScanner />);
    analyze('amazon coupon code save20 deal');

    const categoryBefore = screen.getByTestId('intent-category').textContent;
    const candidatesBefore = screen.getByTestId('candidate-list').textContent;

    fireEvent.click(screen.getByRole('button', { name: /compare with couponsriver/i }));

    await waitFor(() => expect(screen.getByTestId('compare-failure')).toBeTruthy());

    // Local results are preserved, not discarded.
    expect(screen.getByTestId('intent-category').textContent).toBe(categoryBefore);
    expect(screen.getByTestId('candidate-list').textContent).toBe(candidatesBefore);
    expect(screen.getByTestId('intent-confidence')).toBeTruthy();
    // No partial/success match data on failure.
    expect(screen.queryByTestId('compare-success')).toBeNull();
    expect(screen.queryByTestId('compare-matches')).toBeNull();
  });
});

describe('IntentScanner — behavioral guards (Property 7; Req 1.4, 5.6, 5.7, 5.8)', () => {
  it('performs zero network requests during local analysis when Compare is not clicked', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    render(<IntentScanner />);
    analyze('amazon coupon code save20 deal');

    expect(screen.getByTestId('analysis-results')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockAuthFetch).not.toHaveBeenCalled();
  });

  it('does not reuse a previous analysis result after an empty submit', () => {
    render(<IntentScanner />);

    // First, a valid analysis renders results.
    analyze('amazon coupon code save20 deal');
    expect(screen.getByTestId('analysis-results')).toBeTruthy();

    // Then an empty submit must withhold results (no stale reuse).
    analyze('   ');
    expect(screen.getByRole('alert').textContent).toMatch(/enter some text/i);
    expect(screen.queryByTestId('analysis-results')).toBeNull();
    expect(screen.queryByTestId('intent-category')).toBeNull();
  });
});
