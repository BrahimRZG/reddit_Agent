/**
 * Request-layer compliance-onboarding gate (Spec 03).
 *
 * The single choke point for Authenticated_Actions. It evaluates onboarding
 * completion BEFORE any credential read or network call, and composes over the
 * existing Spec 02 `api-client` functions without modifying them. The public
 * `checkStatus` connectivity check is never imported or routed through here, so
 * it remains available regardless of onboarding state (Property 6).
 */

import { getAcknowledgement } from './onboarding-storage';
import { isOnboardingComplete, ACKNOWLEDGEMENT_VERSION } from './onboarding';
import { authenticatedFetch, verifyAuth } from './api-client';
import { ONBOARDING_REQUIRED } from '../types';
import type { GateResult, OnboardingErrorCode, VerifyAuthResult } from '../types';

/**
 * Evaluates the onboarding gate using the locally stored record. Req 5.1, 5.2, 5.6.
 *
 * Returns `{ allowed: true }` only when Onboarding_Complete; otherwise an
 * `ONBOARDING_REQUIRED` error. Performs NO credential read and NO network call.
 */
export async function guardAuthenticatedAction(): Promise<GateResult> {
  const record = await getAcknowledgement();
  if (isOnboardingComplete(record, ACKNOWLEDGEMENT_VERSION)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    error: {
      code: ONBOARDING_REQUIRED,
      message: 'Compliance onboarding must be completed before this action.',
    },
  };
}

/**
 * Onboarding-gated wrapper around `api-client.authenticatedFetch`.
 *
 * If the gate blocks, throws an `ONBOARDING_REQUIRED` error WITHOUT calling
 * `getCredentials` or `fetch`. If allowed, delegates unchanged. Req 5.1, 5.2, 5.3.
 */
export async function guardedAuthenticatedFetch(
  baseUrl: string,
  path: string,
  options?: RequestInit
): Promise<Response> {
  const gate = await guardAuthenticatedAction();
  if (!gate.allowed) {
    throw Object.assign(new Error(gate.error.message), { code: ONBOARDING_REQUIRED });
  }
  return authenticatedFetch(baseUrl, path, options);
}

/** Result of the onboarding-gated verify wrapper. */
export type GuardedVerifyAuthResult =
  | VerifyAuthResult
  | {
      success: false;
      error: { type: 'onboarding'; code: OnboardingErrorCode; message: string };
    };

/**
 * Onboarding-gated wrapper around `api-client.verifyAuth` (result-typed variant).
 *
 * When blocked, returns an `ONBOARDING_REQUIRED` result without delegating; the
 * authenticated request is never dispatched. Req 5.1, 5.2, 5.3.
 */
export async function guardedVerifyAuth(baseUrl: string): Promise<GuardedVerifyAuthResult> {
  const gate = await guardAuthenticatedAction();
  if (!gate.allowed) {
    return {
      success: false,
      error: {
        type: 'onboarding',
        code: ONBOARDING_REQUIRED,
        message: gate.error.message,
      },
    };
  }
  return verifyAuth(baseUrl);
}
