# Implementation Plan — Spec 06: Draft Co-Pilot (Local, Deterministic, Extension-UI-Only)

## Overview

This plan implements the **local, deterministic, Extension-UI-only** Draft_Co_Pilot described in
`requirements.md` and `design.md`. Work proceeds in strict dependency order: shared **types and
constants** first, then the two pure logic modules — **`draft-compliance.ts`** (disclosure,
concealing-language, no-link, prohibited-language, savings-provenance, warnings + safety verdict) and
**`draft-generator.ts`** (deterministic template generation that calls the validator) — then the
**`DraftCoPilot` React panel**, then **popup wiring** inside the existing `OnboardingGate`, then the
**property/unit/component tests**, the **security-boundary** extensions, and finally **full
validation** of both packages.

Draft generation is a **pure, synchronous, deterministic function** (`generateDraft`): no Web Worker,
no MV3 background drafting, no randomness, no timestamps, no network, and no AI/LLM provider.
Determinism applies to **successful** generation only; an internal error or resource constraint
returns a typed `FailureState` carrying a safe fixed message and **no** stack trace, file path,
secret, environment value, internal detail, or stale/partial draft text.

Scope is strictly bounded: extension UI only, manual paste/type input only. There is **no** Worker
draft endpoint, **no** `/v1/draft` route, **no** network-based drafting, **no** Reddit API, DOM
scraping, content script, crawling, Firecrawl, IP rotation, `chrome.alarms`, `chrome.notifications`,
background generation, `reddit.com` host permission, manifest permission expansion, automated Reddit
action, posting control, or AI-provider call. The optional Spec 05 Intent_Context and Spec 04
Compare_Context are consumed **verbatim** without modifying Specs 04/05.

All file paths follow `design.md` Section 2. No manifest permission is added; the existing
`permissions: ["storage"]` and `host_permissions` (`https://*.workers.dev/*`, `http://localhost/*`,
`http://127.0.0.1/*`) remain byte-for-byte unchanged, and that invariant is itself tested (Group 7).
Tests use the existing **Vitest + React Testing Library** stack and **fast-check** for property tests,
each running a **minimum of 100 iterations** and tagged
`// Feature: draft-co-pilot, Property {n}: {property text}` per `design.md` Section 12.

## Task Dependency Graph / Ordering

```
1 (types + constants)
 └─> 2 (draft-compliance.ts: stripUrls, containsConcealingLanguage,
        containsProhibitedLanguage, validateCompliance)
        └─> 3 (draft-generator.ts: validateDraftInput, generateDraft —
               calls validateCompliance)
               └─> 4 (DraftCoPilot.tsx panel — calls generateDraft)
                      └─> 5 (Popup.tsx wiring inside OnboardingGate,
                             below IntentScanner)
                             │
        ┌────────────────────┴────────────────────┐
        ▼                                          ▼
   6 (tests + PBT: draft-generator.test.ts,   7 (security-boundary.test.ts
      draft-compliance.test.ts,                  extension — manifest preservation
      DraftCoPilot.test.tsx, Popup.test.tsx)     + forbidden-scope tokens; independent
        │                                          of UI, needs only 2,3 source present)
        └────────────────────┬─────────────────────┘
                             ▼
                   8 (full validation: extension + worker-api
                      typecheck + test + build; report counts/results)
```

- Group 1 is the foundation for every later group (types reused from Specs 04/05).
- Group 2 (compliance) is pure and depends only on Group 1; Group 3 (generator) calls Group 2's
  `validateCompliance`, so 2 precedes 3.
- Group 4 (panel) consumes Group 3; Group 5 wires Group 4 into the popup under the existing gate.
- Group 6 validates the pure logic and the integrated UI (needs Groups 2–5). Group 7 is static and
  needs only that the Group 2/3/4/5 source files exist; it can run any time after Group 5.
- Group 8 is the final whole-repo verification of both packages (Req 13.7–13.11).
- `fast-check` must be present in the extension dev dependencies before Group 6 property tests run
  (see sub-task 6.1).

## Tasks

