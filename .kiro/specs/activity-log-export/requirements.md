# Requirements Document

## Introduction

This document specifies **Spec 08-A: Compliance Activity Log & Export** for the Reddit Marketing Agent — a compliance-first system composed of a Chrome Extension (Manifest V3, React 18, TypeScript, Vite, Tailwind) and a Cloudflare Worker API (Hono, TypeScript, D1) used for **manual** Reddit research and drafting support. The product is explicitly **not** a Reddit bot and must never automate Reddit posting, voting, messaging, joining, following, or form submission.

Spec 08-A adds a **local, bounded, append-only Compliance Activity Log** plus a **JSON/Markdown export** capability, both **Extension-UI-only**. As the Operator performs compliance-relevant actions inside the Extension — completing onboarding, saving a draft to the Review_Queue, setting a Review_Status, copying a draft for manual posting — the Extension appends a structured, human-readable **Activity_Entry** to a log persisted in `chrome.storage.local`. The Operator can then **export** the entire log as a JSON document or a Markdown document so they retain an auditable, self-contained record of their own compliance-relevant activity.

The Activity_Log is a **passive, local audit aid only**. It MUST NEVER post, comment, vote, message, join, follow, submit forms, scrape Reddit, access the Reddit API, or automate any Reddit action. It records what the Operator already did inside the Extension; it does not initiate, schedule, or transmit anything. Logging is **best-effort and non-blocking**: a failure to append a log entry MUST NEVER block, delay, reverse, or alter the original Review_Queue or Draft_Co_Pilot action that triggered it.

Export happens **entirely on the local device** through two browser-native mechanisms only: copying the serialized document to the clipboard via `navigator.clipboard.writeText`, and/or offering an in-page download via a `Blob` object URL bound to an anchor (`<a download>`) element. The Extension MUST NOT use `chrome.downloads`, and MUST NOT transmit the log or any export to the Worker_API, Reddit, or any external service.

This spec builds on Spec 01 (MVP Foundation), Spec 02 (Worker Auth & Token Lifecycle), Spec 03 (Compliance Onboarding Gate), Spec 04 (CouponsRiver Compare API Foundation), Spec 05 (Intent Scanner), Spec 06 (Draft Co-Pilot), and Spec 07 (Review Queue). It reuses the existing Extension manifest permissions, the existing `OnboardingGate`, the existing `chrome.storage.local` read/write conventions, and the Spec 07 `QueueItem` / `ReviewStatus` shapes without modifying any prior spec.

### A Note on Identifiers and Timestamps

Like the Spec 07 Review_Queue, an Activity_Entry records an **Operator action** at a moment in time rather than a deterministic pure computation. Generating a stable `id` and a `created_at` timestamp at the moment an entry is appended is therefore appropriate here and does not introduce forbidden non-determinism. Determinism in this spec applies to the **pure log transformation and serialization functions** (append, bound-trim, JSON serialize, Markdown render) operating over already-constructed Activity_Entries; id and timestamp creation are **injected** (an `id factory` / `clock` passed in) so the pure transforms contain no hidden inputs and remain reproducible under property testing.

### Non-Goals (Explicitly Out of Scope)

The Activity_Log & Export **MUST NOT** introduce, imply, or depend on any of the following. No acceptance criterion in this document implies any of these:

- Any Reddit API access of any kind.
- Any `reddit.com` or `old.reddit.com` host permission, and no manifest permission expansion of any kind (the existing `permissions` and `host_permissions` arrays remain byte-for-byte unchanged).
- Any new manifest permission of any kind, including but not limited to `downloads`, `alarms`, `notifications`, `clipboardWrite`, or `tabs`.
- Any use of `chrome.downloads` for export (export is `navigator.clipboard.writeText` and/or an in-page `Blob` anchor download only).
- Any content script, DOM scraping, crawling, Firecrawl, or IP rotation.
- Any network request for any log or export operation (append, read, trim, serialize, export are purely local).
- Any automated Reddit action: posting, commenting, upvoting, downvoting, direct messaging, joining, following, or form submission.
- Any auto-post, auto-submit, auto-comment, scheduled-post, or one-click-publish control of any kind.
- Any `chrome.alarms`, scheduled task, background automation, or `chrome.notifications`.
- Any OpenAI, LLM, generative-AI, or other AI-provider call.
- Any Cloudflare Worker change, new `/v1` route, or worker-side log/export storage — for the Spec 08-A MVP there are **no** worker-api changes.
- Any transmission of the Activity_Log, an Activity_Entry, or an export document to the Worker_API or any external service.
- Any logging that blocks, delays, reverses, or alters the original action that triggered it.

