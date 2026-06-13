# Requirements Document

## Introduction

This document specifies **Spec 06: Draft Co-Pilot** for the Reddit Marketing Agent — a compliance-first system composed of a Chrome Extension (Manifest V3, React 18, TypeScript, Vite, Tailwind) and a Cloudflare Worker API (Hono, TypeScript, D1) used for **manual** Reddit research and drafting support. The product is explicitly **not** a Reddit bot and must never automate Reddit posting, voting, messaging, joining, following, or form submission.

Spec 06 adds a **local, deterministic, Extension-UI-only** Draft Co-Pilot that helps the human Operator produce **manual** Reddit reply drafts. The Operator supplies context — pasted Reddit post or comment text, an optional intent result carried over from Spec 05, an optional compare result carried over from Spec 04, and a selected Reply_Mode — and the Draft Co-Pilot generates one or more **deterministic local draft suggestions** from fixed templates and rules. The Draft Co-Pilot performs **no network calls**, uses **no LLM or AI provider**, and produces drafts that the Operator must review, edit, and manually post outside the Extension.

This spec is a **drafting assistant, not a Reddit bot**. The Draft Co-Pilot MUST NEVER post, comment, vote, message, join, follow, submit forms, scrape Reddit, access the Reddit API, or automate any Reddit action. The human Operator remains the sole actor who reviews, edits, copies, and manually posts content.

This spec builds on Spec 01 (MVP Foundation), Spec 02 (Worker Auth & Token Lifecycle), Spec 03 (Compliance Onboarding Gate), Spec 04 (CouponsRiver Compare API Foundation), and Spec 05 (Intent Scanner). It reuses the existing Extension manifest permissions, the existing onboarding gate, and the existing Spec 05 intent and Spec 04 compare data shapes without modification.

### Non-Goals (Explicitly Out of Scope)

The Draft_Co_Pilot **MUST NOT** introduce, imply, or depend on any of the following. No acceptance criterion in this document implies any of these:

- Any OpenAI, LLM, generative AI, or other AI-provider call of any kind.
- Any Worker draft endpoint, `/v1/draft` route, or any new Worker route.
- Any Reddit API access of any kind.
- Any DOM scraping, content script, crawling, Firecrawl, or IP rotation.
- Any `reddit.com` or `old.reddit.com` host permission.
- Any manifest permission expansion (the feature works strictly within existing permissions only).
- Any automated Reddit action: posting, commenting, upvoting, downvoting, direct messaging, joining, following, or form submission.
- Any auto-post, auto-submit, auto-comment, or one-click-publish control of any kind.
- Any background automation, `chrome.alarms`, scheduled task, or Operator-independent background draft generation (a local, in-package Web Worker or MV3 service worker used solely for local deterministic template processing is permitted under Requirement 12.4).
- Any `chrome.notifications` or notification of any kind.
- Any new network request (the Draft Co-Pilot itself performs zero network requests).
- Any hidden, obscured, or omitted affiliation disclosure for promotional drafts.
- Any spammy urgency, manipulation, guaranteed-savings, impersonation, or fake-user-experience language.

### In Scope

- A Draft_Mode selector offering exactly three Reply_Modes: No_Link_Authority, Soft_CTA_With_Disclosure, and Disclosed_Link.
- Manual Draft_Input fields within the Extension UI: pasted Reddit post or comment text, an optional Intent_Context (from Spec 05), an optional Compare_Context (from Spec 04), and an optional Operator-supplied CouponsRiver URL.
- Deterministic, local, template- and rule-based draft generation that produces a Draft_Result, computed entirely in the Extension with no network call and no AI provider.
- Promotional safety checks that require a disclosure for any promotional draft, warn when a Disclosed_Link draft has no Operator-supplied URL, and avoid prohibited claims and language.
- Display in the Extension UI of: the generated Draft_Result, the Compliance_Warnings (including the manual-review warning and the subreddit-rules reminder), and any mode-specific warnings.
- Optional, manual-only copy/select of the generated draft text, allowed **only** if it requires no new manifest permission.

## Glossary

