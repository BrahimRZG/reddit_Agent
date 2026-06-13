# Requirements Document

## Introduction

This document specifies **Spec 07: Review Queue** for the Reddit Marketing Agent — a compliance-first system composed of a Chrome Extension (Manifest V3, React 18, TypeScript, Vite, Tailwind) and a Cloudflare Worker API (Hono, TypeScript, D1) used for **manual** Reddit research and drafting support. The product is explicitly **not** a Reddit bot and must never automate Reddit posting, voting, messaging, joining, following, or form submission.

Spec 07 adds a **local, Extension-UI-only Review Queue** that helps the human Operator triage reply drafts before manually posting them outside the Extension. The Operator can **save** a draft into a local queue — either a Spec 06 Draft_Co_Pilot `DraftResult` or a manually entered/edited draft — manually set each queued item's **Review_Status**, add free-text **Notes**, and add **Checklist_Items** (each with text and a checked flag). The queue is persisted in `chrome.storage.local` under a new storage key. Every queue operation (save, list, view, update, delete) is performed **entirely locally** with **no network call**.

The Review_Queue is a **review/triage aid only**. It MUST NEVER post, comment, vote, message, join, follow, submit forms, scrape Reddit, access the Reddit API, or automate any Reddit action. The human Operator remains the sole actor who reviews, edits, copies, and manually posts content. Setting a Queue_Item to `approved_for_manual_use` records the Operator's own review decision; it does **not** publish, schedule, or transmit anything.

This spec builds on Spec 01 (MVP Foundation), Spec 02 (Worker Auth & Token Lifecycle), Spec 03 (Compliance Onboarding Gate), Spec 04 (CouponsRiver Compare API Foundation), Spec 05 (Intent Scanner), and Spec 06 (Draft Co-Pilot). It reuses the existing Extension manifest permissions, the existing `OnboardingGate`, the existing `chrome.storage.local` read/write conventions, and the Spec 06 `DraftResult` / `DraftMode` / `ComplianceWarning` shapes without modifying any prior spec.

### A Note on Identifiers and Timestamps

The Spec 06 Draft_Generator is a **pure, deterministic** function and is forbidden from using identifiers, randomness, or timestamps. The Review_Queue is different: a Queue_Item records an **Operator action** (saving, editing, status-setting) rather than a deterministic draft computation. Generating a stable `id`, a `created_at` timestamp, and an `updated_at` timestamp at the moment of an Operator action is therefore appropriate here and does **not** violate Spec 06's determinism guarantee. Determinism in this spec applies to the **pure queue transformation functions** (status transition, delete, checklist toggle, serialize/deserialize) operating over an already-constructed Queue_Item, not to id/timestamp creation.

### Non-Goals (Explicitly Out of Scope)

The Review_Queue **MUST NOT** introduce, imply, or depend on any of the following. No acceptance criterion in this document implies any of these:

- Any Reddit API access of any kind.
- Any `reddit.com` or `old.reddit.com` host permission, and no manifest permission expansion of any kind (the existing `permissions` and `host_permissions` arrays remain byte-for-byte unchanged).
- Any content script, DOM scraping, crawling, Firecrawl, or IP rotation.
- Any network request for any queue operation (save, list, view, update, delete are purely local).
- Any automated Reddit action: posting, commenting, upvoting, downvoting, direct messaging, joining, following, or form submission.
- Any auto-post, auto-submit, auto-comment, scheduled-post, or one-click-publish control of any kind.
- Any `chrome.alarms`, scheduled task, background automation, or `chrome.notifications`.
- Any OpenAI, LLM, generative-AI, or other AI-provider call.
- Any Cloudflare Worker change, new `/v1` route, or worker-side queue storage — for the Spec 07 MVP there are **no** worker-api changes.
- Any automatic, system-initiated change to a Queue_Item's Review_Status (status is Operator-controlled only).
- Any transmission of Queue_Items, Notes, or Checklist_Items to the Worker_API or any external service.

### In Scope

