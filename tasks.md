# Implementation Plan: Reddit Marketing Agent MVP Foundation (Spec 01)

## Overview

This plan implements the minimal infrastructure shell for the Reddit Marketing Agent: a Chrome MV3 extension (React/Vite/TypeScript/Tailwind) and a Cloudflare Worker API (Hono/TypeScript), connected by a single public health-check endpoint. Tasks are ordered by dependency — scaffolds first, then shared libraries, then UI, then tests.

## Tasks

- [ ] 1. Scaffold Cloudflare Worker API
  - [ ] 1.1 Create Worker API project structure and configuration
    - Create `worker-api/` directory with `package.json` (name, scripts: build, dev, typecheck, lint, test, deploy), `tsconfig.json` (strict mode), `.eslintrc.cjs` (TypeScript-aware rules), and `wrangler.toml` (name, main, compatibility_date; no D1/KV/secret bindings)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 8.3, 8.4, 8.6, 8.7_

  - [ ] 1.2 Implement Hono app entry point with error handlers
    - Create `worker-api/src/index.ts` exporting a Hono app with a 404 catch-all returning `{ error: { code: "NOT_FOUND", message: "The requested resource was not found." } }` and a global error handler returning 500 `{ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } }`
    - Create `worker-api/src/types/index.ts` with `StatusResponse` and `ErrorResponse` interfaces
    - _Requirements: 2.1, 3.5_

  - [ ] 1.3 Implement GET /v1/status route with method guard
    - Create `worker-api/src/routes/status.ts` with a GET handler returning HTTP 200 JSON: `{ ok: true, api_version: "v1", minimum_extension_version: "1.0.0", scanner_enabled: false, drafting_enabled: false, compare_enabled: false, promotional_modes_enabled: false }`
    - Add an `all` handler for the same path returning HTTP 405 with `{ error: { code: "METHOD_NOT_ALLOWED", message: "Only GET is allowed on this endpoint." } }`
    - Mount the route at `/v1` in the main app
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 2. Scaffold Chrome Extension project
  - [ ] 2.1 Create Extension project structure and build configuration
    - Create `extension/` directory with `package.json` (scripts: build, dev, typecheck, lint, test), `tsconfig.json` (strict mode), `tailwind.config.ts`, `postcss.config.js`, `.eslintrc.cjs`, and `vite.config.ts` (multi-page build for popup and settings entry points, output to `dist/`)
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 8.1, 8.2, 8.5, 8.7_

  - [ ] 2.2 Create manifest.json and static assets
    - Create `extension/manifest.json` with: `manifest_version: 3`, `name: "Reddit Marketing Agent"`, `version: "1.0.0"`, `description: "Internal Reddit research and drafting assistant for CouponsRiver operators."`, `permissions: ["storage"]`, `host_permissions: ["https://*.workers.dev/*"]`, `action.default_popup: "popup/index.html"`, `background.service_worker: "service-worker/index.js"`, icon entries
    - Create placeholder icon PNGs at `extension/public/icons/` (icon-16.png, icon-48.png, icon-128.png)
    - Ensure NO content_scripts, NO activeTab/tabs/scripting permissions
    - _Requirements: 1.1, 1.2, 1.6, 1.7, 1.9, 7.2, 7.4_

  - [ ] 2.3 Create HTML entry points and React render bootstraps
    - Create `extension/src/popup/index.html`, `extension/src/popup/main.tsx` (ReactDOM render)
    - Create `extension/src/settings/index.html`, `extension/src/settings/main.tsx` (ReactDOM render)
    - Ensure Tailwind CSS is imported in both entry points
    - _Requirements: 1.2, 1.4, 1.5_

