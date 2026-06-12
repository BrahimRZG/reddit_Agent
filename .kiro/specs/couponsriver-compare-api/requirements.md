# Requirements Document

## Introduction

This document specifies **Spec 04: CouponsRiver Compare API Foundation** for the Reddit Marketing Agent — a compliance-first system composed of a Chrome Extension (Manifest V3, React 18, TypeScript, Vite, Tailwind) and a Cloudflare Worker API (Hono, TypeScript, D1) used for **manual** Reddit research and drafting support. The product is explicitly **not** a Reddit bot and must never automate Reddit posting, voting, messaging, joining, following, or form submission.

Spec 04 adds a **Worker-side** foundation for a CouponsRiver "compare" capability: an endpoint that compares a candidate (a product, merchant, and/or coupon) against CouponsRiver data and returns matching coupon/offer information. This foundation is intended to **later** power Extension recommendations, but Spec 04 is Worker-focused and adds **no Extension UI**; a thin Extension client method is added only if a protected compare call requires it.

Because the real CouponsRiver database/API is unavailable, the data source in Spec 04 is a **clearly marked mock / in-memory adapter** that implements a replaceable service interface, so a real adapter can be dropped in later without changing the endpoint contract. Spec 04 introduces **no** external network calls, **no** third-party scraping, and **no** Reddit or AI features.

This spec builds on Spec 01 (MVP Foundation), Spec 02 (Worker Auth & Token Lifecycle), and Spec 03 (Compliance Onboarding Gate). It integrates with the existing Hono application, error response shape, and authentication middleware without altering their established behavior.

**Explicitly out of scope for Spec 04:**

- Reddit scanning, discovery, or any Reddit API call
- AI drafting or any OpenAI integration
- Real CouponsRiver network calls, scraping, or third-party HTTP requests of any kind
- Subreddit risk scoring, health tracker, promotional scoring
- Automating any Reddit action of any kind (posting, voting, messaging, joining, following, form submission)
- Any change to `GET /v1/status` behavior, including the `compare_enabled` flag value
- Any change to Spec 02 authentication / token lifecycle or Spec 03 compliance onboarding behavior
- Any Extension UI surface for compare

**Preserved behavior (must not regress):**

- `GET /v1/status` remains a public, unauthenticated, backward-compatible endpoint, returning the exact Spec 01 JSON body (including `compare_enabled: false`).
- The Spec 02 authentication middleware (`authMiddleware`) and token lifecycle remain unchanged; the protected Compare_Endpoint reuses `authMiddleware` without modification.
- Spec 03 compliance onboarding behavior, acknowledgement records, and Extension auth credential behavior remain unchanged.
- The standard `ErrorResponse` shape and existing `ErrorCode` values remain valid; new compare-specific codes are **added** to the union without removing or repurposing existing codes.
- Local development continues to allow `http://localhost` (including `http://localhost:8787`) and `http://127.0.0.1`, and the Extension build continues to copy `manifest.json` and icon assets into the build output.
- No secrets are present in or exposed to the Extension.

## Glossary

