# Implementation Plan — Spec 05: Intent Scanner (Manual Input Only)

## Overview

This plan implements the **local, deterministic, Extension-UI-only** Intent_Scanner described in
`requirements.md` and `design.md`. The work is test-driven where it pays off: each pure module
(`normalizeText`, `classifyIntent`, `extractCandidates`) is written first, then immediately covered by
unit tests and property-based tests, before being composed by the `analyzeInput` orchestrator and wired
into the UI. The single permitted network call — the optional, operator-triggered `POST /v1/compare`
lookup — reuses the **existing** `authenticatedFetch` in `extension/src/lib/api-client.ts` and is built
last so the local analysis path is fully proven first.

Scope is strictly bounded by the corrected Spec 05: extension UI only, manual paste/type input only.
There is **no** Worker `/v1/scan`, Reddit API, RSS/RSS fallback, `chrome.alarms`, `chrome.notifications`,
background scanner, content script, `reddit.com` host permission, manifest permission expansion,
scraping/crawling/Firecrawl/IP rotation, automated Reddit action, draft generation, or AI-provider call.
The aligned `IntentCategory` set is `coupon-seeking`, `deal-seeking`, `product-comparison`,
`generic-discussion`, `irrelevant` (where `irrelevant` = no-signal, confidence `0.0`).

All file paths below follow the placement in `design.md` Section 3. No manifest permission is added; the
existing `permissions: ["storage"]` and `host_permissions` (`https://*.workers.dev/*`,
`http://localhost/*`, `http://127.0.0.1/*`) remain unchanged, and that invariant is itself tested
(Group 10). Tests use the existing **Vitest + React Testing Library** stack and the already-installed
**fast-check** (3.23.2) for property tests, each running a **minimum of 100 iterations** and tagged with
`// Feature: intent-scanner, Property {n}: {property text}` per `design.md` Section 10.

## Task Dependency Graph / Ordering

```
1 (types)
 ├─> 2 (normalizeText) ─┐
 ├─> 3 (classifyIntent) ┤
 └─> 4 (extractCandidates) ┘
        │
        ▼
   [Checkpoint A — task 5 wraps pure modules]
        │
   5 (analyzeInput orchestrator) ──> 7 (IntentScanner panel) ──> 8 (Popup wiring)
        │                                  ▲
   6 (runCompareLookup, reuses 1 + existing client) ─┘ (optional compare branch in panel)
        │
        ▼
   9 (UI/behavioral tests: needs 5,6,7,8)
   10 (manifest/security-boundary tests: independent of UI; extends existing test)
        │
        ▼
   [Checkpoint B]
        │
   11 (full verification: lint + typecheck + test)
```

- Group 1 is the foundation for every later group.
- Groups 2–4 are independent of each other and can be written in any order after Group 1.
- Group 5 composes Groups 2–4. Group 6 depends only on Group 1 and the existing client.
- Group 7 consumes Groups 5 and 6; Group 8 wires Group 7 into the popup.
- Group 9 validates the integrated UI; Group 10 is independent and can run any time after Group 1.
- Group 11 is the final whole-extension verification.

## Tasks

- [x] 1. Add Intent Scanner shared types to `extension/src/types/index.ts`
  - In a new `// --- Intent Scanner Types (Spec 05) ---` section, add the analysis types from
    `design.md` Section 5: `IntentCategory` (the five aligned values: `coupon-seeking`, `deal-seeking`,
    `product-comparison`, `generic-discussion`, `irrelevant`), `Confidence` (the Confidence_Value numeric
    type, invariant `0.0..1.0`), `CandidateType` (`keyword` | `tool_mention` | `merchant_mention` |
    `coupon_signal`), and `DetectedCandidate` (`{ type: CandidateType; value: string }`).
  - Add the local-analysis result types: `Classification` (`{ category; confidence }`), `InputValidation`
    (`valid` | `empty` | `too_long`), and the fresh-per-run scan result `AnalyzeResult`
    (`invalid` | `analyzed` discriminated union — the ScanResult concept).
  - Add the Compare request/response types mirroring the existing worker-api Spec 04 contract:
    `CompareRequestBody`, `CompareCandidate`, `CompareMatch`, `CompareResponse`, and the
    `CompareOutcome` discriminated union (`idle` | `loading` | `success` | `failure`) that reuses the
    existing `ApiError` categories.
  - Do not modify any existing type; only append. Do not change `STORAGE_KEYS` or manifest-related values.
  - _Requirements: 3.1, 3.2, 4.2, 5.4, 5.5, 5.6, 6.5_