- **Extension**: The Chrome Manifest V3 browser extension built with React 18, TypeScript, Vite, and Tailwind CSS. The Draft_Co_Pilot is a feature surface within the Extension UI.
- **Operator**: The human CouponsRiver user who manually supplies context, selects a Reply_Mode, reviews and edits drafts, and manually decides whether and how to post on Reddit.
- **Draft_Co_Pilot**: The Extension-UI-only feature specified by this document that generates deterministic local draft suggestions from Operator-supplied context and a selected Reply_Mode.
- **Draft_Input**: The collection of Operator-supplied context used to generate a draft: the Source_Text, an optional Intent_Context, an optional Compare_Context, the selected Draft_Mode, and an optional Operator-supplied CouponsRiver URL.
- **Source_Text**: The Reddit post or comment text the Operator pastes or types into the Draft_Co_Pilot input control within the Extension UI. The Source_Text is the only mandatory context for drafting.
- **Draft_Mode**: The Reply_Mode selected by the Operator. Exactly one of the three enumerated Reply_Modes defined in the Extension source code: `no-link-authority`, `soft-cta-with-disclosure`, and `disclosed-link`.
- **Reply_Mode**: A drafting style governing the structure, tone, and promotional content of a generated draft. See No_Link_Authority, Soft_CTA_With_Disclosure, and Disclosed_Link.
- **No_Link_Authority**: A non-promotional Reply_Mode that produces a helpful answer containing no CouponsRiver link and no affiliate promotion; it may include general advice.
- **Soft_CTA_With_Disclosure**: A promotional Reply_Mode that includes an affiliation Disclosure and suggests checking CouponsRiver generally, without a direct coupon link unless the Operator later adds one manually.
- **Disclosed_Link**: A promotional Reply_Mode that includes an affiliation Disclosure and may include a CouponsRiver URL **only** when the Operator manually supplies one; when no URL is supplied, the Draft_Co_Pilot warns the Operator.
- **Disclosure**: A plain-language statement of the Operator's affiliation with or commercial connection to CouponsRiver, inserted into every promotional draft.
- **Intent_Context**: An optional, Operator-carried Spec 05 intent analysis result (an Intent_Category, a Confidence_Value, and Detected_Candidate items) supplied as additional drafting context. The Draft_Co_Pilot consumes this shape without modifying Spec 05.
- **Compare_Context**: An optional, Operator-carried Spec 04 compare result (a normalized candidate echo, a match count, and matches) supplied as additional drafting context. The Draft_Co_Pilot consumes this shape without modifying Spec 04.
- **Draft_Generator**: The local, deterministic, in-memory component that transforms a Draft_Input into a Draft_Result using fixed templates and rules, with no network call and no AI provider.
- **Draft_Result**: The output of the Draft_Generator: the generated draft text for the selected Draft_Mode together with the associated Compliance_Warnings.
- **Compliance_Warning**: A single plain-language warning or reminder attached to a Draft_Result, such as the manual-review warning, the subreddit-rules reminder, the disclosure-required notice, and the missing-link warning.
- **Promotional_Draft**: A Draft_Result generated under a promotional Reply_Mode (Soft_CTA_With_Disclosure or Disclosed_Link) that references or suggests CouponsRiver.
- **Prohibited_Language**: Language the Draft_Generator must never produce, including spammy urgency, manipulation, guaranteed-savings claims unsupported by source data, impersonation, and fabricated personal experience.
- **Concealing_Language**: Language in a Promotional_Draft that conceals, obscures, or contradicts the affiliation Disclosure, such as "not affiliated", "I just found this", "randomly came across", "no connection to them", or "not sponsored" when the draft promotes CouponsRiver.
- **Unsafe_Draft_Result**: A Draft_Result the Draft_Co_Pilot flags as unsafe because it omits a required Disclosure or contains Concealing_Language; the Draft_Co_Pilot surfaces a Compliance_Warning rather than presenting the draft as ready.
- **Failure_State**: A typed result returned by the Draft_Generator when draft generation fails due to an internal error or resource constraint; it contains no draft text and no internal implementation detail.
- **OnboardingGate**: The existing Spec 03 app-root gate that renders feature UI only when Compliance_Onboarding is complete. The Draft_Co_Pilot renders inside this gate.
- **chrome.storage.local**: A Chrome extension storage area persisted locally on the Operator's device.

## Requirements

### Requirement 1: Manual Draft Context Input

**User Story:** As an Operator, I want to provide Reddit context and optional analysis results manually in the Extension UI, so that the Draft_Co_Pilot can generate a reply draft from context I control.

