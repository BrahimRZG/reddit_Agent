/**
 * Shared type definitions for the Worker API
 */

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

/** Standard error response shape for all Worker API errors */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    retry_after_seconds?: number;
  };
}

/** Known error codes returned by the Worker API */
export type ErrorCode =
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'INTERNAL_ERROR';
// TODO: Spec 02 — Add 'TOKEN_REVOKED', 'RATE_LIMITED', 'INVALID_SIGNATURE', etc.
