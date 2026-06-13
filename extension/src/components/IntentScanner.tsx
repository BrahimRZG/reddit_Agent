import { useState } from 'react';
import type {
  AnalyzeResult,
  CompareOutcome,
  CompareRequestBody,
  IntentCategory,
} from '../types';
import { analyzeInput, MAX_INPUT_LENGTH } from '../lib/intent-analyzer';
import { runCompareLookup } from '../lib/intent-compare';
import { getWorkerApiBaseUrl } from '../lib/storage';

/** Human-readable labels for each Intent_Category (Req 6.1). */
const CATEGORY_LABELS: Record<IntentCategory, string> = {
  'coupon-seeking': 'Coupon seeking',
  'deal-seeking': 'Deal seeking',
  'product-comparison': 'Product comparison',
  'generic-discussion': 'Generic discussion',
  irrelevant: 'Irrelevant (no signal)',
};

/** The four Compliance_Reminders shown alongside every results view (Req 7.1–7.4). */
const COMPLIANCE_REMINDERS: readonly string[] = [
  'This Extension performs no automated Reddit action.',
  'You are responsible for reviewing subreddit rules before posting.',
  'You are responsible for disclosing any commercial or affiliate connection to CouponsRiver.',
  'This analysis is advisory — you manually decide whether and how to participate.',
];

/** Maps a compare failure category to a short, secret-free indicator (Req 5.6). */
function compareFailureMessage(outcome: Extract<CompareOutcome, { status: 'failure' }>): string {
  switch (outcome.error.type) {
    case 'timeout':
      return 'Compare request timed out. Your local analysis is unchanged.';
    case 'network':
      return 'Compare request could not reach the server. Your local analysis is unchanged.';
    case 'server':
      return `Compare request failed (HTTP ${outcome.error.status ?? 'error'}). Your local analysis is unchanged.`;
    case 'parse':
      return 'Compare response could not be read. Your local analysis is unchanged.';
  }
}

/**
 * Builds a Spec 04 CompareRequestBody from a successful local analysis. `merchant`
 * is required, so it falls back to the first word of the normalized text when no
 * merchant_mention candidate is present (the normalized text is always non-empty
 * for an analyzed result).
 */
function buildCompareRequest(
  analyzed: Extract<AnalyzeResult, { kind: 'analyzed' }>
): CompareRequestBody {
  const merchant =
    analyzed.candidates.find((c) => c.type === 'merchant_mention')?.value ??
    analyzed.normalized.split(' ')[0] ??
    '';
  const product = analyzed.candidates.find((c) => c.type === 'tool_mention')?.value;
  const couponCode = analyzed.candidates.find((c) => c.type === 'coupon_signal')?.value;

  const request: CompareRequestBody = { merchant };
  if (product !== undefined) {
    request.product = product;
  }
  if (couponCode !== undefined) {
    request.coupon_code = couponCode;
  }
  return request;
}

/**
 * Manual-input Intent_Scanner panel (Spec 05, Req 1, 5, 6, 7).
 *
 * Holds input and results in local React state fed solely from the textarea
 * value (Req 1.6). Local analysis (validate → normalize → classify → extract)
 * runs with no network call; the only network request is the optional,
 * operator-triggered Compare lookup (Req 5).
 */