- [x] 2. Implement deterministic text normalization
  - [x] 2.1 Implement `normalizeText` in `extension/src/lib/intent-normalizer.ts`
    - Write a pure function `normalizeText(input: string): string` that lower-cases, collapses each run of
      consecutive whitespace into a single space, and trims leading/trailing whitespace, using only
      local, in-memory operations.
    - MUST NOT read `Date`, `Date.now()`, `performance.now()`, `Math.random()`, `crypto.*`,
      `chrome.storage`, or any global mutable state, and MUST NOT call `fetch`/`authenticatedFetch`.
    - _Requirements: 2.1, 2.4, 2.5_
  - [x]* 2.2 Write unit tests for `normalizeText`
    - Cover case folding, internal whitespace collapse (spaces, tabs, newlines), and leading/trailing trim
      with concrete examples in `extension/src/lib/intent-normalizer.test.ts`.
    - _Requirements: 2.4_
  - [x]* 2.3 Write property test: normalization determinism and idempotence
    - **Property 1: Normalization Determinism and Idempotence** — for any string, `normalize(s)` equals
      `normalize(s)`, and `normalize(normalize(s)) === normalize(s)`.
    - **Validates: Requirements 2.2, 2.3**
  - [x]* 2.4 Write property test: normalization performs no network call
    - **Property 7 (normalizer slice): No Network Without Operator Compare Trigger** — spy on
      `globalThis.fetch`; for any input, `normalizeText` triggers zero fetch calls.
    - **Validates: Requirements 2.1, 2.5**

- [x] 3. Implement deterministic intent classification
  - [x] 3.1 Implement `classifyIntent` in `extension/src/lib/intent-classifier.ts`
    - Write a pure function `classifyIntent(normalized: string): Classification` that assigns exactly one
      `IntentCategory` and a bounded `Confidence` via deterministic keyword/signal scoring over fixed
      signal tables; derive the result solely from the normalized input.
    - When no signal matches, return `{ category: 'irrelevant', confidence: 0.0 }`. Clamp confidence so the
      result is always within `0.0..1.0` inclusive.
    - MUST NOT use any hidden input (no `Date`, randomness, storage) and MUST NOT call
      `fetch`/`authenticatedFetch`.
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6_
  - [x]* 3.2 Write unit tests for the no-signal and representative-signal cases
    - Assert no-signal/whitespace-only normalized text yields `irrelevant` with confidence `0.0`, and one
      representative example per category yields that category, in
      `extension/src/lib/intent-classifier.test.ts`.
    - _Requirements: 3.1, 3.5_
  - [x]* 3.3 Write property test: classification determinism
    - **Property 2: Classification Determinism** — for any normalized text, `classifyIntent(x)` deep-equals
      `classifyIntent(x)` on repeated invocations; assert the fetch spy records zero calls.
    - **Validates: Requirements 3.3, 3.4, 3.6**
  - [x]* 3.4 Write property test: single category invariant
    - **Property 3: Single Category Invariant** — for any normalized text, the returned `category` is a
      member of the `IntentCategory` set and exactly one category is assigned; no-signal input maps to
      `irrelevant`.
    - **Validates: Requirements 3.1, 3.5**
  - [x]* 3.5 Write property test: confidence bound invariant
    - **Property 4: Confidence Bound Invariant** — for any input, `0.0 <= confidence <= 1.0`.
    - **Validates: Requirements 3.2, 3.5**

- [x] 4. Implement deterministic candidate extraction
  - [x] 4.1 Implement `extractCandidates` in `extension/src/lib/intent-extractor.ts`
    - Write a pure function `extractCandidates(normalized: string): DetectedCandidate[]` that produces zero
      or more candidates, each with a `type` from `CandidateType` and a string `value`.
    - Deduplicate by `(type, value)` and sort by a fixed total order (by `type`, then by `value` in UTF-16
      code-unit order) so identical input always yields an identical, identically ordered list.
    - MUST NOT use hidden inputs and MUST NOT call `fetch`/`authenticatedFetch`.
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6_
  - [x]* 4.2 Write unit tests for dedupe, ordering, and each candidate type
    - Assert duplicates are removed, output is sorted by the documented rule, and at least one example of
      each `CandidateType` is produced, in `extension/src/lib/intent-extractor.test.ts`.
    - _Requirements: 4.2, 4.4, 4.5_
  - [x]* 4.3 Write property test: extraction determinism and ordering
    - **Property 5: Candidate Extraction Determinism and Ordering** — for any normalized text, repeated
      calls return an identical, identically ordered list, and the list equals its own re-sort by
      `(type, value)`.
    - **Validates: Requirements 4.3, 4.4**
  - [x]* 4.4 Write property test: candidate uniqueness invariant
    - **Property 6: Candidate Uniqueness Invariant** — for any output list, no two items share both `type`
      and `value`, and every item's `type` is a member of the `CandidateType` set.
    - **Validates: Requirements 4.2, 4.5**
  - [x]* 4.5 Write property test: extraction performs no network call
    - **Property 7 (extractor slice): No Network Without Operator Compare Trigger** — fetch spy records
      zero calls for any input.
    - **Validates: Requirements 4.6**