#### Acceptance Criteria

1. THE Draft_Co_Pilot SHALL provide a multi-line text input control within the Extension UI for the Operator to paste or type the Source_Text.
2. THE Draft_Co_Pilot SHALL accept an optional Intent_Context supplied by the Operator in the Spec 05 intent result shape.
3. THE Draft_Co_Pilot SHALL accept an optional Compare_Context supplied by the Operator in the Spec 04 compare result shape.
4. THE Draft_Co_Pilot SHALL provide an optional input control for the Operator to manually supply a CouponsRiver URL.
5. THE Draft_Co_Pilot SHALL derive all drafting context only from the Extension UI input controls populated by the Operator and SHALL use no other source for Draft_Input.
6. WHEN the Operator requests draft generation with a Source_Text containing zero non-whitespace characters, THE Draft_Co_Pilot SHALL display a validation message requesting non-empty context and SHALL withhold draft generation.
7. THE Draft_Co_Pilot SHALL accept Source_Text up to 10000 characters in length.
8. IF the Operator requests draft generation with a Source_Text exceeding 10000 characters, THEN THE Draft_Co_Pilot SHALL display a validation message stating the 10000-character maximum and SHALL withhold draft generation until the Operator shortens the Source_Text.

### Requirement 2: Reply Mode Selection

**User Story:** As an Operator, I want to choose a reply mode, so that the generated draft matches my intended level of promotion and disclosure.

#### Acceptance Criteria

1. THE Draft_Co_Pilot SHALL provide a Draft_Mode selector offering exactly the three Reply_Modes defined in the Glossary: No_Link_Authority, Soft_CTA_With_Disclosure, and Disclosed_Link.
2. THE Draft_Co_Pilot SHALL require the Operator to select exactly one Draft_Mode before draft generation.
3. WHEN the Operator selects a Draft_Mode and requests draft generation, THE Draft_Generator SHALL generate the Draft_Result using only the templates and rules defined for that selected Draft_Mode.
4. THE Draft_Co_Pilot SHALL display the currently selected Draft_Mode in the Extension UI.

### Requirement 3: Deterministic Local Draft Generation

**User Story:** As an Operator, I want drafts generated locally and deterministically from templates, so that drafting requires no external service, no AI, and produces predictable output.

#### Acceptance Criteria

1. WHEN the Operator requests draft generation with valid Draft_Input, THE Draft_Generator SHALL produce a Draft_Result using only local, in-memory templates and rules.
2. WHEN the Draft_Generator successfully processes an identical valid Draft_Input, THE Draft_Generator SHALL produce an identical Draft_Result on every invocation.
3. THE Draft_Generator SHALL compute the Draft_Result without performing any network request.
4. THE Draft_Generator SHALL compute the Draft_Result without calling any OpenAI service, any LLM, or any other AI provider.
5. THE Draft_Generator SHALL compute the Draft_Result without using randomness or timestamps so that successful draft generation remains deterministic.
6. IF draft generation fails due to an internal error or a resource constraint, THEN THE Draft_Generator SHALL return a typed failure state instead of a Draft_Result.
7. IF draft generation fails, THEN THE Draft_Co_Pilot SHALL exclude any stack trace, file path, secret, environment value, and internal implementation detail from the displayed failure state.
8. IF draft generation fails, THEN THE Draft_Co_Pilot SHALL display no stale and no partial draft text from any prior or in-progress generation.
9. WHERE the Draft_Input contains an optional Intent_Context, THE Draft_Generator SHALL incorporate the Intent_Context into the Draft_Result using deterministic rules.
10. WHERE the Draft_Input contains an optional Compare_Context, THE Draft_Generator SHALL incorporate the Compare_Context into the Draft_Result using deterministic rules.
11. IF the Draft_Input contains no Intent_Context and no Compare_Context, THEN THE Draft_Generator SHALL produce a safe fallback Draft_Result derived from the Source_Text and the selected Draft_Mode alone.

### Requirement 4: No-Link Authority Mode

**User Story:** As an Operator, I want a helpful non-promotional draft, so that I can contribute value to a thread without any affiliate promotion.

#### Acceptance Criteria

