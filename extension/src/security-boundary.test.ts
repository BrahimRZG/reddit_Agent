import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const EXTENSION_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(EXTENSION_ROOT, '..');

describe('Security boundary verification', () => {
  describe('manifest.json', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(EXTENSION_ROOT, 'manifest.json'), 'utf-8')
    );

    it('has no content_scripts', () => {
      expect(manifest.content_scripts).toBeUndefined();
    });

    it('has no activeTab permission', () => {
      expect(manifest.permissions).not.toContain('activeTab');
    });

    it('has no tabs permission', () => {
      expect(manifest.permissions).not.toContain('tabs');
    });

    it('has no scripting permission', () => {
      expect(manifest.permissions).not.toContain('scripting');
    });

    it('has only storage permission', () => {
      expect(manifest.permissions).toEqual(['storage']);
    });

    it('has only approved host permissions', () => {
      expect(manifest.host_permissions).toEqual([
        'https://*.workers.dev/*',
        'http://localhost/*',
        'http://127.0.0.1/*',
      ]);
    });
  });

  describe('Extension source code', () => {
    const extensionSrc = resolve(EXTENSION_ROOT, 'src');

    it('contains no API_KEY references', () => {
      expect(searchSourceFiles(extensionSrc, 'API_KEY')).toEqual([]);
    });

    it('contains no OPENAI references', () => {
      expect(searchSourceFiles(extensionSrc, 'OPENAI')).toEqual([]);
    });

    it('contains no REDDIT_CLIENT references', () => {
      expect(searchSourceFiles(extensionSrc, 'REDDIT_CLIENT')).toEqual([]);
    });
  });

  describe('wrangler.toml', () => {
    const wranglerContent = readFileSync(
      resolve(REPO_ROOT, 'worker-api/wrangler.toml'),
      'utf-8'
    );

    it('does not expose secrets in [vars]', () => {
      expect(wranglerContent).not.toContain('INSTALL_TOKEN_PEPPER =');
      expect(wranglerContent).not.toContain('ADMIN_BOOTSTRAP_SECRET =');
    });
  });
});

function searchSourceFiles(dir: string, pattern: string): string[] {
  const matches: string[] = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') {
        continue;
      }

      matches.push(...searchSourceFiles(fullPath, pattern));
      continue;
    }

    if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) {
      continue;
    }

    if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) {
      continue;
    }

    const content = readFileSync(fullPath, 'utf-8');

    if (content.includes(pattern)) {
      matches.push(fullPath);
    }
  }

  return matches;
}


// --- Spec 05: Intent Scanner scope & permission containment ---

/** Spec 05 source files (manual-input-only Intent_Scanner; no shared types). */
const SPEC_05_SOURCE_FILES = [
  'src/lib/intent-normalizer.ts',
  'src/lib/intent-classifier.ts',
  'src/lib/intent-extractor.ts',
  'src/lib/intent-analyzer.ts',
  'src/lib/intent-compare.ts',
  'src/components/IntentScanner.tsx',
  'src/popup/Popup.tsx',
];

/**
 * Out-of-scope tokens that must never appear in Spec 05 source or the manifest
 * (Property 9). Matched case-insensitively. Deliberately specific (e.g. `/v1/scan`,
 * not bare `scan`) so legitimate identifiers like `IntentScanner` are not flagged.
 */
const FORBIDDEN_SCOPE_TOKENS = [
  '/v1/scan',
  'chrome.alarms',
  'chrome.notifications',
  'content_scripts',
  'reddit.com',
  'old.reddit.com',
  'firecrawl',
  'scraping',
  'ip rotation',
  'rss feed',
  'openai',
];

describe('Spec 05 — Intent Scanner permission containment (Property 10)', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(EXTENSION_ROOT, 'manifest.json'), 'utf-8')
  );

  it('keeps manifest.permissions exactly ["storage"] (no new permission)', () => {
    expect(manifest.permissions).toEqual(['storage']);
  });

  it('keeps host_permissions exactly the three approved entries (no new host)', () => {
    expect(manifest.host_permissions).toEqual([
      'https://*.workers.dev/*',
      'http://localhost/*',
      'http://127.0.0.1/*',
    ]);
  });

  it('still declares no content_scripts', () => {
    expect(manifest.content_scripts).toBeUndefined();
  });
});