### In Scope

- A local, append-only Activity_Log persisted in `chrome.storage.local` under a new `STORAGE_KEYS` entry (existing keys unchanged).
- Appending a structured Activity_Entry for a bounded, enumerated set of compliance-relevant Operator actions, capturing an action type, an ISO 8601 timestamp, and a small, redaction-safe summary.
- A fixed maximum log size (entry count and per-entry summary length), enforced by dropping the oldest entries first (FIFO trim) so the log stays bounded.
- Best-effort, non-blocking append semantics: a log write failure never blocks or alters the original Review_Queue or Draft_Co_Pilot action.
- Export of the entire log as a JSON document and as a Markdown document, via `navigator.clipboard.writeText` and/or an in-page `Blob` anchor (`<a download>`) download — never `chrome.downloads`.
- Listing the log (newest first) and a clear-log control, plus an empty-state indicator.
- Rendering the Activity_Log & Export UI inside the existing Spec 03 `OnboardingGate`, so it does not mount or run any log logic before Compliance_Onboarding is complete or while in a `read_error` state.

## Glossary

- **Extension**: The Chrome Manifest V3 browser extension built with React 18, TypeScript, Vite, and Tailwind CSS. The Activity_Log & Export is a feature surface within the Extension UI.
- **Worker_API**: The Cloudflare Worker backend (Hono, TypeScript, D1). Spec 08-A makes **no** changes to the Worker_API.
- **Operator**: The human CouponsRiver user who performs compliance-relevant actions in the Extension and who exports the Activity_Log.
- **Activity_Log**: The Extension-UI-only, local, bounded, append-only collection of Activity_Entries specified by this document, persisted on the Operator's device.
- **Activity_Entry**: A single structured record in the Activity_Log capturing one compliance-relevant Operator action, identified by a stable Entry_Id and carrying an Action_Type, a `created_at` timestamp, and a redaction-safe Summary.
- **Entry_Id**: A stable, locally generated string identifier that uniquely identifies an Activity_Entry within the Activity_Log.
- **Action_Type**: The enumerated kind of compliance-relevant action an Activity_Entry records. Exactly one of the values defined in the Extension source code: `onboarding_completed`, `draft_saved`, `status_changed`, and `draft_copied`.
- **Summary**: A short, redaction-safe, human-readable string describing the logged action. It captures only non-sensitive descriptors (such as an Action_Type label, a Review_Status value, or a `QueueItem` id) and never the full draft text, Notes, or credentials.
- **Source_Action**: The originating Operator action that triggers an append: completing Compliance_Onboarding (Spec 03), saving a draft to the Review_Queue (Spec 07), setting a Review_Status (Spec 07), or copying a draft for manual posting.
- **Append**: The act of adding a new Activity_Entry to the end of the Activity_Log, subject to the log size bound.
- **Bound_Trim**: The FIFO operation that removes the oldest Activity_Entries when the log would exceed its maximum entry count, keeping the most recent entries.
- **Export_Document**: The serialized representation of the entire Activity_Log produced for export, in either JSON or Markdown format.
- **Export_Format**: The format of an Export_Document. Exactly one of `json` or `markdown`.
- **Clipboard_Export**: Export performed by writing the Export_Document text to the clipboard via `navigator.clipboard.writeText`.
- **Download_Export**: Export performed by creating a `Blob` from the Export_Document, generating an object URL, and triggering a download through an in-page anchor (`<a download>`) element, with the object URL revoked afterward. Never uses `chrome.downloads`.
- **Log_Storage**: The local persistence layer that reads and writes the Activity_Log to `chrome.storage.local` under the Activity_Log storage key.
- **Log_Read_Outcome**: The typed result of reading the Activity_Log from storage: either the parsed list of Activity_Entries, or a safe failure state when the read or parse fails.
- **OnboardingGate**: The existing Spec 03 app-root gate that renders feature UI only when Compliance_Onboarding is complete and fails closed on a `read_error`. The Activity_Log & Export renders inside this gate.
- **Compliance_Onboarding**: The Spec 03 gating process the Operator must complete before gated feature UI renders.
- **Review_Queue**: The Spec 07 local, Extension-UI-only triage feature whose save, status-change, and copy actions are Source_Actions for the Activity_Log.
- **Draft_Co_Pilot**: The Spec 06 Extension feature whose draft output may be saved or copied; its save/copy actions are Source_Actions for the Activity_Log.
- **chrome.storage.local**: A Chrome extension storage area persisted locally on the Operator's device.
- **STORAGE_KEYS**: The Extension's single source of `chrome.storage.local` key constants in `extension/src/types/index.ts`. Spec 08-A adds one new entry without modifying existing entries.

