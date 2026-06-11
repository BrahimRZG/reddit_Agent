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

  describe('Extension source code — no secrets', () => {
    const extensionSrc = resolve(ROOT, 'extension/src');

    it('contains no OPENAI references', () => {
      expect(grepSource(extensionSrc, 'OPENAI')).toBe('');
    });

    it('contains no REDDIT_CLIENT references', () => {
      expect(grepSource(extensionSrc, 'REDDIT_CLIENT')).toBe('');
    });

    it('contains no INSTALL_TOKEN_PEPPER references', () => {
      expect(grepSource(extensionSrc, 'INSTALL_TOKEN_PEPPER')).toBe('');
    });

    it('contains no ADMIN_BOOTSTRAP_SECRET references', () => {
      expect(grepSource(extensionSrc, 'ADMIN_BOOTSTRAP_SECRET')).toBe('');
    });

    it('contains no hardcoded API_KEY values', () => {
      expect(grepSource(extensionSrc, 'API_KEY')).toBe('');
    });
  });

  describe('Extension source code — no automation', () => {
    const extensionSrc = resolve(ROOT, 'extension/src');

    it('contains no Reddit DOM posting code', () => {
      expect(grepSource(extensionSrc, 'document\\.querySelector.*submit')).toBe('');
    });

    it('contains no Reddit voting automation', () => {
      expect(grepSource(extensionSrc, 'upvote|downvote')).toBe('');
    });
  });

  describe('wrangler.toml — allowed bindings only', () => {
    const wranglerContent = readFileSync(
      resolve(REPO_ROOT, 'worker-api/wrangler.toml'),
      'utf-8'
    );
    const activeLines = wranglerContent
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');

    it('allows D1 binding named DB', () => {
      expect(activeLines).toContain('binding = "DB"');
    });

    it('has no active KV namespace bindings', () => {
      expect(activeLines).not.toContain('[[kv_namespaces]]');
    });

    it('has no plaintext [vars] section with secrets', () => {
      expect(activeLines).not.toContain('[vars]');
    });

    it('does not hardcode INSTALL_TOKEN_PEPPER value', () => {
      // The pepper should only exist as a wrangler secret, not in toml
      expect(activeLines).not.toMatch(/INSTALL_TOKEN_PEPPER\s*=\s*"/);
    });

    it('does not hardcode ADMIN_BOOTSTRAP_SECRET value', () => {
      expect(activeLines).not.toMatch(/ADMIN_BOOTSTRAP_SECRET\s*=\s*"/);
    });
  });
});

/**
 * Helper: grep extension source for a pattern, excluding test files and node_modules.
 * Returns matching lines or empty string.
 */
function grepSource(dir: string, pattern: string): string {
  try {
    const cmd = `grep -rE "${pattern}" "${dir}" --include="*.ts" --include="*.tsx" --exclude-dir=node_modules --exclude="*.test.ts" --exclude="*security-boundary*"`;
    return execSync(cmd, { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }

  return matches;
}