- [ ] 1. Add Draft Co-Pilot shared types and constants to `extension/src/types/index.ts`
  - In a new `// --- Draft Co-Pilot Types (Spec 06) ---` section, add the types from `design.md`
    Section 4: `DraftMode` (`'no-link-authority' | 'soft-cta-with-disclosure' | 'disclosed-link'`),
    `IntentContext` (reusing Spec 05 `Classification` + `DetectedCandidate[]`), `CompareContext`
    (alias of the existing Spec 04 `CompareResponse`), and `DraftInput`
    (`sourceText`, `mode`, optional `couponsRiverUrl`, optional `intentContext`, optional
    `compareContext`).
  - Add `DraftInputValidation` (`valid` | `empty` | `too_long` with `max: 10000` | `no_mode`),
    `ComplianceWarningId` (the eight ids: `manual_review`, `subreddit_rules`, `no_automated_action`,
    `disclosure_required`, `missing_link`, `add_link_manually`, `unsafe_concealing`,
    `unsafe_no_disclosure`), `ComplianceWarning` (`{ id; message }`), `DraftResult`
    (`{ kind: 'draft'; mode; draftText; warnings[]; safety: 'safe' | 'unsafe' }`), and `FailureState`
    (`{ kind: 'failure'; code: 'generation_error' | 'resource_limit'; message }`).
  - Define the fixed string constants used by the deterministic generator and validator so they are
    single-sourced: `MAX_SOURCE_LENGTH = 10000` (Req 1.7, 1.8; mirrors Spec 05 `MAX_INPUT_LENGTH`),
    the fixed affiliation Disclosure text (e.g. "Full disclosure: I'm affiliated with CouponsRiver."),
    and the fixed `ComplianceWarning` message strings keyed by `ComplianceWarningId`. Co-locate
    `MAX_SOURCE_LENGTH` with the generator module per `design.md` Section 3 and export it; keep the
    Disclosure and warning-message strings as exported constants so both modules and tests reuse them.
  - Reuse Spec 05 (`Classification`, `DetectedCandidate`, `IntentCategory`) and Spec 04
    (`CompareResponse`, `CompareMatch`, `CompareCandidate`) verbatim; do not modify any existing type.
    Only append; do not change `STORAGE_KEYS` or any manifest-related value.
  - _Requirements: 1.2, 1.3, 1.4, 1.7, 1.8, 2.1, 3.6, 7.5, 7.6, 9.1, 13.4, 13.5_

- [ ] 2. Implement the pure compliance/safety helpers in `extension/src/lib/draft-compliance.ts`
  - [ ] 2.1 Implement `stripUrls`, `containsConcealingLanguage`, and `containsProhibitedLanguage`
    - Write a pure `stripUrls(text: string): string` that removes any URL / external link from a
      string (used to enforce the No_Link_Authority and Soft_CTA no-URL guarantees, Req 4.2, 5.3).
    - Write a pure `containsConcealingLanguage(text: string): boolean` backed by a fixed
      Concealing_Language table containing at least "not affiliated", "i just found this", "randomly
      came across", "no connection to them", and "not sponsored" (matched case-insensitively),
      detecting language that conceals/obscures/contradicts the Disclosure (Req 7.4).
    - Write a pure `containsProhibitedLanguage(text: string): boolean` backed by a fixed
      Prohibited_Language table covering spammy urgency, manipulation, impersonation, and fabricated
      personal-experience phrases (Req 8.1, 8.3).
    - All three MUST be pure: no `Date`/`Date.now`/`performance.now`/`Math.random`/`crypto`/
      `chrome.storage`/global mutable state, and MUST NOT call `fetch`/`authenticatedFetch` or any AI
      provider.
    - _Requirements: 4.2, 5.3, 7.4, 8.1, 8.3_
  - [ ] 2.2 Implement `validateCompliance`
    - Write `validateCompliance(mode, draftText, context): { warnings: ComplianceWarning[]; safety }`
      that always emits `manual_review`, `subreddit_rules`, and `no_automated_action` (Req 9.1–9.3),
      adds `disclosure_required` for promotional modes (Req 7.3, 9.4), adds `add_link_manually` for
      `soft-cta-with-disclosure` (Req 5.4), and adds `missing_link` for `disclosed-link` with no
      Operator URL (Req 6.3, 9.5).
    - Compute the safety verdict: a Promotional_Draft is `'safe'` **iff** it includes the affiliation
      Disclosure **AND** `containsConcealingLanguage` is false; otherwise `'unsafe'` with
      `unsafe_no_disclosure` (missing Disclosure, Req 7.6) and/or `unsafe_concealing` (concealing
      language present even when a Disclosure exists, Req 7.5). Non-promotional drafts are `'safe'`.
    - Keep the function pure (no network/AI/hidden inputs), reusing the exported Disclosure and
      warning-message constants from Group 1.
    - _Requirements: 5.4, 6.3, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.2, 8.5, 9.1, 9.2, 9.3, 9.4, 9.5_

