# Implementation Plan — Spec 08-A: Compliance Activity Log & Export (Local, Append-Only, Extension-UI-Only)

## Overview

This plan implements the **local, bounded, append-only Compliance Activity_Log & Export** described in
`requirements.md` and `design.md`. Work proceeds in strict dependency order: shared **types and
constants** first, then the pure **log transformation module** (`activity-log.ts`), then the thin
**storage adapter** (`activity-log-storage.ts`), then the **best-effort non-blocking recorder**
(`activity-recorder.ts`), then the **local export delivery** (`activity-export.ts`), then the
**`ActivityLog` React panel**, then **popup wiring** and the four **Source_Action integrations** inside
the existing `OnboardingGate`, then the **property/unit/component tests**, the **security-boundary**
extensions, and finally **full validation** of both packages.

Every operation — append, read, FIFO trim, list, clear, serialize, export — runs **entirely locally**
with **no network call**, **no AI provider**, and **no `chrome.downloads`**. The log logic is split
into **pure functions** (`activity-log.ts`) that never touch storage, and a thin **storage adapter**
(`activity-log-storage.ts`) that reads/writes `chrome.storage.local` using the same typed, fail-safe
pattern as Spec 03's `onboarding-storage.ts` and Spec 07's `review-queue-storage.ts`. The pure
transforms take **injected** `LogClock` / `IdFactory` parameters so they stay deterministic given their
inputs (`design.md` Section 5.3); production callers pass `crypto.randomUUID()`-style ids and
`new Date().toISOString()`. Logging is **best-effort and non-blocking**: the `recordActivity` wrapper
swallows every failure so a log write can never block, delay, reverse, or alter the original
Review_Queue or Draft_Co_Pilot action (Req 3; Property 5).

Scope is strictly bounded: Extension UI only, passive recording only, local export only. There is **no**
Reddit API, DOM scraping, content script, crawling, Firecrawl, IP rotation, `chrome.alarms`,
`chrome.notifications`, `chrome.downloads`, background processing, `reddit.com` host permission,
manifest permission expansion, automated Reddit action, posting/auto-post control, AI-provider call,
new `/v1` Worker route, or worker-api change. Export delivery uses **only** `navigator.clipboard.
writeText` and/or an in-page `Blob` object-URL anchor (`<a download>`) download.

All file paths follow `design.md` Section 2. No manifest permission is added; the existing
`permissions: ["storage"]` and `host_permissions` (`https://*.workers.dev/*`, `http://localhost/*`,
`http://127.0.0.1/*`) remain byte-for-byte unchanged, and that invariant is itself tested (Group 8).
Tests use the existing **Vitest + React Testing Library** stack and **fast-check** (already an
extension devDependency — no dependency change needed) for property tests, each running a **minimum of
100 iterations** and tagged `// Feature: activity-log-export, Property {n}: {property text}` per
`design.md` Section 11.

## Task Dependency Graph / Ordering

```
1 (types + constants: Activity Log Types (Spec 08-A) + STORAGE_KEYS.ACTIVITY_LOG)
 └─> 2 (activity-log.ts: createEntry, clampSummary, appendEntry (FIFO trim),
        orderNewestFirst, toJsonDocument, toMarkdownDocument,
        serializeLog/deserializeLog — all PURE)
        ├─> 3 (activity-log-storage.ts: readLog → LogReadOutcome,
        │      writeLog, clearLog, ActivityLogStorageError — chrome.storage.local only)
        │      └─> 4 (activity-recorder.ts: recordActivity — best-effort, non-blocking)
        │             └─> 6 (Popup wiring + 4 Source_Action integrations)
        └─> 5 (activity-export.ts: clipboardExport, downloadExport — local only, no chrome.downloads)
               └─> 6b (ActivityLog.tsx panel — list/export/clear; consumes 2,3,5)
                      └─> 6 (Popup.tsx wiring inside OnboardingGate, below ReviewQueue)
                             │
        ┌────────────────────┴────────────────────┐
        ▼                                          ▼
   7 (tests + PBT: activity-log.test.ts,        8 (security-boundary.test.ts
      activity-log-storage.test.ts,                extension — manifest preservation
      activity-recorder.test.ts,                   + forbidden-scope/no-network/
      activity-export.test.ts,                     no-chrome.downloads/no-posting scans)
      ActivityLog.test.tsx, Popup.test.tsx)
        └────────────────────┬─────────────────────┘
                             ▼
                   9 (full validation: extension + worker-api
                      typecheck + test + build; report counts/results)
```

