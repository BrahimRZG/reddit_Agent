import { useCallback, useEffect, useState } from 'react';
import type { AcknowledgementRecord, OnboardingState } from '../types';
import { readAcknowledgement } from '../lib/onboarding-storage';
import { ACKNOWLEDGEMENT_VERSION, isOnboardingComplete } from '../lib/onboarding';
import { compareSemver } from '../lib/semver';
import { Onboarding } from './Onboarding';

interface OnboardingGateProps {
  /** The normal app UI, rendered only when Compliance_Onboarding is complete. */
  children: React.ReactNode;
}

/** Best-effort reason classification for a non-read-error incomplete state. */
function incompleteReason(
  record: AcknowledgementRecord | null
): 'missing' | 'stale_version' | 'invalid' {
  if (record === null) {
    return 'missing';
  }
  if (
    typeof record.version === 'string' &&
    record.version.length > 0 &&
    compareSemver(record.version, ACKNOWLEDGEMENT_VERSION) < 0
  ) {
    return 'stale_version';
  }
  return 'invalid';
}

/**
 * App-root gate (Spec 03).
 *
 * Loads onboarding state once on mount and decides what to render:
 * - `loading`    → a minimal placeholder.
 * - `incomplete` → the Onboarding_Screen (Req 2.1); `read_error` shows a
 *   recoverable storage error with a Retry action (Req 1.7, 1.8).
 * - `complete`   → the normal app UI (`children`).
 *
 * The gate is fail-closed: a storage read failure resolves to `incomplete`
 * with `reason: 'read_error'` and NEVER renders `children`, keeping every gated
 * Authenticated_Action unavailable even if a record might exist (Req 1.7, 1.8).
 */
export function OnboardingGate({ children }: OnboardingGateProps) {
  const [state, setState] = useState<OnboardingState>({ status: 'loading' });
  const [readErrorMessage, setReadErrorMessage] = useState<string | null>(null);

  // Reads storage and re-evaluates onboarding completion. Used on mount, after
  // a successful acknowledgement (refresh), and on Retry after a read error.
  const evaluate = useCallback(async () => {
    setState({ status: 'loading' });
    const result = await readAcknowledgement();

    if (result.kind === 'read_error') {
      // Fail-closed: never treat a read failure as completion (Req 1.7, 1.8).
      setReadErrorMessage(result.message);
      setState({ status: 'incomplete', reason: 'read_error' });
      return;
    }

    setReadErrorMessage(null);
    const record = result.record;
    if (isOnboardingComplete(record, ACKNOWLEDGEMENT_VERSION)) {
      setState({ status: 'complete', record: record as AcknowledgementRecord });
    } else {
      setState({ status: 'incomplete', reason: incompleteReason(record) });
    }
  }, []);

  useEffect(() => {
    void evaluate();
  }, [evaluate]);

  if (state.status === 'loading') {
    return (
      <div
        className="flex items-center justify-center p-6 text-sm text-gray-500"
        role="status"
        aria-live="polite"
      >
        Loading…
      </div>
    );
  }

  if (state.status === 'complete') {
    return <>{children}</>;
  }

  // Incomplete: a storage read failure shows a recoverable error + Retry.
  if (state.reason === 'read_error') {
    return (
      <div className="max-w-lg mx-auto p-6 bg-white min-h-screen">
        <h1 className="text-lg font-semibold text-gray-900">Compliance Onboarding</h1>
        <div className="mt-4 p-3 rounded-md bg-red-50 border border-red-200" role="alert">
          <p className="text-sm font-medium text-red-700">
            We couldn&apos;t read your onboarding status from local storage.
          </p>
          <p className="mt-1 text-xs text-red-600">
            Authenticated features stay unavailable until this is resolved. Please retry.
          </p>
          {readErrorMessage && (
            <p className="mt-1 text-[11px] text-red-500" data-testid="read-error-detail">
              {readErrorMessage}
            </p>
          )}
        </div>
        <button
          onClick={() => void evaluate()}
          className="mt-4 px-4 py-2 text-sm font-medium text-white bg-gray-700 hover:bg-gray-800 rounded-md transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // Other incomplete states (missing / stale version / invalid): show the screen.
  return <Onboarding onComplete={evaluate} />;
}