1. WHEN the Operator selects No_Link_Authority and requests draft generation, THE Draft_Generator SHALL produce a Draft_Result containing a helpful answer derived from the Source_Text.
2. THE Draft_Generator SHALL exclude any CouponsRiver URL and any other URL or external link from a No_Link_Authority Draft_Result.
3. THE Draft_Generator SHALL exclude any CouponsRiver promotion or call to action from a No_Link_Authority Draft_Result.
4. WHERE general advice is appropriate to the Source_Text AND can be expressed without any URL, external link, or promotional call to action, THE Draft_Generator SHALL include that general advice in a No_Link_Authority Draft_Result.
5. IF appropriate general advice would require a URL, an external link, or a resource reference, THEN THE Draft_Generator SHALL omit that advice or rewrite it as non-linked general guidance so that the No_Link_Authority constraints take priority.

### Requirement 5: Soft CTA With Disclosure Mode

**User Story:** As an Operator, I want a lightly promotional draft that discloses my affiliation, so that I can suggest CouponsRiver generally while remaining transparent.

#### Acceptance Criteria

1. WHEN the Operator selects Soft_CTA_With_Disclosure and requests draft generation, THE Draft_Generator SHALL include an affiliation Disclosure in the Draft_Result.
2. WHEN the Operator selects Soft_CTA_With_Disclosure and requests draft generation, THE Draft_Generator SHALL include a general suggestion to check CouponsRiver in the Draft_Result.
3. THE Draft_Generator SHALL exclude any direct coupon link from a Soft_CTA_With_Disclosure Draft_Result.
4. WHEN the Draft_Generator produces a Soft_CTA_With_Disclosure Draft_Result, THE Draft_Co_Pilot SHALL display a Compliance_Warning stating that the Operator may add a specific CouponsRiver link manually after review.

### Requirement 6: Disclosed Link Mode

**User Story:** As an Operator, I want a draft that includes a disclosed CouponsRiver link when I supply one, so that I can share a specific offer transparently.

#### Acceptance Criteria

1. WHEN the Operator selects Disclosed_Link and requests draft generation, THE Draft_Generator SHALL include an affiliation Disclosure in the Draft_Result.
2. WHERE the Operator has supplied a CouponsRiver URL, THE Draft_Generator SHALL include that Operator-supplied CouponsRiver URL in a Disclosed_Link Draft_Result.
3. IF the Operator selects Disclosed_Link and has supplied no CouponsRiver URL, THEN THE Draft_Co_Pilot SHALL display a Compliance_Warning stating that no link was provided and SHALL produce a Draft_Result that contains no CouponsRiver URL.
4. THE Draft_Generator SHALL include in a Disclosed_Link Draft_Result only the CouponsRiver URL supplied by the Operator and SHALL generate no CouponsRiver URL on its own.

### Requirement 7: Promotional Disclosure Enforcement

**User Story:** As a compliance-conscious team, I want every promotional draft to disclose affiliation, so that the Operator never hides a commercial connection.

#### Acceptance Criteria

1. WHEN the Draft_Generator produces a Promotional_Draft, THE Draft_Generator SHALL include an affiliation Disclosure in that Promotional_Draft.
2. THE Draft_Generator SHALL produce no Promotional_Draft that omits an affiliation Disclosure.
3. WHEN the Draft_Generator produces a Promotional_Draft, THE Draft_Co_Pilot SHALL display a Compliance_Warning stating that disclosure of the CouponsRiver affiliation is required.
4. THE Draft_Generator SHALL exclude from every Promotional_Draft any Concealing_Language that conceals, obscures, or contradicts the affiliation Disclosure.
5. IF a Promotional_Draft would contain Concealing_Language, THEN THE Draft_Co_Pilot SHALL mark that Draft_Result as unsafe and SHALL display a Compliance_Warning, even when the Promotional_Draft also includes an affiliation Disclosure.
6. IF a Promotional_Draft omits an affiliation Disclosure, THEN THE Draft_Co_Pilot SHALL mark that Draft_Result as unsafe and SHALL display a Compliance_Warning.

### Requirement 8: Prohibited Language Avoidance

**User Story:** As a compliance-conscious team, I want drafts free of manipulative or false claims, so that the Operator never posts spammy, deceptive, or impersonating content.

#### Acceptance Criteria