## Requirements

### Requirement 1: Append a Compliance Activity Entry

**User Story:** As an Operator, I want my compliance-relevant actions recorded as structured log entries, so that I retain an auditable record of what I did inside the Extension.

#### Acceptance Criteria

1. THE Activity_Log SHALL append an Activity_Entry when the Operator completes Compliance_Onboarding, with Action_Type `onboarding_completed`.
2. THE Activity_Log SHALL append an Activity_Entry when the Operator saves a draft to the Review_Queue, with Action_Type `draft_saved`.
3. THE Activity_Log SHALL append an Activity_Entry when the Operator sets a Review_Status on a Queue_Item, with Action_Type `status_changed`.
4. THE Activity_Log SHALL append an Activity_Entry when the Operator copies a draft for manual posting, with Action_Type `draft_copied`.
5. WHEN the Activity_Log appends an Activity_Entry, THE Activity_Log SHALL set the Activity_Entry Action_Type to exactly one of the enumerated values defined in the Extension source code.
6. WHEN the Activity_Log appends an Activity_Entry, THE Activity_Log SHALL set the Activity_Entry Summary to a redaction-safe, human-readable string that excludes full draft text, Note text, credentials, and tokens.
7. THE Activity_Log SHALL append Activity_Entries only in response to an actual Operator Source_Action and SHALL create no Activity_Entry on its own initiative or on a schedule.

### Requirement 2: Stable Entry Identity and Timestamp

**User Story:** As an Operator, I want each log entry to have a stable identifier and a timestamp, so that entries are uniquely referenceable and ordered in time.

#### Acceptance Criteria

1. WHEN the Activity_Log appends an Activity_Entry, THE Activity_Log SHALL assign the Activity_Entry a stable Entry_Id that is unique among all Activity_Entries currently in the Activity_Log.
2. WHEN the Activity_Log appends an Activity_Entry, THE Activity_Log SHALL set the Activity_Entry `created_at` field to an ISO 8601 timestamp recorded at append time.
3. THE Activity_Log SHALL preserve an Activity_Entry's Entry_Id, Action_Type, Summary, and `created_at` field unchanged for the lifetime of that Activity_Entry, treating the Activity_Log as append-only.
4. THE Activity_Log SHALL provide no operation that edits the Action_Type, Summary, or `created_at` of an existing Activity_Entry.

### Requirement 3: Best-Effort, Non-Blocking Logging

**User Story:** As an Operator, I want logging to never interfere with my actual work, so that a log failure never blocks or alters a Review_Queue or Draft_Co_Pilot action.

#### Acceptance Criteria

