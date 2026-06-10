# Requirements Document

## Introduction

This document specifies the MVP Foundation layer (Spec 01) for the Reddit Marketing Agent — the minimal infrastructure shell upon which all future features will be built. The scope is deliberately narrow: a Chrome Extension shell, a Cloudflare Worker API shell, a public health-check endpoint, a setup/settings screen, Worker API base URL storage, and architectural security boundaries.

**Explicitly out of scope for Spec 01:**
- D1 database bindings and migrations
- Install token generation, storage, or revocation
- Admin bootstrap secret provisioning
- HMAC request signing and nonce replay protection
- Rate limiting implementation
- Reddit scanning, AI drafting, CouponsRiver D1, disclosure enforcement
- Health tracker, subreddit risk logic
- Content script DOM extraction

These concerns will be addressed in Spec 02: Worker Auth & Token Lifecycle.

## Glossary

- **Extension**: The Chrome browser extension built with Manifest V3, React 18, TypeScript, Vite, and Tailwind CSS.
- **Worker_API**: The Cloudflare Worker backend built with Hono framework and TypeScript.
- **Service_Worker_MV3**: The non-persistent background script in Manifest V3 extensions. It activates on events and terminates when idle; all state must be persisted to storage.
- **Setup_Screen**: The extension UI screen displayed on first install (or when no Worker_API base URL is configured) allowing the operator to configure the Worker_API base URL.
- **Status_Endpoint**: The `GET /v1/status` route on the Worker_API that returns system health, API version, minimum extension version, and feature flags. Unauthenticated in Spec 01.
- **chrome.storage.local**: A Chrome extension storage area persisted locally on the user's device, used to store the Worker_API base URL and operator preferences.

## Requirements


### Requirement 1: Chrome Extension Project Scaffold

**User Story:** As a developer, I want a fully configured Chrome Manifest V3 extension project with React, TypeScript, Vite, and Tailwind CSS, so that I have a working build pipeline for the extension shell.

#### Acceptance Criteria

1. THE Extension project SHALL use Chrome Manifest V3 format with a valid `manifest.json` containing `manifest_version: 3`.
2. THE Extension project SHALL use React 18.x as the UI framework, with the manifest declaring a `default_popup` HTML entry that renders a React component for the popup view and a separate entry point for the settings view.
3. THE Extension project SHALL use TypeScript with strict mode enabled for all source files.
4. THE Extension project SHALL use Vite as the build tool with a configuration that outputs a Chrome extension bundle to a `dist/` directory containing the `manifest.json` at the root level and all referenced scripts and assets.
5. THE Extension project SHALL use Tailwind CSS for styling with a `tailwind.config.ts` that compiles without errors during the build.
6. THE Extension manifest SHALL declare only the `storage` permission and host permissions for `https://*.workers.dev/*`.
7. THE Extension manifest SHALL include a `background.service_worker` field referencing the compiled Service_Worker_MV3 background script.
8. WHEN built with `npm run build`, THE Extension project SHALL produce a bundle that loads in Chrome via "Load unpacked" with zero errors or warnings in the extensions management page.
9. THE Extension manifest SHALL NOT declare any content scripts, `activeTab`, `tabs`, or `scripting` permissions.


### Requirement 2: Cloudflare Worker API Project Scaffold

**User Story:** As a developer, I want a fully configured Cloudflare Worker project with Hono and TypeScript, so that I have a working API shell for the backend.

#### Acceptance Criteria

1. THE Worker_API project SHALL export a Hono application instance as the entry point, with TypeScript as the source language.
2. THE Worker_API project SHALL include a `wrangler.toml` configuration containing at minimum the `name`, `main` (entry point path), and `compatibility_date` fields required for Cloudflare Workers deployment.
3. THE Worker_API project SHALL compile without errors using `npm run build` or `tsc --noEmit`.
4. THE Worker_API project SHALL NOT define any D1 database bindings, KV namespace bindings, or secret bindings in Spec 01.


### Requirement 3: GET /v1/status Public Health-Check Endpoint

**User Story:** As an extension client, I want to call an unauthenticated health-check endpoint on the Worker_API, so that I can verify connectivity and retrieve feature flags.

#### Acceptance Criteria

