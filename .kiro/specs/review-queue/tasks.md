# Implementation Plan — Spec 07: Review Queue (Local, Extension-UI-Only, Operator-Triaged)

## Overview

This plan implements the **local, Extension-UI-only Review_Queue** described in `requirements.md` and
`design.md`. Work proceeds in strict dependency order: shared **types and constants** first, then the
pure **queue transformation module** (`review-queue.ts`), then the thin **storage adapter**
(`review-queue-storage.ts`), then the **`ReviewQueue` React panel**, then **popup wiring** inside the
existing `OnboardingGate`, then the **property/unit/component tests**, the **security-boundary**
extensions, and finally **full validation** of both packages.

Every queue operation — save, list, view, status-change, note edit, checklist edit, delete — runs
**entirely locally** with **no network call** and **no AI provider**. The queue logic is split into
**pure functions** (`review-queue.ts`) that never touch storage, and a thin **storage adapter**
(`review-queue-storage.ts`) that reads/writes `chrome.storage.local` using the same typed, fail-safe
pattern as Spec 03's `onboarding-storage.ts`. The pure transforms take **injected** `QueueClock` /
`IdFactory` parameters so they stay deterministic given their inputs (`design.md` Section 5.3);
production callers pass `crypto.randomUUID()`-style ids and `new Date().toISOString()`. Determinism in
this spec applies to the **transforms over an already-constructed item** (status transition, delete,
checklist toggle, serialize/deserialize), **not** to id/timestamp creation.

Scope is strictly bounded: Extension UI only, Operator-supplied input only, manual select/copy only.
There is **no** Reddit API, DOM scraping, content script, crawling, Firecrawl, IP rotation,
`chrome.alarms`, `chrome.notifications`, background processing, `reddit.com` host permission, manifest
permission expansion, automated Reddit action, posting/auto-post control, AI-provider call, new `/v1`
Worker route, or worker-api change. The Spec 06 `DraftMode` / `DraftResult` / `ComplianceWarning`
shapes are reused **verbatim** without modifying Spec 06, and the captured `warnings`/`safety` are
stored as recorded — the Review_Queue recomputes no compliance verdict (Req 1.8).

All file paths follow `design.md` Section 2. No manifest permission is added; the existing
`permissions: ["storage"]` and `host_permissions` (`https://*.workers.dev/*`, `http://localhost/*`,
`http://127.0.0.1/*`) remain byte-for-byte unchanged, and that invariant is itself tested (Group 7).
Tests use the existing **Vitest + React Testing Library** stack and **fast-check** (already an
extension devDependency — no dependency change needed) for property tests, each running a **minimum of
100 iterations** and tagged `// Feature: review-queue, Property {n}: {property text}` per `design.md`
Section 11.

## Task Dependency Graph / Ordering

```
1 (types + constants: Review Queue Types (Spec 07) + STORAGE_KEYS.REVIEW_QUEUE)
 └─> 2 (review-queue.ts: createItemFromDraftResult, createManualItem,
        addItem, setStatus, updateNote, add/toggle/edit/removeChecklistItem,
        editDraftText, deleteItem, coerceStatus, orderQueue, validate*,
        serializeQueue/deserializeQueue — all PURE)
        └─> 3 (review-queue-storage.ts: readQueue → QueueReadOutcome,
               writeQueue, ReviewQueueStorageError — chrome.storage.local only)
               └─> 4 (ReviewQueue.tsx panel — calls pure transforms + readQueue/writeQueue)
                      └─> 5 (Popup.tsx wiring inside OnboardingGate,
                             below IntentScanner and DraftCoPilot)
                             │
        ┌────────────────────┴────────────────────┐
        ▼                                          ▼
   6 (tests + PBT: review-queue.test.ts,       7 (security-boundary.test.ts
      review-queue-storage.test.ts,               extension — manifest preservation
      ReviewQueue.test.tsx, Popup.test.tsx)       + forbidden-scope/no-network/
        │                                          no-posting scans; independent of UI,
        │                                          needs only 2,3,4 source present)
        └────────────────────┬─────────────────────┘
                             ▼
                   8 (full validation: extension + worker-api
                      typecheck + test + build; report counts/results)
```

