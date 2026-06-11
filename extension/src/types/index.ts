/**
 * Shared type definitions for the Reddit Marketing Agent extension.
 */

// --- Worker API Response Types ---

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

export interface ApiError {
  type: 'network' | 'timeout' | 'server' | 'parse';
  status?: number;
  message: string;
}

export type StatusResult =
  | { success: true; data: StatusResponse }
  | { success: false; error: ApiError };

// --- UI State Types ---

export type ConnectionState =
  | { status: 'loading' }
  | { status: 'connected'; data: StatusResponse }
  | { status: 'update-required'; minimumVersion: string }
  | { status: 'offline'; reason: 'network' | 'timeout' }
  | { status: 'server-error'; httpStatus: number }
  | { status: 'not-configured' };

// --- URL Validation Types ---

export type ValidationResult =
  | { valid: true; normalizedUrl: string }
  | { valid: false; error: string };

// --- Storage Types ---

export const STORAGE_KEYS = {
  WORKER_API_BASE_URL: 'rma_worker_api_base_url',
} as const;

export const DEFAULT_WORKER_API_URL = 'https://reddit-marketing-agent-api.workers.dev';

// --- Auth Types (Spec 02) ---

export interface AuthVerifyResponse {
  ok: true;
  install_id: string;
}

export type AuthResult =
  | { success: true; data: AuthVerifyResponse }
  | { success: false; error: ApiError };