- [ ] 3. Implement the deterministic draft generator in `extension/src/lib/draft-generator.ts`
  - [ ] 3.1 Implement `validateDraftInput`
    - Write a pure `validateDraftInput(input: DraftInput): DraftInputValidation` returning `empty` for
      a Source_Text with zero non-whitespace characters (Req 1.6), `too_long` (`max: 10000`) when the
      Source_Text exceeds `MAX_SOURCE_LENGTH` (Req 1.7, 1.8), `no_mode` when no Draft_Mode is selected
      (Req 2.2), otherwise `valid`.
    - _Requirements: 1.6, 1.7, 1.8, 2.2_
  - [ ] 3.2 Implement `generateDraft` (pure, synchronous, deterministic)
    - Write `generateDraft(input: DraftInput): DraftResult | FailureState` that, for valid input,
      derives deterministic facets from `sourceText` (fixed truncation/first-sentence rule),
      deterministically folds in optional `intentContext` (fixed category→phrase + candidate mapping,
      Req 3.9) and optional `compareContext` (savings facts drawn **solely** from
      `compareContext.matches`, Req 3.10, 8.2, 8.5), selects the fixed per-mode template (Section 6),
      inserts the Disclosure for promotional modes, sanitizes via `stripUrls` and omits any
      Prohibited_Language / Concealing_Language, then attaches warnings + safety via
      `validateCompliance` (Group 2).
    - Enforce per-mode rules: **No_Link_Authority** excludes every URL and CouponsRiver CTA and
      includes general advice only when expressible without a link, otherwise omits/rewrites it as
      non-linked guidance (Req 4.1–4.5); **Soft_CTA_With_Disclosure** includes Disclosure + general
      CouponsRiver suggestion and no direct link (Req 5.1–5.3); **Disclosed_Link** includes Disclosure
      and the Operator-supplied URL **only** when provided, never invents a URL, and emits no URL when
      none supplied (Req 6.1–6.4).
    - Guarantee determinism for success: no `Date`/`Date.now`/`performance.now`/`Math.random`/
      `crypto`/`chrome.storage`/global mutable state, no `fetch`/`authenticatedFetch`, no AI provider;
      identical valid `DraftInput` yields a byte-identical `DraftResult` (Req 3.1–3.5).
    - Produce a safe fallback `DraftResult` from `sourceText` + `mode` alone when neither optional
      context is present (Req 3.11). The function **never throws**: any internal error or resource
      constraint is caught and mapped to a typed `FailureState` whose `message` is a fixed safe string
      containing no stack trace, file path, secret, environment value, or internal detail, and no
      draft text (Req 3.6, 3.7).
    - _Requirements: 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.9, 3.10, 3.11, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4, 7.1, 8.1, 8.2, 8.3, 8.4, 8.5_