- **Worker_API**: The Cloudflare Worker backend built with the Hono framework and TypeScript, exporting a default Hono application typed as `AppEnv = { Bindings: Env; Variables: { installId: string } }`.
- **Extension**: The Chrome Manifest V3 browser extension built with React 18, TypeScript, Vite, and Tailwind CSS.
- **Compare_Endpoint**: The new Worker_API route, `POST /v1/compare`, that accepts a Compare_Request and returns a Compare_Response. This is the primary deliverable of Spec 04.
- **Candidate**: The subject of a comparison, supplied by the caller, describing a product, merchant, and/or coupon. Contains at minimum a merchant identifier and optionally a product name, coupon code, and category.
- **Compare_Request**: The JSON request body sent to the Compare_Endpoint. Wraps a single Candidate and any optional query options (such as a maximum number of matches to return).
- **Compare_Response**: The JSON success body returned by the Compare_Endpoint, containing the normalized query echo, a `match_count`, and a `matches` array of zero or more Match objects.
- **Match**: A single coupon/offer record returned from the data source that corresponds to the Candidate, including merchant, an optional coupon code, a human-readable description, a relevance score, and a `source` marker identifying the originating adapter.
- **Compare_Service**: The TypeScript service interface (e.g., `CompareService`) that defines the `compare(candidate) -> Compare_Response` operation. The Compare_Endpoint depends on this interface, not on any concrete implementation.
- **CouponsRiver_Adapter**: The Spec 04 concrete implementation of Compare_Service. In Spec 04 it is a **mock / in-memory / placeholder** adapter, clearly marked as mock in source, that holds CouponsRiver data in memory and performs matching without any external network call. It is designed to be replaced later by a real adapter implementing the same interface.
- **Compare_Validator**: The Worker_API logic that validates and normalizes a Compare_Request before the Compare_Service is invoked.
- **No_Match**: The successful outcome in which a valid Compare_Request produces zero Match objects. Represented as HTTP 200 with `match_count: 0` and an empty `matches` array — **not** as an error and **not** as HTTP 404.
- **ErrorResponse**: The standard Worker_API error body, `{ error: { code: ErrorCode; message: string; retry_after_seconds?: number } }`, defined in `worker-api/src/types/index.ts`.
- **ErrorCode**: The union of known Worker_API error codes in `worker-api/src/types/index.ts`. Spec 04 adds `VALIDATION_ERROR` to this union.
- **VALIDATION_ERROR**: The new ErrorCode returned with HTTP 400 when a Compare_Request is malformed or fails input validation.
- **authMiddleware**: The existing Spec 02 bearer-token authentication middleware (Authorization bearer token + `X-Install-Id` + `X-Timestamp` + `X-Nonce`) that validates the token hash, timestamp window, rate limit, and nonce, then sets `installId` on the Hono context.
- **Status_Endpoint**: The existing public `GET /v1/status` route (Spec 01), which is unauthenticated and unchanged by Spec 04.

## Requirements

### Requirement 1: Compare Endpoint and Method Guard

**User Story:** As an Extension client (and future recommendation feature), I want a Worker endpoint that compares a candidate against CouponsRiver data, so that I can retrieve matching coupon information from a single, well-defined API.

#### Acceptance Criteria

1. WHEN an authenticated HTTP POST request carrying valid Spec 02 authentication headers and a valid Compare_Request is sent to `/v1/compare`, THE Worker_API SHALL respond with HTTP 200 and a Compare_Response.
2. THE Compare_Endpoint SHALL accept the Compare_Request as a JSON request body with `Content-Type: application/json`.
3. WHEN a request is sent to `/v1/compare` using any HTTP method other than POST, THE Worker_API SHALL respond with HTTP 405 and an ErrorResponse whose `code` is `METHOD_NOT_ALLOWED`.
4. THE Worker_API SHALL mount the Compare_Endpoint under the existing `/v1` path namespace without altering the routing of `GET /v1/status`, `/v1/admin/*`, or `/v1/auth/*`.
5. WHEN a request targets a path under `/v1` that is not a defined route, THE Worker_API SHALL respond with HTTP 404 and an ErrorResponse whose `code` is `NOT_FOUND`, preserving the existing catch-all behavior.
6. WHEN a request is sent to `/v1/compare` using any HTTP method other than POST, THE Worker_API SHALL evaluate the non-POST 405 method guard BEFORE authentication, such that the non-POST request receives HTTP 405 with `code` `METHOD_NOT_ALLOWED` even when valid Spec 02 authentication headers are absent, mirroring the existing `/v1/auth/verify` method-guard precedence.

### Requirement 2: Compare Request Validation and Normalization

**User Story:** As a Worker maintainer, I want every compare request validated and normalized before processing, so that malformed input is rejected safely and matching operates on clean data.

#### Acceptance Criteria

1. THE Compare_Validator SHALL require the Compare_Request to contain a Candidate object with a non-empty `merchant` string after surrounding whitespace is trimmed.
2. IF the Compare_Request body is not valid JSON, THEN THE Worker_API SHALL respond with HTTP 400 and an ErrorResponse whose `code` is `VALIDATION_ERROR`.
3. IF the Compare_Request is missing the required `merchant` field, or the `merchant` field is empty or whitespace-only after trimming, THEN THE Worker_API SHALL respond with HTTP 400 and an ErrorResponse whose `code` is `VALIDATION_ERROR`.
4. IF any supplied Candidate field (`merchant`, `product`, `coupon_code`, or `category`) is present but is not of its required type (string), THEN THE Worker_API SHALL respond with HTTP 400 and an ErrorResponse whose `code` is `VALIDATION_ERROR`.
5. IF the `merchant` field exceeds 128 characters, the `product` field exceeds 256 characters, the `coupon_code` field exceeds 64 characters, or the `category` field exceeds 64 characters (measured after trimming), THEN THE Worker_API SHALL respond with HTTP 400 and an ErrorResponse whose `code` is `VALIDATION_ERROR`.
6. WHERE the Compare_Request includes a `max_results` option, IF `max_results` is not an integer between 1 and 50 inclusive, THEN THE Worker_API SHALL respond with HTTP 400 and an ErrorResponse whose `code` is `VALIDATION_ERROR`.
7. WHEN the Compare_Validator accepts a Compare_Request, THE Compare_Validator SHALL produce a normalized Candidate in which the `merchant`, `product`, `coupon_code`, and `category` string fields have leading and trailing whitespace removed.
8. WHEN a Compare_Request contains fields that are not defined in the Compare_Request schema, THE Compare_Validator SHALL ignore the unrecognized fields and SHALL validate only the defined fields.
9. IF the Compare_Request fails any validation rule, THEN THE Worker_API SHALL NOT invoke the Compare_Service for that request.