1. WHEN any HTTP GET request is sent to `/v1/status`, THE Worker_API SHALL respond with HTTP 200 and a JSON body containing `ok` (boolean `true`), `api_version` (string `"v1"`), `minimum_extension_version` (string `"1.0.0"`), `scanner_enabled` (boolean `false`), `drafting_enabled` (boolean `false`), `compare_enabled` (boolean `false`), and `promotional_modes_enabled` (boolean `false`).
2. THE Status_Endpoint SHALL NOT require any authentication headers, tokens, or signatures in Spec 01.
3. WHEN a request is sent to `/v1/status` using any HTTP method other than GET, THE Worker_API SHALL respond with HTTP 405 and a JSON error object containing `code` set to `METHOD_NOT_ALLOWED` and a `message` field.
4. WHEN a valid GET request is sent to `/v1/status`, THE Worker_API SHALL return the response within 3000 milliseconds under normal operating conditions.
5. WHEN a GET request is sent to any route other than `/v1/status`, THE Worker_API SHALL respond with HTTP 404 and a JSON error object containing `code` set to `NOT_FOUND` and a `message` field.


### Requirement 4: Extension Setup Screen

**User Story:** As an operator, I want a setup/settings screen in the extension, so that I can configure the Worker_API base URL and verify connectivity.

#### Acceptance Criteria

1. WHEN the Extension is installed and no Worker_API base URL has been saved in chrome.storage.local, THE Extension SHALL display the Setup_Screen.
2. THE Setup_Screen SHALL provide a text input for the Worker_API base URL (maximum 256 characters) with a default value of the production workers.dev URL.
3. WHEN the operator saves the Worker_API base URL, THE Extension SHALL validate that the value is a well-formed HTTPS URL before persisting it in chrome.storage.local.
4. IF the operator attempts to save a Worker_API base URL that is not a valid HTTPS URL, THEN THE Setup_Screen SHALL display an error message indicating the URL must begin with `https://` and be a well-formed URL, without persisting the value.
5. WHEN the operator saves a valid Worker_API base URL, THE Extension SHALL call `GET /v1/status` within a 10-second timeout to verify connectivity.
6. WHEN the status check returns HTTP 200 with `ok: true`, THE Setup_Screen SHALL display a success indicator and navigate the operator away from the Setup_Screen to the main extension popup view.
7. IF the status check fails (network error, timeout, or non-200 HTTP response), THEN THE Setup_Screen SHALL display an error message indicating the failure category (network unreachable or server error) and provide a retry button that re-triggers the status check.
8. THE Setup_Screen SHALL be accessible from the extension popup via a settings/gear icon at any time after initial setup.


### Requirement 5: Worker API Base URL Storage

**User Story:** As an operator, I want the Worker_API base URL persisted locally, so that the extension remembers my configuration across browser restarts.

#### Acceptance Criteria

1. THE Extension SHALL store the Worker_API base URL in chrome.storage.local under a constant key defined in the extension source code.
2. WHEN the Service_Worker_MV3 activates after being terminated, THE Extension SHALL read the Worker_API base URL from chrome.storage.local before making any API requests.
3. WHEN no Worker_API base URL is found in chrome.storage.local, THE Extension SHALL default to a hardcoded production URL constant.
4. WHEN the operator saves a new Worker_API base URL in settings, THE Extension SHALL validate that the value is a well-formed HTTPS URL no longer than 2048 characters, then persist it to chrome.storage.local before displaying a save confirmation to the operator.
5. IF the operator submits a Worker_API base URL that is not a valid HTTPS URL or exceeds 2048 characters, THEN THE Extension SHALL display an inline validation error message indicating the URL is invalid and SHALL NOT persist the value.
6. IF a chrome.storage.local read or write operation for the base URL fails, THEN THE Extension SHALL fall back to the hardcoded production URL constant and display an error indicator to the operator.


### Requirement 6: Backend Status Check from Extension

**User Story:** As an operator, I want the extension to check backend connectivity on popup open, so that I can confirm the Worker_API is reachable.

#### Acceptance Criteria

1. WHEN the operator opens the extension popup, THE Extension SHALL call `GET /v1/status` on the configured Worker_API base URL with a request timeout of 10 seconds.
2. WHEN the status response contains `ok: true` and `minimum_extension_version` is less than or equal to the current extension version (compared using semantic versioning), THE Extension SHALL display a green connectivity indicator.
3. WHEN the status response contains a `minimum_extension_version` higher than the current extension version (compared using semantic versioning major.minor.patch precedence), THE Extension SHALL display an update-required warning and a link to the extension update mechanism.
4. IF the status request fails due to a network error or the 10-second timeout elapses without a response, THEN THE Extension SHALL display an offline indicator with a retry button that re-invokes the status check on press.
5. IF the status request returns any HTTP error (4xx or 5xx), THEN THE Extension SHALL display a server-error indicator with a retry button.
6. WHILE a status check request is in progress, THE Extension SHALL display a loading indicator and SHALL NOT dispatch a duplicate status request.


