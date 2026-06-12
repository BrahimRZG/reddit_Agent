# Requirements Document

## Introduction

This document specifies **Spec 03: Compliance Onboarding Gate** for the Reddit Marketing Agent — a compliance-first Chrome Extension (Manifest V3, React 18, TypeScript, Vite, Tailwind) paired with a Cloudflare Worker API (Hono, TypeScript, D1) used for **manual** Reddit research and drafting support. The product is explicitly **not** a Reddit bot and must never automate Reddit posting, voting, messaging, joining, following, form submission, or any other Reddit action.

Spec 03 adds a one-time (per acknowledgement version) compliance onboarding gate that an Operator must complete before the Extension performs any Authenticated_Action. Onboarding presents the compliance rules of the tool, requires the Operator to affirmatively acknowledge each rule, and records a timestamped, versioned acknowledgement in local device storage. Until onboarding is complete, Authenticated_Actions are blocked, while the public connectivity check remains available.

This spec builds on Spec 01 (MVP Foundation) and Spec 02 (Worker Auth & Token Lifecycle). It integrates with the existing storage, credential, and API-client modules without altering their established behavior, except where an Authenticated_Action must now be gated behind onboarding completion.

**Explicitly out of scope for Spec 03:**

- Reddit scanning or discovery
- AI drafting or any OpenAI integration
- CouponsRiver APIs or coupon/tool retrieval
- Subreddit risk scoring
- Health tracker or promotional scoring
- Automating any Reddit action of any kind
- Transmitting the onboarding acknowledgement to the Worker_API (the acknowledgement is local-only unless a future spec establishes a genuine need)

**Preserved behavior (must not regress):**

- `GET /v1/status` remains a public, unauthenticated, backward-compatible endpoint.
- Local development continues to allow `http://localhost` (including `http://localhost:8787`) and `http://127.0.0.1` in Extension URL validation and manifest host permissions.
- No secrets are present in Extension code.
- Existing Spec 02 modules and tests (`credential-storage.ts`, `api-client.ts`, auth middleware, and related files and tests) remain present and functional.
- The Extension build continues to copy `manifest.json` and icons into the build output (`dist/`).
- Spec 01 and Spec 02 behavior is unchanged except for the gating of Authenticated_Actions defined in this spec.

## Glossary

- **Extension**: The Chrome Manifest V3 browser extension built with React 18, TypeScript (strict mode), Vite, and Tailwind CSS.
- **Worker_API**: The Cloudflare Worker backend built with the Hono framework and TypeScript.
- **Operator**: The human CouponsRiver team member who installs and uses the Extension.
- **Compliance_Onboarding**: The gating process in which the Operator reviews the compliance rules and affirmatively acknowledges each rule before using Authenticated_Actions.
- **Onboarding_Screen**: The Extension UI surface (a dedicated screen or a section of the settings view) that presents the compliance rules and the acknowledgement controls.
- **Acknowledgement_Item**: A single required compliance statement that the Operator must affirmatively accept (rendered as a checkbox), defined in Requirement 3.
- **Acknowledgement_Record**: The local data record that captures onboarding completion, including the acknowledged version, the acceptance timestamp, and the accepted Acknowledgement_Items.
- **Acknowledgement_Version**: A version identifier (semantic version string) for the current set of compliance rules and Acknowledgement_Items, defined as a constant in Extension source code.
- **Onboarding_Complete**: The state in which a valid Acknowledgement_Record exists in chrome.storage.local whose acknowledged version equals the current Acknowledgement_Version and in which every required Acknowledgement_Item is accepted.
- **Authenticated_Action**: Any Extension operation that uses Install_Credentials to call an authenticated Worker_API route (for example, a request to `POST /v1/auth/verify` using the install token, or any future authenticated call). The public `GET /v1/status` connectivity check is **not** an Authenticated_Action.
- **Install_Credentials**: The install identity and token persisted by Spec 02 in chrome.storage.local under keys `rma_install_id` and `rma_install_token`.
- **Status_Endpoint**: The public `GET /v1/status` route on the Worker_API. Unauthenticated and not gated by Compliance_Onboarding.
- **chrome.storage.local**: The Chrome extension local storage area persisted on the Operator's device, used to store the Acknowledgement_Record and existing configuration.
- **ONBOARDING_STORAGE_KEY**: The chrome.storage.local key used for the Acknowledgement_Record, named `rma_onboarding_acknowledgement` following the existing `rma_` prefix convention.

