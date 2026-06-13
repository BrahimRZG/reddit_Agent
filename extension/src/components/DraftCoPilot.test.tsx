// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// Mock the draft-generator module while preserving the REAL implementations as
// spies (vi.fn(actual.*)). This lets every test exercise the genuine,
// spec-compliant generator/validator, while a single UI-state test can override
// the spies (mockReturnValueOnce) to drive the "unsafe" banner — a state the
// real generator never returns because it always discloses and scrubs
// concealing language. Mocking the generator for that one UI-state test does
// NOT modify source.
vi.mock('../lib/draft-generator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/draft-generator')>();
  return {
    ...actual,
    generateDraft: vi.fn(actual.generateDraft),
    validateDraftInput: vi.fn(actual.validateDraftInput),
  };
});

import { DraftCoPilot } from './DraftCoPilot';
import { generateDraft, validateDraftInput } from '../lib/draft-generator';
import { AFFILIATION_DISCLOSURE, MAX_SOURCE_LENGTH } from '../types';

const mockGenerate = vi.mocked(generateDraft);
const mockValidate = vi.mocked(validateDraftInput);

// --- Clipboard stub ----------------------------------------------------------
// jsdom does not implement navigator.clipboard. Stub writeText so the Copy
// control renders (clipboardAvailable() requires a writeText function) and so
// the copy assertion can observe the call. Restored in afterEach.
let writeTextMock: ReturnType<typeof vi.fn>;
let originalClipboardDescriptor: PropertyDescriptor | undefined;

function stubClipboard(): void {
  writeTextMock = vi.fn().mockResolvedValue(undefined);
  originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: writeTextMock },
    configurable: true,
    writable: true,
  });
}

function restoreClipboard(): void {
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
  } else {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  }
}

// --- Query/interaction helpers -----------------------------------------------

function sourceTextarea(): HTMLTextAreaElement {
  return screen.getByLabelText(/reddit context/i) as HTMLTextAreaElement;
}

function setSource(value: string): void {
  fireEvent.change(sourceTextarea(), { target: { value } });
}

function setUrl(value: string): void {
  fireEvent.change(screen.getByLabelText(/couponsriver url/i), { target: { value } });
}

function setIntent(value: string): void {
  fireEvent.change(screen.getByLabelText(/intent context json/i), { target: { value } });
}

function setCompare(value: string): void {
  fireEvent.change(screen.getByLabelText(/compare context json/i), { target: { value } });
}

function selectMode(container: HTMLElement, value: string): void {
  const radio = container.querySelector(
    `input[name="draft-mode"][value="${value}"]`,
  ) as HTMLInputElement;
  fireEvent.click(radio);
}

function clickGenerate(): void {
  fireEvent.click(screen.getByTestId('draft-generate-button'));
}

function preview(): HTMLTextAreaElement {
  return screen.getByTestId('draft-preview') as HTMLTextAreaElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  stubClipboard();
});

afterEach(() => {
  cleanup();
  restoreClipboard();
  vi.restoreAllMocks();
});

