/**
 * Local analysis orchestrator (Spec 05, Req 1, 2, 3, 4).
 *
 * Pure composition: `validateInput` → `normalizeText` → (`classifyIntent`,
 * `extractCandidates`). Holds NO module-level mutable state, so `analyzeInput`
 * always returns a fresh result computed solely from the current `input` and can
 * never reuse a stale result from a previous input. Performs NO network call.
 */
import type { AnalyzeResult, InputValidation } from '../types';
import { normalizeText } from './intent-normalizer';
import { classifyIntent } from './intent-classifier';
import { extractCandidates } from './intent-extractor';

/** Maximum accepted Input_Text length (Req 1.2, 1.5). */
export const MAX_INPUT_LENGTH = 10000;

/**
 * Classifies Operator-supplied Input_Text:
 * - `empty`    when it has zero non-whitespace characters (Req 1.4),
 * - `too_long` when its length exceeds MAX_INPUT_LENGTH (Req 1.5),
 * - `valid`    otherwise (carrying the original text).
 *
 * `empty` is checked first so whitespace-only input (even if very long) is
 * reported as empty rather than too long.
 */
export function validateInput(input: string): InputValidation {
  if (input.trim().length === 0) {
    return { kind: 'empty' };
  }
  if (input.length > MAX_INPUT_LENGTH) {
    return { kind: 'too_long', max: MAX_INPUT_LENGTH };
  }
  return { kind: 'valid', text: input };
}

/**
 * Composes validation, normalization, classification, and extraction into a
 * single fresh AnalyzeResult. Invalid input yields an `invalid` result with the
 * categorized reason; valid input yields an `analyzed` result. No network call
 * is performed on this path.
 */
export function analyzeInput(input: string): AnalyzeResult {
  const validation = validateInput(input);

  if (validation.kind === 'empty') {
    return { kind: 'invalid', reason: 'empty' };
  }
  if (validation.kind === 'too_long') {
    return { kind: 'invalid', reason: 'too_long' };
  }

  const normalized = normalizeText(validation.text);
  return {
    kind: 'analyzed',
    normalized,
    classification: classifyIntent(normalized),
    candidates: extractCandidates(normalized),
  };
}
