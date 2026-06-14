import { useState } from 'react';
import type {
  CandidateType,
  CompareContext,
  CompareMatch,
  ComplianceWarning,
  DraftInput,
  DraftMode,
  DraftResult,
  FailureState,
  IntentCategory,
  IntentContext,
} from '../types';
import { MAX_SOURCE_LENGTH } from '../types';
import { generateDraft, validateDraftInput } from '../lib/draft-generator';
import { recordActivity } from '../lib/activity-recorder';

/** Human-readable labels for each of the exactly-three Reply_Modes (Req 2.1, 2.4). */
const MODE_OPTIONS: ReadonlyArray<{ value: DraftMode; label: string; hint: string }> = [
  {
    value: 'no-link-authority',
    label: 'No-link authority',
    hint: 'Helpful, non-promotional answer with no links.',
  },
  {
    value: 'soft-cta-with-disclosure',
    label: 'Soft CTA with disclosure',
    hint: 'Discloses affiliation and suggests CouponsRiver generally (no direct link).',
  },
  {
    value: 'disclosed-link',
    label: 'Disclosed link',
    hint: 'Discloses affiliation and includes your CouponsRiver link if you supply one.',
  },
];

/** The five valid Intent_Category values used for structural validation (Req 1.2). */
const INTENT_CATEGORIES: readonly IntentCategory[] = [
  'coupon-seeking',
  'deal-seeking',
  'product-comparison',
  'generic-discussion',
  'irrelevant',
];

/** The four valid Detected_Candidate `type` values used for structural validation (Req 1.2). */
const CANDIDATE_TYPES: readonly CandidateType[] = [
  'keyword',
  'tool_mention',
  'merchant_mention',
  'coupon_signal',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Parse and structurally validate a pasted Spec 05 Intent_Context (Req 1.2).
 * Returns the typed IntentContext on success or null on any parse/shape failure;
 * the caller treats null as "omit this optional context" (non-blocking).
 */
function parseIntentContext(raw: string): IntentContext | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) {
    return null;
  }
  const classification = data.classification;
  if (!isRecord(classification)) {
    return null;
  }
  if (
    typeof classification.category !== 'string' ||
    !INTENT_CATEGORIES.includes(classification.category as IntentCategory) ||
    typeof classification.confidence !== 'number'
  ) {
    return null;
  }
  if (!Array.isArray(data.candidates)) {
    return null;
  }
  const candidates: IntentContext['candidates'] = [];
  for (const candidate of data.candidates) {
    if (
      !isRecord(candidate) ||
      typeof candidate.type !== 'string' ||
      !CANDIDATE_TYPES.includes(candidate.type as CandidateType) ||
      typeof candidate.value !== 'string'
    ) {
      return null;
    }
    candidates.push({ type: candidate.type as CandidateType, value: candidate.value });
  }
  return {
    classification: {
      category: classification.category as IntentCategory,
      confidence: classification.confidence,
    },
    candidates,
  };
}

/**
 * Parse and structurally validate a pasted Spec 04 Compare_Context (Req 1.3).
 * Returns the typed CompareContext on success or null on any parse/shape failure;
 * the caller treats null as "omit this optional context" (non-blocking).
 */
function parseCompareContext(raw: string): CompareContext | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) {
    return null;
  }
  const candidate = data.candidate;
  if (!isRecord(candidate) || typeof candidate.merchant !== 'string') {
    return null;
  }
  if (typeof data.match_count !== 'number' || !Array.isArray(data.matches)) {
    return null;
  }
  const matches: CompareMatch[] = [];
  for (const match of data.matches) {
    if (
      !isRecord(match) ||
      typeof match.merchant !== 'string' ||
      typeof match.description !== 'string' ||
      typeof match.score !== 'number' ||
      typeof match.source !== 'string'
    ) {
      return null;
    }
    const built: CompareMatch = {
      merchant: match.merchant,
      description: match.description,
      score: match.score,
      source: match.source,
    };
    if (typeof match.coupon_code === 'string') {
      built.coupon_code = match.coupon_code;
    }
    matches.push(built);
  }
  return {
    candidate: { merchant: candidate.merchant },
    match_count: data.match_count,
    matches,
  };
}

