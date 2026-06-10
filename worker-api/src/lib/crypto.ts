/**
 * Cryptographic utilities for the Worker API.
 * Spec 02: Worker Auth & Token Lifecycle.
 *
 * Uses Web Crypto API exclusively (crypto.subtle).
 * No Node.js crypto imports.
 */

/**
 * Computes the one-way token hash used for storage and verification.
 * Uses HMAC-SHA256 with INSTALL_TOKEN_PEPPER as the HMAC key
 * and the raw token as the message.
 *
 * @param rawToken - The raw install token string
 * @param pepper - The INSTALL_TOKEN_PEPPER secret (HMAC key)
 * @returns Lowercase hex string, always exactly 64 characters
 */
export async function hashToken(rawToken: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(rawToken)
  );

  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);

  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }

  return result === 0;
}