describe('Spec 05 — Manual-input-only scope exclusion (Property 9)', () => {
  it('Spec 05 source files contain none of the out-of-scope tokens', () => {
    for (const relativePath of SPEC_05_SOURCE_FILES) {
      const content = readFileSync(resolve(EXTENSION_ROOT, relativePath), 'utf-8').toLowerCase();
      for (const token of FORBIDDEN_SCOPE_TOKENS) {
        expect(
          content.includes(token),
          `${relativePath} unexpectedly references "${token}"`
        ).toBe(false);
      }
    }
  });

  it('the manifest contains none of the out-of-scope tokens', () => {
    const manifestRaw = readFileSync(resolve(EXTENSION_ROOT, 'manifest.json'), 'utf-8').toLowerCase();
    for (const token of FORBIDDEN_SCOPE_TOKENS) {
      expect(manifestRaw.includes(token), `manifest references "${token}"`).toBe(false);
    }
  });

  it('the only Worker endpoint referenced by Spec 05 source is /v1/compare', () => {
    const compareSource = readFileSync(
      resolve(EXTENSION_ROOT, 'src/lib/intent-compare.ts'),
      'utf-8'
    );
    expect(compareSource).toContain('/v1/compare');
    expect(compareSource).not.toContain('/v1/scan');
  });
});

// --- Spec 06: Draft Co-Pilot scope & permission containment ---

/**
 * Spec 06 source files (local, deterministic, Extension-UI-only Draft_Co_Pilot):
 * the shared types module, the two pure logic modules, the React panel, and the
 * popup wiring. The drafting path touches no other file.
 */
const SPEC_06_SOURCE_FILES = [
  'src/types/index.ts',
  'src/lib/draft-compliance.ts',
  'src/lib/draft-generator.ts',
  'src/components/DraftCoPilot.tsx',
  'src/popup/Popup.tsx',
];

/**
 * The draft *logic + component* files only. `Popup.tsx` is intentionally
 * excluded from the no-network scan because it legitimately wires the existing
 * Spec 01 connection-status check through the api-client (`checkStatus`);
 * `Popup.tsx` is still covered by the forbidden-scope token scan below (where it
 * stays clean).
 */
const SPEC_06_DRAFT_LOGIC_FILES = [
  'src/lib/draft-generator.ts',
  'src/lib/draft-compliance.ts',
  'src/components/DraftCoPilot.tsx',
];

/**
 * Out-of-scope tokens that must never appear in Spec 06 source or the manifest
 * (Property 11 — Manual-Input-Only Scope). Matched case-insensitively.
 * Deliberately specific (e.g. `/v1/draft`, not bare `draft`) so legitimate
 * identifiers are not flagged.
 *
 * NOTE: `openai` and `llm` are intentionally NOT scanned as bare tokens here.
 * The Spec 06 draft modules legitimately *document* that they MUST NOT call
 * "OpenAI / LLM / AI provider" in their file-header compliance comments, so a
 * bare-substring scan would false-positive on that documentation rather than on
 * a real violation. The no-network / no-AI guarantee is instead enforced
 * positively by the no-`fetch`/no-`authenticatedFetch`/no-`XMLHttpRequest`
 * assertions below and by the generator's own property tests (Property 2).
 * `/v1/draft` keeps the Worker-draft-endpoint prohibition meaningful.
 */
const SPEC_06_FORBIDDEN_SCOPE_TOKENS = [
  '/v1/draft',
  'chrome.alarms',
  'chrome.notifications',
  'content_scripts',
  'reddit.com',
  'old.reddit.com',
  'firecrawl',
  'scraping',
  'ip rotation',
];

/**
 * Posting / automation control tokens that must never appear in the draft panel
 * or the popup (Property 10 — No Posting Controls). The Draft_Co_Pilot's only
 * controls are "Generate draft" and "Copy"; there is no post/submit/comment/
 * vote/auto-post control of any kind. Matched case-insensitively; deliberately
 * specific so the panel's compliance copy ("…post them yourself") is not flagged.
 */
const SPEC_06_POSTING_AUTOMATION_TOKENS = [
  'upvote',
  'downvote',
  '/api/submit',
  '/api/comment',
  '/api/vote',
  'submitform',
  'autopost',
  'auto-post',
  'auto_submit',
];

