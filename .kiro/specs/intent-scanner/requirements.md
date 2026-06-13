# Requirements Document

## Introduction

This document specifies **Spec 05: Intent Scanner (Manual Input Only)** for the Reddit Marketing Agent — a compliance-first system composed of a Chrome Extension (Manifest V3, React 18, TypeScript, Vite, Tailwind) and a Cloudflare Worker API (Hono, TypeScript, D1) used for **manual** Reddit research and drafting support. The product is explicitly **not** a Reddit bot and must never automate Reddit posting, voting, messaging, joining, following, or form submission.

This corrected Spec 05 defines a **local, deterministic, Extension-UI-only** intent scanner. The Operator manually pastes or types Reddit post or thread text into the Extension UI, and the Extension analyzes that text **locally** with no network calls. The analysis assigns an Intent_Category and a Confidence_Value, extracts Detected_Candidate signals, and — **only** when the Operator explicitly chooses — performs a single optional lookup against the **existing** protected `/v1/compare` endpoint using the **existing** Authenticated_API_Client. There is **no automated discovery of any kind**.

This spec builds on Spec 01 (MVP Foundation), Spec 02 (Worker Auth & Token Lifecycle), Spec 03 (Compliance Onboarding Gate), and Spec 04 (CouponsRiver Compare API Foundation). It reuses the existing Extension manifest permissions, the existing authentication/credential client, and the existing `/v1/compare` contract without modification.

### Non-Goals (Explicitly Out of Scope)

The Intent_Scanner **MUST NOT** introduce, imply, or depend on any of the following. No acceptance criterion in this document implies any of these:

- Any Worker `/v1/scan` endpoint or any scan endpoint usage.
- Any Reddit API access of any kind.
- Any RSS feed or RSS fallback.
- `chrome.alarms` or any scheduled or background scanning.
- `chrome.notifications` or notifications of any kind.
- Any background scanner or background discovery process.
- Any content script.
- Any `reddit.com` or `old.reddit.com` host permission.
- Any manifest permission expansion (the feature works within existing permissions only).
- Any scraping, crawling, Firecrawl, or IP rotation.
- Any automated Reddit action (no posting, voting, direct messaging, following, or form submission).
- Any draft generation.
- Any OpenAI, LLM, or other AI provider call.

### In Scope

- Local, deterministic text normalization of Operator-pasted Input_Text.
- Local, deterministic intent classification that assigns one Intent_Category and a Confidence_Value, computed entirely in the Extension with no network call.
- Local, deterministic candidate extraction that produces Detected_Candidate items (keywords, tool mentions, and signals) from the pasted text.
- An optional, Operator-triggered Compare_Lookup against the existing protected `/v1/compare` endpoint via the existing Authenticated_API_Client. This is the only network call permitted, and only when the Operator explicitly triggers it.
- Display in the Extension UI of: the Intent_Category, the Confidence_Value, the Detected_Candidate list, the Compare_Outcome (when the Operator triggered a Compare_Lookup), and the Compliance_Reminders.

## Glossary

- **Extension**: The Chrome Manifest V3 browser extension built with React 18, TypeScript, Vite, and Tailwind CSS. The Intent_Scanner is a feature surface within the Extension UI.
- **Operator**: The human CouponsRiver user who manually pastes or types text into the Extension and manually decides whether and how to participate on Reddit.
- **Intent_Scanner**: The Extension-UI-only feature specified by this document that normalizes, classifies, and extracts candidates from Operator-pasted text and optionally performs an Operator-triggered Compare_Lookup.
- **Input_Text**: The raw text the Operator pastes or types into the Intent_Scanner input control within the Extension UI. Input_Text is the only data source for analysis.
- **Text_Normalizer**: The local, deterministic, in-memory component that transforms Input_Text into Normalized_Text.
- **Normalized_Text**: The output of the Text_Normalizer: a cleaned, case-consistent, whitespace-collapsed representation of Input_Text used by the Intent_Classifier and the Candidate_Extractor.
- **Intent_Classifier**: The local, deterministic, in-memory component that assigns exactly one Intent_Category and one Confidence_Value to Normalized_Text.
- **Intent_Category**: Exactly one value from the enumerated set defined in the Extension source code: `recommendation_request`, `comparison_request`, `pricing_question`, `deal_or_coupon_request`, `general_discussion`, and `none`.
- **Confidence_Value**: A numeric score in the inclusive range `0.0` to `1.0` that expresses how strongly the Normalized_Text matches the assigned Intent_Category.
- **Candidate_Extractor**: The local, deterministic, in-memory component that produces a list of zero or more Detected_Candidate items from Normalized_Text.
- **Detected_Candidate**: A single extracted signal with a `type` and a `value`. The `type` is one value from the enumerated set defined in the Extension source code: `keyword`, `tool_mention`, `merchant_mention`, and `coupon_signal`. The `value` is the extracted text string.
- **Compare_Lookup**: The single optional, Operator-triggered request the Intent_Scanner sends to the existing protected `/v1/compare` endpoint.
- **Compare_Endpoint**: The existing protected `POST /v1/compare` Worker route defined by Spec 04, reused without modification.
- **Authenticated_API_Client**: The existing Extension client (Spec 02) that attaches the install credentials and request-signing headers to authenticated Worker requests. The Intent_Scanner reuses this client without modification.
- **Compare_Outcome**: The result of a Compare_Lookup as observed by the Intent_Scanner: either a successful Compare_Response (match count and matches) or a categorized failure indicator.
- **Compliance_Reminders**: The set of plain-language reminders the Intent_Scanner displays, consistent with the PRD compliance principles (transparent, manual, value-first; no automated Reddit action; Operator responsible for disclosure).
- **chrome.storage.local**: A Chrome extension storage area persisted locally on the Operator's device.

