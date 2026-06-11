import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '../..');
const EXTENSION_ROOT = resolve(REPO_ROOT, 'extension');

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = resolve(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') {
        continue;
      }
      files.push(...listSourceFiles(fullPath));
      continue;
    }

    if (
      fullPath.endsWith('.ts') ||
      fullPath.endsWith('.tsx') ||
      fullPath.endsWith('.js') ||
      fullPath.endsWith('.json')
    ) {
      if (!fullPath.endsWith('.test.ts') && !fullPath.endsWith('.test.tsx')) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function readExtensionSource(): string {
  return listSourceFiles(resolve(EXTENSION_ROOT, 'src'))
    .map((file) => readFileSync(file, 'utf-8'))
    .join('\n');
}

describe('Security boundary verification', () => {
  describe('manifest.json', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(EXTENSION_ROOT, 'manifest.json'), 'utf-8'),
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

    it('has only approved Worker and local dev host permissions', () => {
      expect(manifest.host_permissions).toEqual([
        'https://*.workers.dev/*',
        'http://localhost/*',
        'http://127.0.0.1/*',
      ]);
    });
  });

  describe('Extension source code — no secrets', () => {
    const source = readExtensionSource();

    it('does not reference Worker admin secret names', () => {
      expect(source).not.toContain('ADMIN_BOOTSTRAP_SECRET');
      expect(source).not.toContain('INSTALL_TOKEN_PEPPER');
    });

    it('does not reference OpenAI or Reddit secret names', () => {
      expect(source).not.toContain('OPENAI_API_KEY');
      expect(source).not.toContain('REDDIT_CLIENT_SECRET');
      expect(source).not.toContain('REDDIT_CLIENT_ID');
    });

    it('does not contain generic API key constants', () => {
      expect(source).not.toMatch(/\bAPI_KEY\b/);
    });
  });

  describe('Extension source code — no Reddit automation', () => {
    const source = readExtensionSource();

    it('does not contain content-script automation APIs', () => {
      expect(source).not.toMatch(/document\.querySelector/);
      expect(source).not.toMatch(/document\.querySelectorAll/);
      expect(source).not.toMatch(/\.click\(\)/);
      expect(source).not.toMatch(/\.submit\(\)/);
    });

    it('does not automate Reddit actions', () => {
      expect(source).not.toMatch(/vote/i);
      expect(source).not.toMatch(/comment.*submit/i);
      expect(source).not.toMatch(/reddit\.com\/api/i);
    });
  });

  describe('wrangler.toml — allowed bindings only', () => {
    const wrangler = readFileSync(
      resolve(REPO_ROOT, 'worker-api/wrangler.toml'),
      'utf-8',
    );

    it('allows the intentional D1 DB binding', () => {
      expect(wrangler).toContain('[[d1_databases]]');
      expect(wrangler).toContain('binding = "DB"');
    });

    it('does not declare KV namespaces', () => {
      expect(wrangler).not.toContain('[[kv_namespaces]]');
    });

    it('does not contain plaintext secret vars', () => {
      expect(wrangler).not.toMatch(/\[vars\][\s\S]*(SECRET|PEPPER|TOKEN|API_KEY)/i);
    });
  });
});