describe('Spec 06 — Draft Co-Pilot permission containment (Property 12)', () => {
  // Req 10.5, 12.1, 12.6, 13.6 — Spec 06 adds no permission and no host.
  const manifest = JSON.parse(
    readFileSync(resolve(EXTENSION_ROOT, 'manifest.json'), 'utf-8')
  );

  it('keeps manifest.permissions exactly ["storage"] (no alarms/notifications/tabs/scripting/activeTab)', () => {
    expect(manifest.permissions).toEqual(['storage']);
  });

  it('keeps host_permissions exactly the three approved entries (no reddit.com / old.reddit.com host)', () => {
    expect(manifest.host_permissions).toEqual([
      'https://*.workers.dev/*',
      'http://localhost/*',
      'http://127.0.0.1/*',
    ]);
  });

  it('still declares no content_scripts', () => {
    expect(manifest.content_scripts).toBeUndefined();
  });
});

describe('Spec 06 — Draft Co-Pilot manual-input-only scope exclusion (Properties 10, 11)', () => {
  // Req 1.5, 12.2, 12.3, 12.4, 12.5, 12.7, 12.8, 12.9, 12.10, 12.11.

  it('Spec 06 source files contain none of the out-of-scope tokens', () => {
    for (const relativePath of SPEC_06_SOURCE_FILES) {
      const content = readFileSync(resolve(EXTENSION_ROOT, relativePath), 'utf-8').toLowerCase();
      for (const token of SPEC_06_FORBIDDEN_SCOPE_TOKENS) {
        expect(
          content.includes(token),
          `${relativePath} unexpectedly references "${token}"`
        ).toBe(false);
      }
    }
  });

  it('the manifest contains none of the Spec 06 out-of-scope tokens', () => {
    const manifestRaw = readFileSync(
      resolve(EXTENSION_ROOT, 'manifest.json'),
      'utf-8'
    ).toLowerCase();
    for (const token of SPEC_06_FORBIDDEN_SCOPE_TOKENS) {
      expect(manifestRaw.includes(token), `manifest references "${token}"`).toBe(false);
    }
  });

  it('the draft logic + component files make no network call (no fetch / authenticatedFetch / XMLHttpRequest)', () => {
    // Req 3.3, 3.4, 12.10, 12.11 — drafting is purely local/in-memory. We scan
    // for the *call form* (`fetch(` / `authenticatedfetch(`) because the modules
    // document, in their header comments, that they MUST NOT call those
    // functions; scanning the call form catches a real invocation without
    // false-positiving on that compliance documentation.
    for (const relativePath of SPEC_06_DRAFT_LOGIC_FILES) {
      const content = readFileSync(resolve(EXTENSION_ROOT, relativePath), 'utf-8').toLowerCase();
      expect(content.includes('fetch('), `${relativePath} calls fetch(`).toBe(false);
      expect(
        content.includes('authenticatedfetch('),
        `${relativePath} calls authenticatedFetch(`
      ).toBe(false);
      expect(
        content.includes('xmlhttprequest'),
        `${relativePath} references XMLHttpRequest`
      ).toBe(false);
    }
  });

  it('the draft panel and popup contain no posting/automation control tokens', () => {
    for (const relativePath of ['src/components/DraftCoPilot.tsx', 'src/popup/Popup.tsx']) {
      const content = readFileSync(resolve(EXTENSION_ROOT, relativePath), 'utf-8').toLowerCase();
      for (const token of SPEC_06_POSTING_AUTOMATION_TOKENS) {
        expect(
          content.includes(token),
          `${relativePath} unexpectedly references posting/automation token "${token}"`
        ).toBe(false);
      }
    }
  });

  it('the draft panel copies via navigator.clipboard.writeText only (no posting controls)', () => {
    // Req 10.3, 10.4, 12.8, 12.9 — the only "copy" mechanism is the clipboard
    // write; the panel exposes no post/submit/auto-post control.
    const draftPanel = readFileSync(
      resolve(EXTENSION_ROOT, 'src/components/DraftCoPilot.tsx'),
      'utf-8'
    );
    expect(draftPanel).toContain('navigator.clipboard.writeText');
    const lowered = draftPanel.toLowerCase();
    for (const token of SPEC_06_POSTING_AUTOMATION_TOKENS) {
      expect(lowered.includes(token), `DraftCoPilot references "${token}"`).toBe(false);
    }
  });

  it('neither the draft panel nor the popup adds Reddit automation strings', () => {
    // Req 12.2, 12.5, 12.8, 12.9 — no new reddit.com host string and no
    // posting/automation control surface in the draft panel or the popup.
    const redditAndAutomationTokens = [
      'reddit.com',
      'old.reddit.com',
      ...SPEC_06_POSTING_AUTOMATION_TOKENS,
    ];
    for (const relativePath of ['src/components/DraftCoPilot.tsx', 'src/popup/Popup.tsx']) {
      const content = readFileSync(resolve(EXTENSION_ROOT, relativePath), 'utf-8').toLowerCase();
      for (const token of redditAndAutomationTokens) {
        expect(
          content.includes(token),
          `${relativePath} unexpectedly references "${token}"`
        ).toBe(false);
      }
    }
  });
});