- [x] 5. Implement the local analysis orchestrator (`analyzeInput`)
  - [x] 5.1 Implement `validateInput` and `analyzeInput`
    - Add a pure `validateInput(input: string): InputValidation` (returns `empty` for zero non-whitespace
      characters, `too_long` for length > 10000, otherwise `valid`) and a pure
      `analyzeInput(input: string): AnalyzeResult` that composes `validateInput` → `normalizeText` →
      (`classifyIntent`, `extractCandidates`), placed alongside the pure modules (e.g.
      `extension/src/lib/intent-analyzer.ts`).
    - `analyzeInput` MUST return a **fresh** `AnalyzeResult` computed only from the current `input` on every
      call, holding no module-level mutable state, so it can never reuse a stale result from a previous
      input. It MUST call no network function.
    - _Requirements: 1.3, 1.4, 1.5, 2.1, 3.1, 4.1_
  - [x]* 5.2 Write unit tests for orchestration and freshness
    - Assert empty/whitespace input yields `invalid: empty`, input > 10000 chars yields `invalid: too_long`,
      and valid input yields an `analyzed` result whose `classification` and `candidates` match calling the
      pure functions directly; assert that calling `analyzeInput` with input B after input A returns B's
      result (no stale reuse).
    - _Requirements: 1.3, 1.4, 1.5_
  - [x]* 5.3 Write property test: orchestration is deterministic and network-free
    - **Property 7 (orchestrator slice): No Network Without Operator Compare Trigger** — for any input,
      `analyzeInput` produces a deterministic result and the fetch spy records zero calls.
    - **Validates: Requirements 2.1, 2.5, 3.4, 4.6, 5.7**

- [x] 6. Implement the optional Compare client wrapper (`runCompareLookup`)
  - [x] 6.1 Implement `runCompareLookup` in `extension/src/lib/intent-compare.ts`
    - Write `runCompareLookup(baseUrl: string, request: CompareRequestBody): Promise<CompareOutcome>` that
      delegates the network call to the **existing** `authenticatedFetch(baseUrl, '/v1/compare', { method:
      'POST', body: JSON.stringify(request) })` from `extension/src/lib/api-client.ts`. Do not add any new
      endpoint, credential store, or manifest permission, and do not modify `api-client.ts`.
    - Map outcomes to the `CompareOutcome` union: HTTP 200 + valid `CompareResponse` → `success`; thrown
      error / no credentials / network failure → `failure` with `ApiError.type: 'network'`; abort/timeout →
      `'timeout'`; non-200 → `'server'` (carry `status`); unparseable body → `'parse'`. Never include the
      install token or secrets in error messages.
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.8_
  - [x]* 6.2 Write tests for the Compare wrapper using a mocked `authenticatedFetch`
    - **Property 8: Compare Reuses Existing Client and Contract** — mock `authenticatedFetch`; assert it is
      the call path with path `'/v1/compare'`, `POST` method, and a JSON `CompareRequestBody`, called
      exactly once per trigger; assert HTTP 200 maps to `success` and each failure mode (thrown/network,
      timeout, non-200, parse) maps to the correct `failure` category.
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 5.8**

- [x] 7. Implement the `IntentScanner` React panel
  - [x] 7.1 Build the panel in `extension/src/components/IntentScanner.tsx`
    - Render a multi-line `<textarea>` (accepting up to 10000 characters) with a live character counter and
      an **Analyze** button; hold input and result in local React component state fed solely from the
      textarea value.
    - On Analyze, call `analyzeInput`; render validation messages for empty/whitespace-only input and for
      input over 10000 characters (withholding any result), and show the initial/empty state before any
      analysis.
    - Display the `IntentCategory` label and `Confidence` value, the `DetectedCandidate` list as
      `type: value` (or a "No candidates detected" indicator when empty), and always render the four
      Compliance_Reminders alongside results. Use `role="alert"`/`aria-live` for validation/failure
      messages, consistent with existing components.
    - Add a **Compare with CouponsRiver** control shown after a successful local analysis that calls
      `runCompareLookup`; render a loading state, then on success the match count and each match, and on
      failure a categorized indicator that does **not** remove the local results.
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 5.1, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 8. Wire `IntentScanner` into the popup
  - [x] 8.1 Render `IntentScanner` inside `Popup.tsx` under the existing `OnboardingGate`
    - Import and render `<IntentScanner />` within the existing `<OnboardingGate>` body in
      `extension/src/popup/Popup.tsx` (alongside the connection status), so the analysis surface stays
      unavailable until Compliance_Onboarding is complete. Do not change the onboarding gate, the status
      check, or the always-available Settings path.
    - _Requirements: 6.6, 7.5, 8.1_

