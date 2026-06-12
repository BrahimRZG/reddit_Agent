import { useEffect, useState } from 'react';
import type { ConnectionState, ValidationResult, AcknowledgementRecord } from '../types';
import { DEFAULT_WORKER_API_URL, ONBOARDING_REQUIRED } from '../types';
import { getWorkerApiBaseUrl, setWorkerApiBaseUrl, StorageError } from '../lib/storage';
import { validateWorkerApiUrl } from '../lib/url-validator';
import { checkStatus } from '../lib/api-client';
import { satisfiesMinimum } from '../lib/semver';
import { ConnectionBadge } from '../components/ConnectionBadge';
import { readAcknowledgement } from '../lib/onboarding-storage';
import { isOnboardingComplete, ACKNOWLEDGEMENT_VERSION } from '../lib/onboarding';
import { guardedVerifyAuth } from '../lib/onboarding-gate';
import { Onboarding } from '../components/Onboarding';

const EXTENSION_VERSION = '1.0.0';

export function Settings() {
  const [urlInput, setUrlInput] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [saved, setSaved] = useState(false);

  // --- Compliance onboarding (Spec 03) ---
  const [onboardingStatus, setOnboardingStatus] = useState<
    'loading' | 'complete' | 'incomplete' | 'read_error'
  >('loading');
  const [onboardingRecord, setOnboardingRecord] = useState<AcknowledgementRecord | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [authActionMessage, setAuthActionMessage] = useState<string | null>(null);

  const onboardingComplete = onboardingStatus === 'complete';

  const loadOnboarding = async () => {
    const result = await readAcknowledgement();
    if (result.kind === 'read_error') {
      setOnboardingRecord(null);
      setOnboardingStatus('read_error');
      return;
    }
    setOnboardingRecord(result.record);
    setOnboardingStatus(isOnboardingComplete(result.record) ? 'complete' : 'incomplete');
  };

  useEffect(() => {
    void loadOnboarding();
  }, []);

  const handleOnboardingComplete = async () => {
    await loadOnboarding();
    setShowOnboarding(false);
  };

  /**
   * Demonstrates the gating pattern for an Authenticated_Action (Req 5.3, 5.5).
   * Routes through the onboarding gate: while onboarding is incomplete the gate
   * returns ONBOARDING_REQUIRED before any credential read or network call, and
   * the Operator is routed to the Onboarding_Screen. The public Save & Test
   * path below is intentionally NOT routed through this gate (Req 5.4).
   */
  const handleAuthenticatedAction = async () => {
    setAuthActionMessage(null);
    const validation = validateWorkerApiUrl(urlInput);
    const baseUrl = validation.valid ? validation.normalizedUrl : urlInput;
    const result = await guardedVerifyAuth(baseUrl);
    if (result.success) {
      setAuthActionMessage('Authenticated connection verified.');
      return;
    }
    if ('code' in result.error && result.error.code === ONBOARDING_REQUIRED) {
      // Route the Operator to onboarding (Req 5.5).
      setShowOnboarding(true);
      setAuthActionMessage('Complete compliance onboarding to use authenticated actions.');
      return;
    }
    setAuthActionMessage(`Authenticated request failed: ${result.error.message}`);
  };

  useEffect(() => {
    (async () => {
      const currentUrl = await getWorkerApiBaseUrl();
      setUrlInput(currentUrl);
    })();
  }, []);

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setUrlInput(value);
    setValidationError(null);
    setSaveError(null);
    setSaved(false);
    setConnectionState(null);

    if (value.length > 0) {
      const result = validateWorkerApiUrl(value);
      if (!result.valid) {
        setValidationError(result.error);
      }
    }
  };

  const handleSaveAndTest = async () => {
    const validation: ValidationResult = validateWorkerApiUrl(urlInput);
    if (!validation.valid) {
      setValidationError(validation.error);
      return;
    }

    setValidationError(null);
    setSaveError(null);
    setSaved(false);

    try {
      await setWorkerApiBaseUrl(urlInput);
      setSaved(true);
    } catch (err) {
      if (err instanceof StorageError) {
        setSaveError(err.message);
      } else {
        setSaveError('Failed to save URL.');
      }
      return;
    }

    setIsTesting(true);
    setConnectionState({ status: 'loading' });

    const result = await checkStatus(validation.normalizedUrl);

    if (result.success) {
      if (!satisfiesMinimum(EXTENSION_VERSION, result.data.minimum_extension_version)) {
        setConnectionState({
          status: 'update-required',
          minimumVersion: result.data.minimum_extension_version,
        });
      } else {
        setConnectionState({ status: 'connected', data: result.data });
      }
    } else {
      switch (result.error.type) {
        case 'timeout':
          setConnectionState({ status: 'offline', reason: 'timeout' });
          break;
        case 'network':
          setConnectionState({ status: 'offline', reason: 'network' });
          break;
        case 'server':
        case 'parse':
          setConnectionState({
            status: 'server-error',
            httpStatus: result.error.status ?? 0,
          });
          break;
      }
    }

    setIsTesting(false);
  };

  const handleResetDefault = () => {
    setUrlInput(DEFAULT_WORKER_API_URL);
    setValidationError(null);
    setSaveError(null);
    setSaved(false);
    setConnectionState(null);
  };

  const isValid = urlInput.length > 0 && !validationError;

  return (
    <div className="max-w-lg mx-auto p-6 bg-white min-h-screen">
      <h1 className="text-lg font-semibold text-gray-900">
        Reddit Marketing Agent — Settings
      </h1>
      <p className="text-sm text-gray-500 mt-1 mb-6">
        Configure the Worker API endpoint for your extension.
      </p>

      {/* URL Input */}
      <div className="space-y-2">
        <label
          htmlFor="worker-url"
          className="block text-sm font-medium text-gray-700"
        >
          Worker API Base URL
        </label>
        <input
          id="worker-url"
          type="url"
          value={urlInput}
          onChange={handleUrlChange}
          placeholder="https://your-worker.workers.dev"
          maxLength={256}
          className={`w-full px-3 py-2 text-sm border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            validationError
              ? 'border-red-300 focus:ring-red-500'
              : 'border-gray-300'
          }`}
        />

        {validationError && (
          <p className="text-xs text-red-600">{validationError}</p>
        )}

        {saveError && (
          <p className="text-xs text-red-600">{saveError}</p>
        )}
      </div>

      {/* Action buttons */}
      <div className="mt-4 flex gap-2">
        <button
          onClick={handleSaveAndTest}
          disabled={!isValid || isTesting}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-md transition-colors"
        >
          {isTesting ? 'Testing…' : 'Save & Test Connection'}
        </button>
        <button
          onClick={handleResetDefault}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
        >
          Reset to Default
        </button>
      </div>

      {/* Connection result */}
      {connectionState && (
        <div className="mt-4 p-3 bg-gray-50 rounded-md">
          <ConnectionBadge state={connectionState} />
        </div>
      )}

      {/* Save confirmation */}
      {saved && !saveError && connectionState?.status === 'connected' && (
        <p className="mt-3 text-xs text-green-600">
          ✓ Settings saved and connection verified.
        </p>
      )}

      {/* --- Compliance onboarding status (Spec 03) --- */}
      <div className="mt-6 pt-4 border-t border-gray-200">
        <h2 className="text-sm font-medium text-gray-700">Compliance Onboarding</h2>

        <div className="mt-2 flex items-center gap-2" data-testid="onboarding-status">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full ${
              onboardingComplete ? 'bg-green-500' : 'bg-amber-500'
            }`}
            role="status"
            aria-label={onboardingComplete ? 'Onboarding complete' : 'Onboarding incomplete'}
          />
          <span className="text-xs text-gray-600">
            {onboardingStatus === 'loading' && 'Checking onboarding status…'}
            {onboardingStatus === 'complete' &&
              `Complete (v${onboardingRecord?.version ?? ACKNOWLEDGEMENT_VERSION})`}
            {onboardingStatus === 'incomplete' &&
              'Incomplete — required before authenticated actions'}
            {onboardingStatus === 'read_error' && 'Unable to read onboarding status'}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => setShowOnboarding((v) => !v)}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
          >
            {showOnboarding
              ? 'Hide onboarding'
              : onboardingComplete
                ? 'View onboarding'
                : 'Complete onboarding'}
          </button>

          {/* Authenticated control — gated behind onboarding (Req 5.3, 5.5).
              Marked disabled (aria-disabled) while incomplete; if activated it
              routes through the gate and sends the Operator to onboarding. The
              public Save & Test button above is never gated (Req 5.4). */}
          <button
            onClick={handleAuthenticatedAction}
            aria-disabled={!onboardingComplete}
            data-testid="authenticated-action"
            className={`px-3 py-1.5 text-xs font-medium text-white rounded-md transition-colors ${
              onboardingComplete
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-gray-300 cursor-not-allowed'
            }`}
          >
            Verify Authenticated Connection
          </button>
        </div>

        {authActionMessage && (
          <p className="mt-2 text-xs text-gray-600" role="status">
            {authActionMessage}
          </p>
        )}

        {showOnboarding && (
          <div className="mt-3 border border-gray-200 rounded-md overflow-hidden">
            <Onboarding record={onboardingRecord} onComplete={handleOnboardingComplete} />
          </div>
        )}
      </div>

      {/* Help text */}
      <div className="mt-6 pt-4 border-t border-gray-200">
        <p className="text-xs text-gray-400">
          The Worker API URL should point to your deployed Cloudflare Worker.
          It must use HTTPS.
        </p>
      </div>
    </div>
  );
}