## Requirements

### Requirement 1: Manual Text Input

**User Story:** As an Operator, I want to paste or type Reddit post or thread text into the Extension UI, so that the Extension can analyze that text locally without any automated discovery.

#### Acceptance Criteria

1. THE Intent_Scanner SHALL provide a multi-line text input control within the Extension UI for the Operator to paste or type Input_Text.
2. THE Intent_Scanner SHALL accept Input_Text up to 10000 characters in length.
3. WHEN the Operator submits Input_Text containing at least one non-whitespace character, THE Intent_Scanner SHALL begin local analysis of the Normalized_Text.
4. IF the Operator submits Input_Text containing zero non-whitespace characters, THEN THE Intent_Scanner SHALL display a validation message requesting non-empty text and SHALL withhold any Intent_Category result.
5. IF the Operator submits Input_Text exceeding 10000 characters, THEN THE Intent_Scanner SHALL display a validation message stating the 10000-character maximum and SHALL withhold analysis until the Operator shortens Input_Text.
6. THE Intent_Scanner SHALL derive Input_Text only from the Extension UI input control populated by the Operator and SHALL use no other source for Input_Text.

### Requirement 2: Deterministic Text Normalization

**User Story:** As an Operator, I want pasted text normalized deterministically before analysis, so that classification and extraction operate on clean, consistent input.

#### Acceptance Criteria

1. WHEN the Intent_Scanner receives Input_Text, THE Text_Normalizer SHALL transform Input_Text into Normalized_Text using only local, in-memory operations.
2. WHEN the Text_Normalizer processes identical Input_Text, THE Text_Normalizer SHALL produce identical Normalized_Text on every invocation.
3. WHEN the Text_Normalizer normalizes Normalized_Text a second time, THE Text_Normalizer SHALL return Normalized_Text unchanged.
4. THE Text_Normalizer SHALL convert Input_Text to a single consistent letter case, collapse each run of consecutive whitespace characters into a single space character, and remove leading and trailing whitespace.
5. THE Text_Normalizer SHALL complete normalization without performing any network request.

### Requirement 3: Deterministic Intent Classification

**User Story:** As an Operator, I want the Extension to assign an intent category and a confidence value to the pasted text locally, so that I can understand the intent of the text without any external service.

#### Acceptance Criteria

1. WHEN the Text_Normalizer produces Normalized_Text, THE Intent_Classifier SHALL assign exactly one Intent_Category from the enumerated set defined in the Glossary.
2. THE Intent_Classifier SHALL assign a Confidence_Value within the inclusive range 0.0 to 1.0 for each classification.
3. WHEN the Intent_Classifier processes identical Normalized_Text, THE Intent_Classifier SHALL return an identical Intent_Category and an identical Confidence_Value on every invocation.
4. THE Intent_Classifier SHALL compute the Intent_Category and the Confidence_Value using only local, in-memory logic and SHALL perform no network request.
5. WHERE Normalized_Text matches no classification signal, THE Intent_Classifier SHALL assign the Intent_Category `none` with a Confidence_Value of 0.0.
6. THE Intent_Classifier SHALL derive the Intent_Category and the Confidence_Value solely from Normalized_Text.

### Requirement 4: Deterministic Candidate Extraction

**User Story:** As an Operator, I want the Extension to extract detected candidates such as keywords, tool mentions, and signals from the pasted text locally, so that I can see what the text references.

#### Acceptance Criteria