// --- Spec 07: Review Queue scope & permission containment ---

/**
 * Spec 07 source files (local, Extension-UI-only, Operator-triaged Review_Queue):
 * the shared types module, the pure queue-transform module, the thin storage
 * adapter, the React panel, and the popup wiring. The queue path touches no other
 * file. (Property 11 — Manual-Input-Only Scope.)
 */
const SPEC_07_SOURCE_FILES = [
  'src/types/index.ts',
  'src/lib/review-queue.ts',
  'src/lib/review-queue-storage.ts',
  'src/components/ReviewQueue.tsx',
  'src/popup/Popup.tsx',
];

/**
 * The queue *logic + storage + component* files only. `Popup.tsx` is intentionally
 * excluded from the no-network scan because it legitimately wires the existing
 * Spec 01 connection-status check through the api-client (`checkStatus`); it is
 * still covered by the forbidden-scope token scan below (where it stays clean).
 */
const SPEC_07_QUEUE_LOGIC_FILES = [
  'src/lib/review-queue.ts',
  'src/lib/review-queue-storage.ts',
  'src/components/ReviewQueue.tsx',
];

/**
 * Out-of-scope tokens that must never appear in Spec 07 source or the manifest
 * (Property 11 — Manual-Input-Only Scope). Matched case-insensitively.
 * Deliberately SPECIFIC so legitimate identifiers / prose are not flagged:
 *   - the Worker-route tokens are the spec-prohibited queue/draft routes
 *     (`/v1/draft`, `/v1/queue`, `/v1/review`) — NOT a bare `/v1/`, because the
 *     shared types module legitimately references `/v1/status` and `/v1/compare`
 *     (Spec 01 / Spec 04), so a bare `/v1/` scan would false-positive on those.
 *   - bare `openai` / `llm` / `ai` are NOT scanned: like the Spec 06 block, were
 *     they to appear they would only be inside file-header compliance doc comments
 *     ("no OpenAI / LLM / AI provider"), so a bare-substring scan would
 *     false-positive on documentation rather than a real violation. The no-AI
 *     guarantee is instead enforced positively by the no-network call-form scan
 *     below (the queue is storage-only and makes no network/AI call).
 */
const SPEC_07_FORBIDDEN_SCOPE_TOKENS = [
  'reddit.com',
  'old.reddit.com',
  'chrome.alarms',
  'chrome.notifications',
  'content_scripts',
  'firecrawl',
  'scraping',
  'ip rotation',
  '/v1/draft',
  '/v1/queue',
  '/v1/review',
];

/**
 * Posting / automation control tokens that must never appear in the queue panel
 * or the popup (Property 11 — No Posting Controls). The Review_Queue's only data
 * egress is the local clipboard for manual copy; there is no post/submit/comment/
 * vote/auto-post control of any kind. Reuses the Spec 06 list. Matched
 * case-insensitively; deliberately specific so the panel's compliance copy
 * ("…posting manually yourself" / "…posted automatically") is not flagged.
 */
const SPEC_07_POSTING_AUTOMATION_TOKENS = [
  'upvote',
  'downvote',
  '/api/submit',
  '/api/comment',
  '/api/vote',
  'submitform',
  'autopost',
  'auto-post',
  'auto_submit',
];

