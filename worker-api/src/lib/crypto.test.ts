import { describe, it, expect } from 'vitest';
import { hashToken, constantTimeEqual } from './crypto';

describe('hashToken', () => {
  it('returns a 64-character lowercase hex string', async () => {
    const result = await hashToken('test-token', 'test-pepper');
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same inputs produce same output', async () => {
    const a = await hashToken('my-token', 'my-pepper');
    const b = await hashToken('my-token', 'my-pepper');
    expect(a).toBe(b);
  });

  it('produces different hashes for different tokens', async () => {
    const a = await hashToken('token-a', 'pepper');
    const b = await hashToken('token-b', 'pepper');
    expect(a).not.toBe(b);
  });

  it('produces different hashes for different peppers', async () => {
    const a = await hashToken('same-token', 'pepper-1');
    const b = await hashToken('same-token', 'pepper-2');
    expect(a).not.toBe(b);
  });

  it('handles empty token string', async () => {
    const result = await hashToken('', 'pepper');
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('constantTimeEqual', () => {
  it('returns true for equal strings', () => {
    expect(constantTimeEqual('hello', 'hello')).toBe(true);
  });

  it('returns true for equal empty strings', () => {
    expect(constantTimeEqual('', '')).toBe(true);
  });

  it('returns false for different strings of same length', () => {
    expect(constantTimeEqual('hello', 'world')).toBe(false);
  });

  it('returns false for strings of different lengths', () => {
    expect(constantTimeEqual('short', 'longer-string')).toBe(false);
  });

  it('returns false when one string is a prefix of the other', () => {
    expect(constantTimeEqual('abc', 'abcdef')).toBe(false);
  });

  it('works with 64-char hex strings (token hash length)', () => {
    const a = 'a'.repeat(64);
    const b = 'a'.repeat(64);
    expect(constantTimeEqual(a, b)).toBe(true);

    const c = 'a'.repeat(63) + 'b';
    expect(constantTimeEqual(a, c)).toBe(false);
  });
});