1. WHEN the Text_Normalizer produces Normalized_Text, THE Candidate_Extractor SHALL produce a list of zero or more Detected_Candidate items from Normalized_Text.
2. THE Candidate_Extractor SHALL assign each Detected_Candidate a `type` from the enumerated set defined in the Glossary and a `value` string.
3. WHEN the Candidate_Extractor processes identical Normalized_Text, THE Candidate_Extractor SHALL return an identical and identically ordered list of Detected_Candidate items on every invocation.
4. THE Candidate_Extractor SHALL order the Detected_Candidate list using a stable, deterministic ordering rule defined in the Extension source code.
5. WHEN two Detected_Candidate items share an equal `type` and an equal `value`, THE Candidate_Extractor SHALL retain only one of the matching items so that the Detected_Candidate list contains no duplicate item.
6. THE Candidate_Extractor SHALL compute the Detected_Candidate list using only local, in-memory logic and SHALL perform no network request.

### Requirement 5: Optional Operator-Triggered Compare Lookup

**User Story:** As an Operator, I want to optionally trigger a `/v1/compare` lookup using the existing authenticated client, so that I can retrieve matching CouponsRiver data only when I explicitly choose to.

#### Acceptance Criteria

1. THE Intent_Scanner SHALL provide an explicit Extension UI control that allows the Operator to trigger a Compare_Lookup for the analyzed input.
2. THE Intent_Scanner SHALL initiate a Compare_Lookup only when the Operator activates the Compare_Lookup control.
3. WHEN the Operator activates the Compare_Lookup control, THE Intent_Scanner SHALL send the request to the existing protected `/v1/compare` endpoint using the existing Authenticated_API_Client.
4. THE Intent_Scanner SHALL reuse the existing Authenticated_API_Client credentials and request-signing behavior and SHALL add no new endpoint, no new credential store, and no new manifest permission.
5. WHEN the Compare_Endpoint returns an HTTP 200 Compare_Response, THE Intent_Scanner SHALL retain the resulting Compare_Outcome for display.
6. IF a Compare_Lookup fails due to a network error, a timeout, or a non-200 HTTP response, THEN THE Intent_Scanner SHALL display a categorized failure indicator and SHALL keep the locally computed Intent_Category, Confidence_Value, and Detected_Candidate list available to the Operator.
7. WHILE the Operator has triggered no Compare_Lookup, THE Intent_Scanner SHALL perform no network request.
8. THE Operator-triggered Compare_Lookup to the existing `/v1/compare` endpoint SHALL be the only network request the Intent_Scanner performs.

### Requirement 6: Results Display

**User Story:** As an Operator, I want to view the classification, confidence, detected candidates, compare outcome, and compliance reminders in the Extension UI, so that I can make an informed manual decision.

#### Acceptance Criteria

1. WHEN the Intent_Classifier produces an Intent_Category, THE Intent_Scanner SHALL display the Intent_Category in the Extension UI.
2. WHEN the Intent_Classifier produces a Confidence_Value, THE Intent_Scanner SHALL display the Confidence_Value in the Extension UI.
3. WHEN the Candidate_Extractor produces a non-empty Detected_Candidate list, THE Intent_Scanner SHALL display the `type` and `value` of each Detected_Candidate in the Extension UI.
4. WHERE the Detected_Candidate list is empty, THE Intent_Scanner SHALL display an indicator stating that zero candidates were detected.
5. WHEN a Compare_Outcome is available, THE Intent_Scanner SHALL display the Compare_Outcome, including the match count and each returned match, in the Extension UI.
6. WHEN the Intent_Scanner displays analysis results, THE Intent_Scanner SHALL display the Compliance_Reminders alongside those results.

### Requirement 7: Compliance Reminders

**User Story:** As an Operator, I want to see compliance reminders with each analysis, so that I remain accountable for transparent, manual, value-first participation.

#### Acceptance Criteria

1. THE Intent_Scanner SHALL display a Compliance_Reminder stating that the Extension performs no automated Reddit action.
2. THE Intent_Scanner SHALL display a Compliance_Reminder stating that the Operator is responsible for reviewing subreddit rules before posting.
3. THE Intent_Scanner SHALL display a Compliance_Reminder stating that the Operator is responsible for disclosing any commercial or affiliate connection to CouponsRiver.
4. THE Intent_Scanner SHALL display a Compliance_Reminder stating that the analysis is advisory and that the Operator manually decides whether and how to participate.
5. WHEN the Intent_Scanner displays analysis results, THE Intent_Scanner SHALL display the Compliance_Reminders defined in Acceptance Criteria 7.1 through 7.4.

### Requirement 8: Scope and Security Boundaries