describe('Spec 07 — Review Queue permission containment (Property 12)', () => {
  // Req 12.1, 13.6 — Spec 07 adds no permission and no host. These intentionally
  // duplicate the Spec 05/06 manifest assertions; that duplication is the point —
  // it states the invariant freshly as a Spec 07 guarantee.
  const manifest = JSON.parse(
    readFileSync(resolve(EXTENSION_ROOT, 'manifest.json'), 'utf-8')
  );

  it('keeps manifest.permissions exactly ["storage"] (no alarms/notifications/tabs/scripting/activeTab)', () => {
    expect(manifest.permissions).toEqual(['storage']);
  });

  it('keeps host_permissions exactly the three approved entries byte-for-byte (no reddit.com host)', () => {
    expect(manifest.host_permissions).toEqual([
      'https://*.workers.dev/*',
      'http://localhost/*',
      'http://127.0.0.1/*',
    ]);
  });

  it('still declares no content_scripts', () => {
    expect(manifest.content_scripts).toBeUndefined();
  });
});

describe('Spec 07 — Review Queue manual-input-only scope exclusion (Properties 10, 11)', () => {
  // Req 9.6, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8.

  it('Spec 07 source files contain none of the out-of-scope tokens', () => {
    for (const relativePath of SPEC_07_SOURCE_FILES) {
      const content = readFileSync(resolve(EXTENSION_ROOT, relativePath), 'utf-8').toLowerCase();
      for (const token of SPEC_07_FORBIDDEN_SCOPE_TOKENS) {
        expect(
          content.includes(token),
          `${relativePath} unexpectedly references "${token}"`
        ).toBe(false);
      }
    }
  });

  it('the manifest contains none of the Spec 07 out-of-scope tokens', () => {
    const manifestRaw = readFileSync(
      resolve(EXTENSION_ROOT, 'manifest.json'),
      'utf-8'
    ).toLowerCase();
    for (const token of SPEC_07_FORBIDDEN_SCOPE_TOKENS) {
      expect(manifestRaw.includes(token), `manifest references "${token}"`).toBe(false);
    }
  });

  it('the queue logic + storage + component files make no network call (no fetch / authenticatedFetch / XMLHttpRequest call form)', () => {
    // Req 9.6, 12.4 — every queue operation runs entirely locally against
    // chrome.storage.local; there is no Worker/draft-endpoint usage in the queue
    // logic, storage adapter, or panel. We scan the *call form* (`fetch(`,
    // `authenticatedfetch(`, `xmlhttprequest(`) rather than the bare name because
    // `review-queue-storage.ts` legitimately *documents*, in its header compliance
    // comment, that it performs "no fetch, no authenticatedFetch, no XMLHttpRequest"
    // — a bare-substring scan for `xmlhttprequest` would false-positive on that
    // documentation (exactly the openai/llm situation the Spec 06 block notes),
    // whereas the call form catches a real invocation (`new XMLHttpRequest()`).
    for (const relativePath of SPEC_07_QUEUE_LOGIC_FILES) {
      const content = readFileSync(resolve(EXTENSION_ROOT, relativePath), 'utf-8').toLowerCase();
      expect(content.includes('fetch('), `${relativePath} calls fetch(`).toBe(false);
      expect(
        content.includes('authenticatedfetch('),
        `${relativePath} calls authenticatedFetch(`
      ).toBe(false);
      expect(
        content.includes('xmlhttprequest('),
        `${relativePath} instantiates XMLHttpRequest`
      ).toBe(false);
    }
  });

  it('the queue panel and popup contain no posting/automation control tokens', () => {
    // Req 12.7, 12.8 — the Review_Queue exposes no automated posting/commenting/
    // voting/DM/submit control; its only data egress is the local clipboard.
    for (const relativePath of ['src/components/ReviewQueue.tsx', 'src/popup/Popup.tsx']) {
      const content = readFileSync(resolve(EXTENSION_ROOT, relativePath), 'utf-8').toLowerCase();
      for (const token of SPEC_07_POSTING_AUTOMATION_TOKENS) {
        expect(
          content.includes(token),
          `${relativePath} unexpectedly references posting/automation token "${token}"`
        ).toBe(false);
      }
    }
  });

  it('the queue panel copies via navigator.clipboard.writeText only (no posting controls)', () => {
    // Req 12.7, 12.8 — the only egress mechanism is the clipboard write for manual
    // copy; the panel exposes no post/submit/auto-post control. Positive assertion
    // mirroring the Spec 06 DraftCoPilot clipboard assertion.
    const queuePanel = readFileSync(
      resolve(EXTENSION_ROOT, 'src/components/ReviewQueue.tsx'),
      'utf-8'
    );
    expect(queuePanel).toContain('navigator.clipboard.writeText');
    const lowered = queuePanel.toLowerCase();
    for (const token of SPEC_07_POSTING_AUTOMATION_TOKENS) {
      expect(lowered.includes(token), `ReviewQueue references "${token}"`).toBe(false);
    }
  });

  // WORKER-API: the existing security-boundary suite does NOT scan worker-api
  // *source* for routes (it only reads `worker-api/wrangler.toml` to assert no
  // secrets in [vars]); per the no-over-engineering convention we add no new
  // worker-api filesystem reads here. Spec 07 introduces NO worker-api change —
  // the queue is a local, extension-static slice with no new `/v1` Worker route —
  // so this block stays extension-only, and the forbidden-scope token scan above
  // already proves the extension references no `/v1/draft`, `/v1/queue`, or
  // `/v1/review` route.
});