- Group 1 is the foundation for every later group (types reuse Spec 06 `DraftMode`/`DraftResult`/
  `ComplianceWarning` verbatim).
- Group 2 (pure logic) depends only on Group 1; Group 3 (storage adapter) calls Group 2's
  `serializeQueue`/`deserializeQueue`, so 2 precedes 3.
- Group 4 (panel) consumes Groups 2 and 3; Group 5 wires Group 4 into the popup under the existing
  gate, below `IntentScanner` and `DraftCoPilot`.
- Group 6 validates the pure logic, the storage adapter, and the integrated UI (needs Groups 2–5).
  Group 7 is static and needs only that the Group 2/3/4 source files exist; it can run any time after
  Group 4 (the Spec 07 token/no-network scans target those files plus `Popup.tsx`).
- Group 8 is the final whole-repo verification of both packages (Req 13.7–13.11).
- `fast-check` is already present in the extension dev dependencies (no dependency change needed)
  before Group 6 property tests run.

## Tasks

- [ ] 1. Add Review Queue shared types and constants to `extension/src/types/index.ts`
  - In a new `// --- Review Queue Types (Spec 07) ---` section, add the types from `design.md`
    Section 4: `ReviewStatus` (`'needs_review' | 'approved_for_manual_use' | 'rejected'`),
    `DraftSource` (`'draft_co_pilot' | 'manual'`), `ChecklistItem` (`{ id; text; checked }`),
    `QueueItem` (`{ id; draftText; source; mode?; warnings?; safety?; status; note?; checklist[];
    created_at; updated_at }`), and `ReviewQueue` (`QueueItem[]`).
  - Add the typed result shapes: `QueueReadOutcome`
    (`{ ok: true; items } | { ok: false; error: 'read_error' | 'parse_error'; message }`),
    `QueueFieldValidation` (`{ kind: 'valid' } | { kind: 'empty' } | { kind: 'too_long'; max }`),
    `AddResult` (`{ ok: true; queue } | { ok: false; reason: 'queue_full'; max }`), and
    `MutateResult` (`{ ok: true; queue } | { ok: false; reason: 'empty' | 'too_long' |
    'checklist_full' | 'not_found'; max? }`).
  - Reuse the Spec 06 `DraftMode`, `DraftResult`, and `ComplianceWarning` types **verbatim** for the
    captured `mode`/`warnings`/`safety` fields; do **not** modify any existing Spec 01–06 type.
  - Define the bound constants single-sourced so transforms, the UI, and tests share them:
    `MAX_QUEUE_DRAFT_TEXT = 10000` (Req 8.1, 8.2), `MAX_NOTE = 2000` (Req 8.3, 8.4),
    `MAX_CHECKLIST_TEXT = 280` (Req 8.3, 8.4), `MAX_CHECKLIST_ITEMS = 50` (Req 8.5, 8.6), and
    `MAX_QUEUE_ITEMS = 200` (Req 8.5, 8.6).
  - Add exactly one new entry `REVIEW_QUEUE: 'rma_review_queue'` to the existing `STORAGE_KEYS`
    object, preserving the `rma_` prefix convention and leaving the existing `WORKER_API_BASE_URL` and
    `ONBOARDING` entries unchanged (Req 9.1, 9.2). Append only; change no manifest-related value.
  - _Requirements: 1.2, 1.3, 1.4, 1.6, 2.1, 3.1, 4.x, 5.1, 5.2, 8.1, 8.3, 8.5, 9.1, 9.2, 10.1, 13.5_