### Requirement 3: Successful Compare With One or More Matches

**User Story:** As a caller, I want a successful compare to return the coupons that match my candidate, so that I can present or act on relevant offers.

#### Acceptance Criteria

1. WHEN a valid Compare_Request matches one or more records in the data source, THE Worker_API SHALL respond with HTTP 200 and a Compare_Response whose `matches` array contains one Match per matching record.
2. THE Compare_Response SHALL include a `match_count` integer field whose value equals the number of elements in the `matches` array.
3. THE Compare_Response SHALL include a normalized echo of the queried Candidate so that the caller can confirm what was compared.
4. WHEN the Worker_API returns a Match, THE Match SHALL include a `merchant` string, an optional `coupon_code` string, a human-readable `description` string, a numeric relevance `score`, and a `source` string identifying the originating adapter.
5. WHERE the Compare_Request specifies a `max_results` option, THE Worker_API SHALL return no more Match objects than the specified `max_results` value.
6. WHEN the Worker_API returns multiple Match objects, THE Worker_API SHALL order the `matches` array deterministically by descending relevance `score` and SHALL break ties using a stable, deterministic ordering.

### Requirement 4: No-Match Versus Not-Found Semantics

**User Story:** As a caller, I want "no matching coupons" to be a normal successful result rather than an error, so that I can distinguish an empty result set from a malformed request or an unknown route.

#### Acceptance Criteria

1. WHEN a valid Compare_Request produces zero matching records, THE Worker_API SHALL respond with HTTP 200 and a Compare_Response whose `matches` array is empty and whose `match_count` is `0`.
2. THE Worker_API SHALL NOT use HTTP 404 or any ErrorResponse to represent a No_Match outcome.
3. THE Worker_API SHALL reserve HTTP 404 with ErrorCode `NOT_FOUND` for requests to undefined routes or unknown resources, distinct from the No_Match outcome.
4. WHEN the Worker_API returns a No_Match Compare_Response, THE Worker_API SHALL include the same normalized Candidate echo and `match_count` fields used for non-empty results.

### Requirement 5: Safe, Structured Error Responses

**User Story:** As a security-conscious team, I want malformed or failed compare requests to return safe, structured errors, so that callers receive actionable codes without any internal details being leaked.

#### Acceptance Criteria

1. WHEN the Worker_API returns any compare-related error, THE Worker_API SHALL use the standard ErrorResponse shape `{ error: { code, message, retry_after_seconds? } }`.
2. THE Worker_API SHALL set the ErrorResponse `code` for failed input validation to `VALIDATION_ERROR` and return HTTP 400.
3. THE Worker_API SHALL add `VALIDATION_ERROR` to the `ErrorCode` union in `worker-api/src/types/index.ts` without removing or changing any existing ErrorCode value.
4. THE Worker_API SHALL NOT include internal implementation details — including stack traces, exception messages, file paths, environment variable values, secrets, the contents of `INSTALL_TOKEN_PEPPER` or `ADMIN_BOOTSTRAP_SECRET`, database errors, or adapter internals — in any compare error response.
5. IF an unexpected error occurs while processing a compare request, THEN THE Worker_API SHALL respond with HTTP 500 and an ErrorResponse whose `code` is `INTERNAL_ERROR` and whose `message` is a generic, non-revealing description.
6. THE Worker_API SHALL provide a human-readable, non-sensitive `message` string for every compare error response.
7. WHERE minimal diagnostic information aids troubleshooting, THE Worker_API MAY include in a compare ErrorResponse an optional opaque error identifier field `error_id` (an opaque, randomly generated correlation value that is NOT derived from any secret and reveals no internal state) and/or an optional `timestamp` field within the `error` object formatted as an ISO 8601 timestamp; these fields SHALL be OPTIONAL and ADDITIVE, SHALL be safe to expose to callers and the Extension, and SHALL NOT contain or encode any secret, credential, stack trace, exception message, file path, environment variable value, database error text, SQL detail, upstream raw response, adapter internal detail, or authentication token.
8. WHEN the Worker_API adds the optional `error_id` or `timestamp` debugging fields, THE Worker_API SHALL add them in an ADDITIVE and BACKWARD-COMPATIBLE manner such that the canonical compare error shape becomes `{ error: { code, message, error_id?, timestamp?, retry_after_seconds? } }`, the existing ErrorResponse shape `{ error: { code, message, retry_after_seconds? } }` remains valid, the existing Spec 01, Spec 02, and Spec 03 error responses are unaffected, and the new fields (`error_id`, `timestamp`) remain optional on the ErrorResponse type so the shared error contract and other specs are not broken.