- [ ] 4. Implement the `DraftCoPilot` React panel in `extension/src/components/DraftCoPilot.tsx`
  - [ ] 4.1 Build the inputs, mode selector, and Generate action
    - Render a multi-line `<textarea>` for **Source_Text** with a live character counter and a
      `MAX_SOURCE_LENGTH` (10000) limit (Req 1.1, 1.7), an optional **CouponsRiver URL** field
      (Req 1.4), and optional **Intent_Context** / **Compare_Context** inputs that the Operator
      pastes/loads in the Spec 05 / Spec 04 result shapes and that are structurally validated before
      use (Req 1.2, 1.3). Hold input and the latest result in local React state fed solely from the
      panel's own controls (Req 1.5), following the existing `IntentScanner.tsx` patterns.
    - Render a **Draft_Mode selector** offering exactly the three Reply_Modes with the current
      selection displayed (Req 2.1, 2.4). On the synchronous **Generate** action, clear any prior
      result first, then call `generateDraft` synchronously (Req 2.3, 3.1, 3.8).
    - Show validation messages and withhold generation for empty/whitespace Source_Text (Req 1.6),
      over-limit Source_Text (Req 1.8), and no mode selected (Req 2.2), using `role="alert"`/
      `aria-live` consistent with existing components.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.1, 2.2, 2.3, 2.4, 3.1_
  - [ ] 4.2 Render the draft preview, warnings, safety banner, and failure indicator
    - Display the generated `draftText` in a **selectable** read-only control so the Operator can
      manually select and copy it (Req 10.1, 10.2), plus a **Copy** button using
      `navigator.clipboard.writeText` (no new manifest permission required; selection remains the
      fallback) (Req 10.4, 10.5).
    - Always render the `ComplianceWarning` list with a result (Req 9.1–9.5); render a prominent
      "not ready — needs fixing" banner when `safety === 'unsafe'` (Req 7.5, 7.6). Render **no**
      post/submit/comment/publish/auto-post control of any kind (Req 10.3, 12.8, 12.9).
    - On a `FailureState`, render only the safe failure indicator and **no** stale or partial draft
      text from any prior or in-progress generation (Req 3.7, 3.8).
    - _Requirements: 3.7, 3.8, 7.5, 7.6, 9.1, 9.2, 9.3, 9.4, 9.5, 10.1, 10.2, 10.3, 10.4, 10.5, 12.8, 12.9_

- [ ] 5. Wire `DraftCoPilot` into the popup under the existing `OnboardingGate`
  - [ ] 5.1 Render `DraftCoPilot` inside `Popup.tsx`, below `IntentScanner`, as a distinct section
    - Import and render `<DraftCoPilot />` within the existing `<OnboardingGate>` body in
      `extension/src/popup/Popup.tsx`, **below** the existing `<IntentScanner />`, as a section
      visually distinct from the Intent_Scanner (Req 11.1, 11.4). Because `OnboardingGate` renders its
      `children` only when onboarding `status === 'complete'` (fail-closed on `read_error`), the panel
      does not mount, render any input/control/preview, or run any draft logic while onboarding is
      incomplete or in `read_error` (Req 11.2), and renders only when onboarding is complete (Req 11.3).
    - Do not change the onboarding gate, the connection status check, the always-available Settings
      path, or the existing Intent_Scanner rendering/behavior (Req 11.5, 13.1, 13.3, 13.5).
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 13.1, 13.3, 13.5_