- [ ] 2. Implement the pure queue logic in `extension/src/lib/review-queue.ts`
  - [ ] 2.1 Implement field validators and the injected `QueueClock` / `IdFactory` seams
    - Define the injected-dependency interfaces `QueueClock { now(): string }` and
      `IdFactory { create(): string }` so the transforms stay pure and test-deterministic
      (`design.md` Section 5.3).
    - Write pure `validateDraftText(text)` returning `{ kind: 'empty' }` for zero non-whitespace
      characters (Req 1.7, 7.5), `{ kind: 'too_long'; max: MAX_QUEUE_DRAFT_TEXT }` above 10000
      characters (Req 8.1, 8.2), otherwise `{ kind: 'valid' }`.
    - Write pure `validateNote(text)` (≤ `MAX_NOTE`) and `validateChecklistText(text)`
      (≤ `MAX_CHECKLIST_TEXT`) returning the same `QueueFieldValidation` shape (Req 8.3, 8.4).
    - All validators MUST be pure: no `Date`/`Date.now`/`performance.now`/`Math.random`/`crypto`/
      `chrome.storage`/global mutable state, and no `fetch`/`authenticatedFetch` or any AI provider.
    - _Requirements: 1.7, 7.5, 8.1, 8.2, 8.3, 8.4_
  - [ ] 2.2 Implement item creation and `addItem`
    - Write `createItemFromDraftResult(result, clock, ids)` capturing `result.draftText`,
      `result.mode` → `mode`, `result.warnings` → `warnings`, `result.safety` → `safety`, setting
      `source = 'draft_co_pilot'`, `status = 'needs_review'`, `checklist = []`,
      `id = ids.create()`, and `created_at = updated_at = clock.now()` (Req 1.2, 1.3, 1.5, 1.8,
      2.1–2.3).
    - Write `createManualItem(draftText, clock, ids)` that sets `source = 'manual'`, omits
      `mode`/`warnings`/`safety` (Req 1.4, 1.6), and otherwise mirrors the same defaults
      (Req 1.5, 2.1–2.3).
    - Write `addItem(queue, item): AddResult` appending the item unless the queue already holds
      `MAX_QUEUE_ITEMS`, in which case it returns `{ ok: false, reason: 'queue_full', max: 200 }` and
      creates no item (Req 8.5, 8.6).
    - Each function returns a **new** value and never mutates its argument.
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2.1, 2.2, 2.3, 8.5, 8.6_
  - [ ] 2.3 Implement the Operator-only, single-target mutations
    - Write `setStatus(queue, id, status, clock)` that sets only the targeted item's `status` and
      bumps its `updated_at`, leaving every other item unchanged (Req 3.3, 3.4, 2.4); there is no
      automatic/scheduled status path.
    - Write `updateNote(queue, id, note, clock): MutateResult` that validates the Note bound, sets or
      clears `note` on only the targeted item, bumps `updated_at`, and leaves `status`/`safety`
      unchanged (Req 4.2, 4.3, 4.4, 8.4).
    - Write `addChecklistItem(queue, id, text, clock, ids): MutateResult` (validate text + 50-item
      bound, assign unique `id`, `checked = false`, append to only the targeted item — Req 5.1, 5.2,
      8.4, 8.6), `toggleChecklistItem(queue, id, checklistId, clock)` (invert `checked` on only the
      targeted entry — Req 5.3), `editChecklistItem(queue, id, checklistId, text, clock): MutateResult`
      (Req 5.4, 8.4), and `removeChecklistItem(queue, id, checklistId, clock)` (Req 5.5).
    - Write `editDraftText(queue, id, draftText, clock): MutateResult` that validates non-whitespace
      (Req 7.5) and the 10000 bound (Req 8.2); on success updates only that item's `draftText`,
      **preserves `id` and `created_at`**, and bumps `updated_at` (Req 7.1, 7.2); on failure leaves the
      existing draft text unchanged.
    - Write `deleteItem(queue, id)` that removes only the item bearing the targeted `id`, retaining
      every other item and reducing the count by exactly one (Req 7.4).
    - All note/checklist operations are **advisory**: they never change `status` or captured `safety`
      (Req 4.4, 5.6). Every mutation bumps `updated_at` (Req 2.4).
    - _Requirements: 2.4, 3.3, 3.4, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 7.1, 7.2, 7.4, 7.5, 8.2, 8.4, 8.6_
  - [ ] 2.4 Implement status coercion, ordering, and serialize/deserialize
    - Write `coerceStatus(value): ReviewStatus` returning the value when it is one of the three
      `ReviewStatus` literals, otherwise `needs_review` (Req 3.6).
    - Write `orderQueue(queue): QueueItem[]` returning a stable, deterministic order — `created_at`
      descending, then `id` ascending as a total-order tiebreak — without mutating the input (Req 6.3).
    - Write `serializeQueue(queue)` mapping the queue to a plain JSON-safe structure, and
      `deserializeQueue(raw): QueueItem[]` that validates each entry with a runtime shape guard (in the
      spirit of `isAcknowledgementRecord`), applies `coerceStatus`, **drops** any malformed individual
      item, and retains the well-formed items (Req 3.6, 9.5, 10.6).
    - These remain pure (no storage/network/AI/hidden inputs) so `deserializeQueue(serializeQueue([x]))[0]`
      deep-equals `x` across all fields (Req 9.5).
    - _Requirements: 3.6, 6.3, 9.5, 10.6_

