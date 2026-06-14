import { useMemo, useState } from 'react';
import type { AcknowledgementItemId, AcknowledgementRecord } from '../types';
import {
  ACKNOWLEDGEMENT_VERSION,
  REQUIRED_ACKNOWLEDGEMENT_ITEMS,
  buildAcknowledgementRecord,
  isOnboardingComplete,
  validateAcknowledgement,
} from '../lib/onboarding';
import { setAcknowledgement, OnboardingStorageError } from '../lib/onboarding-storage';
import { recordActivity } from '../lib/activity-recorder';

interface OnboardingProps {
  /**
   * An optional already-stored record. When it represents a complete
   * onboarding, the component renders a completed-state summary instead of the
   * acknowledgement form (Task 6.2).
   */
  record?: AcknowledgementRecord | null;
  /** Called after a successful write so the gate can re-evaluate and refresh. */
  onComplete?: () => void;
}

const MISSING_ITEM_MESSAGE = 'You must accept every item before continuing.';

/**
 * The Onboarding_Screen (Spec 03).
 *
 * Presents the compliance disclosures (Req 2.2–2.7), the current
 * Acknowledgement_Version (Req 2.8), and the six required acknowledgement
 * checkboxes (Req 3.1). The accept control stays disabled until all six are
 * checked (Req 3.2, 3.3). On accept it persists a timestamped, versioned
 * Acknowledgement_Record (Req 3.4, 4.1–4.3) and invokes `onComplete`. Storage
 * write failures surface inline and leave onboarding incomplete (Req 4.6).
 */
export function Onboarding({ record, onComplete }: OnboardingProps) {
  const [checked, setChecked] = useState<Set<AcknowledgementItemId>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const validation = useMemo(
    () => validateAcknowledgement({ items: [...checked] }),
    [checked]
  );
  const allChecked = validation.valid;

  // Task 6.2: when a complete record already exists, show the summary view.
  if (isOnboardingComplete(record ?? null)) {
    const completeRecord = record as AcknowledgementRecord;
    return <CompletedSummary record={completeRecord} />;
  }

  const toggleItem = (id: AcknowledgementItemId) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setErrorMessage(null);
  };

  const handleAccept = async () => {
    // Defensive guard (Req 3.5): never persist when any item is unchecked.
    if (!validateAcknowledgement({ items: [...checked] }).valid) {
      setErrorMessage(MISSING_ITEM_MESSAGE);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      await setAcknowledgement(buildAcknowledgementRecord());
      // Best-effort, non-blocking compliance log (Spec 08-A). Fire-and-forget:
      // never awaited and never gates onComplete; only on the success path.
      recordActivity('onboarding_completed', { detail: `version ${ACKNOWLEDGEMENT_VERSION}` });
      onComplete?.();
    } catch (err) {
      // Req 4.6: write failure shows an inline error and stays incomplete.
      const message =
        err instanceof OnboardingStorageError
          ? err.message
          : 'Failed to save your acknowledgement. Please try again.';
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto p-6 bg-white min-h-screen">
      <h1 className="text-lg font-semibold text-gray-900">
        Compliance Onboarding
      </h1>

      {/* Manual-assistant / not-a-bot framing (Req 2.2) */}
      <p className="text-sm text-gray-600 mt-2">
        This Extension helps you manually research and draft Reddit content. It does not
        automate any Reddit action and is not a Reddit bot. Please review and accept the
        rules below before using authenticated features.
      </p>

      {/* Acknowledgement version (Req 2.8) */}
      <p className="text-xs text-gray-400 mt-2" data-testid="acknowledgement-version">
        Acknowledgement version: {ACKNOWLEDGEMENT_VERSION}
      </p>

      {/* Required acknowledgement checkboxes (Req 3.1, defaulting to unchecked) */}
      <fieldset className="mt-5 space-y-3">
        <legend className="sr-only">Compliance acknowledgements</legend>
        {REQUIRED_ACKNOWLEDGEMENT_ITEMS.map((item) => {
          const inputId = `ack-${item.id}`;
          return (
            <div key={item.id} className="flex items-start gap-3">
              <input
                id={inputId}
                type="checkbox"
                checked={checked.has(item.id)}
                onChange={() => toggleItem(item.id)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor={inputId} className="text-sm text-gray-700 leading-snug">
                {item.label}
              </label>
            </div>
          );
        })}
      </fieldset>

      {/* Missing-item / write-failure message */}
      {errorMessage && (
        <p className="mt-4 text-xs text-red-600" role="alert">
          {errorMessage}
        </p>
      )}

      {/* Accept control — disabled until all six are checked (Req 3.2, 3.3).
          We use `aria-disabled` (not the native `disabled` attribute) for the
          incomplete state so the control is announced as disabled and styled as
          disabled, while the defensive guard in `handleAccept` can still run if
          activated while incomplete (Req 3.5). The native `disabled` attribute
          is reserved for the in-flight submit to prevent double-writes. */}
      <div className="mt-6">
        <button
          onClick={handleAccept}
          aria-disabled={!allChecked}
          disabled={isSubmitting}
          className={`px-4 py-2 text-sm font-medium text-white rounded-md transition-colors ${
            allChecked
              ? 'bg-blue-600 hover:bg-blue-700'
              : 'bg-gray-300 cursor-not-allowed hover:bg-gray-300'
          } ${isSubmitting ? 'opacity-70 cursor-wait' : ''}`}
        >
          {isSubmitting ? 'Saving…' : 'Accept and Continue'}
        </button>
      </div>

      <div className="mt-6 pt-4 border-t border-gray-200">
        <p className="text-xs text-gray-400">
          Your acknowledgement is stored locally on this device only and is never sent to
          any server.
        </p>
      </div>
    </div>
  );
}

/** Completed-state summary view (Task 6.2): acknowledged version + timestamp. */
function CompletedSummary({ record }: { record: AcknowledgementRecord }) {
  const acceptedAt = formatTimestamp(record.acknowledged_at);
  return (
    <div className="max-w-lg mx-auto p-6 bg-white min-h-screen">
      <h1 className="text-lg font-semibold text-gray-900">Compliance Onboarding</h1>
      <p className="mt-2 text-sm text-green-700" data-testid="onboarding-complete-summary">
        ✓ Compliance onboarding complete.
      </p>
      <dl className="mt-4 space-y-2 text-sm text-gray-700">
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">Acknowledged version</dt>
          <dd className="font-medium" data-testid="summary-version">
            {record.version}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">Acknowledged at</dt>
          <dd className="font-medium" data-testid="summary-timestamp">
            {acceptedAt}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** Renders an ISO 8601 timestamp in a readable form, falling back to the raw value. */
function formatTimestamp(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString();
}