- Group 1 is the foundation for every later group.
- Group 2 (pure logic) depends only on Group 1; Group 3 (storage adapter) calls Group 2's
  `serializeLog`/`deserializeLog`; Group 4 (recorder) calls Groups 2 and 3; Group 5 (export) calls
  Group 2's renderers.
- Group 6 wires the `ActivityLog` panel (6b) into the popup under the existing gate, below
  `IntentScanner`/`DraftCoPilot`/`ReviewQueue`, and adds the four best-effort `recordActivity`
  integrations into the existing Source_Actions.
- Group 7 validates the pure logic, storage adapter, recorder, export, and integrated UI. Group 8 is
  static and needs only that the Group 2–6 source files exist.
- Group 9 is the final whole-repo verification of both packages (Req 12.7–12.11).
- `fast-check` is already present in the extension dev dependencies (no dependency change needed)
  before Group 7 property tests run.

## Tasks

- [ ] 1. Add Activity Log shared types and constants to `extension/src/types/index.ts`
  - In a new `// --- Activity Log Types (Spec 08-A) ---` section, add the types from `design.md`
    Section 4: `ActionType` (`'onboarding_completed' | 'draft_saved' | 'status_changed' |
    'draft_copied'`), `SummaryParts` (`{ itemId?; status?; detail? }`), `ActivityEntry`
    (`{ id; type; created_at; summary }`), `ActivityLog` (`ActivityEntry[]`), `ExportFormat`
    (`'json' | 'markdown'`), and `LogReadOutcome` (`{ ok: true; entries } | { ok: false; error:
    'read_error' | 'parse_error'; message }`).
  - Reuse the Spec 07 `ReviewStatus` type **verbatim** for the `SummaryParts.status` descriptor; do
    **not** modify any existing Spec 01–07 type.
  - Define the bound constants single-sourced so transforms, the UI, and tests share them:
    `MAX_LOG_ENTRIES = 500` (Req 4.1, 4.2) and `MAX_SUMMARY_LEN = 280` (Req 4.3).
  - Add exactly one new entry `ACTIVITY_LOG: 'rma_activity_log'` to the existing `STORAGE_KEYS`
    object, preserving the `rma_` prefix convention and leaving the existing `WORKER_API_BASE_URL`,
    `ONBOARDING`, and `REVIEW_QUEUE` entries unchanged (Req 8.1, 8.2). Append only; change no
    manifest-related value.
  - _Requirements: 1.5, 2.1, 2.2, 4.1, 4.3, 5.x, 8.1, 8.2, 9.1, 12.5_