1. THE Draft_Generator SHALL exclude spammy urgency language and manipulation language from every Draft_Result.
2. THE Draft_Generator SHALL exclude any guaranteed-savings claim from a Draft_Result unless the Compare_Context explicitly supports that savings claim.
3. THE Draft_Generator SHALL exclude impersonation language and fabricated personal-experience language from every Draft_Result.
4. WHEN the Source_Text contains Prohibited_Language, THE Draft_Generator SHALL omit that Prohibited_Language from the Draft_Result.
5. THE Draft_Generator SHALL derive every factual savings statement in a Draft_Result solely from the Compare_Context supplied by the Operator.

### Requirement 9: Compliance Warnings Display

**User Story:** As an Operator, I want compliance warnings shown with every draft, so that I remain accountable for manual review, subreddit rules, and disclosure.

#### Acceptance Criteria

1. WHEN the Draft_Co_Pilot displays a Draft_Result, THE Draft_Co_Pilot SHALL display a Compliance_Warning stating that the Operator must manually review and edit the draft before posting.
2. WHEN the Draft_Co_Pilot displays a Draft_Result, THE Draft_Co_Pilot SHALL display a Compliance_Warning reminding the Operator to review the subreddit rules before posting.
3. WHEN the Draft_Co_Pilot displays a Draft_Result, THE Draft_Co_Pilot SHALL display a Compliance_Warning stating that the Extension performs no automated Reddit action and that the Operator posts manually outside the Extension.
4. WHEN the Draft_Co_Pilot produces a Promotional_Draft, THE Draft_Co_Pilot SHALL display the disclosure-required Compliance_Warning defined in Requirement 7.3.
5. WHEN the Draft_Co_Pilot produces a Disclosed_Link Draft_Result with no Operator-supplied URL, THE Draft_Co_Pilot SHALL display the missing-link Compliance_Warning defined in Requirement 6.3.

### Requirement 10: Draft Result Display and Manual Handling

**User Story:** As an Operator, I want to view and manually copy or select the generated draft, so that I can edit and post it myself outside the Extension.

#### Acceptance Criteria

1. WHEN the Draft_Generator produces a Draft_Result, THE Draft_Co_Pilot SHALL display the generated draft text in the Extension UI.
2. THE Draft_Co_Pilot SHALL present the generated draft text in a control that allows the Operator to manually select and copy the text.
3. THE Draft_Co_Pilot SHALL provide no control that posts, comments, submits, or otherwise publishes the draft to Reddit or any platform.
4. WHERE a copy-to-clipboard action requires no additional manifest permission, THE Draft_Co_Pilot SHALL make a manual copy-to-clipboard control available for the Operator to activate explicitly whenever a Draft_Result is displayed.
5. IF a copy-to-clipboard action would require a new manifest permission, THEN THE Draft_Co_Pilot SHALL NOT provide a copy-to-clipboard control and SHALL rely on manual text selection only.

### Requirement 11: Popup Integration

**User Story:** As an Operator, I want the Draft_Co_Pilot available inside the existing popup behind the compliance gate, so that drafting stays consistent with the existing compliance workflow.

#### Acceptance Criteria

1. THE Draft_Co_Pilot SHALL render within the Extension popup inside the existing Spec 03 OnboardingGate.
2. WHILE Compliance_Onboarding is incomplete or in a read_error state, THE Draft_Co_Pilot SHALL NOT mount, SHALL render no draft input, no draft control, and no draft preview, and SHALL run no draft generation logic.
3. WHEN Compliance_Onboarding is complete, THE Draft_Co_Pilot SHALL render its draft input, controls, and preview within the popup.
4. THE Draft_Co_Pilot SHALL render as a section distinct from the existing Intent_Scanner section within the popup.
5. THE Draft_Co_Pilot SHALL preserve the existing rendering and behavior of the Intent_Scanner and the connection status within the popup.

### Requirement 12: Scope and Security Boundaries

**User Story:** As a compliance-conscious developer, I want strict scope and security boundaries enforced, so that the Draft_Co_Pilot remains a local, manual, Extension-UI-only drafting assistant within existing permissions.

#### Acceptance Criteria

