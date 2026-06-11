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

// --- Storage Types ---

/** Keys used in chrome.storage.local */
export const STORAGE_KEYS = {
  WORKER_API_BASE_URL: 'rma_worker_api_base_url',
} as const;

/** Default Worker API URL used when no custom URL is configured */
export const DEFAULT_WORKER_API_URL = 'https://reddit-marketing-agent-api.workers.dev';

// TODO: Spec 02 — Add install token types, auth state types