- A local Review_Queue persisted in `chrome.storage.local` under a new `STORAGE_KEYS` entry (existing keys unchanged).
- Saving a draft into the queue from a Spec 06 `DraftResult` (capturing draft text, `mode`, and the captured `ComplianceWarning` list and `safety`) or from a manually entered/edited draft.
- Manual Review_Status management across exactly three statuses: `needs_review` (default on save), `approved_for_manual_use`, and `rejected`.
- Free-text Notes per Queue_Item (add, edit, clear) and Checklist_Items (add, edit text, toggle checked, remove), as advisory review aids only.
- Listing all Queue_Items, viewing a single Queue_Item, editing Queue_Item fields, deleting a Queue_Item, and an empty-state indicator.
- Reasonable storage bounds (maximum draft-text length, note length, checklist-item text length, checklist-item count, and total Queue_Item count) to keep local storage sane.
- Rendering the Review_Queue UI inside the existing Spec 03 `OnboardingGate`, so it does not mount or run any queue logic before Compliance_Onboarding is complete or while in a `read_error` state.

## Glossary

- **Extension**: The Chrome Manifest V3 browser extension built with React 18, TypeScript, Vite, and Tailwind CSS. The Review_Queue is a feature surface within the Extension UI.
- **Worker_API**: The Cloudflare Worker backend (Hono, TypeScript, D1). Spec 07 makes **no** changes to the Worker_API.
- **Operator**: The human CouponsRiver user who saves drafts, sets review statuses, edits notes and checklist items, and manually decides whether and how to post on Reddit.
- **Review_Queue**: The Extension-UI-only feature specified by this document that stores, displays, and lets the Operator triage a collection of Queue_Items entirely on the local device.
- **Queue_Item**: A single saved entry in the Review_Queue, capturing the draft text, an optional Draft_Mode, optional captured Spec 06 Compliance_Warnings and Safety_Flag, a Review_Status, Notes, Checklist_Items, and created/updated tracking, identified by a stable local Item_Id.
- **Item_Id**: A stable, locally generated string identifier that uniquely identifies a Queue_Item within the Review_Queue for the lifetime of that item.
- **Draft_Source**: The origin of a saved draft: `draft_co_pilot` when saved from a Spec 06 Draft_Result, or `manual` when entered or edited directly by the Operator.
- **Draft_Mode**: The Spec 06 Reply_Mode (`no-link-authority`, `soft-cta-with-disclosure`, or `disclosed-link`) captured when a Queue_Item originates from a Draft_Co_Pilot Draft_Result. Optional for manually entered drafts.
- **Draft_Co_Pilot**: The Spec 06 Extension feature that produces a Draft_Result (`{ kind: 'draft'; mode; draftText; warnings; safety }`) or a Failure_State. The Review_Queue consumes the Draft_Result shape without modifying Spec 06.
- **Draft_Result**: The Spec 06 successful generator output that the Operator may save into the Review_Queue.
- **Compliance_Warning**: A single Spec 06 plain-language warning (`{ id; message }`) optionally captured onto a Queue_Item when the saved draft came from a Draft_Result. The Review_Queue stores these verbatim and never recomputes them.
- **Safety_Flag**: The Spec 06 `safety` value (`safe` or `unsafe`) optionally captured onto a Queue_Item when the saved draft came from a Draft_Result.
- **Review_Status**: The Operator-controlled triage state of a Queue_Item. Exactly one of the three enumerated values defined in the Extension source code: `needs_review`, `approved_for_manual_use`, and `rejected`. The default on save is `needs_review`.
- **Note**: The free-text review note attached to a Queue_Item by the Operator. Advisory only.
- **Checklist_Item**: A single advisory review-checklist entry on a Queue_Item, consisting of a stable Checklist_Item_Id, a `text` string, and a `checked` boolean.
- **Checklist_Item_Id**: A stable, locally generated string identifier that uniquely identifies a Checklist_Item within its containing Queue_Item.
- **Queue_Storage**: The local persistence layer that reads and writes the Review_Queue to `chrome.storage.local` under the Review_Queue storage key.
- **Queue_Read_Outcome**: The typed result of reading the Review_Queue from storage: either the parsed list of Queue_Items, or a safe failure state when the read or parse fails.
- **OnboardingGate**: The existing Spec 03 app-root gate that renders feature UI only when Compliance_Onboarding is complete and fails closed on a `read_error`. The Review_Queue renders inside this gate.
- **Compliance_Onboarding**: The Spec 03 gating process the Operator must complete before gated feature UI renders.
- **chrome.storage.local**: A Chrome extension storage area persisted locally on the Operator's device.
- **STORAGE_KEYS**: The Extension's single source of `chrome.storage.local` key constants in `extension/src/types/index.ts`. Spec 07 adds one new entry without modifying existing entries.

## Requirements

### Requirement 1: Save a Draft into the Review Queue