1. THE Draft_Co_Pilot SHALL operate within the Extension's existing manifest permissions and SHALL require no additional manifest permission and no additional host permission.
2. THE Draft_Co_Pilot SHALL obtain drafting context only from Operator-supplied input and SHALL perform no automated discovery of Reddit content.
3. THE Draft_Co_Pilot SHALL use no Cloudflare Worker draft endpoint, SHALL add no `/v1/draft` route or any other Worker route, and SHALL perform no network-based or external-service draft generation.
4. WHERE a local browser execution mechanism such as a Web Worker or the existing MV3 extension service worker is used, THE Draft_Co_Pilot SHALL use it only for local deterministic template processing within the extension package, and that mechanism SHALL make no network call, SHALL access no Reddit, SHALL perform no automated Reddit action, SHALL require no new host permission, SHALL add no content script, and SHALL preserve deterministic output for successful generation.
5. THE Draft_Co_Pilot SHALL access no Reddit API, no DOM scraping, no content script, no crawling, no Firecrawl, and no IP rotation.
6. THE Draft_Co_Pilot SHALL request no `reddit.com` or `old.reddit.com` host permission.
7. THE Draft_Co_Pilot SHALL use no `chrome.alarms`, no scheduled task, no background draft generation triggered without the Operator, and no `chrome.notifications`.
8. THE Draft_Co_Pilot SHALL perform no automated Reddit action, including posting, commenting, upvoting, downvoting, direct messaging, joining, following, and form submission, on Reddit or any other platform.
9. THE Draft_Co_Pilot SHALL provide no auto-post, auto-submit, auto-comment, or one-click-publish control.
10. THE Draft_Co_Pilot SHALL call no OpenAI service, no LLM, and no other AI provider.
11. THE Draft_Co_Pilot SHALL perform no network request as part of draft generation.

### Requirement 13: Preserved Behavior of Specs 01–05

**User Story:** As a developer maintaining Specs 01 through 05, I want Spec 06 to integrate without regressing existing behavior, so that foundation, auth, onboarding, compare, and intent-scanner behavior remain intact.

#### Acceptance Criteria

1. THE Extension SHALL keep the Spec 01 connection status behavior and the `GET /v1/status` consumption unchanged.
2. THE Extension SHALL keep the Spec 02 authentication and credential behavior unchanged.
3. THE Extension SHALL keep the Spec 03 Compliance_Onboarding behavior, the Acknowledgement_Record, and the gating of features unchanged.
4. THE Worker_API SHALL keep the Spec 04 `POST /v1/compare` endpoint, the mock adapter, and the compare contract unchanged.
5. THE Extension SHALL keep the Spec 05 Intent_Scanner behavior, its local analysis, and its optional Operator-triggered compare lookup unchanged.
6. THE Extension SHALL keep the existing manifest `permissions` and `host_permissions` byte-for-byte unchanged.
7. THE Extension test suite SHALL be executed via `cd extension && npm run typecheck && npm run test && npm run build` and SHALL pass.
8. THE Worker_API test suite SHALL be executed via `cd ../worker-api && npm run typecheck && npm run test && npm run build` and SHALL pass.
9. THE Extension build SHALL be executed and SHALL succeed.
10. THE Worker_API build SHALL be executed and SHALL succeed.
11. WHEN the Spec 06 validation commands complete, THE validation report SHALL state the final Extension and Worker_API test counts and the build results.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Successful Draft Generation Determinism

*For any* valid Draft_Input, when draft generation succeeds, the Draft_Generator SHALL produce an identical Draft_Result on every invocation, computed using only local, in-memory templates and rules with no randomness and no timestamps.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

### Property 2: No Network and No AI in Draft Generation

*For any* draft generation, the Draft_Generator SHALL perform zero network requests and SHALL invoke no OpenAI service, no LLM, and no other AI provider.

**Validates: Requirements 3.3, 3.4, 12.10, 12.11**

### Property 3: No-Link Authority Excludes Promotion

*For any* No_Link_Authority Draft_Result, the draft text SHALL contain no CouponsRiver URL and no CouponsRiver promotion or call to action.

**Validates: Requirements 4.2, 4.3**

### Property 4: Promotional Drafts Always Disclose

*For any* Promotional_Draft produced under Soft_CTA_With_Disclosure or Disclosed_Link, the draft text SHALL include an affiliation Disclosure, and no Promotional_Draft SHALL omit that Disclosure.

**Validates: Requirements 5.1, 6.1, 7.1, 7.2, 7.3**