- [ ] 3. Implement the storage adapter in `extension/src/lib/review-queue-storage.ts`
  - [ ] 3.1 Implement `readQueue` and `ReviewQueueStorageError`
    - Define `class ReviewQueueStorageError extends Error` (parallels `OnboardingStorageError` /
      `StorageError`).
    - Write `readQueue(): Promise<QueueReadOutcome>` mirroring `onboarding-storage.ts`'s typed
      fail-safe read: `await chrome.storage.local.get(STORAGE_KEYS.REVIEW_QUEUE)` inside `try/catch`;
      a thrown read → `{ ok: false, error: 'read_error', message }` with a **fixed safe** message
      (Req 10.2, 10.5); a missing/`undefined` value → `{ ok: true, items: [] }` (Req 10.3); a present
      but non-array/unparseable value → `{ ok: false, error: 'parse_error', message }` **without
      overwriting** the stored value (Req 10.4); a present array → `deserializeQueue` (malformed items
      dropped, statuses coerced) → `{ ok: true, items }` (Req 10.6).
    - The failure `message` is drawn from a small set of fixed safe constants — never a stack trace,
      file path, secret, environment value, or internal implementation detail (Req 10.5).
    - This module performs **no network request** of any kind (Req 9.6, 12.4).
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 9.6, 12.4_
  - [ ] 3.2 Implement `writeQueue`
    - Write `writeQueue(items): Promise<void>` that persists `serializeQueue(items)` under
      `STORAGE_KEYS.REVIEW_QUEUE` via `chrome.storage.local.set`; on failure it throws
      `ReviewQueueStorageError` (caught by the UI and surfaced as a recoverable error) — Req 9.3.
    - Writes happen only on explicit Operator mutations that started from a successful read; no
      read/parse failure ever overwrites the stored value implicitly (Req 10.4).
    - No network request; transmit nothing to the Worker_API or any external service (Req 9.6, 9.7,
      12.4).
    - _Requirements: 9.3, 9.4, 9.6, 9.7, 12.4_

