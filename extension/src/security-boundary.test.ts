import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

const ROOT = resolve(__dirname, '../../..');

describe('Security boundary verification', () => {
  describe('manifest.json', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(ROOT, 'extension/manifest.json'), 'utf-8')
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

    it('has only workers.dev host permission', () => {
      expect(manifest.host_permissions).toEqual(['https://*.workers.dev/*']);
    });
  });

  describe('Extension source code', () => {
    const extensionSrc = resolve(ROOT, 'extension/src');

    it('contains no API_KEY references', () => {
      const result = grepRecursive(extensionSrc, 'API_KEY');
      expect(result).toBe('');
    });

    it('contains no OPENAI references', () => {
      const result = grepRecursive(extensionSrc, 'OPENAI');
      expect(result).toBe('');
    });

    it('contains no REDDIT_CLIENT references', () => {
      const result = grepRecursive(extensionSrc, 'REDDIT_CLIENT');
      expect(result).toBe('');
    });

    it('contains no hardcoded SECRET values', () => {
      const result = grepRecursive(extensionSrc, 'SECRET');
      expect(result).toBe('');
    });
  });

  describe('wrangler.toml', () => {
    const wranglerContent = readFileSync(
      resolve(ROOT, 'worker-api/wrangler.toml'),
      'utf-8'
    );

    it('has no active KV namespace bindings', () => {
      const activeLines = wranglerContent
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');
      expect(activeLines).not.toContain('[[kv_namespaces]]');
    });

    it('has no active [vars] section with secrets', () => {
      const activeLines = wranglerContent
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');
      expect(activeLines).not.toContain('[vars]');
    });
  });
});

/**
 * Helper: grep recursively in a directory for a pattern.
 */
function grepRecursive(dir: string, pattern: string): string {
  try {
    const cmd = `grep -r "${pattern}" "${dir}" --include="*.ts" --include="*.tsx" --exclude-dir=node_modules --exclude="*.test.ts"`;
    return execSync(cmd, { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}
