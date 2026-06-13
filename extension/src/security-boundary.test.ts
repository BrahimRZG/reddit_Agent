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