export function IntentScanner() {
  const [text, setText] = useState('');
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [compare, setCompare] = useState<CompareOutcome>({ status: 'idle' });

  const overLimit = text.length > MAX_INPUT_LENGTH;

  const handleAnalyze = () => {
    // A new analysis always replaces the previous result and clears any prior
    // compare outcome, so a stale result is never reused (Req 1.4, fresh-per-run).
    setCompare({ status: 'idle' });
    setResult(analyzeInput(text));
  };

  const handleCompare = async () => {
    if (result === null || result.kind !== 'analyzed') {
      return;
    }
    const request = buildCompareRequest(result);
    setCompare({ status: 'loading' });
    const baseUrl = await getWorkerApiBaseUrl();
    const outcome = await runCompareLookup(baseUrl, request);
    setCompare(outcome);
  };

  return (
    <div className="mt-4 border-t border-gray-200 pt-4">
      <h2 className="text-sm font-semibold text-gray-900">Intent Scanner</h2>
      <p className="mt-1 text-[11px] text-gray-500">
        Paste Reddit post or thread text below to analyze it locally. Nothing is sent anywhere
        unless you explicitly run a comparison.
      </p>

      <label htmlFor="intent-input" className="sr-only">
        Reddit text to analyze
      </label>
      <textarea
        id="intent-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="Paste or type Reddit text here…"
        className="mt-2 w-full rounded border border-gray-300 p-2 text-xs text-gray-800 focus:border-blue-500 focus:ring-blue-500"
      />

      <div className="mt-1 flex items-center justify-between">
        <span
          className={`text-[10px] ${overLimit ? 'text-red-600' : 'text-gray-400'}`}
          data-testid="char-counter"
        >
          {text.length} / {MAX_INPUT_LENGTH}
        </span>
        <button
          onClick={handleAnalyze}
          className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
        >
          Analyze
        </button>
      </div>

      {/* Validation messages (Req 1.4, 1.5) — withhold any result. */}
      {result?.kind === 'invalid' && (
        <p className="mt-3 text-xs text-red-600" role="alert" aria-live="polite">
          {result.reason === 'empty'
            ? 'Enter some text to analyze.'
            : `Text exceeds the ${MAX_INPUT_LENGTH.toLocaleString()}-character maximum. Please shorten it.`}
        </p>
      )}

      {/* Analyzed results (Req 6). */}
      {result?.kind === 'analyzed' && (
        <div className="mt-3 space-y-3" data-testid="analysis-results">
          {/* Category + confidence (Req 6.1, 6.2). */}
          <div className="rounded bg-gray-50 p-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-500">Intent category</span>
              <span className="text-xs font-semibold text-gray-900" data-testid="intent-category">
                {CATEGORY_LABELS[result.classification.category]}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[11px] text-gray-500">Confidence</span>
              <span className="text-xs font-medium text-gray-700" data-testid="intent-confidence">
                {Math.round(result.classification.confidence * 100)}%
              </span>
            </div>
          </div>

          {/* Detected candidates (Req 6.3, 6.4). */}
          <div>
            <p className="text-[11px] font-medium text-gray-600">Detected candidates</p>
            {result.candidates.length === 0 ? (
              <p className="mt-1 text-xs text-gray-500" data-testid="no-candidates">
                No candidates detected.
              </p>
            ) : (
              <ul className="mt-1 space-y-0.5" data-testid="candidate-list">
                {result.candidates.map((candidate) => (
                  <li
                    key={`${candidate.type}-${candidate.value}`}
                    className="text-xs text-gray-700"
                  >
                    <span className="font-mono text-[11px] text-gray-500">{candidate.type}</span>
                    {': '}
                    {candidate.value}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Optional Compare control (Req 5.1, 6.5). */}
          <div>
            <button
              onClick={handleCompare}
              disabled={compare.status === 'loading'}
              className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded transition-colors disabled:opacity-60 disabled:cursor-wait"
            >
              {compare.status === 'loading' ? 'Comparing…' : 'Compare with CouponsRiver'}
            </button>

            {compare.status === 'success' && (
              <div className="mt-2 rounded bg-emerald-50 p-2" data-testid="compare-success">
                <p className="text-xs font-medium text-emerald-800">
                  {compare.data.match_count} match{compare.data.match_count === 1 ? '' : 'es'} found
                </p>
                {compare.data.match_count > 0 && (
                  <ul className="mt-1 space-y-1" data-testid="compare-matches">
                    {compare.data.matches.map((match, index) => (
                      <li
                        key={`${match.merchant}-${match.coupon_code ?? 'none'}-${index}`}
                        className="text-[11px] text-emerald-900"
                      >
                        <span className="font-medium">{match.merchant}</span>
                        {match.coupon_code ? ` — ${match.coupon_code}` : ''} — {match.description}{' '}
                        <span className="text-emerald-700">
                          (score {match.score}, {match.source})
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {compare.status === 'failure' && (
              <p
                className="mt-2 text-xs text-red-600"
                role="alert"
                aria-live="polite"
                data-testid="compare-failure"
              >
                {compareFailureMessage(compare)}
              </p>
            )}
          </div>

          {/* Compliance reminders (Req 6.6, 7.1–7.5). */}
          <div className="rounded border border-amber-200 bg-amber-50 p-2" data-testid="compliance-reminders">
            <p className="text-[11px] font-semibold text-amber-800">Compliance reminders</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {COMPLIANCE_REMINDERS.map((reminder) => (
                <li key={reminder} className="text-[11px] text-amber-900">
                  {reminder}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
