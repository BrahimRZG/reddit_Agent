/**
 * Lightweight semver comparison utility for major.minor.patch versions.
 * No pre-release or build metadata support.
 * Zero external dependencies.
 */

/**
 * Parses a semver string into [major, minor, patch] tuple.
 * Malformed strings are treated as [0, 0, 0].
 */
function parseSemver(version: string): [number, number, number] {
  const parts = version.split('.');
  if (parts.length !== 3) {
    return [0, 0, 0];
  }

  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  const patch = parseInt(parts[2], 10);

  if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
    return [0, 0, 0];
  }

  if (major < 0 || minor < 0 || patch < 0) {
    return [0, 0, 0];
  }

  return [major, minor, patch];
}

/**
 * Compares two semver strings (major.minor.patch only).
 *
 * @returns -1 if a < b, 0 if a == b, 1 if a > b
 *
 * Malformed version strings are treated as 0.0.0.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const [aMajor, aMinor, aPatch] = parseSemver(a);
  const [bMajor, bMinor, bPatch] = parseSemver(b);

  if (aMajor !== bMajor) {
    return aMajor > bMajor ? 1 : -1;
  }
  if (aMinor !== bMinor) {
    return aMinor > bMinor ? 1 : -1;
  }
  if (aPatch !== bPatch) {
    return aPatch > bPatch ? 1 : -1;
  }

  return 0;
}

/**
 * Returns true if `current` satisfies `minimum` (current >= minimum).
 *
 * Malformed version strings are treated as 0.0.0.
 */
export function satisfiesMinimum(current: string, minimum: string): boolean {
  return compareSemver(current, minimum) >= 0;
}