**User Story:** As an Operator, I want to save a generated or manual draft into a local review queue, so that I can triage it before deciding whether to post it manually.

#### Acceptance Criteria

1. THE Review_Queue SHALL provide an Extension UI control that saves a draft as a new Queue_Item.
2. WHEN the Operator saves a Spec 06 Draft_Result, THE Review_Queue SHALL create a Queue_Item that captures the Draft_Result `draftText`, the Draft_Result `mode` as the Queue_Item Draft_Mode, the Draft_Result `warnings` as the captured Compliance_Warning list, and the Draft_Result `safety` as the captured Safety_Flag.
3. WHEN the Operator saves a Spec 06 Draft_Result, THE Review_Queue SHALL set the Queue_Item Draft_Source to `draft_co_pilot`.
4. WHEN the Operator saves a manually entered or edited draft, THE Review_Queue SHALL create a Queue_Item that captures the Operator-supplied draft text and SHALL set the Queue_Item Draft_Source to `manual`.
5. WHEN the Review_Queue creates a Queue_Item, THE Review_Queue SHALL set the Queue_Item Review_Status to `needs_review`.
6. WHERE a saved draft did not originate from a Draft_Co_Pilot Draft_Result, THE Review_Queue SHALL omit the captured Compliance_Warning list and the captured Safety_Flag from the Queue_Item or store them as empty or absent values.
7. IF the Operator saves a draft whose draft text contains zero non-whitespace characters, THEN THE Review_Queue SHALL display a validation message requesting non-empty draft text and SHALL create no Queue_Item.
8. THE Review_Queue SHALL store every captured Compliance_Warning and Safety_Flag verbatim as recorded at save time and SHALL recompute no compliance verdict.

### Requirement 2: Stable Queue Item Identity and Tracking

**User Story:** As an Operator, I want each saved item to have a stable identifier and creation tracking, so that I can reliably reference, edit, and delete the correct item.

#### Acceptance Criteria

1. WHEN the Review_Queue creates a Queue_Item, THE Review_Queue SHALL assign the Queue_Item a stable Item_Id that is unique among all Queue_Items currently in the Review_Queue.
2. WHEN the Review_Queue creates a Queue_Item, THE Review_Queue SHALL set the Queue_Item `created_at` field to an ISO 8601 timestamp recorded at save time.
3. WHEN the Review_Queue creates a Queue_Item, THE Review_Queue SHALL set the Queue_Item `updated_at` field equal to the `created_at` field value.
4. WHEN the Operator modifies a Queue_Item's Review_Status, Note, or Checklist_Items, THE Review_Queue SHALL set that Queue_Item `updated_at` field to an ISO 8601 timestamp recorded at the time of the modification.
5. THE Review_Queue SHALL preserve a Queue_Item's Item_Id and `created_at` field unchanged across every subsequent edit, status change, and persistence cycle for the lifetime of that Queue_Item.

### Requirement 3: Manual Review Status Management

**User Story:** As an Operator, I want to manually set each queued item's review status, so that I can record my own triage decision without any automated change.

#### Acceptance Criteria

1. THE Review_Queue SHALL represent a Queue_Item's Review_Status as exactly one of the three enumerated values defined in the Extension source code: `needs_review`, `approved_for_manual_use`, and `rejected`.
2. THE Review_Queue SHALL provide an Extension UI control that allows the Operator to set a Queue_Item's Review_Status to any of the three enumerated values.
3. WHEN the Operator sets a Queue_Item's Review_Status to a target value, THE Review_Queue SHALL update only that Queue_Item's Review_Status to the target value and SHALL leave the Review_Status of every other Queue_Item unchanged.
4. THE Review_Queue SHALL change a Queue_Item's Review_Status only in response to an explicit Operator action and SHALL apply no automatic, scheduled, or system-initiated Review_Status change.
5. WHEN the Review_Queue displays a Queue_Item, THE Review_Queue SHALL display that Queue_Item's current Review_Status.
6. IF a stored Queue_Item carries a Review_Status value outside the three enumerated values, THEN the Review_Queue SHALL treat that Queue_Item's Review_Status as `needs_review`.

### Requirement 4: Review Notes

**User Story:** As an Operator, I want to add and edit free-text notes on a queued item, so that I can capture review reasoning as an advisory aid.

#### Acceptance Criteria