- [ ] 2. Implement the pure log logic in `extension/src/lib/activity-log.ts`
  - [ ] 2.1 Implement entry creation, summary clamp, and the injected `LogClock` / `IdFactory` seams
    - Define the injected-dependency interfaces `LogClock { now(): string }` and
      `IdFactory { create(): string }` so the transforms stay pure and test-deterministic
      (`design.md` Section 5.3).
    - Write `clampSummary(text)` returning `text` unchanged when within `MAX_SUMMARY_LEN`, otherwise a
      value truncated to at most `MAX_SUMMARY_LEN` characters (Req 4.3).
    - Write `createEntry(type, summaryParts, clock, ids)` that sets `id = ids.create()`, `type`,
      `created_at = clock.now()`, and `summary = clampSummary(renderSummary(type, summaryParts))`,
      where the summary is assembled only from non-sensitive descriptors (Action_Type label,
      `ReviewStatus`, `QueueItem` id, short `detail`) and never includes full draft text, Note text,
      credentials, or tokens (Req 1.5, 1.6, 2.1, 2.2, 4.3, 5.7).
    - All functions MUST be pure: no `Date`/`Date.now`/`Math.random`/`crypto`/`chrome.storage`/global
      mutable state beyond the injected `clock`/`ids`, and no `fetch`/`authenticatedFetch` or any AI
      provider.
    - _Requirements: 1.5, 1.6, 2.1, 2.2, 4.3, 5.7_
  - [ ] 2.2 Implement `appendEntry` with FIFO bound and `orderNewestFirst`
    - Write `appendEntry(log, entry)` that returns a **new** log equal to `log` with `entry` appended;
      when the result would exceed `MAX_LOG_ENTRIES`, remove the **oldest** entries first (FIFO) so the
      result holds exactly `MAX_LOG_ENTRIES` of the most recent entries and preserves their relative
      order (Req 4.1, 4.2, 4.4). It never mutates its argument and exposes no in-place entry edit
      (Req 2.3, 2.4).
    - Write `orderNewestFirst(log)` returning a stable, deterministic order — `created_at` descending,
      then `id` ascending as a total-order tiebreak — without mutating the input (Req 7.1).
    - _Requirements: 2.3, 2.4, 4.1, 4.2, 4.4, 7.1_
  - [ ] 2.3 Implement deterministic JSON/Markdown export renderers and serialize/deserialize
    - Write `toJsonDocument(log)` producing a deterministic JSON string (stable key order, fixed
      indentation) including every retained entry's `id`, `type`, `created_at`, and `summary`, valid
      for an empty log (Req 5.1, 5.3, 5.5, 5.6).
    - Write `toMarkdownDocument(log)` producing a deterministic, human-readable Markdown document
      rendering every retained entry's `type`, `created_at`, and `summary` in newest-first order, valid
      for an empty log (Req 5.2, 5.4, 5.5, 5.6).
    - Both renderers operate only over the redaction-safe `ActivityEntry` fields, so neither emits a
      credential, token, full draft text, or full Note text (Req 5.7).
    - Write `serializeLog(log)` mapping the log to a plain JSON-safe structure, and
      `deserializeLog(raw): ActivityEntry[]` that validates each entry with a runtime shape guard (in
      the spirit of `isAcknowledgementRecord`), **drops** any malformed individual entry, and retains
      the well-formed entries (Req 8.4, 9.6). These remain pure so
      `deserializeLog(serializeLog([x]))[0]` deep-equals `x` across `id`, `type`, `created_at`, and
      `summary` (Req 8.4).
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 8.4, 9.6_

- [ ] 3. Implement the storage adapter in `extension/src/lib/activity-log-storage.ts`
  - [ ] 3.1 Implement `readLog` and `ActivityLogStorageError`
    - Define `class ActivityLogStorageError extends Error` (parallels `OnboardingStorageError` /
      `ReviewQueueStorageError`).
    - Write `readLog(): Promise<LogReadOutcome>` mirroring the typed fail-safe read:
      `await chrome.storage.local.get(STORAGE_KEYS.ACTIVITY_LOG)` inside `try/catch`; a thrown read →
      `{ ok: false, error: 'read_error', message }` with a **fixed safe** message (Req 9.2, 9.5); a
      missing/`undefined` value → `{ ok: true, entries: [] }` (Req 9.3); a present but
      non-array/unparseable value → `{ ok: false, error: 'parse_error', message }` **without
      overwriting** the stored value (Req 9.4); a present array → `deserializeLog` (malformed entries
      dropped) → `{ ok: true, entries }` (Req 9.6).
    - The failure `message` is drawn from a small set of fixed safe constants — never a stack trace,
      file path, secret, environment value, or internal implementation detail (Req 9.5).
    - This module performs **no network request** of any kind (Req 8.5, 11.4).
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 8.5, 11.4_
  - [ ] 3.2 Implement `writeLog` and `clearLog`
    - Write `writeLog(entries): Promise<void>` that persists `serializeLog(entries)` under
      `STORAGE_KEYS.ACTIVITY_LOG` via `chrome.storage.local.set`; on failure it throws
      `ActivityLogStorageError` (Req 8.3).
    - Write `clearLog(): Promise<void>` that persists an empty array under the same key (Req 7.4, 7.5).
    - No read/parse failure ever overwrites the stored value implicitly. No network request; transmit
      nothing to the Worker_API or any external service (Req 8.5, 8.6, 11.4).
    - _Requirements: 7.4, 7.5, 8.3, 8.5, 8.6, 11.4_

