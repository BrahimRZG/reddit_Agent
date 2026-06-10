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

    it('contains no hardcoded SECRET values (excluding StorageError class name)', () => {
      // grep for SECRET but exclude the StorageError class definition and test files
      const result = grepRecursive(extensionSrc, 'SECRET', ['*.test.ts']);
      expect(result).toBe('');
    });
  });

  describe('wrangler.toml', () => {
    const wranglerContent = readFileSync(
      resolve(ROOT, 'worker-api/wrangler.toml'),
      'utf-8'
    );

    it('has no active D1 database bindings', () => {
      // Active (uncommented) d1_databases binding
      const activeD1 = wranglerContent
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');
      expect(activeD1).not.toContain('[[d1_databases]]');
    });

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
 * Returns matching lines or empty string if no matches.
 * Excludes .test.ts files and node_modules.
 */
function grepRecursive(dir: string, pattern: string, excludeGlobs: string[] = []): string {
  try {
    let cmd = `grep -r "${pattern}" "${dir}" --include="*.ts" --include="*.tsx" --exclude-dir=node_modules`;
    for (const glob of excludeGlobs) {
      cmd += ` --exclude="${glob}"`;
    }
    // Also exclude test files from false positives
    cmd += ' --exclude="*.test.ts"';
    return execSync(cmd, { encoding: 'utf-8' }).trim();
  } catch {
    // grep returns exit code 1 when no matches — that's success for us
    return '';
  }
}
