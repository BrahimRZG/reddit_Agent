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
  ONBOARDING: 'rma_onboarding_acknowledgement', // Spec 03 (unchanged)
  REVIEW_QUEUE: 'rma_review_queue', // Spec 07 (new)
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

// --- Review Queue Types (Spec 07) ---

/** The three Operator-controlled triage states (Req 3.1). Default on save is `needs_review`. */
export type ReviewStatus = 'needs_review' | 'approved_for_manual_use' | 'rejected';

/** Origin of a saved draft (Req 1.3, 1.4). */
export type DraftSource = 'draft_co_pilot' | 'manual';

/** A single advisory review-checklist entry (Req 5). */
export interface ChecklistItem {
  id: string; // stable Checklist_Item_Id, unique within its Queue_Item (Req 5.2)
  text: string; // ≤ MAX_CHECKLIST_TEXT chars (Req 8.3)
  checked: boolean; // defaults to false on add (Req 5.2)
}

/** A single saved entry in the Review_Queue (Req 1, 2). */
export interface QueueItem {
  id: string; // stable Item_Id, unique within the queue (Req 2.1)
  draftText: string; // ≤ MAX_QUEUE_DRAFT_TEXT chars (Req 8.1)
  source: DraftSource; // 'draft_co_pilot' | 'manual' (Req 1.3, 1.4)
  mode?: DraftMode; // captured Spec 06 Draft_Mode when from a Draft_Result (Req 1.2)
  warnings?: ComplianceWarning[]; // captured Spec 06 warnings, verbatim (Req 1.2, 1.6, 1.8)
  safety?: 'safe' | 'unsafe'; // captured Spec 06 Safety_Flag (Req 1.2, 1.6)
  status: ReviewStatus; // Operator-controlled triage state (Req 3)
  note?: string; // advisory free-text Note, ≤ MAX_NOTE chars (Req 4)
  checklist: ChecklistItem[]; // advisory checklist, ≤ MAX_CHECKLIST_ITEMS (Req 5)
  created_at: string; // ISO 8601, set at save, immutable (Req 2.2, 2.5)
  updated_at: string; // ISO 8601, bumped on each Operator modification (Req 2.3, 2.4)
}

/** The Review_Queue is the ordered collection of Queue_Items (Req 6.1). */
export type ReviewQueue = QueueItem[];

/**
 * Typed outcome of reading the Review_Queue from chrome.storage.local (Req 10.1).
 * The failure `message` is a fixed, safe string — never a stack trace, file path,
 * secret, environment value, or internal implementation detail (Req 10.5).
 */
export type QueueReadOutcome =
  | { ok: true; items: QueueItem[] }
  | { ok: false; error: 'read_error' | 'parse_error'; message: string };

/** Result of a bounded field validation (Req 8). */
export type QueueFieldValidation =
  | { kind: 'valid' }
  | { kind: 'empty' } // zero non-whitespace chars (Req 1.7, 7.5)
  | { kind: 'too_long'; max: number }; // exceeds the applicable bound (Req 8.2, 8.4)

/** Result of an add (Req 8.5, 8.6) that may be bound-rejected. */
export type AddResult =
  | { ok: true; queue: ReviewQueue }
  | { ok: false; reason: 'queue_full'; max: number };

/** Result of a single-target mutation that may be validation- or lookup-rejected. */
export type MutateResult =
  | { ok: true; queue: ReviewQueue }
  | { ok: false; reason: 'empty' | 'too_long' | 'checklist_full' | 'not_found'; max?: number };

/** Storage bounds (Req 8). Single-sourced so transforms, the UI, and tests share them. */
export const MAX_QUEUE_DRAFT_TEXT = 10000; // draft text per Queue_Item (Req 8.1, 8.2)
export const MAX_NOTE = 2000; // Note length (Req 8.3, 8.4)
export const MAX_CHECKLIST_TEXT = 280; // Checklist_Item text length (Req 8.3, 8.4)
export const MAX_CHECKLIST_ITEMS = 50; // checklist items per Queue_Item (Req 8.5, 8.6)
export const MAX_QUEUE_ITEMS = 200; // total Queue_Items (Req 8.5, 8.6)

/**
 * Fixed, safe failure messages for QueueReadOutcome (Req 10.5). These are leak-free
 * constants — never a stack trace, file path, secret, environment value, or internal
 * implementation detail. Used by the storage adapter and surfaced by the UI.
 */
export const QUEUE_READ_ERROR_MESSAGE = "Couldn't read your review queue. Please try again.";
export const QUEUE_PARSE_ERROR_MESSAGE =
  "Your saved review queue couldn't be read and was left untouched.";

/** Plain, non-spammy display labels for each Review_Status (used by the UI). */
export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  needs_review: 'Needs review',
  approved_for_manual_use: 'Approved for manual use',
  rejected: 'Rejected',
};