1. THE Activity_Log SHALL perform every append as a best-effort, non-blocking side effect of the original Source_Action.
2. IF appending an Activity_Entry fails for any reason, THEN THE Activity_Log SHALL allow the original Review_Queue or Draft_Co_Pilot action to complete unchanged and SHALL neither block, delay, reverse, nor alter that original action.
3. IF appending an Activity_Entry fails, THEN THE Activity_Log SHALL fail silently with respect to the original action and SHALL surface no error that interrupts, cancels, or rolls back the original action.
4. THE Activity_Log SHALL never make the success of a Review_Queue save, a Review_Status change, or a draft copy contingent on the success of the corresponding log append.

### Requirement 4: Bounded, Append-Only Log Size

**User Story:** As an Operator, I want the log to stay a sensible size, so that local storage stays manageable and the UI stays responsive.

#### Acceptance Criteria

1. THE Activity_Log SHALL retain at most a fixed maximum number of Activity_Entries defined as a constant in the Extension source code.
2. WHEN appending an Activity_Entry would cause the Activity_Log to exceed the maximum entry count, THE Activity_Log SHALL remove the oldest Activity_Entries first (FIFO) so that the resulting Activity_Log contains exactly the maximum number of the most recent Activity_Entries.
3. THE Activity_Log SHALL accept a Summary up to a fixed maximum character length defined as a constant in the Extension source code and SHALL truncate or reject a longer Summary so that no stored Summary exceeds the maximum.
4. THE Activity_Log SHALL preserve the relative order of the retained Activity_Entries after a Bound_Trim.

### Requirement 5: Export as JSON and Markdown

**User Story:** As an Operator, I want to export the whole log as JSON or Markdown, so that I keep a self-contained, auditable record outside the Extension.

#### Acceptance Criteria

1. THE Activity_Log SHALL produce an Export_Document representing the entire Activity_Log in JSON format on Operator request.
2. THE Activity_Log SHALL produce an Export_Document representing the entire Activity_Log in Markdown format on Operator request.
3. WHEN the Activity_Log produces a JSON Export_Document, THE Activity_Log SHALL include every retained Activity_Entry's Entry_Id, Action_Type, `created_at`, and Summary in a valid JSON structure.
4. WHEN the Activity_Log produces a Markdown Export_Document, THE Activity_Log SHALL render every retained Activity_Entry's Action_Type, `created_at`, and Summary in a human-readable Markdown structure.
5. WHEN the Activity_Log is empty and the Operator requests an export, THE Activity_Log SHALL produce a valid Export_Document representing an empty log in the requested Export_Format.
6. THE Activity_Log SHALL produce Export_Documents deterministically, so that exporting the same Activity_Log in the same Export_Format yields byte-identical output.
7. THE Activity_Log SHALL exclude any credential, token, full draft text, and full Note text from every Export_Document.

### Requirement 6: Local-Only Export Delivery

**User Story:** As an Operator, I want exports delivered entirely on my device, so that no data leaves my machine and no extra permission is needed.

#### Acceptance Criteria

1. THE Activity_Log SHALL deliver an Export_Document to the Operator using only `navigator.clipboard.writeText` (Clipboard_Export) and/or an in-page `Blob` object-URL anchor (`<a download>`) download (Download_Export).
2. THE Activity_Log SHALL NOT use `chrome.downloads` for any export.
3. WHEN the Activity_Log performs a Download_Export, THE Activity_Log SHALL create a `Blob` from the Export_Document, bind a generated object URL to an in-page anchor element, trigger the download, and revoke the object URL afterward.
4. THE Activity_Log SHALL perform every export operation locally and SHALL make no network request and SHALL transmit no Export_Document to the Worker_API or any external service.
5. THE Activity_Log SHALL require no manifest permission and no host permission for export beyond the Extension's existing manifest permissions.

### Requirement 7: Listing, Empty State, and Clearing the Log

**User Story:** As an Operator, I want to view and clear my activity log, so that I can review recent activity and reset the record when I choose.

#### Acceptance Criteria