- [x] 9. Checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Write UI/behavioral tests for the integrated panel
  - [x]* 10.1 Write the full UI-flow example tests
    - In `extension/src/components/IntentScanner.test.tsx`, drive the panel with React Testing Library:
      type valid input, click Analyze, and assert the category, confidence, candidate list (and the
      empty-candidate indicator), and all four compliance reminders render; assert the presence of the
      input control and the Compare control.
    - _Requirements: 1.1, 5.1, 6.1, 6.2, 6.3, 6.4, 6.6, 7.1, 7.2, 7.3, 7.4, 7.5_
  - [x]* 10.2 Write the Compare UI test with a mocked `authenticatedFetch`
    - Mock `authenticatedFetch`; click Compare and assert the success outcome renders match count and
      matches, and that a mocked failure renders a categorized indicator while the local category,
      confidence, and candidate list remain visible (Req 5.6).
    - _Requirements: 5.1, 5.5, 5.6, 6.5_
  - [x]* 10.3 Write behavioral guards: no partial results and no stale reuse
    - Assert a failed Compare produces **no** partial candidates and never discards local results; assert
      submitting empty/whitespace input shows the validation message and does **not** reuse a cached or
      previous analysis result; with a `globalThis.fetch` spy, assert that performing local analysis
      without clicking Compare triggers zero network requests.
    - **Property 7: No Network Without Operator Compare Trigger** (UI/local-path slice).
    - **Validates: Requirements 1.4, 5.6, 5.7, 5.8**

- [x] 11. Extend the security-boundary tests for scope and permission containment
  - [x]* 11.1 Add manifest permission-containment assertions
    - Extend `extension/src/security-boundary.test.ts` to assert `manifest.permissions` equals exactly
      `['storage']` and `manifest.host_permissions` equals exactly the three approved entries
      (`https://*.workers.dev/*`, `http://localhost/*`, `http://127.0.0.1/*`), proving no new permission was
      added by Spec 05.
    - **Property 10: Permission Containment.**
    - **Validates: Requirements 8.1, 8.11**
  - [x]* 11.2 Add manual-input-only scope-exclusion assertions
    - Extend the static source checks to assert Spec 05 source and the manifest contain none of:
      `/v1/scan`, Reddit API usage, RSS, `chrome.alarms`, `chrome.notifications`, `content_scripts`,
      `reddit.com`/`old.reddit.com` host references, Firecrawl/scraping/IP-rotation, automated Reddit
      actions, draft generation, or OpenAI/LLM/AI-provider references; confirm `manifest.content_scripts`
      remains undefined.
    - **Property 9: Manual-Input-Only Scope.**
    - **Validates: Requirements 1.6, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10**

- [x] 12. Final verification
  - [x] 12.1 Run typecheck, tests, and build for both the `extension` and `worker-api` packages
    - Run the established project verification commands, in this exact order, covering **both** packages:
      ```
      cd extension && npm run typecheck && npm run test && npm run build
      cd ../worker-api && npm run typecheck && npm run test && npm run build
      ```
    - For the `extension` package, run `npm run typecheck`, then `npm run test`, then `npm run build` in
      that order; for the `worker-api` package, run `npm run typecheck`, then `npm run test`, then
      `npm run build` in that order.
    - Fix any failures so that, for **both** packages, `npm run typecheck` passes, every `npm run test`
      (Vitest) suite passes — including the property-based tests at >=100 iterations alongside the unit,
      UI, and security-boundary tests — and `npm run build` completes successfully.
    - _Requirements: 8.1, 8.11_

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; the unmarked
  tasks are the core implementation and must be completed.
- Each task references the specific requirement sub-clauses it satisfies, and property tests reference the
  exact Correctness Property (P1–P10) from `requirements.md` / `design.md` Section 11.
- Property-based tests use the already-installed **fast-check** (3.23.2), run a minimum of 100 iterations,
  and carry the `// Feature: intent-scanner, Property {n}: {property text}` tag.
- The plan adds **no** manifest permission and **no** new endpoint, credential store, background context,
  content script, or AI/LLM call; the only network request is the optional, operator-triggered
  `POST /v1/compare` via the existing `authenticatedFetch`.
- This workflow produces planning artifacts only. To begin implementation, open `tasks.md` and click
  "Start task" next to a task item.