**User Story:** As a compliance-conscious developer, I want strict scope and security boundaries enforced, so that the Intent_Scanner remains a local, manual, Extension-UI-only feature within existing permissions.

#### Acceptance Criteria

1. THE Intent_Scanner SHALL operate within the Extension's existing manifest permissions and SHALL require no additional manifest permission and no additional host permission.
2. THE Intent_Scanner SHALL obtain text for analysis only from Operator-pasted or Operator-typed Input_Text and SHALL perform no automated discovery of Reddit content.
3. THE Intent_Scanner SHALL use no Worker scan endpoint and SHALL use no `/v1/scan` route.
4. THE Intent_Scanner SHALL access no Reddit API, no RSS feed, and no RSS fallback.
5. THE Intent_Scanner SHALL use no `chrome.alarms`, no scheduled task, and no background scanning process.
6. THE Intent_Scanner SHALL use no `chrome.notifications` and SHALL emit no notification.
7. THE Intent_Scanner SHALL use no content script and SHALL request no `reddit.com` or `old.reddit.com` host permission.
8. THE Intent_Scanner SHALL perform no scraping, no crawling, no Firecrawl use, and no IP rotation.
9. THE Intent_Scanner SHALL perform no automated Reddit action, including posting, voting, direct messaging, following, and form submission, on Reddit or any other platform.
10. THE Intent_Scanner SHALL generate no drafts and SHALL call no OpenAI service, no LLM, and no other AI provider.
11. THE Intent_Scanner SHALL restrict its only network request to the Operator-triggered Compare_Lookup against the existing protected `/v1/compare` endpoint via the existing Authenticated_API_Client.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Normalization Determinism and Idempotence

*For any* Input_Text, the Text_Normalizer SHALL produce identical Normalized_Text on repeated invocations, and normalizing already-Normalized_Text SHALL return that Normalized_Text unchanged (`normalize(normalize(x)) == normalize(x)`).

**Validates: Requirements 2.2, 2.3**

### Property 2: Classification Determinism

*For any* Normalized_Text, the Intent_Classifier SHALL return an identical Intent_Category and an identical Confidence_Value on every invocation.

**Validates: Requirements 3.3, 3.4, 3.6**

### Property 3: Single Category Invariant

*For any* Normalized_Text, the Intent_Classifier SHALL assign exactly one Intent_Category drawn only from the enumerated set defined in the Glossary.

**Validates: Requirements 3.1, 3.5**

### Property 4: Confidence Bound Invariant

*For any* classification, the assigned Confidence_Value SHALL be greater than or equal to 0.0 and less than or equal to 1.0.

**Validates: Requirements 3.2, 3.5**

### Property 5: Candidate Extraction Determinism and Ordering

*For any* Normalized_Text, the Candidate_Extractor SHALL return an identical and identically ordered Detected_Candidate list on every invocation, using a stable deterministic ordering rule.

**Validates: Requirements 4.3, 4.4**

### Property 6: Candidate Uniqueness Invariant

*For any* Detected_Candidate list, no two items SHALL share both an equal `type` and an equal `value`, and every item SHALL have a `type` drawn only from the enumerated set defined in the Glossary.

**Validates: Requirements 4.2, 4.5**

### Property 7: No Network Without Operator Compare Trigger

*For any* analysis in which the Operator has not activated the Compare_Lookup control, the Intent_Scanner SHALL perform zero network requests; text normalization, intent classification, and candidate extraction SHALL each complete using only local, in-memory logic.

**Validates: Requirements 2.1, 2.5, 3.4, 4.6, 5.7, 5.8**

### Property 8: Compare Reuses Existing Client and Contract

*For any* Operator-triggered Compare_Lookup, the Intent_Scanner SHALL send the request to the existing protected `/v1/compare` endpoint using the existing Authenticated_API_Client, without adding any new endpoint, credential store, or manifest permission.

**Validates: Requirements 5.2, 5.3, 5.4, 5.8**

### Property 9: Manual-Input-Only Scope

*For any* execution, the Intent_Scanner SHALL obtain analysis text only from Operator-pasted or Operator-typed Input_Text and SHALL perform no automated discovery, no Reddit API access, no RSS access, no scheduled or background scanning, no notification, no content-script execution, no scraping or crawling, no automated Reddit action, no draft generation, and no AI-provider call.

**Validates: Requirements 1.6, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10**

### Property 10: Permission Containment

*For any* execution, the Intent_Scanner SHALL operate within the Extension's existing manifest permissions and SHALL request no additional manifest permission and no additional host permission.

**Validates: Requirements 8.1, 8.11**
