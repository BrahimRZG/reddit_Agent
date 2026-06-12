/**
 * Shared type definitions for the Reddit Marketing Agent extension.
 * Spec 01 — MVP Foundation types only.
 */

// --- Worker API Response Types ---

/** Response body from GET /v1/status */
export interface StatusResponse {
  ok: boolean;
  api_version: string;
  minimum_extension_version: string;
  scanner_enabled: boolean;
  drafting_enabled: boolean;
  compare_enabled: boolean;
  promotional_modes_enabled: boolean;
}

// --- API Client Types ---

/** Categorized error from the API client */
export interface ApiError {
  type: 'network' | 'timeout' | 'server' | 'parse';
  status?: number;
  message: string;
}

/** Result of calling checkStatus — either success with data or failure with error */
export type StatusResult =
  | { success: true; data: StatusResponse }
  | { success: false; error: ApiError };

// --- Auth Types (Spec 02 — Worker Auth & Token Lifecycle) ---

/** Response body from POST /v1/auth/verify */
export interface AuthVerifyResponse {
  ok: boolean;
  install_id: string;
}

/** Result of calling verifyAuth — either success with verify data or failure with error */
export type VerifyAuthResult =
  | { success: true; data: AuthVerifyResponse }
  | { success: false; error: ApiError };

// --- UI State Types ---

/** Connection state for the popup and status indicator */
export type ConnectionState =
  | { status: 'loading' }
  | { status: 'connected'; data: StatusResponse }
  | { status: 'update-required'; minimumVersion: string }
  | { status: 'offline'; reason: 'network' | 'timeout' }
  | { status: 'server-error'; httpStatus: number }
  | { status: 'not-configured' };

// --- URL Validation Types ---

/** Result of URL validation — discriminated union with normalizedUrl on success */
export type ValidationResult =
  | { valid: true; normalizedUrl: string }
  | { valid: false; error: string };

// --- Compliance Onboarding Types (Spec 03) ---

/** Stable identifiers for the six required acknowledgement items (Req 3.1 a–f). */
export type AcknowledgementItemId =
  | 'manual_assistant_not_bot' // (a) manual assistant, not a bot
  | 'no_automation' // (b) no automated posting/voting/messaging/joining/following/form submission
  | 'manual_review_submit' // (c) review, edit, and manually submit all content
  | 'follow_subreddit_rules' // (d) follow subreddit rules and Reddit policies
  | 'disclose_affiliation' // (e) disclose affiliation for promotional/coupon content
  | 'no_abuse'; // (f) no spam, vote manipulation, impersonation, or ban evasion

/** A single required compliance statement rendered as a checkbox. */
export interface AcknowledgementItem {
  id: AcknowledgementItemId;
  label: string;
}

/** Local record capturing onboarding completion (chrome.storage.local only). Req 1.2, 4.1–4.3. */
export interface AcknowledgementRecord {
  acknowledged: boolean; // true when onboarding accepted (Req 4.3)
  version: string; // accepted Acknowledgement_Version, semver (Req 4.2)
  acknowledged_at: string; // ISO 8601 acceptance timestamp (Req 4.1)
  items: AcknowledgementItemId[]; // accepted item identifiers (Req 1.2, 3.6)
}

/** Onboarding-required error code constant. */
export const ONBOARDING_REQUIRED = 'ONBOARDING_REQUIRED' as const;
export type OnboardingErrorCode = typeof ONBOARDING_REQUIRED;

/** Error returned/raised when an Authenticated_Action is blocked by the gate. Req 5.2. */
export interface OnboardingGateError {
  code: OnboardingErrorCode;
  message: string;
}

/** Result of the gate check (mirrors the codebase's discriminated-union convention). */
export type GateResult =
  | { allowed: true }
  | { allowed: false; error: OnboardingGateError };

/** Result of acknowledgement validation. */
export type AcknowledgementValidation =
  | { valid: true }
  | { valid: false; missing: AcknowledgementItemId[] };

/** UI-facing onboarding state for the gate component. */
export type OnboardingState =
  | { status: 'loading' }
  | { status: 'incomplete'; reason: 'missing' | 'stale_version' | 'invalid' | 'read_error' }
  | { status: 'complete'; record: AcknowledgementRecord };

// --- Storage Types ---

/** Keys used in chrome.storage.local */
export const STORAGE_KEYS = {
  WORKER_API_BASE_URL: 'rma_worker_api_base_url', // Spec 01 (unchanged)
  ONBOARDING: 'rma_onboarding_acknowledgement', // Spec 03 (new)
} as const;

/** Default Worker API URL used when no custom URL is configured */
export const DEFAULT_WORKER_API_URL = 'https://reddit-marketing-agent-api.workers.dev';

// TODO: Spec 02 — Add install token types, auth state types