- [ ] 6. Write the unit, property-based, and component tests
  - [ ]* 6.1 Add `fast-check` to the extension dev tooling and write the determinism property test
    - If `fast-check` is not already in `extension/package.json` `devDependencies`, add it (matching
      the `worker-api` version, `3.23.2`) so property tests can run; do not add any runtime dependency.
    - In `extension/src/lib/draft-generator.test.ts`, write the determinism property test plus an
      explicit example asserting that two `generateDraft` calls on identical valid `DraftInput` return
      deep-equal successful `DraftResult` values (byte-identical `draftText`, equal `warnings`/
      `safety`); add a static assertion that the draft modules reference none of `Date`, `Date.now`,
      `performance.now`, `Math.random`, `crypto`.
    - **Property 1: Successful Draft Generation Determinism** — fast-check, ≥100 iterations, tagged
      `// Feature: draft-co-pilot, Property 1: Successful Draft Generation Determinism`.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
    - _Properties: 1_
  - [ ]* 6.2 Write the no-network / no-AI property test
    - In `draft-generator.test.ts`, spy on `globalThis.fetch` and assert **0** calls across random
      `DraftInput`; assert no AI/LLM provider is invoked.
    - **Property 2: No Network and No AI in Draft Generation** — fast-check, ≥100 iterations, tagged.
    - _Requirements: 3.3, 3.4, 12.10, 12.11_
    - _Properties: 2_
  - [ ]* 6.3 Write the No-Link Authority property test
    - In `draft-generator.test.ts`, for any input in `no-link-authority` mode (including inputs whose
      Source_Text/URL field contains URLs), assert the resulting `draftText` contains **no** URL and
      **no** CouponsRiver CTA.
    - **Property 3: No-Link Authority Excludes Promotion** — fast-check, ≥100 iterations, tagged.
    - _Requirements: 4.2, 4.3_
    - _Properties: 3_

  - [ ]* 6.4 Write the Disclosed-Link URL-provenance property test
    - In `draft-generator.test.ts`, assert a `disclosed-link` draft contains a CouponsRiver URL **iff**
      the Operator supplied one; when none is supplied, assert the draft contains no URL and the
      `missing_link` warning is present, and assert the generator never invents a URL.
    - **Property 5: Disclosed Link URL Provenance** — fast-check, ≥100 iterations, tagged.
    - _Requirements: 6.2, 6.3, 6.4, 9.5_
    - _Properties: 5_
  - [ ]* 6.5 Write the Soft-CTA property test
    - In `draft-generator.test.ts`, for any `soft-cta-with-disclosure` input, assert the draft includes
      a general CouponsRiver suggestion and the affiliation Disclosure and contains **no** direct
      coupon link / URL.
    - **Property 6: Soft CTA Excludes Direct Links** — fast-check, ≥100 iterations, tagged.
    - _Requirements: 5.2, 5.3_
    - _Properties: 6_
  - [ ]* 6.6 Write the prohibited-language property test
    - In `draft-generator.test.ts`, inject Prohibited_Language phrases into the Source_Text and assert
      they are absent from the `draftText`; assert no guaranteed-savings claim appears unless the
      `compareContext` explicitly supports it.
    - **Property 7: Prohibited Language Is Never Produced** — fast-check, ≥100 iterations, tagged.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
    - _Properties: 7_
  - [ ]* 6.7 Write the safe-fallback property test
    - In `draft-generator.test.ts`, for any valid Source_Text + mode with **no** Intent_Context and
      **no** Compare_Context, assert generation succeeds with a mode-conformant `DraftResult` (no error,
      no missing required content for that mode).
    - **Property 9: Safe Fallback Without Optional Context** — fast-check, ≥100 iterations, tagged.
    - _Requirements: 3.9, 3.10, 3.11_
    - _Properties: 9_
  - [ ]* 6.8 Write the safe-failure-state property test
    - In `draft-generator.test.ts`, inject a failing internal dependency so generation fails and assert
      a typed `FailureState` is returned with no draft text and a message free of stack traces, file
      paths, secrets, environment values, and internal details (scan against a forbidden-pattern list).
    - **Property 9a: Safe Failure State** — fast-check, ≥100 iterations, tagged.
    - _Requirements: 3.6, 3.7, 3.8_
    - _Properties: 9a_
  - [ ]* 6.9 Write generator validation unit tests (edge cases)
    - In `draft-generator.test.ts`, cover `validateDraftInput` boundaries: 0, 1, 10000, and 10001
      characters; empty-string vs whitespace-only Source_Text (both `empty`); and no Draft_Mode
      selected (`no_mode`).
    - _Requirements: 1.6, 1.7, 1.8, 2.2_

  - [ ]* 6.10 Write the promotional-disclosure property test
    - In `extension/src/lib/draft-compliance.test.ts`, for any promotional-mode draft, assert the
      affiliation Disclosure is present and that no Promotional_Draft omits it.
    - **Property 4: Promotional Drafts Always Disclose** — fast-check, ≥100 iterations, tagged.
    - _Requirements: 5.1, 6.1, 7.1, 7.2, 7.3_
    - _Properties: 4_
  - [ ]* 6.11 Write the concealing-language safety property test and the required example tests
    - In `draft-compliance.test.ts`, assert a Promotional_Draft is `'safe'` **iff** it includes a
      Disclosure AND contains no Concealing_Language. Add the three steering-required example tests: a
      promotional draft with a disclosure and no concealing language **passes** (safe); a promotional
      draft with a disclosure **plus** concealing language is **rejected/warned unsafe**
      (`unsafe_concealing`); a promotional draft **without** a disclosure is **rejected/warned unsafe**
      (`unsafe_no_disclosure`). Add a per-phrase unit test covering each Concealing_Language example
      ("not affiliated", "I just found this", "randomly came across", "no connection to them", "not
      sponsored").
    - **Property 4a: Concealing Language Makes a Promotional Draft Unsafe** — fast-check, ≥100
      iterations, tagged.
    - _Requirements: 7.4, 7.5, 7.6_
    - _Properties: 4a_
  - [ ]* 6.12 Write the compliance-warnings property test
    - In `draft-compliance.test.ts`, assert every result carries `manual_review`, `subreddit_rules`,
      and `no_automated_action`; every promotional draft additionally carries `disclosure_required`;
      and every `disclosed-link` draft lacking an Operator URL carries `missing_link`.
    - **Property 8: Compliance Warnings Always Present** — fast-check, ≥100 iterations, tagged.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
    - _Properties: 8_
  - [ ]* 6.13 Write `draft-compliance` helper unit tests
    - In `draft-compliance.test.ts`, unit-test `stripUrls` (removes http/https and bare-domain URLs),
      `containsProhibitedLanguage` (each table category), and `containsConcealingLanguage`
      (case-insensitive matches and non-matches).
    - _Requirements: 4.2, 5.3, 7.4, 8.1, 8.3_

  - [ ]* 6.14 Write the `DraftCoPilot` component tests
    - In `extension/src/components/DraftCoPilot.test.tsx`, drive the panel with React Testing Library:
      assert the Source_Text textarea + character counter, the optional URL and context inputs, and the
      three-mode selector render (Req 1.x, 2.x); type valid input, select a mode, click Generate, and
      assert the preview, the Copy control, and all compliance warnings render (Req 9.x, 10.1, 10.2,
      10.4); assert an unsafe result shows the safety banner (Req 7.5, 7.6).
    - Assert there is **no** post/submit/comment/publish/auto-post control (Req 10.3, 12.8, 12.9); on a
      failure, assert the safe failure indicator renders with **no** stale or partial draft text
      (Req 3.8); assert that mounting the panel and not clicking Generate invokes `generateDraft` zero
      times, and that empty/over-limit/no-mode inputs withhold any result (Req 1.6, 1.8, 2.2).
    - **Property 9a (UI slice): Safe Failure State** and **Property 10: No Posting Controls** — tagged
      where applicable.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.4, 3.8, 7.5, 7.6, 9.1, 9.2, 9.3, 9.4, 9.5, 10.1, 10.2, 10.3, 10.4, 12.8, 12.9_
    - _Properties: 9a, 10_
  - [ ]* 6.15 Extend `Popup.test.tsx` for gate behavior and section preservation
    - In `extension/src/popup/Popup.test.tsx`, assert that with **incomplete** onboarding and with the
      **`read_error`** state the `DraftCoPilot` does not render (no draft input/control/preview) and
      `generateDraft` is not invoked, and that with **completed** onboarding the `DraftCoPilot` renders
      as a section distinct from `IntentScanner` while the Intent_Scanner and connection status are
      preserved (Req 11.2, 11.3, 11.4, 11.5).
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 13.5_
    - _Properties: 13_

- [ ] 7. Extend the security-boundary tests for Spec 06 scope and permission containment
  - [ ]* 7.1 Add Spec 06 manifest permission-containment assertions
    - Extend `extension/src/security-boundary.test.ts` to assert `manifest.permissions` equals exactly
      `['storage']` and `manifest.host_permissions` equals exactly the three approved entries
      (`https://*.workers.dev/*`, `http://localhost/*`, `http://127.0.0.1/*`) byte-for-byte, and that
      `manifest.content_scripts` remains undefined — proving Spec 06 added no permission or host.
    - **Property 12: Permission Containment.**
    - _Requirements: 10.5, 12.1, 12.6, 13.6_
    - _Properties: 12_

  - [ ]* 7.2 Add Spec 06 forbidden-scope token and no-posting-control assertions
    - Extend `security-boundary.test.ts` with a Spec 06 source-file list (`src/types/index.ts`,
      `src/lib/draft-compliance.ts`, `src/lib/draft-generator.ts`,
      `src/components/DraftCoPilot.tsx`, `src/popup/Popup.tsx`) and assert none of them — nor the
      manifest — contains the forbidden-scope tokens `/v1/draft`, `openai`, `llm`, `chrome.alarms`,
      `chrome.notifications`, `content_scripts`, `reddit.com`, `firecrawl`, `scraping` (matched
      case-insensitively); assert the draft modules contain no `fetch`/network call and no posting/
      submit/publish control token.
    - **Property 10: No Posting Controls** and **Property 11: Manual-Input-Only Scope.**
    - _Requirements: 1.5, 12.2, 12.3, 12.4, 12.5, 12.7, 12.8, 12.9, 12.10, 12.11_
    - _Properties: 10, 11_

- [ ] 8. Final validation — execute typecheck, tests, and build for both packages
  - [ ] 8.1 Run and report the full extension and worker-api verification
    - Execute, in this exact order and report the outcome of each command:
      ```
      cd extension && npm run typecheck && npm run test && npm run build
      cd ../worker-api && npm run typecheck && npm run test && npm run build
      ```
    - For the `extension` package, run `npm run typecheck`, then `npm run test` (single-run, no watch),
      then `npm run build`; for the `worker-api` package, run `npm run typecheck`, then `npm run test`,
      then `npm run build`. Fix any failures so that, for **both** packages, typecheck passes, every
      Vitest suite passes — including the Spec 06 property tests at ≥100 iterations alongside the unit,
      component, and security-boundary tests, and the existing Spec 01–05 suites unchanged — and
      `npm run build` completes successfully.
    - Confirm the manifest `permissions`/`host_permissions` remain byte-for-byte unchanged (Req 13.6),
      then produce a validation report stating the final **extension** and **worker-api** test counts
      and the build results for both packages (Req 13.11).
    - **Property 13: Preserved Specs 01–05 Behavior.**
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11_
    - _Properties: 13_

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; the unmarked
  tasks are the core implementation and must be completed. Top-level tasks are never optional.
- Each task references the specific requirement sub-clauses it satisfies, and each property test
  sub-task references the exact Correctness Property (P1–P13, including 4a and 9a) from
  `requirements.md` / `design.md` Section 11, with the requirements clause it checks.
- Property-based tests use **fast-check**, run a minimum of **100 iterations**, and carry the
  `// Feature: draft-co-pilot, Property {n}: {property text}` tag (`design.md` Section 12). Determinism
  is asserted for **successful** generation only; failures return a typed `FailureState`.
- Property → test placement: P1, P2, P3, P5, P6, P7, P9, P9a → `draft-generator.test.ts`;
  P4, P4a, P8 → `draft-compliance.test.ts`; P10 → `DraftCoPilot.test.tsx` + `security-boundary.test.ts`;
  P11, P12 → `security-boundary.test.ts`; P13 → `Popup.test.tsx` + the Group 8 validation run.
- The plan adds **no** manifest permission, **no** Worker draft endpoint or `/v1/draft` route, **no**
  network/AI/LLM call, **no** background/`chrome.alarms`/`chrome.notifications`, **no** content script,
  and **no** posting control; drafting is local, synchronous, deterministic, and Operator-driven only.