- [ ] 4. Implement the `ReviewQueue` React panel in `extension/src/components/ReviewQueue.tsx`
  - [ ] 4.1 Build the save controls, list, and empty state
    - On mount, load the queue via `readQueue` and hold the queue + per-item edit state in local React
      state (following the existing `IntentScanner.tsx` / `DraftCoPilot.tsx` patterns).
    - **Save from Draft_Result**: when a Spec 06 `DraftResult` is available, a control saves it as a new
      Queue_Item via `createItemFromDraftResult` + `addItem`, then `writeQueue` (Req 1.1, 1.2, 1.3).
    - **Save manual draft**: a multi-line `<textarea>` + Save control creates a `manual` Queue_Item via
      `createManualItem` + `addItem`, with a live character counter against `MAX_QUEUE_DRAFT_TEXT`
      (Req 1.4); empty/whitespace → validation message and no item created (Req 1.7); over-bound or
      queue-full → validation message stating the applicable maximum and no item created (Req 8.2, 8.6).
    - Render all Queue_Items in `orderQueue` order, each row showing the Review_Status and a
      representation of the draft text (Req 6.1, 6.2, 6.3); when the queue is empty render an
      empty-state indicator stating no items are queued (Req 6.5).
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 6.1, 6.2, 6.3, 6.5, 8.2, 8.6_
  - [ ] 4.2 Build the per-item view, status selector, note editor, checklist, edit, and delete
    - **Per-item view**: render draft text, `mode` when present, captured `warnings` when present,
      captured `safety` when present, current `status`, `note` when present, and the `checklist`
      (Req 6.4).
    - **Status selector**: a control offering exactly the three `ReviewStatus` values; selecting one
      calls `setStatus` and persists via `writeQueue` (Req 3.2, 3.3, 3.5).
    - **Note editor**: add/edit/clear a Note (≤ `MAX_NOTE`) via `updateNote`, with a max-length
      validation message (Req 4.1, 4.2, 4.3, 4.5, 8.4); show the Note when non-empty.
    - **Checklist**: add (≤ `MAX_CHECKLIST_TEXT`, ≤ `MAX_CHECKLIST_ITEMS`), toggle, edit text, and
      remove entries via the Group 2 transforms, each persisted; over-bound add shows a validation
      message and creates no item (Req 5.1, 5.3, 5.4, 5.5, 8.4, 8.6).
    - **Edit draft text**: edit a Queue_Item's draft text via `editDraftText`; empty/whitespace or over
      `MAX_QUEUE_DRAFT_TEXT` → validation message and the existing draft text is left unchanged
      (Req 7.1, 7.2, 7.5, 8.2). **Delete**: remove a single Queue_Item by `id` via `deleteItem`
      (Req 7.3, 7.4).
    - **Recoverable storage error**: on a `read_error`/`parse_error` `QueueReadOutcome` or a thrown
      `ReviewQueueStorageError`, render a recoverable error state (with Retry) showing only the fixed
      safe message and never crashing (Req 10.2, 10.4, 10.5).
    - **Manual copy only**: the Operator may select/copy draft text for manual posting (e.g. via
      `navigator.clipboard.writeText`); render **no** post/submit/comment/vote/publish/auto-post
      control of any kind, and treat `approved_for_manual_use` as a review decision that
      publishes/schedules/transmits nothing (Req 12.7, 12.8). Use `role="alert"`/`aria-live` for
      validation and error messages, consistent with existing components.
    - _Requirements: 3.2, 3.3, 3.5, 4.1, 4.2, 4.3, 4.5, 5.1, 5.3, 5.4, 5.5, 6.4, 7.1, 7.2, 7.3, 7.4, 7.5, 8.4, 8.6, 10.2, 10.4, 10.5, 12.7, 12.8_

- [ ] 5. Wire `ReviewQueue` into the popup under the existing `OnboardingGate`
  - [ ] 5.1 Render `ReviewQueue` inside `Popup.tsx`, below `DraftCoPilot`, as a distinct section
    - Import and render `<ReviewQueue />` within the existing `<OnboardingGate>` body in
      `extension/src/popup/Popup.tsx`, **below** the existing `<IntentScanner />` and `<DraftCoPilot />`,
      as a section visually distinct from both (Req 11.1, 11.4). Because `OnboardingGate` renders its
      `children` only when onboarding `status === 'complete'` (fail-closed on `read_error`), the panel
      does not mount, render any list/control/input, or run any queue read/write/mutation logic
      (including `readQueue`) while onboarding is incomplete or in `read_error` (Req 11.2), and renders
      only when onboarding is complete (Req 11.3).
    - Do not change the `OnboardingGate`, the connection status check, the always-available Settings
      path, or the existing `IntentScanner` / `DraftCoPilot` rendering/behavior (Req 11.5, 13.1, 13.2,
      13.3, 13.5).
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 13.1, 13.2, 13.3, 13.5_