### Property 4a: Concealing Language Makes a Promotional Draft Unsafe

*For any* Promotional_Draft, the Draft_Co_Pilot SHALL treat the Draft_Result as safe if and only if it includes an affiliation Disclosure AND contains no Concealing_Language; a Promotional_Draft that contains Concealing_Language SHALL be marked unsafe and warned even when a Disclosure is present, and a Promotional_Draft that omits a Disclosure SHALL be marked unsafe and warned.

**Validates: Requirements 7.4, 7.5, 7.6**

### Property 5: Disclosed Link URL Provenance

*For any* Disclosed_Link Draft_Result, the draft SHALL include a CouponsRiver URL if and only if the Operator supplied one; when the Operator supplies no URL, the draft SHALL contain no CouponsRiver URL and the Draft_Co_Pilot SHALL display the missing-link Compliance_Warning, and the Draft_Generator SHALL never generate a CouponsRiver URL on its own.

**Validates: Requirements 6.2, 6.3, 6.4, 9.5**

### Property 6: Soft CTA Excludes Direct Links

*For any* Soft_CTA_With_Disclosure Draft_Result, the draft text SHALL include a general CouponsRiver suggestion and an affiliation Disclosure and SHALL contain no direct coupon link.

**Validates: Requirements 5.2, 5.3**

### Property 7: Prohibited Language Is Never Produced

*For any* Draft_Result, the draft text SHALL contain no spammy urgency language, no manipulation language, no impersonation language, and no fabricated personal-experience language, and SHALL contain no guaranteed-savings claim unless the Compare_Context explicitly supports that claim.

**Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**

### Property 8: Compliance Warnings Always Present

*For any* displayed Draft_Result, the Draft_Co_Pilot SHALL display the manual-review warning, the subreddit-rules reminder, and the no-automated-action warning; additionally, every Promotional_Draft SHALL display the disclosure-required warning, and every Disclosed_Link Draft_Result lacking an Operator-supplied URL SHALL display the missing-link warning.

**Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**

### Property 9: Safe Fallback Without Optional Context

*For any* Draft_Input that contains no Intent_Context and no Compare_Context, the Draft_Generator SHALL produce a valid Draft_Result derived from the Source_Text and the selected Draft_Mode alone, with no error and no missing required content for that mode.

**Validates: Requirements 3.9, 3.10, 3.11**

### Property 9a: Safe Failure State

*For any* draft generation that fails due to an internal error or a resource constraint, the Draft_Generator SHALL return a typed Failure_State containing no draft text, and the Draft_Co_Pilot SHALL display no stack trace, file path, secret, environment value, internal implementation detail, and no stale or partial draft text.

**Validates: Requirements 3.6, 3.7, 3.8**

### Property 10: No Posting Controls

*For any* execution, the Draft_Co_Pilot SHALL provide no control that posts, comments, submits, upvotes, downvotes, or otherwise publishes content to Reddit or any platform, and SHALL provide no auto-post, auto-submit, auto-comment, or one-click-publish control.

**Validates: Requirements 10.3, 12.8, 12.9**

### Property 11: Manual-Input-Only Scope

*For any* execution, the Draft_Co_Pilot SHALL obtain drafting context only from Operator-supplied input and SHALL perform no automated discovery, no Reddit API access, no DOM scraping, no content-script execution, no crawling, no Operator-independent background generation, no notification, and no AI-provider call.

**Validates: Requirements 1.5, 12.2, 12.4, 12.5, 12.7, 12.10**

### Property 12: Permission Containment

*For any* execution, the Draft_Co_Pilot SHALL operate within the Extension's existing manifest permissions and SHALL request no additional manifest permission and no additional host permission, leaving `permissions` and `host_permissions` byte-for-byte unchanged.

**Validates: Requirements 10.5, 12.1, 12.6, 13.6**

### Property 13: Preserved Specs 01–05 Behavior

*For any* sequence of Draft_Co_Pilot operations, the Spec 01 status behavior, the Spec 02 authentication, the Spec 03 onboarding gate, the Spec 04 compare endpoint and contract, and the Spec 05 Intent_Scanner behavior SHALL remain unchanged, and the existing Spec 01 through Spec 05 test suites SHALL be executed and SHALL continue to pass.

**Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.7, 13.8**