describe('DraftCoPilot — no draft until Generate (Req 2.3, 3.1)', () => {
  it('renders the inputs and mode selector but no draft/failure until Generate is clicked', () => {
    render(<DraftCoPilot />);

    // Inputs/controls are present from the start.
    expect(sourceTextarea()).toBeTruthy();
    expect(screen.getByTestId('draft-mode-selector')).toBeTruthy();
    expect(screen.getByTestId('draft-char-counter')).toBeTruthy();

    // No result, no failure indicator before Generate.
    expect(screen.queryByTestId('draft-result')).toBeNull();
    expect(screen.queryByTestId('draft-failure-indicator')).toBeNull();
    expect(screen.queryByTestId('draft-preview')).toBeNull();

    // Generation is never invoked on mount.
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});

describe('DraftCoPilot — validation withholds the draft (Req 1.6, 1.8, 2.2)', () => {
  it('empty Source_Text shows a validation message and produces no draft', () => {
    // Feature: draft-co-pilot, Property 9a: Safe Failure State (UI slice) — a
    // withheld generation must not display any draft text.
    const { container } = render(<DraftCoPilot />);
    selectMode(container, 'no-link-authority');
    setSource('   ');
    clickGenerate();

    expect(screen.getByTestId('draft-validation-error')).toBeTruthy();
    expect(screen.queryByTestId('draft-result')).toBeNull();
    expect(screen.queryByTestId('draft-preview')).toBeNull();
  });

  it('no mode selected shows "Select a reply mode." and produces no draft', () => {
    render(<DraftCoPilot />);
    setSource('Looking for a good laptop deal under $800.');
    clickGenerate();

    const error = screen.getByTestId('draft-validation-error');
    expect(error.textContent).toMatch(/select a reply mode/i);
    expect(screen.queryByTestId('draft-result')).toBeNull();
  });

  it('over-limit Source_Text shows a validation message and produces no draft', () => {
    const { container } = render(<DraftCoPilot />);
    // Use fireEvent.change with a long value rather than typing.
    setSource('a'.repeat(MAX_SOURCE_LENGTH + 1));
    selectMode(container, 'no-link-authority');
    clickGenerate();

    expect(screen.getByTestId('draft-validation-error')).toBeTruthy();
    expect(screen.queryByTestId('draft-result')).toBeNull();
  });
});

describe('DraftCoPilot — successful generation per mode (Req 4, 5, 6, 10)', () => {
  it('no-link-authority shows a selectable read-only preview with no URL and no disclosure', () => {
    const { container } = render(<DraftCoPilot />);
    setSource('What is a good budget mechanical keyboard? Visit https://spam.example for deals.');
    selectMode(container, 'no-link-authority');
    clickGenerate();

    const ta = preview();
    expect(ta).toBeTruthy();
    expect(ta.readOnly).toBe(true);
    expect(ta.value.trim().length).toBeGreaterThan(0);
    // No URL of any kind in a No-Link Authority draft.
    expect(ta.value).not.toMatch(/https?:\/\//);
    // No affiliation disclosure in a non-promotional draft.
    expect(ta.value).not.toContain(AFFILIATION_DISCLOSURE);
  });

  it('soft-cta-with-disclosure includes the disclosure, mentions CouponsRiver, and contains no URL', () => {
    const { container } = render(<DraftCoPilot />);
    setSource('Any recommendations for cheap running shoes?');
    selectMode(container, 'soft-cta-with-disclosure');
    clickGenerate();

    const value = preview().value;
    expect(value).toContain(AFFILIATION_DISCLOSURE);
    expect(value.toLowerCase()).toContain('couponsriver');
    expect(value).not.toMatch(/https?:\/\//);
  });

  it('disclosed-link includes the disclosure and the exact Operator-supplied URL', () => {
    const url = 'https://couponsriver.example/offer/shoes';
    const { container } = render(<DraftCoPilot />);
    setSource('Any recommendations for cheap running shoes?');
    setUrl(url);
    selectMode(container, 'disclosed-link');
    clickGenerate();

    const value = preview().value;
    expect(value).toContain(AFFILIATION_DISCLOSURE);
    expect(value).toContain(url);
  });
});

describe('DraftCoPilot — optional context parse notes are non-blocking (Req 1.2, 1.3)', () => {
  it('invalid Intent_Context JSON shows a note and still generates a draft', () => {
    const { container } = render(<DraftCoPilot />);
    setSource('Looking for a deal on noise-cancelling headphones.');
    setIntent('this is not json {');
    selectMode(container, 'no-link-authority');
    clickGenerate();

    expect(screen.getByTestId('draft-intent-parse-note')).toBeTruthy();
    expect(screen.getByTestId('draft-result')).toBeTruthy();
    expect(preview()).toBeTruthy();
  });

  it('invalid Compare_Context JSON shows a note and still generates a draft', () => {
    const { container } = render(<DraftCoPilot />);
    setSource('Looking for a deal on noise-cancelling headphones.');
    setCompare('{ broken json');
    selectMode(container, 'soft-cta-with-disclosure');
    clickGenerate();

    expect(screen.getByTestId('draft-compare-parse-note')).toBeTruthy();
    expect(screen.getByTestId('draft-result')).toBeTruthy();
    expect(preview()).toBeTruthy();
  });
});

describe('DraftCoPilot — unsafe draft state (Req 7.5, 7.6)', () => {
  it('renders the "Not ready — needs fixing" banner when the result is unsafe', () => {
    // The real generator always discloses and scrubs concealing language, so it
    // never returns an unsafe result. Override the spies for THIS generation
    // only to drive the unsafe UI state; restored automatically afterward.
    mockValidate.mockReturnValueOnce({ kind: 'valid' });
    mockGenerate.mockReturnValueOnce({
      kind: 'draft',
      mode: 'soft-cta-with-disclosure',
      draftText: 'A promotional draft body for UI-state testing.',
      warnings: [{ id: 'unsafe_concealing', message: 'Concealing language was detected.' }],
      safety: 'unsafe',
    });

    const { container } = render(<DraftCoPilot />);
    setSource('Anyone know where to buy this cheaper?');
    selectMode(container, 'soft-cta-with-disclosure');
    clickGenerate();

    const banner = screen.getByTestId('draft-safety-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toMatch(/not ready\s*—\s*needs fixing/i);
  });
});

describe('DraftCoPilot — copy uses clipboard only; no posting controls (Req 10, 12.8, 12.9)', () => {
  it('Copy calls navigator.clipboard.writeText with the draft, performs no network, and exposes no Reddit/post controls', async () => {
    // Feature: draft-co-pilot, Property 10: No Posting Controls — the panel must
    // never expose a post/submit/comment/publish/vote/share control, and copying
    // must go through the clipboard only (no network).
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { container } = render(<DraftCoPilot />);
    setSource('Any recommendations for cheap running shoes?');
    selectMode(container, 'soft-cta-with-disclosure');
    clickGenerate();

    const draftText = preview().value;

    fireEvent.click(screen.getByTestId('draft-copy-button'));

    await waitFor(() => expect(writeTextMock).toHaveBeenCalledTimes(1));
    expect(writeTextMock).toHaveBeenCalledWith(draftText);

    // Button reflects the copied state.
    await waitFor(() =>
      expect(screen.getByTestId('draft-copy-button').textContent).toMatch(/copied/i),
    );

    // No network call of any kind occurred.
    expect(fetchSpy).not.toHaveBeenCalled();

    // No Reddit/post/submit/publish/vote/share control exists — only the
    // "Generate draft" and "Copy" buttons.
    const buttons = container.querySelectorAll('button');
    buttons.forEach((button) => {
      expect(button.textContent ?? '').not.toMatch(
        /post|submit|comment|publish|upvote|downvote|share to reddit/i,
      );
    });
    expect(screen.getByTestId('draft-generate-button')).toBeTruthy();
    expect(screen.getByTestId('draft-copy-button')).toBeTruthy();
  });
});