## Requirements

### Requirement 1: Local Onboarding State Storage

**User Story:** As an Operator, I want my compliance acknowledgement stored locally on my device, so that the Extension remembers that I completed onboarding across browser restarts without sending my acknowledgement to a server.

#### Acceptance Criteria

1. THE Extension SHALL store the Acknowledgement_Record in chrome.storage.local under the constant key `rma_onboarding_acknowledgement` defined in Extension source code.
2. THE Acknowledgement_Record SHALL contain a boolean `acknowledged` field, a string `version` field holding the accepted Acknowledgement_Version, a string `acknowledged_at` field holding an ISO 8601 timestamp, and an `items` field enumerating the accepted Acknowledgement_Item identifiers.
3. WHEN the Extension reads the Acknowledgement_Record, THE Extension SHALL retrieve the record from chrome.storage.local using the `rma_onboarding_acknowledgement` key.
4. WHEN no Acknowledgement_Record exists under the `rma_onboarding_acknowledgement` key, THE Extension SHALL treat Compliance_Onboarding as incomplete.
5. THE Extension SHALL store the Acknowledgement_Record using a storage key that is distinct from the Spec 02 credential keys `rma_install_id` and `rma_install_token` and from the Spec 01 key `rma_worker_api_base_url`.
6. THE Extension SHALL NOT transmit the Acknowledgement_Record or any Acknowledgement_Item to the Worker_API.
7. IF a chrome.storage.local read operation for the Acknowledgement_Record fails, THEN THE Extension SHALL treat Compliance_Onboarding as incomplete, regardless of whether an Acknowledgement_Record might exist in storage, and SHALL NOT treat onboarding as complete based on an unverified or partially read record.
8. WHEN the Extension fails to read the Acknowledgement_Record from chrome.storage.local, THE Extension SHALL treat Compliance_Onboarding as incomplete, SHALL keep every gated Authenticated_Action unavailable, and SHOULD display a recoverable storage error message to the Operator.

### Requirement 2: Onboarding Content Presentation

**User Story:** As an Operator, I want the onboarding screen to clearly explain how I am permitted to use the tool, so that I understand my compliance obligations before using authenticated features.

#### Acceptance Criteria

1. WHILE Compliance_Onboarding is incomplete, THE Extension SHALL display the Onboarding_Screen when the Operator opens the Extension.
2. THE Onboarding_Screen SHALL state that the Extension is a manual Reddit research and drafting assistant and is not a Reddit automation bot.
3. THE Onboarding_Screen SHALL state that the Extension must not be used to automate Reddit posting, voting, messaging, joining, following, or form submission.
4. THE Onboarding_Screen SHALL state that the Operator must review, edit, and manually submit all Reddit content.
5. THE Onboarding_Screen SHALL state that the Operator must follow subreddit rules and Reddit policies.
6. THE Onboarding_Screen SHALL state that the Operator must disclose affiliation when content is promotional or coupon-related.
7. THE Onboarding_Screen SHALL state that the Operator must not use the Extension for spam, vote manipulation, impersonation, or ban evasion.
8. THE Onboarding_Screen SHALL display the current Acknowledgement_Version to the Operator.

### Requirement 3: Required Acknowledgement Checkboxes

**User Story:** As an Operator, I want to affirmatively accept each compliance rule, so that my agreement to the rules is explicit and recorded.

#### Acceptance Criteria