### Requirement 6: Authentication via Existing Middleware

**User Story:** As a platform owner, I want the compare endpoint protected using the existing authentication, so that I can restrict access without inventing a new auth mechanism.

#### Acceptance Criteria

1. THE Worker_API SHALL protect the Compare_Endpoint using the existing Spec 02 `authMiddleware`, without modifying that middleware.
2. IF a compare request to the protected Compare_Endpoint is missing required authentication headers or presents invalid credentials, THEN THE Worker_API SHALL respond with the authentication error codes and HTTP statuses already defined by `authMiddleware` (`MISSING_AUTH_HEADERS`, `INVALID_TOKEN`, `INSTALL_NOT_FOUND`, `TOKEN_REVOKED`, `TIMESTAMP_EXPIRED`, `NONCE_REUSED`, or `RATE_LIMITED`).
3. IF authentication fails for a compare request, THEN THE Worker_API SHALL NOT invoke the Compare_Service and SHALL NOT perform validation of the Compare_Request body.
4. WHEN a compare request presents valid Spec 02 authentication, THE Worker_API SHALL proceed to validate and process the Compare_Request, such that authentication is enforced before request validation, except the non-POST method guard which precedes authentication per Requirement 1.
5. THE Worker_API SHALL NOT alter the behavior, validation order, or error responses of `authMiddleware` as part of Spec 04.
6. THE Worker_API SHALL make the install identity available to the compare handler via the Hono context (`c.get('installId')`) as set by `authMiddleware`, without changing how `authMiddleware` sets it.

### Requirement 7: Mock CouponsRiver Adapter Behind a Replaceable Interface

**User Story:** As a developer, I want the CouponsRiver data source implemented as a mock adapter behind a service interface, so that a real CouponsRiver implementation can replace it later without changing the endpoint contract.

#### Acceptance Criteria

1. THE Worker_API SHALL define a Compare_Service interface declaring the compare operation that maps a normalized Candidate to a Compare_Response.
2. THE Compare_Endpoint SHALL depend only on the Compare_Service interface and SHALL NOT depend on the concrete CouponsRiver_Adapter implementation directly.
3. THE Worker_API SHALL implement the CouponsRiver_Adapter as an in-memory data source that satisfies the Compare_Service interface.
4. THE CouponsRiver_Adapter SHALL be clearly marked in source code as a mock / placeholder implementation that will be replaced by a real CouponsRiver data source.
5. WHEN the CouponsRiver_Adapter returns a Match, THE CouponsRiver_Adapter SHALL set the Match `source` field to a value that identifies the data as originating from the mock adapter.
6. THE Worker_API SHALL allow the CouponsRiver_Adapter to be replaced by an alternative Compare_Service implementation without changes to the Compare_Request or Compare_Response contract.

### Requirement 8: Determinism and Safety

**User Story:** As a security and reliability reviewer, I want the compare foundation to be deterministic and side-effect free, so that it cannot make external calls, cannot leak secrets, and behaves predictably in tests.

#### Acceptance Criteria

1. THE CouponsRiver_Adapter SHALL NOT perform any outbound network request to CouponsRiver or any external service.
2. WHEN the Compare_Endpoint processes the same valid Compare_Request against the same CouponsRiver_Adapter state, THE Worker_API SHALL return an identical Compare_Response on each invocation.
3. THE Worker_API SHALL compute compare results without reading or writing the D1 database (`DB` binding) for the compare operation in Spec 04.
4. THE Compare_Response SHALL NOT contain any secret, credential, environment value, or authentication token.
5. THE CouponsRiver_Adapter SHALL NOT mutate the Compare_Request or the Candidate supplied by the caller while computing matches.