- [ ] 6. Write the unit, property-based, and component tests
  - [ ]* 6.1 Write the save / well-formed-item property test
    - In `extension/src/lib/review-queue.test.ts`, for any `DraftResult` or any manual draft with at
      least one non-whitespace character (with a deterministic stub `IdFactory`/`QueueClock`), assert
      the created item has a non-empty `id` unique within the queue, `status === 'needs_review'`,
      `created_at === updated_at`, and — when from a `DraftResult` — `draftText`/`mode`/`warnings`/
      `safety` equal to the source values.
    - **Property 1: Save Produces a Well-Formed Item with Default Status** — fast-check, ≥100
      iterations, tagged `// Feature: review-queue, Property 1: Save Produces a Well-Formed Item with Default Status`.
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3_
    - _Properties: 1_
  - [ ]* 6.2 Write the status-bounded / coercion property test
    - In `review-queue.test.ts`, for any arbitrary stored status string, assert `coerceStatus`
      returns one of the three `ReviewStatus` literals and maps any out-of-set value to `needs_review`.
    - **Property 2: Review Status Is Bounded to the Three Enumerated Values** — fast-check, ≥100
      iterations, tagged.
    - _Requirements: 3.1, 3.6_
    - _Properties: 2_
  - [ ]* 6.3 Write the status-transition single-target property test
    - In `review-queue.test.ts`, for any queue + chosen `id` + target status, assert `setStatus` sets
      only that item's `status` to the target value and leaves every other item's `status` unchanged;
      assert there is no automatic/scheduled status path (status changes only via an explicit call).
    - **Property 3: Status Transition Is Operator-Only and Targets Exactly One Item** — fast-check,
      ≥100 iterations, tagged.
    - _Requirements: 3.3, 3.4_
    - _Properties: 3_
  - [ ]* 6.4 Write the serialize/deserialize round-trip property test
    - In `review-queue.test.ts`, for any valid `QueueItem`, assert
      `deserializeQueue(serializeQueue([x]))[0]` deep-equals `x` across `id`, `draftText`, `mode`,
      `source`, `warnings`, `safety`, `status`, `note`, `checklist`, `created_at`, and `updated_at`.
    - **Property 4: Queue Item Serialize/Deserialize Round-Trip** — fast-check, ≥100 iterations,
      tagged.
    - _Requirements: 9.3, 9.4, 9.5_
    - _Properties: 4_
  - [ ]* 6.5 Write the delete single-target property test
    - In `review-queue.test.ts`, for any queue containing a given `id`, assert `deleteItem` produces a
      queue that contains every other original item unchanged, does not contain the targeted `id`, and
      has a count reduced by exactly one.
    - **Property 5: Delete Removes Exactly the Targeted Item** — fast-check, ≥100 iterations, tagged.
    - _Requirements: 7.4_
    - _Properties: 5_
  - [ ]* 6.6 Write the checklist-toggle single-target property test
    - In `review-queue.test.ts`, for any item + `checklistId` within it, assert `toggleChecklistItem`
      inverts the `checked` boolean of only that entry and leaves the `text` and `checked` of every
      other entry unchanged.
    - **Property 6: Checklist Toggle Flips Exactly One Item** — fast-check, ≥100 iterations, tagged.
    - _Requirements: 5.3_
    - _Properties: 6_
  - [ ]* 6.7 Write the advisory-edits property test
    - In `review-queue.test.ts`, for any item + any note/checklist operation (add, edit, clear,
      toggle, remove), assert the item's `status` and captured `safety` are unchanged.
    - **Property 7: Notes and Checklist Edits Are Advisory** — fast-check, ≥100 iterations, tagged.
    - _Requirements: 4.4, 5.6_
    - _Properties: 7_
  - [ ]* 6.8 Write the storage-bounds property test and the boundary unit tests
    - In `review-queue.test.ts`, for any save/edit, assert the Review_Queue rejects draft text > 10000,
      a Note > 2000, a Checklist_Item text > 280, a checklist count > 50 per item, and a total count >
      200, creating/updating no item that would breach those bounds; at-or-under inputs are accepted.
    - Add boundary unit tests at 0/1/280/281/2000/2001/10000/10001 characters, 50/51 checklist items,
      and 200/201 queue items, plus empty-vs-whitespace-only draft text (both `empty`).
    - **Property 8: Storage Bounds Are Enforced** — fast-check, ≥100 iterations, tagged (+ boundary
      units).
    - _Requirements: 8.2, 8.4, 8.6_
    - _Properties: 8_
  - [ ]* 6.9 Write the read/parse safe-failure property + example tests
    - In `extension/src/lib/review-queue-storage.test.ts`, mock `chrome.storage.local` to throw and to
      return junk: assert `readQueue` returns a typed `read_error`/`parse_error` whose `message`
      contains no stack trace, file path, secret, environment value, or internal detail (scan against
      a forbidden-pattern list, ≥100 iterations over arbitrary thrown/junk values), and that the
      stored value is **not overwritten** on `parse_error`.
    - Add the example cases: missing key → `{ ok: true, items: [] }`; read throws → `read_error`;
      present-but-unparseable → `parse_error` with no overwrite; one malformed item dropped while
      well-formed items are retained; message is leak-free.
    - **Property 9: Read and Parse Failures Yield a Safe Failure State** — fast-check, ≥100 iterations,
      tagged (+ examples).
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_
    - _Properties: 9_
  - [ ]* 6.10 Write the no-network property test
    - In `review-queue-storage.test.ts` (and/or `review-queue.test.ts`), spy on `globalThis.fetch`
      (and `XMLHttpRequest`) and assert **0** calls across random queue operations (save, list, view,
      status-change, edit, delete); assert no Queue_Item/Note/Checklist_Item is transmitted anywhere.
    - **Property 10: No Network for Any Queue Operation** — fast-check, ≥100 iterations, tagged.
    - _Requirements: 9.6, 9.7, 12.4_
    - _Properties: 10_
  - [ ]* 6.11 Write the `ReviewQueue` component tests
    - In `extension/src/components/ReviewQueue.test.tsx`, drive the panel with React Testing Library:
      assert save-from-`DraftResult` and save-manual (with counter + empty/over-bound/queue-full
      validation) create items (Req 1.x, 8.2, 8.6); assert the list renders in `orderQueue` order and
      the empty-state indicator renders when empty (Req 6.1–6.3, 6.5); assert the per-item view shows
      captured `warnings`/`safety`/`mode`/`status`/`note`/`checklist` (Req 6.4).
    - Assert the three-value status selector calls `setStatus` and persists (Req 3.2, 3.3, 3.5); the
      note editor add/edit/clear (Req 4); checklist add/toggle/edit/remove single-target behavior
      (Req 5); edit-draft and delete (Req 7); the recoverable storage-error state on `read_error`/
      `parse_error` with a leak-free message (Req 10.2, 10.4, 10.5); and that there is **no**
      post/submit/comment/vote/publish/auto-post control (Req 12.7, 12.8).
    - **Property 9 (UI slice): Safe Failure State** — tagged where applicable.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 3.2, 3.3, 3.5, 4.1, 4.2, 4.3, 4.5, 5.1, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 8.2, 8.4, 8.6, 10.2, 10.4, 10.5, 12.7, 12.8_
    - _Properties: 9_
  - [ ]* 6.12 Extend `Popup.test.tsx` for gate behavior and section preservation
    - In `extension/src/popup/Popup.test.tsx`, assert that with **incomplete** onboarding and with the
      **`read_error`** state the `ReviewQueue` does not render (no queue list/control/input) and
      `readQueue` is **not invoked**, and that with **completed** onboarding the `ReviewQueue` renders
      as a section distinct from `IntentScanner` and `DraftCoPilot` while their rendering/behavior and
      the connection status are preserved (Req 11.2, 11.3, 11.4, 11.5).
    - **Property 13: Gate Containment** — tagged where applicable.
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 13.5_
    - _Properties: 13_

