/**
 * Text_Normalizer (Spec 05, Req 2).
 *
 * Pure, deterministic, idempotent normalization of Operator-pasted Input_Text.
 * Uses only local, in-memory string operations: it does NOT read `Date`,
 * `Date.now()`, `performance.now()`, `Math.random()`, `crypto.*`,
 * `chrome.storage`, or any global mutable state, and it performs NO network
 * call (`fetch`/`authenticatedFetch`).
 */

/**
 * Transforms raw Input_Text into Normalized_Text:
 *   1. lower-cases all characters to a single consistent case,
 *   2. collapses each run of consecutive whitespace into a single space,
 *   3. removes leading and trailing whitespace.
 *
 * Deterministic (Req 2.2): identical input always yields identical output.
 * Idempotent (Req 2.3): `normalizeText(normalizeText(x)) === normalizeText(x)`,
 * because the output is already lower-cased, single-spaced, and trimmed.
 */
export function normalizeText(input: string): string {
  return input.toLowerCase().replace(/\s+/g, ' ').trim();
}
