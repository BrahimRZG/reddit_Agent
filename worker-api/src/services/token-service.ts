/**
 * Token generation service.
 * Spec 02: Worker Auth & Token Lifecycle.
 */

/**
 * Generates a cryptographically random install token.
 * Returns base64url-encoded 32 bytes (43 characters, no padding).
 */
export function generateRawToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64UrlEncode(bytes);
}

/**
 * Base64url encoding without padding (RFC 4648 §5).
 */
function base64UrlEncode(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