1. THE Review_Queue SHALL provide an Extension UI control that allows the Operator to add or edit a free-text Note on a Queue_Item.
2. WHEN the Operator saves a Note on a Queue_Item, THE Review_Queue SHALL store the Note text on only that Queue_Item.
3. WHEN the Operator clears a Note on a Queue_Item, THE Review_Queue SHALL remove the Note text from that Queue_Item while retaining the Queue_Item.
4. THE Review_Queue SHALL treat a Note as an advisory review aid and SHALL apply no change to the Queue_Item's Review_Status or captured Safety_Flag as a result of adding, editing, or clearing a Note.
5. WHEN the Review_Queue displays a Queue_Item that has a non-empty Note, THE Review_Queue SHALL display the Note text.

### Requirement 5: Review Checklist Items

**User Story:** As an Operator, I want to add checklist items and toggle them as done, so that I can track review steps for each queued item.

#### Acceptance Criteria

1. THE Review_Queue SHALL provide an Extension UI control that allows the Operator to add a Checklist_Item, consisting of a `text` string and a `checked` boolean, to a Queue_Item.
2. WHEN the Operator adds a Checklist_Item, THE Review_Queue SHALL assign the Checklist_Item a stable Checklist_Item_Id unique among the Checklist_Items of its containing Queue_Item and SHALL set its `checked` value to `false`.
3. WHEN the Operator toggles a Checklist_Item, THE Review_Queue SHALL invert the `checked` boolean of only the targeted Checklist_Item and SHALL leave the `checked` value and `text` of every other Checklist_Item unchanged.
4. WHEN the Operator edits a Checklist_Item's text, THE Review_Queue SHALL update the `text` of only the targeted Checklist_Item.
5. WHEN the Operator removes a Checklist_Item, THE Review_Queue SHALL remove only the targeted Checklist_Item from its containing Queue_Item and SHALL retain every other Checklist_Item.
6. THE Review_Queue SHALL treat Checklist_Items as advisory review aids and SHALL apply no change to the Queue_Item's Review_Status or captured Safety_Flag as a result of adding, editing, toggling, or removing a Checklist_Item.

### Requirement 6: Queue Listing, Viewing, and Empty State

**User Story:** As an Operator, I want to list and view my queued items, so that I can see what is awaiting review.

#### Acceptance Criteria

1. THE Review_Queue SHALL display a list of all Queue_Items currently stored in the Review_Queue.
2. WHEN the Review_Queue displays the list, THE Review_Queue SHALL display each Queue_Item's Review_Status and a representation of its draft text.
3. THE Review_Queue SHALL order the displayed Queue_Item list using a stable, deterministic ordering rule defined in the Extension source code.
4. WHEN the Operator views a single Queue_Item, THE Review_Queue SHALL display that Queue_Item's draft text, Draft_Mode when present, captured Compliance_Warnings when present, captured Safety_Flag when present, Review_Status, Note when present, and Checklist_Items.
5. WHERE the Review_Queue contains zero Queue_Items, THE Review_Queue SHALL display an empty-state indicator stating that no items are queued.

### Requirement 7: Editing and Deleting Queue Items

**User Story:** As an Operator, I want to edit a queued item's draft text and delete items, so that I can keep the queue accurate and uncluttered.

#### Acceptance Criteria

1. THE Review_Queue SHALL provide an Extension UI control that allows the Operator to edit a Queue_Item's draft text.
2. WHEN the Operator saves an edited draft text on a Queue_Item, THE Review_Queue SHALL update the draft text of only that Queue_Item and SHALL preserve that Queue_Item's Item_Id and `created_at` field.
3. THE Review_Queue SHALL provide an Extension UI control that allows the Operator to delete a Queue_Item.
4. WHEN the Operator deletes a Queue_Item, THE Review_Queue SHALL remove only the Queue_Item bearing the targeted Item_Id and SHALL retain every other Queue_Item unchanged.
5. IF the Operator saves an edited draft text containing zero non-whitespace characters, THEN THE Review_Queue SHALL display a validation message requesting non-empty draft text and SHALL leave the existing Queue_Item draft text unchanged.

### Requirement 8: Storage Bounds

**User Story:** As an Operator, I want sensible limits on queued content, so that local storage stays manageable and the UI stays responsive.

#### Acceptance Criteria