### Requirement 9: Compare Request and Response Types

**User Story:** As a developer, I want strongly typed compare request and response definitions, so that the endpoint, service, and tests share a single typed contract.

#### Acceptance Criteria

1. THE Worker_API SHALL define a Compare_Request type and a Compare_Response type in `worker-api/src/types/index.ts`.
2. THE Compare_Request type SHALL define the Candidate fields `merchant` (required string), `product` (optional string), `coupon_code` (optional string), and `category` (optional string), and an optional `max_results` integer option.
3. THE Compare_Response type SHALL define a normalized Candidate echo, a `match_count` integer, and a `matches` array of Match objects.
4. THE Match type SHALL define a `merchant` string, an optional `coupon_code` string, a `description` string, a numeric `score`, and a `source` string.
5. THE Worker_API SHALL compile with TypeScript strict mode enabled after the compare types are added.

### Requirement 10: Worker Tests for Compare

**User Story:** As a developer, I want automated Worker tests for the compare endpoint, so that valid, invalid, and no-match behaviors are verifiably correct and remain correct over time.

#### Acceptance Criteria

1. THE Worker_API test suite SHALL include a test that sends a valid Compare_Request with valid Spec 02 authentication headers to `/v1/compare` and asserts an HTTP 200 Compare_Response with `match_count` equal to the length of the `matches` array.
2. THE Worker_API test suite SHALL include a test that sends, with valid Spec 02 authentication headers, a Compare_Request missing the required `merchant` field and asserts an HTTP 400 ErrorResponse with `code` `VALIDATION_ERROR`.
3. THE Worker_API test suite SHALL include a test that sends, with valid Spec 02 authentication headers, a malformed (non-JSON) request body and asserts an HTTP 400 ErrorResponse with `code` `VALIDATION_ERROR`.
4. THE Worker_API test suite SHALL include a test that sends, with valid Spec 02 authentication headers, a valid Compare_Request producing no matches and asserts an HTTP 200 Compare_Response with `match_count` `0` and an empty `matches` array.
5. THE Worker_API test suite SHALL include a test that sends a non-POST method to `/v1/compare` and asserts an HTTP 405 ErrorResponse with `code` `METHOD_NOT_ALLOWED`, without requiring valid authentication headers (the method guard precedes authentication).
6. THE Worker_API test suite SHALL include a test that sends an otherwise-valid Compare_Request WITHOUT valid Spec 02 authentication headers (for example, with the `Authorization` header omitted) and asserts that the Worker_API returns the `authMiddleware` error (for example `MISSING_AUTH_HEADERS`) and that the Compare_Service is NOT invoked.
7. THE Worker_API test suite SHALL execute the compare tests using Vitest by calling `app.request(path, { ... })` against the default-exported Hono application.

### Requirement 11: Preserved Behavior and Security Boundaries

**User Story:** As a developer maintaining Specs 01, 02, and 03, I want Spec 04 to integrate without regressing existing behavior, so that status, authentication, onboarding, local development, and build behavior remain intact.

#### Acceptance Criteria

1. THE Worker_API SHALL continue to respond to `GET /v1/status` with HTTP 200 and the exact Spec 01 status JSON, including `compare_enabled` equal to `false`.
2. THE Worker_API SHALL NOT make the availability of the Compare_Endpoint depend on changing the `GET /v1/status` response body.
3. THE Worker_API SHALL keep the Spec 02 authentication and token lifecycle behavior unchanged, including the `authMiddleware` validation order and the `/v1/admin/*` and `/v1/auth/*` route behavior.
4. THE Extension SHALL keep Spec 03 compliance onboarding behavior, the Acknowledgement_Record, and the gating of authenticated actions unchanged.
5. WHERE a protected Compare_Endpoint requires an Extension caller, THE Extension SHALL add at most a thin client method that reuses the existing Spec 02 credential and request-signing behavior, and SHALL NOT add any Extension compare UI.
6. THE Extension source code and the Worker_API source code SHALL contain no third-party API secrets, and the Worker_API SHALL NOT expose any secret to the Extension through the Compare_Endpoint.
7. THE Worker_API SHALL NOT add Reddit scanning, Reddit API calls, AI drafting, OpenAI integration, subreddit risk scoring, health tracking, or promotional scoring as part of Spec 04.
8. THE Worker_API SHALL NOT automate posting, voting, messaging, joining, following, or form submission as part of Spec 04.
9. THE Extension build SHALL continue to copy `manifest.json` and the icon assets into the build output directory, and the Extension SHALL continue to accept `http://localhost` and `http://127.0.0.1` base URLs (including `http://localhost:8787`) during URL validation.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Validation Soundness and Completeness