1. THE Activity_Log SHALL display the retained Activity_Entries in newest-first order using a stable, deterministic ordering rule defined in the Extension source code.
2. WHEN the Activity_Log displays an Activity_Entry, THE Activity_Log SHALL display that Activity_Entry's Action_Type, `created_at`, and Summary.
3. WHERE the Activity_Log contains zero Activity_Entries, THE Activity_Log SHALL display an empty-state indicator stating that no activity has been recorded.
4. THE Activity_Log SHALL provide an Extension UI control that clears the entire Activity_Log.
5. WHEN the Operator clears the Activity_Log, THE Activity_Log SHALL remove every Activity_Entry and SHALL persist the now-empty Activity_Log to chrome.storage.local.

### Requirement 8: Local Persistence and Round-Trip

**User Story:** As an Operator, I want my log persisted locally, so that entries survive popup closes and browser restarts without any data leaving my machine.

#### Acceptance Criteria

1. THE Activity_Log SHALL persist the Activity_Log in chrome.storage.local under a new constant key added to STORAGE_KEYS in Extension source code.
2. THE Activity_Log SHALL define the new STORAGE_KEYS entry using the existing `rma_` key-name prefix convention and SHALL leave the existing STORAGE_KEYS entries unchanged.
3. WHEN the Activity_Log appends an Activity_Entry or clears the log, THE Activity_Log SHALL persist the updated Activity_Log to chrome.storage.local.
4. WHEN an Activity_Entry is written to chrome.storage.local and then read back, THE Activity_Log SHALL return an Activity_Entry whose Entry_Id, Action_Type, `created_at`, and Summary equal the values that were written.
5. THE Activity_Log SHALL perform every append, read, trim, list, clear, and export operation using only local chrome.storage.local operations and in-memory work, and SHALL perform no network request for any operation.
6. THE Activity_Log SHALL NOT transmit any Activity_Entry or Export_Document to the Worker_API or any external service.

### Requirement 9: Storage Read and Parse Error Handling

**User Story:** As an Operator, I want storage failures handled safely, so that a corrupt or unreadable log never crashes the Extension or leaks internal details.

#### Acceptance Criteria

1. WHEN the Activity_Log reads the Activity_Log from chrome.storage.local, THE Activity_Log SHALL return a typed Log_Read_Outcome that is either the parsed Activity_Entry list or a safe failure state.
2. IF the chrome.storage.local read for the Activity_Log fails, THEN THE Activity_Log SHALL return a safe failure state and SHALL display a recoverable storage error message to the Operator.
3. IF the stored Activity_Log value is missing, THEN THE Activity_Log SHALL treat the Activity_Log as containing zero Activity_Entries.
4. IF the stored Activity_Log value is present but cannot be parsed as a valid Activity_Log, THEN THE Activity_Log SHALL return a safe failure state and SHALL retain the unparsed stored value rather than overwriting it.
5. WHEN the Activity_Log surfaces a storage read or parse failure to the Operator, THE Activity_Log SHALL exclude any stack trace, file path, secret, environment value, and internal implementation detail from the displayed message.
6. IF an individual stored Activity_Entry is malformed within an otherwise readable Activity_Log, THEN THE Activity_Log SHALL exclude that malformed Activity_Entry from the returned list and SHALL retain the well-formed Activity_Entries.

### Requirement 10: OnboardingGate Integration

**User Story:** As an Operator, I want the Activity_Log available only behind the compliance gate, so that it stays consistent with the existing compliance workflow.

#### Acceptance Criteria

1. THE Activity_Log SHALL render within the Extension popup inside the existing Spec 03 OnboardingGate.
2. WHILE Compliance_Onboarding is incomplete or in a read_error state, THE Activity_Log SHALL NOT mount, SHALL render no log list, no export control, and no clear control, and SHALL run no log read, append, trim, or clear logic.
3. WHEN Compliance_Onboarding is complete, THE Activity_Log SHALL render its log list, export controls, and clear control within the popup.
4. THE Activity_Log SHALL render as a section distinct from the existing Intent_Scanner section, the existing Draft_Co_Pilot section, and the existing Review_Queue section within the popup.
5. THE Activity_Log SHALL preserve the existing rendering and behavior of the Intent_Scanner, the Draft_Co_Pilot, the Review_Queue, and the connection status within the popup.

