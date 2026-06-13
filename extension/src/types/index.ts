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


// --- Intent Scanner Types (Spec 05) ---

/**
 * The Intent_Category assigned per classification (Req 3.1). Exactly one of
 * these is returned by `classifyIntent`. `irrelevant` is the no-signal category
 * (Req 3.5) and always carries a Confidence_Value of 0.0.
 */
export type IntentCategory =
  | 'coupon-seeking'
  | 'deal-seeking'
  | 'product-comparison'
  | 'generic-discussion'
  | 'irrelevant';

/**
 * The Confidence_Value: a numeric score in the inclusive range 0.0..1.0 (Req 3.2).
 * The bound invariant is enforced in code (clamping) and asserted in tests.
 */
export type Confidence = number;

/** The enumerated Detected_Candidate `type` set (Req 4.2). */
export type CandidateType = 'keyword' | 'tool_mention' | 'merchant_mention' | 'coupon_signal';

/** A single extracted signal: a `type` from CandidateType and a string `value` (Req 4.2). */
export interface DetectedCandidate {
  type: CandidateType;
  value: string;
}

/** The Intent_Classifier output: exactly one category + a bounded confidence (Req 3.1, 3.2). */
export interface Classification {
  category: IntentCategory;
  confidence: Confidence;
}

/**
 * Result of validating Operator-supplied Input_Text (Req 1.4, 1.5).
 * - `valid`    → the (original) text is analyzable.
 * - `empty`    → zero non-whitespace characters (Req 1.4).
 * - `too_long` → length exceeds the 10000-character maximum (Req 1.5).
 */
export type InputValidation =
  | { kind: 'valid'; text: string }
  | { kind: 'empty' }
  | { kind: 'too_long'; max: 10000 };

/**
 * The fresh-per-run local analysis result (the ScanResult concept). A
 * discriminated union so the UI can render either a validation message or the
 * full analyzed result. `analyzeInput` returns a brand-new value on every call
 * and never reuses a prior input's result.
 */
export type AnalyzeResult =
  | { kind: 'invalid'; reason: 'empty' | 'too_long' }
  | {
      kind: 'analyzed';
      normalized: string;
      classification: Classification;
      candidates: DetectedCandidate[];
    };

// --- Compare request/response (mirrors the worker-api Spec 04 contract) ---

/**
 * Body POSTed to /v1/compare. `merchant` is required; the rest are optional.
 * `max_results`, when present, is an integer in 1..50. Mirrors the worker
 * `CompareRequest` contract without modifying worker-api.
 */
export interface CompareRequestBody {
  merchant: string;
  product?: string;
  coupon_code?: string;
  category?: string;
  max_results?: number;
}

/** Normalized candidate echoed back in the success response (worker NormalizedCandidate). */
export interface CompareCandidate {
  merchant: string;
  product?: string;
  coupon_code?: string;
  category?: string;
}

/** A single coupon/offer match (mirrors the worker `Match` shape). */
export interface CompareMatch {
  merchant: string;
  coupon_code?: string;
  description: string;
  score: number;
  source: string; // e.g. 'mock-couponsriver'
}

/** HTTP 200 success body for POST /v1/compare. Invariant: match_count === matches.length. */
export interface CompareResponse {
  candidate: CompareCandidate;
  match_count: number;
  matches: CompareMatch[];
}

/**
 * Result of a Compare_Lookup as observed by the Intent_Scanner. Discriminated
 * union consistent with StatusResult / VerifyAuthResult; reuses the existing
 * ApiError categories for failures (Req 5.5, 5.6).
 */
export type CompareOutcome =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: CompareResponse }
  | { status: 'failure'; error: ApiError };
// --- Draft Co-Pilot Types (Spec 06) ---

/** The three Reply_Modes, exactly as enumerated in the Glossary (Req 2.1). */
export type DraftMode = 'no-link-authority' | 'soft-cta-with-disclosure' | 'disclosed-link';

/**
 * Optional Spec 05 intent analysis carried over by the Operator (Req 1.2).
 * Reuses Spec 05 types verbatim — no modification to Spec 05.
 */
export interface IntentContext {
  classification: Classification;
  candidates: DetectedCandidate[];
}

/**
 * Optional Spec 04 compare result carried over by the Operator (Req 1.3).
 * Reuses the Spec 04 CompareResponse shape verbatim — no modification to Spec 04.
 */
export type CompareContext = CompareResponse;

/** The full Operator-supplied drafting context (Req 1). */
export interface DraftInput {
  sourceText: string;
  mode: DraftMode;
  couponsRiverUrl?: string;
  intentContext?: IntentContext;
  compareContext?: CompareContext;
}

/** Validation outcome before generation (Req 1.6, 1.7, 1.8, 2.2). */
export type DraftInputValidation =
  | { kind: 'valid' }
  | { kind: 'empty' }
  | { kind: 'too_long'; max: 10000 }
  | { kind: 'no_mode' };

/** Stable identifiers for each Compliance_Warning (Req 9). */
export type ComplianceWarningId =
  | 'manual_review'
  | 'subreddit_rules'
  | 'no_automated_action'
  | 'disclosure_required'
  | 'missing_link'
  | 'add_link_manually'
  | 'unsafe_concealing'
  | 'unsafe_no_disclosure';

/** A single plain-language warning attached to a Draft_Result (Req 9). */
export interface ComplianceWarning {
  id: ComplianceWarningId;
  message: string;
}

/** Successful generator output (Req 3.1). */
export interface DraftResult {
  kind: 'draft';
  mode: DraftMode;
  draftText: string;
  warnings: ComplianceWarning[];
  safety: 'safe' | 'unsafe';
}

/** Typed Failure_State (Req 3.6–3.8). */
export interface FailureState {
  kind: 'failure';
  code: 'generation_error' | 'resource_limit';
  message: string;
}

export const MAX_SOURCE_LENGTH = 10000;

export const AFFILIATION_DISCLOSURE = "Full disclosure: I'm affiliated with CouponsRiver.";

export const COMPLIANCE_WARNING_MESSAGES: Record<ComplianceWarningId, string> = {
  manual_review: 'Review and edit this draft before posting it yourself.',
  subreddit_rules: "Check the subreddit's rules before posting.",
  no_automated_action:
    'This extension takes no automated Reddit action — you post manually.',
  disclosure_required:
    'Promotional drafts must disclose your CouponsRiver affiliation.',
  missing_link:
    'No link was provided, so no CouponsRiver URL is included in this draft.',
  add_link_manually:
    'You may add a specific CouponsRiver link manually after reviewing the draft.',
  unsafe_concealing:
    'Concealing language was detected — this draft is not ready to post.',
  unsafe_no_disclosure:
    'This promotional draft is missing the affiliation disclosure — it is not ready to post.',
};