- [ ] 4. Implement the best-effort, non-blocking recorder in `extension/src/lib/activity-recorder.ts`
  - Write `recordActivity(type, summaryParts): void` that performs the read-modify-write inside a guard
    that **swallows every error**: `readLog` (degrade a read failure to an empty list / skip), build the
    entry via `createEntry` with the real `crypto.randomUUID`-style `IdFactory` and a
    `new Date().toISOString()` `LogClock`, then `writeLog(appendEntry(current, entry))` — all wrapped so
    nothing rethrows into the caller (Req 3.1, 3.2, 3.3).
  - The helper is fire-and-forget (returns `void`, safe to call without `await`); the success of any
    Source_Action MUST NOT be contingent on the append succeeding (Req 3.4; Property 5). On a
    `read_error`, skip the append rather than overwriting the corrupt stored value (Req 9.4).
  - No network request; no AI provider; no `chrome.downloads` (Req 11.4, 11.5, 11.6).
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 9.4, 11.4_

- [ ] 5. Implement local export delivery in `extension/src/lib/activity-export.ts`
  - Write `clipboardExport(doc): Promise<void>` calling `navigator.clipboard.writeText(doc)`
    (Clipboard_Export) — Req 6.1.
  - Write `downloadExport(doc, filename, mime): void` (Download_Export) that creates
    `new Blob([doc], { type: mime })`, generates an object URL via `URL.createObjectURL`, binds it to an
    in-page `<a download={filename}>` element, triggers the download, and calls `URL.revokeObjectURL`
    afterward (Req 6.1, 6.3).
  - This module MUST NOT use `chrome.downloads` for any export (Req 6.2, 11.5), MUST make no network
    request, and MUST transmit no Export_Document off the device (Req 6.4). It requires no new manifest
    permission (Req 6.5, 11.1).
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 11.1, 11.5_

- [ ] 6. Implement the `ActivityLog` panel and wire it + the four Source_Action integrations
  - [ ] 6.1 Build the `ActivityLog` React panel in `extension/src/components/ActivityLog.tsx`
    - On mount, load the log via `readLog` and hold the entries + UI state in local React state
      (following the existing `ReviewQueue.tsx` pattern).
    - **List + empty state**: render all retained entries in `orderNewestFirst` order, each row showing
      the Action_Type, the `created_at`, and the Summary (Req 7.1, 7.2); when empty render an empty-state
      indicator stating no activity has been recorded (Req 7.3).
    - **Export controls**: Export-as-JSON and Export-as-Markdown affordances, each offering **Copy to
      clipboard** (`clipboardExport`) and **Download** (`downloadExport` via in-page `Blob` anchor with
      object-URL revoke); **no** `chrome.downloads` (Req 5.1, 5.2, 6.1, 6.2, 6.3).
    - **Clear control**: clear the entire log via `clearLog` and re-render the empty state (Req 7.4,
      7.5).
    - **Recoverable storage error**: on a `read_error`/`parse_error` `LogReadOutcome` or a thrown
      `ActivityLogStorageError`, render a recoverable error state (with Retry) showing only the fixed
      safe message and never crashing (Req 9.2, 9.4, 9.5).
    - **Passive only**: render **no** post/submit/comment/vote/publish/auto-post control of any kind;
      use `role="alert"`/`aria-live` for error messages, consistent with existing components
      (Req 11.7, 11.8).
    - _Requirements: 5.1, 5.2, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 7.4, 7.5, 9.2, 9.4, 9.5, 11.7, 11.8_
  - [ ] 6.2 Wire `ActivityLog` into the popup and add the four best-effort Source_Action integrations
    - Import and render `<ActivityLog />` within the existing `<OnboardingGate>` body in
      `extension/src/popup/Popup.tsx`, **below** `<IntentScanner />`, `<DraftCoPilot />`, and
      `<ReviewQueue />`, as a section visually distinct from all three (Req 10.1, 10.4). Because
      `OnboardingGate` renders `children` only when onboarding `status === 'complete'` (fail-closed on
      `read_error`), the panel does not mount, render any list/export/clear control, or run any log
      read/append/trim/clear logic (including `readLog`) while onboarding is incomplete or in
      `read_error` (Req 10.2), and renders only when onboarding is complete (Req 10.3).
    - Add four **additive, best-effort, non-blocking** `recordActivity(...)` calls **after** each
      existing Source_Action has already succeeded, without `await`: `onboarding_completed` after the
      Spec 03 Acknowledgement_Record persists; `draft_saved` after a Spec 07 `writeQueue` succeeds;
      `status_changed` (with the new `status`) after a Spec 07 status write succeeds; `draft_copied`
      after a draft copy completes (Req 1.1, 1.2, 1.3, 1.4, 3.1).
    - Do not change the `OnboardingGate`, the connection status check, the Settings path, or the
      existing `IntentScanner` / `DraftCoPilot` / `ReviewQueue` rendering/behavior beyond the additive
      best-effort log calls (Req 10.5, 12.1, 12.2, 12.3, 12.5).
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1, 10.1, 10.2, 10.3, 10.4, 10.5, 12.1, 12.2, 12.3, 12.5_