- [ ] 7. Extend the security-boundary tests for Spec 07 scope and permission containment
  - [ ]* 7.1 Add Spec 07 manifest permission-containment assertions
    - Extend `extension/src/security-boundary.test.ts` with a Spec 07 block asserting
      `manifest.permissions` equals exactly `['storage']` and `manifest.host_permissions` equals
      exactly the three approved entries (`https://*.workers.dev/*`, `http://localhost/*`,
      `http://127.0.0.1/*`) byte-for-byte, and that `manifest.content_scripts` remains `undefined` —
      proving Spec 07 added no permission or host.
    - **Property 12: Permission Containment.**
    - _Requirements: 12.1, 13.6_
    - _Properties: 12_
  - [ ]* 7.2 Add Spec 07 forbidden-scope token, no-network, and no-posting-control assertions
    - Extend `security-boundary.test.ts` with a Spec 07 source-file list (`src/types/index.ts`,
      `src/lib/review-queue.ts`, `src/lib/review-queue-storage.ts`,
      `src/components/ReviewQueue.tsx`, `src/popup/Popup.tsx`) and assert none of them — nor the
      manifest — contains the forbidden-scope tokens `reddit.com`, `old.reddit.com`, `chrome.alarms`,
      `chrome.notifications`, `content_scripts`, `firecrawl`, `scraping`, `ip rotation`, and `/v1/`
      (matched case-insensitively; the queue is storage-only and references no `/v1` endpoint).
    - Do **not** scan bare `openai` / `llm` as Spec 07 tokens: like the Spec 06 block, if these appear
      they would only be inside file-header compliance doc comments ("no OpenAI / LLM / AI provider"),
      so a bare-substring scan would false-positive on documentation rather than a real violation. The
      no-AI guarantee is instead enforced positively by the no-network scan below and the no-AI
      provider usage in the source. (If the implementation keeps the modules free of those doc tokens,
      they may be included; otherwise drop them to avoid false positives.)
    - Assert the queue logic + storage + component files (`review-queue.ts`, `review-queue-storage.ts`,
      `ReviewQueue.tsx`) contain no `fetch(` / `authenticatedfetch(` / `xmlhttprequest` call form
      (Req 9.6, 12.4), and that `ReviewQueue.tsx` contains none of the posting/automation tokens
      (`upvote`, `downvote`, `/api/submit`, `/api/comment`, `/api/vote`, `submitform`, `autopost`,
      `auto-post`, `auto_submit`) — the panel's only data egress is the local clipboard for manual copy
      (Req 12.7, 12.8).
    - **Property 10: No Network for Any Queue Operation** and **Property 11: Manual-Input-Only Scope.**
    - _Requirements: 9.6, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_
    - _Properties: 10, 11_