1. THE Onboarding_Screen SHALL present the following Acknowledgement_Items, each as a separate checkbox that defaults to unchecked: (a) the Extension is a manual research and drafting assistant and not a bot; (b) the Operator will not automate Reddit posting, voting, messaging, joining, following, or form submission; (c) the Operator will review, edit, and manually submit all Reddit content; (d) the Operator will follow subreddit rules and Reddit policies; (e) the Operator will disclose affiliation when content is promotional or coupon-related; (f) the Operator will not use the Extension for spam, vote manipulation, impersonation, or ban evasion.
2. WHILE one or more required Acknowledgement_Items are unchecked, THE Onboarding_Screen SHALL keep the accept control disabled.
3. WHEN every required Acknowledgement_Item is checked, THE Onboarding_Screen SHALL enable the accept control.
4. WHEN the Operator activates the accept control while every required Acknowledgement_Item is checked, THE Extension SHALL persist an Acknowledgement_Record marking Compliance_Onboarding as complete.
5. IF the Operator activates the accept control while one or more required Acknowledgement_Items are unchecked, THEN THE Extension SHALL NOT persist an Acknowledgement_Record and THE Onboarding_Screen SHALL display a message indicating that every Acknowledgement_Item must be accepted.
6. WHEN the Extension validates a candidate acknowledgement, THE Extension SHALL treat the acknowledgement as valid only when every required Acknowledgement_Item identifier is present in the accepted set.

### Requirement 4: Timestamped, Versioned Acknowledgement Record

**User Story:** As a compliance reviewer, I want each acknowledgement recorded with a timestamp and version, so that there is a local record of when the Operator accepted which version of the rules.

#### Acceptance Criteria

1. WHEN the Extension persists an Acknowledgement_Record, THE Extension SHALL set the `acknowledged_at` field to the ISO 8601 timestamp at which the Operator accepted the Acknowledgement_Items.
2. WHEN the Extension persists an Acknowledgement_Record, THE Extension SHALL set the `version` field to the current Acknowledgement_Version constant.
3. WHEN the Extension persists an Acknowledgement_Record, THE Extension SHALL set the `acknowledged` field to `true`.
4. THE Extension SHALL define the Acknowledgement_Version as a semantic version string constant in Extension source code.
5. WHILE a stored Acknowledgement_Record has a `version` value lower than the current Acknowledgement_Version, THE Extension SHALL treat Compliance_Onboarding as incomplete and SHALL display the Onboarding_Screen.
6. IF a chrome.storage.local write operation for the Acknowledgement_Record fails, THEN THE Extension SHALL display an error message to the Operator and SHALL treat Compliance_Onboarding as incomplete.

### Requirement 5: Gating Authenticated Extension Actions

**User Story:** As a compliance-conscious team, I want authenticated extension actions blocked until onboarding is complete, so that the tool cannot be used against an authenticated backend before the Operator agrees to the compliance rules.

#### Acceptance Criteria

1. WHILE Compliance_Onboarding is incomplete, THE Extension SHALL block every Authenticated_Action and SHALL NOT send an authenticated request to the Worker_API.
2. IF an Authenticated_Action is invoked while Compliance_Onboarding is incomplete, THEN THE Extension SHALL return an error identified by the code `ONBOARDING_REQUIRED` and SHALL NOT attach Install_Credentials to any outbound request.
3. WHEN Compliance_Onboarding is complete, THE Extension SHALL permit Authenticated_Actions to proceed.
4. THE Extension SHALL keep the public Status_Endpoint connectivity check (`GET /v1/status`) available regardless of whether Compliance_Onboarding is complete.
5. WHILE Compliance_Onboarding is incomplete, THE Extension SHALL present any control that initiates an Authenticated_Action in a disabled state or SHALL route the Operator to the Onboarding_Screen when such a control is activated.
6. WHEN the Extension determines whether to permit an Authenticated_Action, THE Extension SHALL evaluate Onboarding_Complete using the locally stored Acknowledgement_Record.

### Requirement 6: Preserved Behavior and Security Boundaries

**User Story:** As a developer maintaining Specs 01 and 02, I want Spec 03 to integrate without regressing existing behavior, so that connectivity, local development, and security boundaries remain intact.

#### Acceptance Criteria

1. THE Worker_API SHALL continue to respond to `GET /v1/status` with HTTP 200 and the existing public, unauthenticated status response defined in Spec 01.
2. THE Extension SHALL continue to accept `http://localhost` and `http://127.0.0.1` base URLs (including `http://localhost:8787`) during URL validation.
3. THE Extension manifest SHALL continue to declare host permissions for `http://localhost/*` and `http://127.0.0.1/*` in addition to `https://*.workers.dev/*`.
4. THE Extension source code SHALL contain no API secrets, service credentials, or environment-specific keys for any third-party service.
5. THE Extension SHALL retain the Spec 02 modules `credential-storage.ts` and `api-client.ts`, the Worker_API authentication middleware, and their associated tests.
6. WHEN the Extension is built, THE Extension build SHALL copy `manifest.json` and the icon assets into the build output directory.
7. THE Extension SHALL NOT automate Reddit posting, voting, messaging, joining, following, or form submission as part of Compliance_Onboarding or gating.

