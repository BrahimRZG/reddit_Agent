/**
 * Pure compliance-onboarding logic and constants (Spec 03).
 *
 * This module is zero-I/O and deterministic so it is directly unit- and
 * property-testable, mirroring `semver.ts` / `url-validator.ts`.
 */

import { compareSemver } from './semver';
import type {
  AcknowledgementRecord,
  AcknowledgementItem,
  AcknowledgementItemId,
  AcknowledgementValidation,
} from '../types';

/** Current compliance ruleset version (semantic version string). Req 4.4 */
export const ACKNOWLEDGEMENT_VERSION = '1.0.0';

/**
 * Canonical ordered list of required Acknowledgement_Items (Req 3.1, items a–f).
 * The labels phrase the disclosures from Req 2.2–2.7.
 */
export const REQUIRED_ACKNOWLEDGEMENT_ITEMS: readonly AcknowledgementItem[] = [
  {
    id: 'manual_assistant_not_bot',
    label:
      'I understand this Extension is a manual Reddit research and drafting assistant, not a Reddit automation bot.',
  },
  {
    id: 'no_automation',
    label:
      'I will not use the Extension to automate Reddit posting, voting, messaging, joining, following, or form submission.',
  },
  {
    id: 'manual_review_submit',
    label: 'I will review, edit, and manually submit all Reddit content myself.',
  },
  {
    id: 'follow_subreddit_rules',
    label: 'I will follow subreddit rules and Reddit policies.',
  },
  {
    id: 'disclose_affiliation',
    label: 'I will disclose affiliation when content is promotional or coupon-related.',
  },
  {
    id: 'no_abuse',
    label:
      'I will not use the Extension for spam, vote manipulation, impersonation, or ban evasion.',
  },
] as const;

/** The required identifier set, derived from the canonical list. */
export const REQUIRED_ACKNOWLEDGEMENT_ITEM_IDS: readonly AcknowledgementItemId[] =
  REQUIRED_ACKNOWLEDGEMENT_ITEMS.map((i) => i.id);

/**
 * Validates a candidate acknowledgement's accepted item set.
 *
 * Valid only when EVERY required item id is present (set-membership; order,
 * duplicates, and extra/unknown ids do not invalidate). Req 3.6.
 */
export function validateAcknowledgement(
  candidate: { items: readonly string[] } | null | undefined
): AcknowledgementValidation {
  const accepted = new Set(candidate?.items ?? []);
  const missing = REQUIRED_ACKNOWLEDGEMENT_ITEM_IDS.filter((id) => !accepted.has(id));
  return missing.length === 0 ? { valid: true } : { valid: false, missing };
}

/**
 * Evaluates Onboarding_Complete for a stored record against the current version.
 *
 * Complete IFF: record exists AND `acknowledged === true` AND `version` is a
 * non-empty string AND the stored version is not lower than `currentVersion`
 * AND every required item is present. A stored version lower than current is
 * treated as incomplete (re-acknowledgement). Req 1.4, 3.6, 4.5.
 */
export function isOnboardingComplete(
  record: AcknowledgementRecord | null,
  currentVersion: string = ACKNOWLEDGEMENT_VERSION
): boolean {
  if (record === null || record.acknowledged !== true) {
    return false;
  }
  if (typeof record.version !== 'string' || record.version.length === 0) {
    return false;
  }
  if (compareSemver(record.version, currentVersion) < 0) {
    return false; // stale version — re-acknowledgement required
  }
  return validateAcknowledgement(record).valid;
}

/**
 * Builds the Acknowledgement_Record at accept time.
 *
 * Pure factory (apart from reading the current clock) so the accept-time
 * record is testable. Req 4.1, 4.2, 4.3.
 */
export function buildAcknowledgementRecord(): AcknowledgementRecord {
  return {
    acknowledged: true,
    version: ACKNOWLEDGEMENT_VERSION,
    acknowledged_at: new Date().toISOString(),
    items: [...REQUIRED_ACKNOWLEDGEMENT_ITEM_IDS],
  };
}
