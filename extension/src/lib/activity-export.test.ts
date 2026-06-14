// @vitest-environment jsdom
/**
 * Spec 08-A — Compliance Activity Log & Export — `activity-export.ts` tests
 * (Task 7.3).
 *
 * Exercises the two LOCAL, browser-native delivery helpers in isolation:
 *  - `clipboardExport` → `navigator.clipboard.writeText` (resolve/reject paths)
 *  - `downloadExport`  → an in-page `Blob` object-URL anchor download that revokes
 *                        the object URL and removes the anchor afterward.
 *
 * Both paths must use NO Chrome extension API and NEVER `chrome.downloads`
 * (Property 11). `chrome` is stubbed with `downloads`/`storage` spies so we can
 * assert they are never touched. The jsdom environment supplies `document` and
 * `navigator`; `URL.createObjectURL` / `revokeObjectURL` are stubbed (jsdom does
 * not implement them). The React panel, popup wiring, and security scans are
 * separate slices and are NOT exercised here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { clipboardExport, downloadExport } from './activity-export';

// --- chrome stub (must never be touched by either export path) ---------------

const chromeDownloadsSpy = vi.fn();
const chromeStorageGetSpy = vi.fn();
const chromeStorageSetSpy = vi.fn();

beforeEach(() => {
  vi.stubGlobal('chrome', {
    downloads: { download: chromeDownloadsSpy },
    storage: { local: { get: chromeStorageGetSpy, set: chromeStorageSetSpy } },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function assertNoChromeApiUsed() {
  expect(chromeDownloadsSpy).not.toHaveBeenCalled();
  expect(chromeStorageGetSpy).not.toHaveBeenCalled();
  expect(chromeStorageSetSpy).not.toHaveBeenCalled();
}

// --- clipboardExport ---------------------------------------------------------

describe('clipboardExport', () => {
  it('calls navigator.clipboard.writeText with the document and resolves', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(clipboardExport('hello-doc')).resolves.toBeUndefined();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('hello-doc');
    assertNoChromeApiUsed();
  });

  it('rejects when navigator.clipboard.writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(clipboardExport('doc')).rejects.toThrow('clipboard denied');
    assertNoChromeApiUsed();
  });
});

// --- downloadExport ----------------------------------------------------------

describe('downloadExport', () => {
  const OBJECT_URL = 'blob:mock-activity-log';
  // Capture the genuine createElement ONCE, before any spy replaces it, so the
  // spy implementation can delegate to it without recursing into itself.
  const realCreateElement = document.createElement.bind(document);

  let createObjectURLSpy: MockInstance<any[], any>;
  let revokeObjectURLSpy: MockInstance<any[], any>;
  let createElementSpy: MockInstance<any[], any>;
  let capturedAnchor: HTMLAnchorElement | undefined;
  let clickSpy: MockInstance<any[], any> | undefined;
  let removeSpy: MockInstance<any[], any> | undefined;
  let clickShouldThrow = false;

  beforeEach(() => {
    capturedAnchor = undefined;
    clickSpy = undefined;
    removeSpy = undefined;
    clickShouldThrow = false;

    // jsdom does not implement object-URL helpers — define then spy.
    const urlAny = URL as unknown as {
      createObjectURL?: (b: Blob) => string;
      revokeObjectURL?: (u: string) => void;
    };
    urlAny.createObjectURL = () => OBJECT_URL;
    urlAny.revokeObjectURL = () => undefined;
    createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue(OBJECT_URL);
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    // Spy on createElement; for an anchor, capture it and spy on click/remove.
    createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tagName: string, options?: ElementCreationOptions) => {
        const el = realCreateElement(tagName as 'a', options);
        if (tagName === 'a') {
          capturedAnchor = el as HTMLAnchorElement;
          clickSpy = vi.spyOn(capturedAnchor, 'click').mockImplementation(() => {
            if (clickShouldThrow) {
              throw new Error('click failed');
            }
          });
          removeSpy = vi.spyOn(capturedAnchor, 'remove');
        }
        return el;
      });
  });

  it('builds a Blob with the given MIME type and passes it to URL.createObjectURL', () => {
    const doc = '{"a":1}';
    downloadExport(doc, 'activity-log.json', 'application/json');

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURLSpy.mock.calls[0][0] as Blob;
    expect(blobArg).toBeInstanceOf(Blob);
    expect(blobArg.type).toBe('application/json');
    // jsdom's Blob has no .text(); assert the byte length matches the document.
    expect(blobArg.size).toBe(new TextEncoder().encode(doc).length);
    assertNoChromeApiUsed();
  });

  it('creates an anchor, sets href to the object URL and download to the filename, and clicks it', () => {
    downloadExport('# Log', 'activity-log.md', 'text/markdown');

    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(capturedAnchor).toBeDefined();
    expect(capturedAnchor?.getAttribute('href')).toBe(OBJECT_URL);
    expect(capturedAnchor?.getAttribute('download')).toBe('activity-log.md');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    assertNoChromeApiUsed();
  });

  it('revokes the object URL and removes the anchor afterward', () => {
    downloadExport('data', 'activity-log.json', 'application/json');

    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith(OBJECT_URL);
    expect(removeSpy).toHaveBeenCalledTimes(1);
    // anchor is no longer attached to the document
    expect(capturedAnchor?.isConnected).toBe(false);
  });

  it('still revokes the object URL and removes the anchor when click throws', () => {
    clickShouldThrow = true;

    expect(() => downloadExport('data', 'activity-log.json', 'application/json')).toThrow(
      'click failed',
    );
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith(OBJECT_URL);
    expect(removeSpy).toHaveBeenCalledTimes(1);
    assertNoChromeApiUsed();
  });

  it('never invokes chrome.downloads (Property 11)', () => {
    downloadExport('data', 'activity-log.json', 'application/json');
    expect(chromeDownloadsSpy).not.toHaveBeenCalled();
  });
});