/** True when the runtime environment exposes a usable clipboard write (Req 10.4, 10.5). */
function clipboardAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard !== 'undefined' &&
    typeof navigator.clipboard.writeText === 'function'
  );
}

/**
 * Draft_Co_Pilot panel (Spec 06, Req 1, 2, 3, 7, 9, 10).
 *
 * UI only. Holds all input and the latest result in local React state fed solely
 * from this panel's own controls (Req 1.5) — it takes no props that supply
 * external context. On Generate it clears any prior result, then calls the pure,
 * synchronous `generateDraft` (Req 2.3, 3.1, 3.8). It performs NO network call,
 * NO Reddit action, and renders NO posting/submit control of any kind
 * (Req 10.3, 12.8, 12.9). Copy is a manual Operator action via
 * `navigator.clipboard.writeText`, with manual selection always available as the
 * fallback (Req 10.2, 10.4, 10.5).
 */
export function DraftCoPilot() {
  const [sourceText, setSourceText] = useState('');
  const [mode, setMode] = useState<DraftMode | ''>('');
  const [couponsRiverUrl, setCouponsRiverUrl] = useState('');
  const [intentContextText, setIntentContextText] = useState('');
  const [compareContextText, setCompareContextText] = useState('');

  const [result, setResult] = useState<DraftResult | FailureState | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [intentParseError, setIntentParseError] = useState(false);
  const [compareParseError, setCompareParseError] = useState(false);
  const [copied, setCopied] = useState(false);

  const overLimit = sourceText.length > MAX_SOURCE_LENGTH;

  const handleGenerate = () => {
    // FIRST clear any prior result/failure and transient UI state so a failed or
    // withheld generation can never display stale or partial draft text
    // (Req 3.7, 3.8).
    setResult(null);
    setValidationError(null);
    setIntentParseError(false);
    setCompareParseError(false);
    setCopied(false);

    // Optional contexts: parse + structurally validate. On parse/shape failure
    // show a non-blocking inline note and simply omit that context — never crash,
    // never block generation (Req 1.2, 1.3).
    let intentContext: IntentContext | undefined;
    if (intentContextText.trim().length > 0) {
      const parsed = parseIntentContext(intentContextText);
      if (parsed === null) {
        setIntentParseError(true);
      } else {
        intentContext = parsed;
      }
    }

    let compareContext: CompareContext | undefined;
    if (compareContextText.trim().length > 0) {
      const parsed = parseCompareContext(compareContextText);
      if (parsed === null) {
        setCompareParseError(true);
      } else {
        compareContext = parsed;
      }
    }

    const input: DraftInput = {
      sourceText,
      mode: mode as DraftMode,
    };
    const trimmedUrl = couponsRiverUrl.trim();
    if (trimmedUrl.length > 0) {
      input.couponsRiverUrl = trimmedUrl;
    }
    if (intentContext !== undefined) {
      input.intentContext = intentContext;
    }
    if (compareContext !== undefined) {
      input.compareContext = compareContext;
    }

    // Validate before generation; withhold a result for empty/whitespace
    // Source_Text (Req 1.6), over-limit Source_Text (Req 1.8), and no mode
    // selected (Req 2.2).
    const validation = validateDraftInput(input);
    if (validation.kind !== 'valid') {
      switch (validation.kind) {
        case 'empty':
          setValidationError('Enter the Reddit context to draft from.');
          break;
        case 'too_long':
          setValidationError(
            `Source text exceeds the ${MAX_SOURCE_LENGTH.toLocaleString()}-character maximum. Please shorten it.`,
          );
          break;
        case 'no_mode':
          setValidationError('Select a reply mode.');
          break;
      }
      return;
    }

    // Synchronous, deterministic generation (Req 2.3, 3.1).
    setResult(generateDraft(input));
  };

  const handleCopy = async () => {
    if (result === null || result.kind !== 'draft' || !clipboardAvailable()) {
      return;
    }
    try {
      await navigator.clipboard.writeText(result.draftText);
      // Best-effort, non-blocking compliance log (Spec 08-A) — only on success.
      recordActivity('draft_copied', { detail: 'Draft Co-Pilot draft' });
      setCopied(true);
    } catch {
      // Clipboard write failed; manual selection remains the fallback (Req 10.5).
      setCopied(false);
    }
  };

  const selectedModeLabel =
    MODE_OPTIONS.find((option) => option.value === mode)?.label ?? 'None selected';

  return (
    <div className="mt-4 border-t border-gray-200 pt-4" data-testid="draft-co-pilot">
      <h2 className="text-sm font-semibold text-gray-900">Draft Co-Pilot</h2>
      <p className="mt-1 text-[11px] text-gray-500">
        Generate a manual reply draft locally from context you provide. Nothing is sent anywhere —
        drafts are built in your browser and you review, edit, and post them yourself.
      </p>

      {/* Source_Text (Req 1.1, 1.7) */}
      <label htmlFor="draft-source" className="mt-3 block text-[11px] font-medium text-gray-600">
        Reddit context (source text)
      </label>
      <textarea
        id="draft-source"
        value={sourceText}
        onChange={(e) => setSourceText(e.target.value)}
        rows={5}
        placeholder="Paste or type the Reddit post or comment you want to reply to…"
        className="mt-1 w-full rounded border border-gray-300 p-2 text-xs text-gray-800 focus:border-blue-500 focus:ring-blue-500"
      />
      <div className="mt-1 flex items-center justify-end">
        <span
          className={`text-[10px] ${overLimit ? 'text-red-600' : 'text-gray-400'}`}
          data-testid="draft-char-counter"
        >
          {sourceText.length} / {MAX_SOURCE_LENGTH}
        </span>
      </div>

      {/* Optional CouponsRiver URL (Req 1.4) */}
      <label htmlFor="draft-url" className="mt-2 block text-[11px] font-medium text-gray-600">
        CouponsRiver URL <span className="font-normal text-gray-400">(optional)</span>
      </label>
      <input
        id="draft-url"
        type="text"
        value={couponsRiverUrl}
        onChange={(e) => setCouponsRiverUrl(e.target.value)}
        placeholder="https://couponsriver.example/offer"
        className="mt-1 w-full rounded border border-gray-300 p-2 text-xs text-gray-800 focus:border-blue-500 focus:ring-blue-500"
      />

      {/* Optional Intent_Context (Spec 05 shape) (Req 1.2) */}
      <label htmlFor="draft-intent" className="mt-2 block text-[11px] font-medium text-gray-600">
        Intent context JSON{' '}
        <span className="font-normal text-gray-400">(optional — paste a Spec 05 result)</span>
      </label>
      <textarea
        id="draft-intent"
        value={intentContextText}
        onChange={(e) => setIntentContextText(e.target.value)}
        rows={2}
        placeholder='{"classification":{"category":"coupon-seeking","confidence":0.8},"candidates":[]}'
        className="mt-1 w-full rounded border border-gray-300 p-2 font-mono text-[11px] text-gray-800 focus:border-blue-500 focus:ring-blue-500"
      />
      {intentParseError && (
        <p
          className="mt-1 text-[11px] text-amber-700"
          role="alert"
          aria-live="polite"
          data-testid="draft-intent-parse-note"
        >
          Couldn't read the intent context — it was ignored. The draft was generated without it.
        </p>
      )}

      {/* Optional Compare_Context (Spec 04 shape) (Req 1.3) */}
      <label htmlFor="draft-compare" className="mt-2 block text-[11px] font-medium text-gray-600">
        Compare context JSON{' '}
        <span className="font-normal text-gray-400">(optional — paste a Spec 04 result)</span>
      </label>
      <textarea
        id="draft-compare"
        value={compareContextText}
        onChange={(e) => setCompareContextText(e.target.value)}
        rows={2}
        placeholder='{"candidate":{"merchant":"Acme"},"match_count":0,"matches":[]}'
        className="mt-1 w-full rounded border border-gray-300 p-2 font-mono text-[11px] text-gray-800 focus:border-blue-500 focus:ring-blue-500"
      />
      {compareParseError && (
        <p
          className="mt-1 text-[11px] text-amber-700"
          role="alert"
          aria-live="polite"
          data-testid="draft-compare-parse-note"
        >
          Couldn't read the compare context — it was ignored. The draft was generated without it.
        </p>
      )}

      {/* Draft_Mode selector — exactly the three Reply_Modes (Req 2.1, 2.4) */}
      <fieldset className="mt-3" data-testid="draft-mode-selector">
        <legend className="text-[11px] font-medium text-gray-600">Reply mode</legend>
        <div className="mt-1 space-y-1">
          {MODE_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-start gap-2 text-xs text-gray-800">
              <input
                type="radio"
                name="draft-mode"
                value={option.value}
                checked={mode === option.value}
                onChange={() => setMode(option.value)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{option.label}</span>
                <span className="block text-[10px] text-gray-500">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-gray-400" data-testid="draft-selected-mode">
          Selected mode: {selectedModeLabel}
        </p>
      </fieldset>

      {/* Generate — the only action that produces a draft (Req 2.3, 3.1) */}
      <div className="mt-3 flex justify-end">
        <button
          onClick={handleGenerate}
          className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
          data-testid="draft-generate-button"
        >
          Generate draft
        </button>
      </div>

      {/* Validation messages (Req 1.6, 1.8, 2.2) — result withheld. */}
      {validationError !== null && (
        <p
          className="mt-3 text-xs text-red-600"
          role="alert"
          aria-live="polite"
          data-testid="draft-validation-error"
        >
          {validationError}
        </p>
      )}

      {/* Failure indicator (Req 3.7, 3.8) — safe message only, no draft text. */}
      {result?.kind === 'failure' && (
        <p
          className="mt-3 text-xs text-red-600"
          role="alert"
          aria-live="polite"
          data-testid="draft-failure-indicator"
        >
          {result.message}
        </p>
      )}

      {/* Draft preview + warnings + safety (Req 7.5, 7.6, 9, 10) */}
      {result?.kind === 'draft' && (
        <div className="mt-3 space-y-3" data-testid="draft-result">
          {/* Unsafe banner (Req 7.5, 7.6) */}
          {result.safety === 'unsafe' && (
            <div
              className="rounded border border-red-300 bg-red-50 p-2"
              role="alert"
              aria-live="polite"
              data-testid="draft-safety-banner"
            >
              <p className="text-[11px] font-semibold text-red-800">
                Not ready — needs fixing
              </p>
              <p className="mt-0.5 text-[11px] text-red-700">
                This draft was flagged unsafe. Review the warnings below and fix the issues before
                considering it.
              </p>
            </div>
          )}

          {/* Selectable, read-only draft preview (Req 10.1, 10.2) */}
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="draft-preview" className="text-[11px] font-medium text-gray-600">
                Draft preview
              </label>
              {clipboardAvailable() && (
                <button
                  onClick={handleCopy}
                  className="px-2 py-1 text-[11px] font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded transition-colors"
                  data-testid="draft-copy-button"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>
            <textarea
              id="draft-preview"
              value={result.draftText}
              readOnly
              rows={8}
              className="mt-1 w-full rounded border border-gray-300 bg-gray-50 p-2 text-xs text-gray-800"
              data-testid="draft-preview"
            />
            <p className="mt-0.5 text-[10px] text-gray-400">
              Select the text above to copy it manually if needed.
            </p>
          </div>

          {/* Compliance warnings — always shown with a draft (Req 9.1–9.5) */}
          <div
            className="rounded border border-amber-200 bg-amber-50 p-2"
            data-testid="draft-compliance-warnings"
          >
            <p className="text-[11px] font-semibold text-amber-800">Compliance reminders</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {result.warnings.map((warning: ComplianceWarning) => (
                <li key={warning.id} className="text-[11px] text-amber-900">
                  {warning.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