### Requirement 7: Onboarding and Gating Tests

**User Story:** As a developer, I want automated tests for onboarding storage, acknowledgement validation, and gating, so that the compliance gate is verifiably correct and remains correct over time.

#### Acceptance Criteria

1. THE Extension test suite SHALL include tests that verify the Acknowledgement_Record is written to and read from chrome.storage.local under the `rma_onboarding_acknowledgement` key, using a mocked chrome.storage.local.
2. THE Extension test suite SHALL include tests that verify acknowledgement validation accepts a candidate only when every required Acknowledgement_Item is present and rejects a candidate when one or more Acknowledgement_Items are missing.
3. THE Extension test suite SHALL include tests that verify an Authenticated_Action is blocked with the `ONBOARDING_REQUIRED` error while Compliance_Onboarding is incomplete and is permitted once Compliance_Onboarding is complete.
4. THE Extension test suite SHALL include a test that verifies a stored Acknowledgement_Record with a `version` lower than the current Acknowledgement_Version is treated as incomplete.
5. THE Extension test suite SHALL include a test that verifies the public Status_Endpoint connectivity check remains available while Compliance_Onboarding is incomplete.
6. THE Extension SHALL run the tests using Vitest.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Gate Soundness

*For any* invocation of an Authenticated_Action, the action SHALL send an authenticated request to the Worker_API if and only if Onboarding_Complete evaluates to `true` for the locally stored Acknowledgement_Record.

**Validates: Requirements 5.1, 5.2, 5.3, 5.6**

### Property 2: Fail-Closed Gating

*For any* state in which the Acknowledgement_Record is missing, unreadable, or invalid, the Extension SHALL treat Compliance_Onboarding as incomplete and SHALL block Authenticated_Actions; in particular, a read failure SHALL NOT imply completion even if an Acknowledgement_Record may exist in storage.

**Validates: Requirements 1.4, 1.7, 1.8, 4.6, 5.1**

### Property 3: Acknowledgement Completeness

*For any* candidate acknowledgement, validation SHALL report the acknowledgement as complete if and only if every required Acknowledgement_Item identifier is present in the accepted set.

**Validates: Requirements 3.4, 3.5, 3.6**

### Property 4: Acknowledgement Record Round-Trip

*For any* valid completed acknowledgement, writing the Acknowledgement_Record via the storage module and then reading it back SHALL return a record whose `acknowledged`, `version`, `acknowledged_at`, and `items` fields equal the values that were written.

**Validates: Requirements 1.1, 1.2, 1.3, 4.1, 4.2, 4.3**

### Property 5: Version Re-Acknowledgement

*For any* stored Acknowledgement_Record whose `version` is lower than the current Acknowledgement_Version, Onboarding_Complete SHALL evaluate to `false` and the Extension SHALL display the Onboarding_Screen.

**Validates: Requirements 4.5**

### Property 6: Public Status Always Available

*For any* onboarding state (complete or incomplete), the public Status_Endpoint connectivity check (`GET /v1/status`) SHALL remain invokable and SHALL NOT be blocked by the onboarding gate.

**Validates: Requirements 5.4, 6.1**

### Property 7: Local-Only Acknowledgement

*For any* completion of Compliance_Onboarding, the Extension SHALL persist the Acknowledgement_Record only to chrome.storage.local and SHALL issue zero requests carrying the Acknowledgement_Record or any Acknowledgement_Item to the Worker_API.

**Validates: Requirements 1.6**

### Property 8: Timestamp and Version Presence

*For any* Acknowledgement_Record marked complete (`acknowledged` is `true`), the record SHALL contain a non-empty ISO 8601 `acknowledged_at` timestamp and a `version` equal to the Acknowledgement_Version that was current at acceptance time.

**Validates: Requirements 4.1, 4.2, 4.3**