1. THE Review_Queue SHALL accept Queue_Item draft text up to 10000 characters in length.
2. IF the Operator saves or edits a Queue_Item with draft text exceeding 10000 characters, THEN THE Review_Queue SHALL display a validation message stating the 10000-character maximum and SHALL withhold the save or edit until the Operator shortens the draft text.
3. THE Review_Queue SHALL accept a Note up to 2000 characters in length and SHALL accept a Checklist_Item `text` up to 280 characters in length.
4. IF the Operator saves a Note exceeding 2000 characters or a Checklist_Item `text` exceeding 280 characters, THEN THE Review_Queue SHALL display a validation message stating the applicable maximum and SHALL withhold that save until the Operator shortens the text.
5. THE Review_Queue SHALL accept up to 50 Checklist_Items per Queue_Item and up to 200 Queue_Items in total.
6. IF the Operator attempts to add a Checklist_Item beyond the 50-item per-Queue_Item maximum or to save a Queue_Item beyond the 200-item total maximum, THEN THE Review_Queue SHALL display a message stating the applicable maximum and SHALL create no additional item.

### Requirement 9: Local Persistence and Round-Trip

**User Story:** As an Operator, I want my queue persisted locally on my device, so that my items survive popup closes and browser restarts without any data leaving my machine.

#### Acceptance Criteria

1. THE Review_Queue SHALL persist the Review_Queue in chrome.storage.local under a new constant key added to STORAGE_KEYS in Extension source code.
2. THE Review_Queue SHALL define the new STORAGE_KEYS entry using the existing `rma_` key-name prefix convention and SHALL leave the existing STORAGE_KEYS entries unchanged.
3. WHEN the Operator saves, edits, status-changes, or deletes a Queue_Item, THE Review_Queue SHALL persist the updated Review_Queue to chrome.storage.local.
4. WHEN the Review_Queue reads the Review_Queue, THE Review_Queue SHALL retrieve the stored value from chrome.storage.local using the Review_Queue storage key.
5. WHEN a Queue_Item is written to chrome.storage.local and then read back, THE Review_Queue SHALL return a Queue_Item whose Item_Id, draft text, Draft_Mode, Draft_Source, captured Compliance_Warnings, captured Safety_Flag, Review_Status, Note, Checklist_Items, `created_at`, and `updated_at` equal the values that were written.
6. THE Review_Queue SHALL perform every save, list, view, status-change, edit, and delete operation using only local chrome.storage.local operations and SHALL perform no network request for any queue operation.
7. THE Review_Queue SHALL NOT transmit any Queue_Item, Note, or Checklist_Item to the Worker_API or any external service.

### Requirement 10: Storage Read and Parse Error Handling

**User Story:** As an Operator, I want storage failures handled safely, so that a corrupt or unreadable queue never crashes the Extension or leaks internal details.

#### Acceptance Criteria

1. WHEN the Review_Queue reads the Review_Queue from chrome.storage.local, THE Review_Queue SHALL return a typed Queue_Read_Outcome that is either the parsed Queue_Item list or a safe failure state.
2. IF the chrome.storage.local read for the Review_Queue fails, THEN THE Review_Queue SHALL return a safe failure state and SHALL display a recoverable storage error message to the Operator.
3. IF the stored Review_Queue value is missing, THEN THE Review_Queue SHALL treat the Review_Queue as containing zero Queue_Items.
4. IF the stored Review_Queue value is present but cannot be parsed as a valid Review_Queue, THEN THE Review_Queue SHALL return a safe failure state and SHALL retain the unparsed stored value rather than overwriting it.
5. WHEN the Review_Queue surfaces a storage read or parse failure to the Operator, THE Review_Queue SHALL exclude any stack trace, file path, secret, environment value, and internal implementation detail from the displayed message.
6. IF an individual stored Queue_Item is malformed within an otherwise readable Review_Queue, THEN THE Review_Queue SHALL exclude that malformed Queue_Item from the returned list and SHALL retain the well-formed Queue_Items.

### Requirement 11: OnboardingGate Integration

**User Story:** As an Operator, I want the Review_Queue available only behind the compliance gate, so that it stays consistent with the existing compliance workflow.

#### Acceptance Criteria

1. THE Review_Queue SHALL render within the Extension popup inside the existing Spec 03 OnboardingGate.
2. WHILE Compliance_Onboarding is incomplete or in a read_error state, THE Review_Queue SHALL NOT mount, SHALL render no queue list, no queue control, and no queue input, and SHALL run no queue read, write, or mutation logic.
3. WHEN Compliance_Onboarding is complete, THE Review_Queue SHALL render its queue list, controls, and inputs within the popup.
4. THE Review_Queue SHALL render as a section distinct from the existing Intent_Scanner section and the existing Draft_Co_Pilot section within the popup.
5. THE Review_Queue SHALL preserve the existing rendering and behavior of the Intent_Scanner, the Draft_Co_Pilot, and the connection status within the popup.

