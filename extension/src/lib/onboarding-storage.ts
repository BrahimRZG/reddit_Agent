/**
 * Local persistence for the compliance-onboarding Acknowledgement_Record (Spec 03).
 *
 * Mirrors `storage.ts` / `credential-storage.ts`: a dedicated key constant, a
 * custom error class for writes, and fail-closed (`null`-on-failure) reads.
 * The record is stored only in `chrome.storage.local` — never transmitted.
 */

import { STORAGE_KEYS } from '../types';
import type { AcknowledgementRecord } from '../types';

/** Custom error for onboarding write failures (parallels StorageError). */
export class OnboardingStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnboardingStorageError';
  }
}

/**
 * Runtime shape guard for a persisted record (defends against corruption /
 * older shapes). Accepts any string array for `items` (forward/back
 * compatibility); required-id presence is enforced by `validateAcknowledgement`.
 */
export function isAcknowledgementRecord(value: unknown): value is AcknowledgementRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const r = value as Record<string, unknown>;
  return (
    typeof r.acknowledged === 'boolean' &&
    typeof r.version === 'string' &&
    typeof r.acknowledged_at === 'string' &&
    Array.isArray(r.items) &&
    r.items.every((i) => typeof i === 'string')
  );
}

/**
 * Reads the Acknowledgement_Record from chrome.storage.local.
 *
 * Fail-closed: returns `null` on missing key, malformed shape, or any read
 * error. A read error returns `null` REGARDLESS of whether a record might
 * exist — onboarding is never treated as complete based on an unverified or
 * partially read record. Req 1.3, 1.4, 1.7, 1.8.
 */
export async function getAcknowledgement(): Promise<AcknowledgementRecord | null> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.ONBOARDING);
    const raw = result[STORAGE_KEYS.ONBOARDING];
    return isAcknowledgementRecord(raw) ? raw : null;
  } catch {
    return null; // fail closed
  }
}

/**
 * Read-result variant used ONLY so the UI can distinguish a read error (to
 * show a recoverable storage error + Retry) from a legitimately absent record.
 *
 * This is messaging-only and does NOT relax the fail-closed default: either
 * outcome is treated as onboarding-incomplete by `isOnboardingComplete`. A
 * thrown read still maps to incomplete. Req 1.7, 1.8.
 */
export async function readAcknowledgement(): Promise<
  | { kind: 'ok'; record: AcknowledgementRecord | null } // null === no/invalid record
  | { kind: 'read_error'; message: string } // storage read threw
> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.ONBOARDING);
    const raw = result[STORAGE_KEYS.ONBOARDING];
    return { kind: 'ok', record: isAcknowledgementRecord(raw) ? raw : null };
  } catch (err) {
    return { kind: 'read_error', message: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Persists the Acknowledgement_Record under `STORAGE_KEYS.ONBOARDING`. Req 1.1.
 *
 * @throws {OnboardingStorageError} when the write fails (Req 4.6).
 */
export async function setAcknowledgement(record: AcknowledgementRecord): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.ONBOARDING]: record });
  } catch (err) {
    throw new OnboardingStorageError(
      `Failed to write onboarding record: ${err instanceof Error ? err.message : 'Unknown error'}`
    );
  }
}

/** Removes the Acknowledgement_Record (dev/testing resets). */
export async function clearAcknowledgement(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.ONBOARDING);
}