- [ ] 7. Write the unit, property-based, and component tests
  - [ ]* 7.1 Write the well-formed-entry property test
    - In `extension/src/lib/activity-log.test.ts`, for any `ActionType` + `SummaryParts` (with a
      deterministic stub `IdFactory`/`LogClock`), assert the created entry has a non-empty unique `id`,
      an enumerated `type`, a non-empty ISO 8601 `created_at`, and a `summary` within `MAX_SUMMARY_LEN`
      that contains none of a forbidden sensitive-token set.
    - **Property 1: Append Produces a Well-Formed, Bounded-Type Entry** — fast-check, ≥100 iterations,
      tagged.
    - _Requirements: 1.5, 1.6, 2.1, 2.2, 4.3_
    - _Properties: 1_
  - [ ]* 7.2 Write the pure-append and FIFO-bound property tests
    - In `activity-log.test.ts`, assert `appendEntry` returns a new log, does not mutate its input, and
      adds exactly one entry subject to trim (**Property 2**); and for any append sequence assert the
      result length ≤ `MAX_LOG_ENTRIES`, the oldest entries are dropped first, the most recent are
      retained, and the retained relative order is preserved (**Property 3**). Add boundary units at
      `MAX_LOG_ENTRIES - 1`, `MAX_LOG_ENTRIES`, and `MAX_LOG_ENTRIES + 1`.
    - fast-check, ≥100 iterations, tagged.
    - _Requirements: 1.7, 2.3, 4.1, 4.2, 4.4, 8.4_
    - _Properties: 2, 3_
  - [ ]* 7.3 Write the append-only property test
    - In `activity-log.test.ts`, assert no transform other than a full clear changes an existing
      entry's `id`, `type`, `summary`, or `created_at`.
    - **Property 4: Append-Only — No In-Place Entry Mutation** — fast-check, ≥100 iterations, tagged.
    - _Requirements: 2.3, 2.4_
    - _Properties: 4_
  - [ ]* 7.4 Write the export determinism, completeness, and redaction property tests
    - In `activity-log.test.ts`, for any log and format assert `toJsonDocument` / `toMarkdownDocument`
      include every retained entry's fields for that format and are byte-identical across repeated
      exports (**Property 6**), and assert every produced document contains none of a forbidden
      sensitive-token set (**Property 7**). Include the empty-log case for both formats (Req 5.5).
    - fast-check, ≥100 iterations, tagged.
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7, 1.6_
    - _Properties: 6, 7_
  - [ ]* 7.5 Write the serialize/deserialize round-trip property test
    - In `activity-log.test.ts`, for any valid `ActivityEntry`, assert
      `deserializeLog(serializeLog([x]))[0]` deep-equals `x` across `id`, `type`, `created_at`, and
      `summary`.
    - **Property 8: Entry Serialize/Deserialize Round-Trip** — fast-check, ≥100 iterations, tagged.
    - _Requirements: 8.4_
    - _Properties: 8_
  - [ ]* 7.6 Write the non-blocking recorder test
    - In `extension/src/lib/activity-recorder.test.ts`, mock `readLog`/`writeLog` to throw and assert
      `recordActivity` does **not** throw, returns synchronously, and a simulated caller action proceeds
      and completes unchanged; assert that a `read_error` causes the append to be skipped without
      overwriting the stored value.
    - **Property 5: Logging Never Blocks or Alters the Source Action** — fast-check over arbitrary
      thrown errors, ≥100 iterations, tagged.
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
    - _Properties: 5_
  - [ ]* 7.7 Write the export-delivery and no-network tests
    - In `extension/src/lib/activity-export.test.ts`, assert `clipboardExport` calls
      `navigator.clipboard.writeText`; assert `downloadExport` creates a `Blob`, calls
      `URL.createObjectURL`, clicks an in-page anchor, and calls `URL.revokeObjectURL`, and that
      `chrome.downloads` is **never** referenced (**Property 11**). Spy on `globalThis.fetch` (and
      `XMLHttpRequest`) and assert **0** calls across export and log operations (**Property 10**).
    - fast-check, ≥100 iterations, tagged.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 8.5, 8.6, 11.4, 11.5_
    - _Properties: 10, 11_
  - [ ]* 7.8 Write the read/parse safe-failure property + example tests
    - In `extension/src/lib/activity-log-storage.test.ts`, mock `chrome.storage.local` to throw and to
      return junk: assert `readLog` returns a typed `read_error`/`parse_error` whose `message` contains
      no stack trace, file path, secret, environment value, or internal detail (scan against a
      forbidden-pattern list, ≥100 iterations), and that the stored value is **not overwritten** on
      `parse_error`. Add example cases: missing key → `{ ok: true, entries: [] }`; read throws →
      `read_error`; present-but-unparseable → `parse_error` with no overwrite; one malformed entry
      dropped while well-formed entries retained.
    - **Property 9: Read and Parse Failures Yield a Safe Failure State** — fast-check, ≥100 iterations,
      tagged (+ examples).
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_
    - _Properties: 9_
  - [ ]* 7.9 Write the `ActivityLog` component tests
    - In `extension/src/components/ActivityLog.test.tsx`, drive the panel with React Testing Library:
      assert the list renders in `orderNewestFirst` order with type/created_at/summary and the
      empty-state indicator renders when empty (Req 7.1–7.3); assert JSON and Markdown export via
      clipboard (`clipboardExport`) and via the in-page `Blob` anchor (`downloadExport`, with
      `revokeObjectURL`) and that `chrome.downloads` is never used (Req 5.1, 5.2, 6.1, 6.2, 6.3); assert
      clear empties the log (Req 7.4, 7.5); assert the recoverable storage-error state on
      `read_error`/`parse_error` with a leak-free message (Req 9.2, 9.4, 9.5); and assert there is
      **no** post/submit/comment/vote/publish/auto-post control (Req 11.7, 11.8).
    - _Requirements: 5.1, 5.2, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 7.4, 7.5, 9.2, 9.4, 9.5, 11.7, 11.8_
    - _Properties: 9, 11_
  - [ ]* 7.10 Extend `Popup.test.tsx` for gate behavior, section preservation, and non-blocking logging
    - In `extension/src/popup/Popup.test.tsx`, assert that with **incomplete** onboarding and with the
      **`read_error`** state the `ActivityLog` does not render (no list/export/clear control) and
      `readLog` is **not invoked**, and that with **completed** onboarding the `ActivityLog` renders as a
      section distinct from `IntentScanner`, `DraftCoPilot`, and `ReviewQueue` while their
      rendering/behavior and the connection status are preserved (Req 10.2, 10.3, 10.4, 10.5).
    - Assert that a failing `recordActivity` (mocked to throw internally) does not break a Source_Action
      flow — the queue save / status change / copy still completes (Req 3.2; Property 5).
    - **Property 14: Gate Containment** and **Property 5** — tagged where applicable.
    - _Requirements: 3.2, 10.2, 10.3, 10.4, 10.5, 12.5_
    - _Properties: 5, 14_