- [ ] 3. Implement Extension shared types
  - [ ] 3.1 Create shared TypeScript type definitions
    - Create `extension/src/types/index.ts` with: `StatusResponse`, `ApiError` (type: 'network'|'timeout'|'server'|'parse', status?, message), `StatusResult`, `ConnectionState` (loading|connected|update-required|offline|server-error|not-configured), `ValidationResult` (`{ valid: true; normalizedUrl: string } | { valid: false; error: string }`)
    - Add TODO comments for Spec 02 types
    - _Requirements: 3.1, 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 4. Implement Extension utility libraries
  - [ ] 4.1 Implement url-validator.ts
    - Create `extension/src/lib/url-validator.ts` with `validateWorkerApiUrl(input: string): ValidationResult`
    - Rules: parseable by `new URL()`, protocol must be `https:`, length ≤ 2048 chars
    - On success return `{ valid: true, normalizedUrl }` with trailing slash removed
    - On failure return `{ valid: false, error: "..." }` with descriptive message
    - _Requirements: 4.3, 4.4, 5.4, 5.5_

  - [ ] 4.2 Implement semver.ts
    - Create `extension/src/lib/semver.ts` with `compareSemver(a: string, b: string): -1 | 0 | 1` and `satisfiesMinimum(current: string, minimum: string): boolean`
    - Implements major.minor.patch numeric comparison only (no pre-release/build metadata)
    - Zero external dependencies (~20 lines)
    - _Requirements: 6.2, 6.3_

  - [ ] 4.3 Implement storage.ts
    - Create `extension/src/lib/storage.ts` with `getWorkerApiBaseUrl(): Promise<string>` and `setWorkerApiBaseUrl(url: string): Promise<void>`
    - Key: `rma_worker_api_base_url`; default: hardcoded `DEFAULT_WORKER_API_URL` constant
    - On read failure or missing key: return default URL
    - On write: validate URL first (delegate to url-validator), throw `StorageError` on write failure
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6_

  - [ ] 4.4 Implement api-client.ts
    - Create `extension/src/lib/api-client.ts` with `checkStatus(baseUrl: string): Promise<StatusResult>`
    - 10,000ms timeout via AbortController with `didTimeout` flag pattern
    - Error classification: AbortError+didTimeout→timeout, AbortError+!didTimeout→network, TypeError→network, HTTP 4xx/5xx→server (with status), JSON parse failure→parse
    - Add `// TODO: Spec 02 - Worker Auth & Token Lifecycle — Add HMAC signing headers here`
    - _Requirements: 6.1, 6.4, 6.5, 7.7_

- [ ] 5. Checkpoint - Verify libraries compile
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement Extension UI components
  - [ ] 6.1 Create shared UI components (StatusIndicator, ConnectionBadge)
    - Create `extension/src/components/StatusIndicator.tsx` — renders colored dot (green/amber/red/gray) based on `ConnectionState`
    - Create `extension/src/components/ConnectionBadge.tsx` — renders status text + icon with appropriate Tailwind classes
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 7.7_

  - [ ] 6.2 Implement Popup component
    - Create `extension/src/popup/Popup.tsx` with state management for `ConnectionState`
    - On mount: read storage → if no URL configured show 'not-configured' state → else call `checkStatus` → map result to connection state
    - Use `useRef` flag to prevent concurrent status requests
    - Show loading indicator during check, green/amber/red indicators based on result
    - Retry button for offline/server-error states
    - Gear icon that opens `settings/index.html` in a new tab via `chrome.tabs.create`
    - _Requirements: 4.1, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.7_

  - [ ] 6.3 Implement Settings component
    - Create `extension/src/settings/Settings.tsx` with URL input form
    - First-run detection: if no URL in storage, show setup wizard mode
    - Controlled input (max 256 chars display), inline validation errors
    - Save flow: validate URL → persist via storage module → call `checkStatus` → show success/failure
    - On success: display success indicator
    - On failure: display error category (network/server) with retry button
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.4, 5.5_

- [ ] 7. Implement Extension service worker
  - [ ] 7.1 Create minimal service worker placeholder
    - Create `extension/src/service-worker/index.ts` with `chrome.runtime.onInstalled` listener logging `[RMA] Extension installed`
    - Add TODO comments for Spec 02 (alarms, periodic scanning)
    - _Requirements: 1.7, 5.2_