### Requirement 12: Scope and Security Boundaries

**User Story:** As a compliance-conscious developer, I want strict scope and security boundaries enforced, so that the Review_Queue remains a local, manual, Extension-UI-only triage aid within existing permissions.

#### Acceptance Criteria

1. THE Review_Queue SHALL operate within the Extension's existing manifest permissions and SHALL require no additional manifest permission and no additional host permission.
2. THE Review_Queue SHALL request no `reddit.com` or `old.reddit.com` host permission and SHALL access no Reddit API.
3. THE Review_Queue SHALL use no content script, no DOM scraping, no crawling, no Firecrawl, and no IP rotation.
4. THE Review_Queue SHALL perform no network request as part of any queue operation, SHALL add no `/v1` Worker route, and SHALL make no Worker_API change.
5. THE Review_Queue SHALL use no `chrome.alarms`, no scheduled task, no background automation, and no `chrome.notifications`.
6. THE Review_Queue SHALL call no OpenAI service, no LLM, and no other AI provider.
7. THE Review_Queue SHALL perform no automated Reddit action, including posting, commenting, upvoting, downvoting, direct messaging, joining, following, and form submission, on Reddit or any other platform.
8. THE Review_Queue SHALL provide no auto-post, auto-submit, auto-comment, scheduled-post, or one-click-publish control, and SHALL treat `approved_for_manual_use` as an Operator review decision only that publishes, schedules, and transmits nothing.

### Requirement 13: Preserved Behavior of Specs 01–06

**User Story:** As a developer maintaining Specs 01 through 06, I want Spec 07 to integrate without regressing existing behavior, so that foundation, auth, onboarding, compare, intent-scanner, and draft-co-pilot behavior remain intact.

#### Acceptance Criteria

1. THE Extension SHALL keep the Spec 01 connection status behavior and the `GET /v1/status` consumption unchanged.
2. THE Extension SHALL keep the Spec 02 authentication and credential behavior unchanged.
3. THE Extension SHALL keep the Spec 03 Compliance_Onboarding behavior, the Acknowledgement_Record, and the gating of features unchanged.
4. THE Worker_API SHALL keep the Spec 04 `POST /v1/compare` endpoint, the mock adapter, and the compare contract unchanged.
5. THE Extension SHALL keep the Spec 05 Intent_Scanner behavior and the Spec 06 Draft_Co_Pilot behavior, including the Draft_Result and Failure_State handling, unchanged.
6. THE Extension SHALL keep the existing manifest `permissions` and `host_permissions` byte-for-byte unchanged.
7. THE Extension test suite SHALL be executed via `cd extension && npm run typecheck && npm run test && npm run build` and SHALL pass.
8. THE Worker_API test suite SHALL be executed via `cd ../worker-api && npm run typecheck && npm run test && npm run build` and SHALL pass.
9. THE Extension build SHALL be executed and SHALL succeed.
10. THE Worker_API build SHALL be executed and SHALL succeed.
11. WHEN the Spec 07 validation commands complete, THE validation report SHALL state the final Extension and Worker_API test counts and the build results.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Save Produces a Well-Formed Item with Default Status

*For any* draft saved into the Review_Queue (from a Draft_Result or a manual draft with at least one non-whitespace character), the resulting Queue_Item SHALL have a non-empty Item_Id unique within the queue, a Review_Status equal to `needs_review`, equal `created_at` and `updated_at` timestamps, and — when saved from a Draft_Result — captured `draftText`, Draft_Mode, Compliance_Warnings, and Safety_Flag equal to the Draft_Result values.

**Validates: Requirements 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3**

### Property 2: Review Status Is Bounded to the Three Enumerated Values

*For any* Queue_Item exposed by the Review_Queue, its effective Review_Status SHALL be exactly one of `needs_review`, `approved_for_manual_use`, or `rejected`, and any stored value outside that set SHALL be treated as `needs_review`.

**Validates: Requirements 3.1, 3.6**

### Property 3: Status Transition Is Operator-Only and Targets Exactly One Item