*For any* Compare_Request, the Worker_API SHALL return an HTTP 200 Compare_Response if and only if the request passes every validation rule; any request that violates a validation rule (malformed JSON, missing or empty `merchant`, wrong field type, out-of-bounds length, or invalid `max_results`) SHALL receive an HTTP 400 ErrorResponse with code `VALIDATION_ERROR`, and the Compare_Service SHALL NOT be invoked for that request.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.9**

### Property 2: Normalization Idempotence

*For any* Candidate, applying the Compare_Validator normalization twice SHALL produce the same result as applying it once.

**Validates: Requirements 2.7**

### Property 3: No-Match Is Success

*For any* valid Compare_Request that yields zero matches, the Worker_API SHALL respond with HTTP 200, `match_count` equal to `0`, and an empty `matches` array, and SHALL never represent this outcome as HTTP 404 or any ErrorResponse.

**Validates: Requirements 4.1, 4.2, 4.3**

### Property 4: Match Count Invariant

*For any* Compare_Response, the `match_count` field SHALL equal the number of elements in the `matches` array, and `match_count` SHALL be greater than or equal to `0`.

**Validates: Requirements 3.2, 4.1, 4.4**

### Property 5: Result Bound and Deterministic Ordering

*For any* valid Compare_Request, the number of returned Match objects SHALL not exceed the effective `max_results` limit, and the `matches` array SHALL be ordered deterministically by descending relevance `score` with a stable tie-break, such that repeated evaluations of the same request produce the same ordering.

**Validates: Requirements 3.5, 3.6, 8.2**

### Property 6: Match Provenance and Shape

*For any* Match returned by the Worker_API, the Match SHALL include a `merchant` string, a `description` string, a numeric `score`, and a `source` field identifying the mock CouponsRiver_Adapter.

**Validates: Requirements 3.4, 7.5, 9.4**

### Property 7: Adapter Purity and No External IO

*For any* Compare_Request, the CouponsRiver_Adapter SHALL compute its result without performing any external network request, without reading or writing the D1 database, and without mutating the supplied Compare_Request or Candidate.

**Validates: Requirements 8.1, 8.3, 8.5**

### Property 8: Determinism

*For any* valid Compare_Request evaluated against the same CouponsRiver_Adapter state, repeated invocations SHALL return identical Compare_Response values.

**Validates: Requirements 8.2**

### Property 9: Errors Never Leak Internals

*For any* compare error response, the body SHALL conform to the ErrorResponse shape with a `code` drawn only from the ErrorCode union and a human-readable `message`, MAY additionally include only the optional non-sensitive debugging fields `error_id` (an opaque correlation identifier not derived from any secret) and `timestamp` (an ISO 8601 timestamp within the `error` object), and SHALL contain no stack trace, exception text, file path, secret, credential, environment value, database error, SQL detail, upstream raw response, authentication token, or adapter internal detail.

**Validates: Requirements 5.1, 5.2, 5.4, 5.5, 5.6, 5.7, 5.8, 8.4**

### Property 10: Method Guard

*For any* HTTP method other than POST sent to `/v1/compare`, the Worker_API SHALL respond with HTTP 405 and an ErrorResponse whose code is `METHOD_NOT_ALLOWED`.

**Validates: Requirements 1.3**

### Property 11: Active Auth Enforcement

*For any* request to the protected Compare_Endpoint that lacks valid authentication, the existing `authMiddleware` SHALL reject the request with its already-defined error code and status before the Compare_Service is invoked and before request-body validation; a non-POST method SHALL still receive HTTP 405 via the method guard that precedes authentication.

**Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 1.3**

### Property 12: Preserved Status, Auth, and Onboarding

*For any* sequence of compare requests, `GET /v1/status` SHALL continue to return the exact Spec 01 status JSON (including `compare_enabled: false`), and the Spec 02 authentication/token lifecycle and Spec 03 compliance onboarding behavior SHALL remain unchanged.

**Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.7, 11.8**
