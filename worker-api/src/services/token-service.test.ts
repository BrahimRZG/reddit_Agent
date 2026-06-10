import { describe, it, expect } from 'vitest';
import { generateRawToken } from './token-service';

describe('generateRawToken', () => {
  it('returns a non-empty string', () => {
    const token = generateRawToken();
    expect(token.length).toBeGreaterThan(0);
  });

  it('returns a 43-character base64url string', () => {
    const token = generateRawToken();
    expect(token).toHaveLength(43);
  });

  it('contains only URL-safe characters (no +, /, or =)', () => {
    const token = generateRawToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('generates unique tokens on successive calls', () => {
    const tokens = new Set(Array.from({ length: 10 }, () => generateRawToken()));
    expect(tokens.size).toBe(10);
  });
});