### Requirement 7: Security Boundaries (Architectural Constraints)

**User Story:** As a security-conscious developer, I want strict architectural boundaries enforced in Spec 01, so that the extension shell cannot accidentally leak secrets or perform unauthorized actions.

#### Acceptance Criteria

1. THE Extension source code SHALL contain no API secrets, service credentials, or environment-specific keys for OpenAI, Reddit, Cloudflare, or any third-party service.
2. THE Extension source code SHALL NOT include any content scripts that interact with Reddit or any other website's DOM.
3. THE Extension SHALL NOT perform any automated posting, voting, direct messaging, or commenting on Reddit or any other platform.
4. THE Extension SHALL NOT extract, scrape, or read content from any web page via content scripts or the `scripting` API.
5. THE Worker_API source code SHALL NOT contain any hardcoded third-party API keys or secrets; all future secrets will be provided via Cloudflare environment variables or Wrangler secrets (deferred to Spec 02).
6. THE Extension SHALL only make HTTP requests to URLs matching the declared host permissions (`https://*.workers.dev/*`).
7. IF the Worker_API is unreachable or returns an error, THEN THE Extension SHALL remain responsive (no UI freeze exceeding 1 second) and SHALL NOT expose internal URLs, error stack traces, or configuration details in any user-visible output.


### Requirement 8: CI/CD Foundation

**User Story:** As a developer, I want build and type-check scripts for both projects, so that I can validate code correctness in continuous integration.

#### Acceptance Criteria

1. THE Extension project SHALL include a `build` npm script that produces a loadable Chrome extension bundle in the build output directory and exits with code 0 on success or non-zero on failure.
2. THE Extension project SHALL include a `typecheck` npm script that runs `tsc --noEmit` with strict mode and exits with code 0 when no type errors are found or non-zero when type errors exist.
3. THE Worker_API project SHALL include a `build` npm script that compiles the Worker into a deployable Cloudflare Worker bundle and exits with code 0 on success or non-zero on failure.
4. THE Worker_API project SHALL include a `typecheck` npm script that runs `tsc --noEmit` with strict mode and exits with code 0 when no type errors are found or non-zero when type errors exist.
5. THE Extension project SHALL include a `lint` npm script using ESLint with TypeScript-aware rules that exits with code 0 when no errors are reported or non-zero when one or more lint errors are reported.
6. THE Worker_API project SHALL include a `lint` npm script using ESLint with TypeScript-aware rules that exits with code 0 when no errors are reported or non-zero when one or more lint errors are reported.
7. WHEN any of the `build`, `typecheck`, or `lint` scripts are executed after a clean `npm install`, THE scripts SHALL complete without requiring additional manual setup steps or environment variables.

## Correctness Properties

The following properties MUST hold for any valid implementation of this specification:

1. **No Secrets in Extension**: A static analysis of the Extension source directory SHALL find zero occurrences of API keys, service credentials, or environment-specific secrets for any third-party service.
2. **No Content Scripts**: The Extension manifest SHALL declare zero content scripts and zero `scripting` or `activeTab` permissions.
3. **No Reddit Interaction**: The Extension SHALL contain no code that reads from, writes to, or interacts with Reddit's DOM or API.
4. **No Automated Actions**: The Extension SHALL contain no code that posts, votes, messages, or comments on any platform.
5. **Public Status Endpoint**: The `/v1/status` endpoint SHALL return HTTP 200 with the specified JSON body for any valid GET request without requiring authentication.
6. **Graceful Degradation**: FOR ALL Worker_API failure scenarios (network error, timeout, 4xx, 5xx), THE Extension SHALL remain responsive and display an appropriate status indicator without crashing or freezing.
7. **Persistence Across Restart**: WHEN the Service_Worker_MV3 is terminated and reactivated, THE Extension SHALL retrieve the Worker_API base URL from chrome.storage.local and resume operation without operator intervention.
8. **Host Permission Restriction**: The Extension SHALL only declare host permissions for `https://*.workers.dev/*` and SHALL NOT request broader host access.
9. **Valid Build Output**: Running `npm run build` in both projects SHALL produce zero errors and a deployable artifact.
