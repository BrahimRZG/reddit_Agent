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