*For any* Review_Queue and any Operator-set target status, applying the status change to a chosen Item_Id SHALL set only that Queue_Item's Review_Status to the target value, SHALL leave every other Queue_Item's Review_Status unchanged, and SHALL never occur without an explicit Operator action.

**Validates: Requirements 3.3, 3.4**

### Property 4: Queue Item Serialize/Deserialize Round-Trip

*For any* valid Queue_Item, serializing it for chrome.storage.local and then deserializing it SHALL return a Queue_Item equal to the original in its Item_Id, draft text, Draft_Mode, Draft_Source, captured Compliance_Warnings, captured Safety_Flag, Review_Status, Note, Checklist_Items, `created_at`, and `updated_at`.

**Validates: Requirements 9.3, 9.4, 9.5**

### Property 5: Delete Removes Exactly the Targeted Item

*For any* Review_Queue containing a Queue_Item with a given Item_Id, deleting that Item_Id SHALL produce a Review_Queue that contains every other original Queue_Item unchanged and does not contain the targeted Item_Id, reducing the item count by exactly one.

**Validates: Requirements 7.4**

### Property 6: Checklist Toggle Flips Exactly One Item

*For any* Queue_Item and any Checklist_Item_Id within it, toggling that Checklist_Item SHALL invert the `checked` boolean of only that Checklist_Item and SHALL leave the `text` and `checked` value of every other Checklist_Item unchanged.

**Validates: Requirements 5.3**

### Property 7: Notes and Checklist Edits Are Advisory

*For any* Queue_Item, adding, editing, clearing, toggling, or removing a Note or a Checklist_Item SHALL leave the Queue_Item's Review_Status and captured Safety_Flag unchanged.

**Validates: Requirements 4.4, 5.6**

### Property 8: Storage Bounds Are Enforced

*For any* save or edit, the Review_Queue SHALL reject draft text exceeding 10000 characters, a Note exceeding 2000 characters, a Checklist_Item text exceeding 280 characters, a Checklist_Item count exceeding 50 per Queue_Item, and a total Queue_Item count exceeding 200, creating or updating no item that would breach those bounds.

**Validates: Requirements 8.2, 8.4, 8.6**

### Property 9: Read and Parse Failures Yield a Safe Failure State

*For any* Review_Queue read in which the chrome.storage.local read fails or the stored value cannot be parsed, the Review_Queue SHALL return a typed safe failure state whose surfaced message contains no stack trace, file path, secret, environment value, or internal implementation detail, and SHALL not overwrite the unparsed stored value.

**Validates: Requirements 10.1, 10.2, 10.4, 10.5**

### Property 10: No Network for Any Queue Operation

*For any* queue operation (save, list, view, status-change, edit, delete), the Review_Queue SHALL perform zero network requests and SHALL transmit no Queue_Item, Note, or Checklist_Item to the Worker_API or any external service.

**Validates: Requirements 9.6, 9.7, 12.4**

### Property 11: Manual-Input-Only Scope

*For any* execution, the Review_Queue SHALL obtain its content only from Operator-saved drafts and Operator-supplied notes and checklist items, and SHALL perform no Reddit API access, no content-script execution, no scraping or crawling, no scheduled or background processing, no notification, no automated Reddit action, and no AI-provider call.

**Validates: Requirements 12.2, 12.3, 12.5, 12.6, 12.7, 12.8**

### Property 12: Permission Containment

*For any* execution, the Review_Queue SHALL operate within the Extension's existing manifest permissions, SHALL request no additional manifest permission and no additional host permission, and SHALL keep the manifest `permissions` and `host_permissions` arrays byte-for-byte unchanged.

**Validates: Requirements 12.1, 13.6**

### Property 13: Gate Containment

*For any* onboarding state that is incomplete or in `read_error`, the Review_Queue SHALL not mount, render any queue UI, or run any queue read, write, or mutation logic; only when Compliance_Onboarding is complete SHALL the Review_Queue render and operate.

**Validates: Requirements 11.2, 11.3**

### Property 14: Preserved Behavior of Specs 01–06

*For any* Spec 07 change, the Spec 01 status behavior, Spec 02 auth, Spec 03 onboarding and gating, Spec 04 `POST /v1/compare` contract, Spec 05 Intent_Scanner, and Spec 06 Draft_Co_Pilot SHALL remain unchanged, and the executed Extension and Worker_API typecheck, test, and build commands SHALL pass.

**Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.7, 13.8, 13.9, 13.10, 13.11**