// --- Spec 08-A: Compliance Activity Log & Export scope & permission containment ---

/**
 * Spec 08-A source files: shared types, pure log logic, storage adapter,
 * best-effort recorder, local export helpers, Activity_Log panel, popup wiring,
 * and the four Source_Action integration touch-points.
 */
const SPEC_08_SOURCE_FILES = [
  'src/types/index.ts',
  'src/lib/activity-log.ts',
  'src/lib/activity-log-storage.ts',
  'src/lib/activity-recorder.ts',
  'src/lib/activity-export.ts',
  'src/components/ActivityLog.tsx',
  'src/popup/Popup.tsx',
  'src/components/Onboarding.tsx',
  'src/components/ReviewQueue.tsx',
  'src/components/DraftCoPilot.tsx',
];

/**
 * Files whose Spec 08-A behavior must stay local-only. Popup.tsx is excluded from
 * this narrower network scan because it legitimately contains the pre-existing
 * public status check wiring; the Activity_Log implementation itself is local-only.
 */
const SPEC_08_LOCAL_ONLY_FILES = [
  'src/lib/activity-log.ts',
  'src/lib/activity-log-storage.ts',
  'src/lib/activity-recorder.ts',
  'src/lib/activity-export.ts',
  'src/components/ActivityLog.tsx',
];

/**
 * Deliberately specific forbidden tokens for active network/automation surfaces.
 * Comments are stripped before scanning so compliance prose like "no chrome.downloads"
 * does not false-positive.
 */
const SPEC_08_FORBIDDEN_ACTIVE_TOKENS = [
  'fetch(',
  'authenticatedfetch(',
  'xmlhttprequest(',
  'chrome.downloads',
  'chrome.alarms',
  'chrome.notifications',
  'chrome.tabs.create',
  'reddit.com',
  'old.reddit.com',
  '/api/submit',
  '/api/comment',
  '/api/vote',
  '/v1/draft',
  '/v1/review',
  '/v1/queue',
  'autopost',
  'auto-post',
  'auto_submit',
  'firecrawl',
  'scraping',
  'ip rotation',
  'openai',
  'anthropic',
];

function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function readProductionSource(relativePath: string): string {
  return readFileSync(resolve(EXTENSION_ROOT, relativePath), 'utf-8');
}