### Requirement 11: Scope and Security Boundaries

**User Story:** As a compliance-conscious developer, I want strict scope and security boundaries enforced, so that the Activity_Log & Export remains a local, passive, Extension-UI-only audit aid within existing permissions.

#### Acceptance Criteria

1. THE Activity_Log SHALL operate within the Extension's existing manifest permissions and SHALL require no additional manifest permission and no additional host permission.
2. THE Activity_Log SHALL request no `reddit.com` or `old.reddit.com` host permission and SHALL access no Reddit API.
3. THE Activity_Log SHALL use no content script, no DOM scraping, no crawling, no Firecrawl, and no IP rotation.
4. THE Activity_Log SHALL perform no network request as part of any log or export operation, SHALL add no `/v1` Worker route, and SHALL make no Worker_API change.
5. THE Activity_Log SHALL use no `chrome.alarms`, no scheduled task, no background automation, no `chrome.notifications`, and no `chrome.downloads`.
6. THE Activity_Log SHALL call no OpenAI service, no LLM, and no other AI provider.
7. THE Activity_Log SHALL perform no automated Reddit action, including posting, commenting, upvoting, downvoting, direct messaging, joining, following, and form submission, on Reddit or any other platform.
8. THE Activity_Log SHALL provide no auto-post, auto-submit, auto-comment, scheduled-post, or one-click-publish control, and SHALL treat every Activity_Entry as a passive record of an action the Operator already performed.

### Requirement 12: Preserved Behavior of Specs 01–07

**User Story:** As a developer maintaining Specs 01 through 07, I want Spec 08-A to integrate without regressing existing behavior, so that foundation, auth, onboarding, compare, intent-scanner, draft-co-pilot, and review-queue behavior remain intact.

#### Acceptance Criteria

1. THE Extension SHALL keep the Spec 01 connection status behavior and the `GET /v1/status` consumption unchanged.
2. THE Extension SHALL keep the Spec 02 authentication and credential behavior unchanged.
3. THE Extension SHALL keep the Spec 03 Compliance_Onboarding behavior, the Acknowledgement_Record, and the gating of features unchanged, apart from the additive `onboarding_completed` Activity_Entry append, which is best-effort and non-blocking.
4. THE Worker_API SHALL keep the Spec 04 `POST /v1/compare` endpoint, the mock adapter, and the compare contract unchanged.
5. THE Extension SHALL keep the Spec 05 Intent_Scanner behavior, the Spec 06 Draft_Co_Pilot behavior, and the Spec 07 Review_Queue behavior unchanged, apart from the additive, best-effort, non-blocking Activity_Entry appends.
6. THE Extension SHALL keep the existing manifest `permissions` and `host_permissions` byte-for-byte unchanged.
7. THE Extension test suite SHALL be executed via `cd extension && npm run typecheck && npm run test && npm run build` and SHALL pass.
8. THE Worker_API test suite SHALL be executed via `cd ../worker-api && npm run typecheck && npm run test && npm run build` and SHALL pass.
9. THE Extension build SHALL be executed and SHALL succeed.
10. THE Worker_API build SHALL be executed and SHALL succeed.
11. WHEN the Spec 08-A validation commands complete, THE validation report SHALL state the final Extension and Worker_API test counts and the build results.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Append Produces a Well-Formed, Bounded-Type Entry

*For any* Source_Action, the appended Activity_Entry SHALL have a non-empty Entry_Id unique within the log, an Action_Type equal to exactly one of the enumerated values, a non-empty ISO 8601 `created_at`, and a Summary that is within the maximum length and free of full draft text, Note text, credentials, and tokens.

**Validates: Requirements 1.5, 1.6, 2.1, 2.2, 4.3**

### Property 2: Append Is Pure-Transform Plus Injected Identity

