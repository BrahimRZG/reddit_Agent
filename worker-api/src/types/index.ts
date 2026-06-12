/**
 * Shared type definitions for the Worker API
 */

// --- Cloudflare Worker Environment Bindings ---

/** Worker environment with D1 database and secrets */
export interface Env {
  DB: D1Database;
  INSTALL_TOKEN_PEPPER: string;
  ADMIN_BOOTSTRAP_SECRET: string;
}

/** Hono context variables set by middleware */
export interface AppVariables {
  installId: string;
}

/** Hono app environment */
export type AppEnv = {
  Bindings: Env;
  Variables: AppVariables;
};

// --- Status Response (Spec 01, unchanged) ---

/** Response from GET /v1/status */
export interface StatusResponse {
  ok: boolean;
  api_version: string;
  minimum_extension_version: string;
  scanner_enabled: boolean;
  drafting_enabled: boolean;
  compare_enabled: boolean;
  promotional_modes_enabled: boolean;
}

// --- Error Response ---

/**
 * Standard error response shape for all Worker API errors.
 *
 * Spec 04 additively introduces the OPTIONAL `error_id` and `timestamp` fields
 * (safe, non-sensitive debug metadata). They are optional, so every existing
 * Spec 01/02/03 error body remains a valid `ErrorResponse`.
 */
export interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    /** Optional opaque correlation id (Spec 04); NOT derived from any secret. */
    error_id?: string;
    /** Optional ISO 8601 timestamp (Spec 04). */
    timestamp?: string;
    retry_after_seconds?: number;
  };
}

// --- Auth Types (Spec 02) ---

/** Response from POST /v1/admin/provision-token */
export interface ProvisionResponse {
  install_id: string;
  token: string;
}

/** Response from POST /v1/admin/revoke-token */
export interface RevokeResponse {
  install_id: string;
  status: 'revoked';
  revoked_at: string;
}

/** Response from POST /v1/auth/verify */
export interface VerifyResponse {
  valid: true;
  install_id: string;
}

/** D1 row shape for install_tokens table */
export interface InstallTokenRow {
  install_id: string;
  token_hash: string;
  status: 'active' | 'revoked';
  created_at: string;
  revoked_at: string | null;
  notes: string | null;
}

// --- Error Codes ---

/** Known error codes returned by the Worker API */
export type ErrorCode =
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'INTERNAL_ERROR'
  | 'MISSING_AUTH_HEADERS'
  | 'INSTALL_NOT_FOUND'
  | 'TOKEN_REVOKED'
  | 'INVALID_TOKEN'
  | 'TIMESTAMP_EXPIRED'
  | 'NONCE_REUSED'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'; // NEW (Spec 04); no existing code removed or repurposed


// --- Compare Types (Spec 04: CouponsRiver Compare API Foundation) ---

/** The subject of a comparison supplied by the caller (Requirement 9.2). */
export interface Candidate {
  /** Required merchant identifier. */
  merchant: string;
  /** Optional product name. */
  product?: string;
  /** Optional coupon code. */
  coupon_code?: string;
  /** Optional category. */
  category?: string;
}

/**
 * Request body for POST /v1/compare: Candidate fields plus an optional
 * `max_results` integer option (Requirement 9.2).
 */
export interface CompareRequest extends Candidate {
  /** Optional integer in 1..50 capping the number of returned matches. */
  max_results?: number;
}

/**
 * A Candidate after validation and normalization: all string fields are
 * trimmed of surrounding whitespace (Requirement 2.7).
 */
export interface NormalizedCandidate {
  merchant: string;
  product?: string;
  coupon_code?: string;
  category?: string;
}

/**
 * A fully validated and normalized compare request with an effective
 * `max_results` value (the default is applied when the field is omitted).
 */
export interface NormalizedCompareRequest {
  candidate: NormalizedCandidate;
  /** Effective value (default applied when omitted). */
  max_results: number;
}

/** A single coupon/offer match returned from the data source (Requirement 9.4). */
export interface Match {
  merchant: string;
  coupon_code?: string;
  description: string;
  /** Numeric relevance score. */
  score: number;
  /** Identifies the originating adapter (e.g. 'mock-couponsriver'). */
  source: string;
}

/** Success body for POST /v1/compare (Requirement 9.3). */
export interface CompareResponse {
  /** Normalized echo of the queried candidate. */
  candidate: NormalizedCandidate;
  /** Invariant: equals matches.length. */
  match_count: number;
  matches: Match[];
}
