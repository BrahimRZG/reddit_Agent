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

/** Standard error response shape for all Worker API errors */
export interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
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
  | 'UNAUTHORIZED';