describe('Spec 08-A — Activity Log permission containment', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(EXTENSION_ROOT, 'manifest.json'), 'utf-8')
  );

  it('keeps manifest.permissions exactly ["storage"] (no downloads/alarms/notifications/tabs/scripting/activeTab)', () => {
    expect(manifest.permissions).toEqual(['storage']);
    expect(manifest.permissions).not.toContain('downloads');
    expect(manifest.permissions).not.toContain('alarms');
    expect(manifest.permissions).not.toContain('notifications');
    expect(manifest.permissions).not.toContain('tabs');
    expect(manifest.permissions).not.toContain('scripting');
    expect(manifest.permissions).not.toContain('activeTab');
  });

  it('keeps host_permissions exactly the approved entries (no reddit.com host)', () => {
    expect(manifest.host_permissions).toEqual([
      'https://*.workers.dev/*',
      'http://localhost/*',
      'http://127.0.0.1/*',
    ]);
  });

  it('still declares no content_scripts', () => {
    expect(manifest.content_scripts).toBeUndefined();
  });

  it('the manifest contains no Spec 08-A forbidden scope tokens', () => {
    const manifestRaw = readFileSync(resolve(EXTENSION_ROOT, 'manifest.json'), 'utf-8').toLowerCase();
    for (const token of SPEC_08_FORBIDDEN_ACTIVE_TOKENS) {
      expect(manifestRaw.includes(token), `manifest references "${token}"`).toBe(false);
    }
  });
});

describe('Spec 08-A — Activity Log local-only scope exclusion', () => {
  it('Spec 08-A production files contain no active forbidden network/automation tokens', () => {
    for (const relativePath of SPEC_08_SOURCE_FILES) {
      const content = stripComments(readProductionSource(relativePath)).toLowerCase();
      for (const token of SPEC_08_FORBIDDEN_ACTIVE_TOKENS) {
        expect(
          content.includes(token),
          `${relativePath} unexpectedly references active forbidden token "${token}"`
        ).toBe(false);
      }
    }
  });

  it('Activity Log local-only files make no network call and use no Worker/Reddit/AI surface', () => {
    for (const relativePath of SPEC_08_LOCAL_ONLY_FILES) {
      const content = stripComments(readProductionSource(relativePath)).toLowerCase();
      expect(content.includes('fetch('), `${relativePath} calls fetch(`).toBe(false);
      expect(content.includes('authenticatedfetch('), `${relativePath} calls authenticatedFetch(`).toBe(false);
      expect(content.includes('xmlhttprequest('), `${relativePath} instantiates XMLHttpRequest`).toBe(false);
      expect(content.includes('reddit.com'), `${relativePath} references reddit.com`).toBe(false);
      expect(content.includes('openai'), `${relativePath} references OpenAI`).toBe(false);
      expect(content.includes('anthropic'), `${relativePath} references Anthropic`).toBe(false);
    }
  });

  it('activity-export.ts uses only local clipboard and Blob/ObjectURL anchor delivery', () => {
    const exportFile = stripComments(readProductionSource('src/lib/activity-export.ts')).toLowerCase();

    expect(exportFile).toContain('navigator.clipboard.writetext');
    expect(exportFile).toContain('new blob');
    expect(exportFile).toContain('url.createobjecturl');
    expect(exportFile).toContain("document.createelement('a')");
    expect(exportFile).toContain('url.revokeobjecturl');

    expect(exportFile.includes('chrome.downloads'), 'activity-export.ts uses chrome.downloads').toBe(false);
    expect(exportFile.includes('fetch('), 'activity-export.ts calls fetch(').toBe(false);
    expect(exportFile.includes('authenticatedfetch('), 'activity-export.ts calls authenticatedFetch(').toBe(false);
  });

  it('activity storage and recorder persist only through chrome.storage.local and never through network or extension automation APIs', () => {
    for (const relativePath of ['src/lib/activity-log-storage.ts', 'src/lib/activity-recorder.ts']) {
      const content = stripComments(readProductionSource(relativePath)).toLowerCase();

      if (relativePath.endsWith('activity-log-storage.ts')) {
        expect(content).toContain('chrome.storage.local');
      }

      expect(content.includes('fetch('), `${relativePath} calls fetch(`).toBe(false);
      expect(content.includes('authenticatedfetch('), `${relativePath} calls authenticatedFetch(`).toBe(false);
      expect(content.includes('chrome.downloads'), `${relativePath} uses chrome.downloads`).toBe(false);
      expect(content.includes('chrome.alarms'), `${relativePath} uses chrome.alarms`).toBe(false);
      expect(content.includes('chrome.notifications'), `${relativePath} uses chrome.notifications`).toBe(false);
      expect(content.includes('reddit.com'), `${relativePath} references reddit.com`).toBe(false);
    }
  });
});