- [ ] 8. Final validation — execute typecheck, tests, and build for both packages
  - [ ] 8.1 Run and report the full extension and worker-api verification
    - Execute, in this exact order, and report the outcome of each command:
      ```
      cd extension && npm run typecheck && npm run test && npm run build
      cd ../worker-api && npm run typecheck && npm run test && npm run build
      ```
    - For the `extension` package, run `npm run typecheck`, then `npm run test` (single-run, no watch),
      then `npm run build`; for the `worker-api` package, run `npm run typecheck`, then `npm run test`,
      then `npm run build`. Fix any failures so that, for **both** packages, typecheck passes, every
      Vitest suite passes — including the Spec 07 property tests at ≥100 iterations alongside the unit,
      component, and security-boundary tests, and the existing Spec 01–06 suites unchanged — and
      `npm run build` completes successfully.
    - Confirm the manifest `permissions`/`host_permissions` remain byte-for-byte unchanged and that
      there are **no** worker-api changes / no new `/v1` route (Req 12.4, 13.6), then produce a
      validation report stating the final **extension** and **worker-api** test counts and the build
      results for both packages (Req 13.7–13.11).
    - **Property 14: Preserved Behavior of Specs 01–06.**
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11_
    - _Properties: 14_

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; the unmarked
  tasks are the core implementation and must be completed. Top-level tasks are never optional.
- Each task references the specific requirement sub-clauses it satisfies, and each property test
  sub-task references the exact Correctness Property (P1–P14) from `requirements.md` / `design.md`
  Section 10–11, with the requirements clause it checks.
- Property-based tests use **fast-check** (already an extension devDependency — no dependency change
  needed), run a minimum of **100 iterations**, and carry the
  `// Feature: review-queue, Property {n}: {property text}` tag (`design.md` Section 11). The pure
  transforms are made test-deterministic by passing a stub `IdFactory`/`QueueClock`; determinism in
  this spec applies to the transforms over an existing item, not to id/timestamp creation.
- Property → test placement: P1–P8 → `review-queue.test.ts`; P4, P9, P10 → `review-queue-storage.test.ts`
  (P4 round-trip may live in either; P9/P10 cover the storage adapter); P9 (UI slice) → `ReviewQueue.test.tsx`;
  P11, P12 → `security-boundary.test.ts`; P13 → `Popup.test.tsx`; P14 → the Group 8 validation run.
- The plan adds **no** manifest permission, **no** Worker route or `/v1` endpoint, **no** worker-api
  change, **no** network/AI/LLM call, **no** background/`chrome.alarms`/`chrome.notifications`, **no**
  content script, and **no** posting/automation control; every queue operation is local, manual,
  Operator-driven, and persisted only in `chrome.storage.local`.
- The captured Spec 06 `mode`/`warnings`/`safety` are stored **verbatim** at save time; the
  Review_Queue recomputes no compliance verdict (Req 1.8), and Spec 06's `DraftMode`/`DraftResult`/
  `ComplianceWarning` types are reused without modification.
- This workflow produces planning artifacts only. To begin implementation, open `tasks.md` and click
  "Start task" next to a task item.