- [ ] 8. Extend the security-boundary tests for Spec 08-A scope and permission containment
  - [ ]* 8.1 Add Spec 08-A manifest permission-containment assertions
    - Extend `extension/src/security-boundary.test.ts` with a Spec 08-A block asserting
      `manifest.permissions` equals exactly `['storage']` and `manifest.host_permissions` equals exactly
      the three approved entries (`https://*.workers.dev/*`, `http://localhost/*`, `http://127.0.0.1/*`)
      byte-for-byte, that `manifest.content_scripts` remains `undefined`, and that there is **no**
      `downloads`, `alarms`, `notifications`, `clipboardWrite`, or `tabs` permission — proving Spec 08-A
      added no permission or host.
    - **Property 12: Permission Containment.**
    - _Requirements: 11.1, 12.6_
    - _Properties: 12_
  - [ ]* 8.2 Add Spec 08-A forbidden-scope, no-network, no-chrome.downloads, and no-posting assertions
    - Extend `security-boundary.test.ts` with a Spec 08-A source-file list (`src/types/index.ts`,
      `src/lib/activity-log.ts`, `src/lib/activity-log-storage.ts`, `src/lib/activity-recorder.ts`,
      `src/lib/activity-export.ts`, `src/components/ActivityLog.tsx`, `src/popup/Popup.tsx`) and assert
      none of them — nor the manifest — contains the forbidden-scope tokens `reddit.com`,
      `old.reddit.com`, `chrome.alarms`, `chrome.notifications`, `chrome.downloads`, `content_scripts`,
      `firecrawl`, `scraping`, `ip rotation`, and `/v1/` (matched case-insensitively).
    - Assert the log/storage/recorder/export/component files (`activity-log.ts`,
      `activity-log-storage.ts`, `activity-recorder.ts`, `activity-export.ts`, `ActivityLog.tsx`)
      contain no `fetch(` / `authenticatedfetch(` / `xmlhttprequest` call form (Req 8.5, 11.4), and that
      `activity-export.ts` references no `chrome.downloads` (Req 6.2, 11.5) — its only egress is the
      local clipboard / in-page `Blob` anchor.
    - Assert `ActivityLog.tsx` contains none of the posting/automation tokens (`upvote`, `downvote`,
      `/api/submit`, `/api/comment`, `/api/vote`, `submitform`, `autopost`, `auto-post`, `auto_submit`).
      As in the Spec 06/07 blocks, bare `openai` / `llm` are not scanned to avoid false-positives on
      compliance doc comments; the no-AI guarantee is enforced positively by the no-network scan.
    - **Property 10: No Network**, **Property 11: Local-Only Export — No chrome.downloads**, and
      **Property 13: Passive-Scope Containment.**
    - _Requirements: 6.2, 8.5, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_
    - _Properties: 10, 11, 13_

- [ ] 9. Final validation — execute typecheck, tests, and build for both packages
  - [ ] 9.1 Run and report the full extension and worker-api verification
    - Execute, in this exact order, and report the outcome of each command:
      ```
      cd extension && npm run typecheck && npm run test && npm run build
      cd ../worker-api && npm run typecheck && npm run test && npm run build
      ```
    - For the `extension` package, run `npm run typecheck`, then `npm run test` (single-run, no watch),
      then `npm run build`; for the `worker-api` package, run `npm run typecheck`, then `npm run test`,
      then `npm run build`. Fix any failures so that, for **both** packages, typecheck passes, every
      Vitest suite passes — including the Spec 08-A property tests at ≥100 iterations alongside the
      unit, component, and security-boundary tests — and both builds succeed.
    - Report the final Extension and Worker_API test counts and the build results (Req 12.7–12.11).
    - _Requirements: 12.7, 12.8, 12.9, 12.10, 12.11_