- [ ] 8. Checkpoint - Verify full build
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Property-based tests
  - [ ]* 9.1 Write property tests for url-validator.ts
    - **Property 3: URL Validation Correctness**
    - Use fast-check to generate arbitrary strings and verify: accepts iff parseable URL + https: protocol + length ≤ 2048
    - Verify normalizedUrl has no trailing slash when input has one
    - Minimum 100 iterations
    - **Validates: Requirements 4.3, 4.4, 5.4, 5.5**

  - [ ]* 9.2 Write property tests for semver.ts
    - **Property 5: Semver Comparison Correctness**
    - Use fast-check to generate pairs of (major, minor, patch) tuples and verify: `satisfiesMinimum(a, b)` returns true iff a >= b using numeric comparison of major→minor→patch
    - Verify `compareSemver` transitivity and reflexivity
    - Minimum 100 iterations
    - **Validates: Requirements 6.2, 6.3**

- [ ] 10. Unit tests
  - [ ]* 10.1 Write unit tests for Worker API routes
    - Test GET /v1/status returns exact expected JSON body and HTTP 200
    - Test POST/PUT/DELETE/PATCH to /v1/status return HTTP 405 with METHOD_NOT_ALLOWED code
    - Test unknown paths return HTTP 404 with NOT_FOUND code
    - _Requirements: 3.1, 3.3, 3.5_

  - [ ]* 10.2 Write unit tests for storage.ts
    - Mock `chrome.storage.local` API
    - Test round-trip: set URL then get returns same URL
    - Test missing key returns default URL
    - Test read failure returns default URL
    - Test write failure throws StorageError
    - Test validates URL before writing (rejects invalid)
    - _Requirements: 5.1, 5.3, 5.6_

  - [ ]* 10.3 Write unit tests for api-client.ts
    - Mock global `fetch`
    - Test successful response parsed correctly
    - Test timeout (didTimeout=true) classified as 'timeout'
    - Test network error (TypeError) classified as 'network'
    - Test HTTP 500 classified as 'server' with status
    - Test malformed JSON classified as 'parse'
    - _Requirements: 6.1, 6.4, 6.5_

  - [ ]* 10.4 Write unit tests for Popup and Settings components
    - Use Vitest + Testing Library
    - Test Popup: loading state, connected state, offline state, not-configured state, retry button triggers re-check, gear icon navigates to settings
    - Test Settings: form renders with default URL, validation error on invalid URL, success flow, error flow with retry
    - _Requirements: 4.1, 4.4, 4.6, 4.7, 6.2, 6.4, 6.6_

- [ ] 11. Security boundary verification
  - [ ]* 11.1 Write security boundary static analysis tests
    - Verify no occurrences of API_KEY, SECRET, OPENAI, REDDIT_CLIENT in extension source
    - Verify manifest.json has no `content_scripts`, no `activeTab`/`tabs`/`scripting` permissions
    - Verify wrangler.toml has no `[[d1_databases]]`, `[[kv_namespaces]]`, or `[vars]` with secrets
    - Verify extension only declares host_permissions for `https://*.workers.dev/*`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [ ] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP delivery
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key milestones
- Property-based tests (fast-check) are used ONLY for pure utility functions: url-validator.ts and semver.ts
- All other components use standard unit tests with Vitest + Testing Library
- The design uses TypeScript throughout both projects (extension and worker-api)
- Storage keys use `rma_` prefix for namespace isolation
- Extension permissions are `["storage"]` only — no alarms or notifications in Spec 01
- The `didTimeout` flag pattern in api-client.ts distinguishes intentional timeout from generic AbortError
- On storage read failure: use default Worker URL for status checks, show non-blocking settings warning

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.3"] },
    { "id": 2, "tasks": ["1.3", "3.1"] },
    { "id": 3, "tasks": ["4.1", "4.2"] },
    { "id": 4, "tasks": ["4.3", "4.4"] },
    { "id": 5, "tasks": ["6.1", "7.1"] },
    { "id": 6, "tasks": ["6.2", "6.3"] },
    { "id": 7, "tasks": ["9.1", "9.2", "10.1"] },
    { "id": 8, "tasks": ["10.2", "10.3", "10.4", "11.1"] }
  ]
}
```