*For any* Activity_Log and any new entry built from an injected id/clock, the append transform SHALL return a new log equal to the input log with exactly the new entry added (subject to Bound_Trim), SHALL not mutate the input log, and SHALL depend on no hidden inputs beyond the injected id/clock.

**Validates: Requirements 1.7, 2.3, 8.4**

### Property 3: Log Size Is Bounded by FIFO Trim

*For any* sequence of appends, the resulting Activity_Log SHALL contain at most the maximum entry count, SHALL retain the most recent entries, SHALL drop the oldest entries first, and SHALL preserve the relative order of the retained entries.

**Validates: Requirements 4.1, 4.2, 4.4**

### Property 4: Append-Only — No In-Place Entry Mutation

*For any* existing Activity_Entry, no Activity_Log operation other than a full clear SHALL change that entry's Entry_Id, Action_Type, Summary, or `created_at`.

**Validates: Requirements 2.3, 2.4**

### Property 5: Logging Never Blocks or Alters the Source Action

*For any* Source_Action whose corresponding append fails, the original Review_Queue or Draft_Co_Pilot action SHALL complete unchanged, with no block, delay, reversal, alteration, or interrupting error.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

### Property 6: Export Is Deterministic and Complete

*For any* Activity_Log and Export_Format, the produced Export_Document SHALL include every retained Activity_Entry's recorded fields for that format, and exporting the same log in the same format SHALL yield byte-identical output.

**Validates: Requirements 5.3, 5.4, 5.6**

### Property 7: Export Is Redaction-Safe

*For any* Activity_Log, every produced Export_Document SHALL contain no credential, token, full draft text, or full Note text.

**Validates: Requirements 5.7, 1.6**

### Property 8: Entry Serialize/Deserialize Round-Trip

*For any* valid Activity_Entry, serializing it for chrome.storage.local and then deserializing it SHALL return an Activity_Entry equal to the original in its Entry_Id, Action_Type, `created_at`, and Summary.

**Validates: Requirements 8.4**

### Property 9: Read and Parse Failures Yield a Safe Failure State

*For any* Activity_Log read in which the chrome.storage.local read fails or the stored value cannot be parsed, the Activity_Log SHALL return a typed safe failure state whose surfaced message contains no stack trace, file path, secret, environment value, or internal implementation detail, and a malformed individual entry within an otherwise readable log SHALL be dropped while well-formed entries are retained.

**Validates: Requirements 9.1, 9.2, 9.4, 9.5, 9.6**

### Property 10: No Network for Any Log or Export Operation

*For any* append, read, trim, list, clear, or export operation, the Activity_Log SHALL perform zero network calls and SHALL transmit no Activity_Entry or Export_Document to any external service.

**Validates: Requirements 6.4, 8.5, 8.6, 11.4**

### Property 11: Local-Only Export Mechanism — No chrome.downloads

*For any* export, delivery SHALL occur only via `navigator.clipboard.writeText` and/or an in-page `Blob` object-URL anchor download, and SHALL never invoke `chrome.downloads`.

**Validates: Requirements 6.1, 6.2, 6.3, 11.5**

### Property 12: Permission Containment

*For any* build of the Extension with Spec 08-A, the manifest `permissions` SHALL equal exactly `['storage']`, the `host_permissions` SHALL equal exactly the three approved entries byte-for-byte, and `content_scripts` SHALL remain undefined.

**Validates: Requirements 11.1, 12.6**

### Property 13: Passive-Scope Containment

*For any* Spec 08-A source file, there SHALL be no Reddit host, Reddit API, content script, AI provider, `chrome.alarms`, `chrome.notifications`, `chrome.downloads`, or posting/automation control, consistent with a passive local audit aid.

**Validates: Requirements 11.2, 11.3, 11.5, 11.6, 11.7, 11.8**

### Property 14: Gate Containment

*For any* render while Compliance_Onboarding is incomplete or in a read_error state, the Activity_Log SHALL not mount, render no log list/export/clear control, and run no log read, append, trim, or clear logic.

**Validates: Requirements 10.2, 10.3**
