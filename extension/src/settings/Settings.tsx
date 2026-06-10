import { useEffect, useState } from 'react';
import type { ConnectionState, ValidationResult } from '../types';
import { DEFAULT_WORKER_API_URL } from '../types';
import { getWorkerApiBaseUrl, setWorkerApiBaseUrl, StorageError } from '../lib/storage';
import { validateWorkerApiUrl } from '../lib/url-validator';
import { checkStatus } from '../lib/api-client';
import { satisfiesMinimum } from '../lib/semver';
import { ConnectionBadge } from '../components/ConnectionBadge';

const EXTENSION_VERSION = '1.0.0';

export function Settings() {
  const [urlInput, setUrlInput] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load current URL on mount
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

    // Live validation feedback (only show errors, not success)
    if (value.length > 0) {
      const result = validateWorkerApiUrl(value);
      if (!result.valid) {
        setValidationError(result.error);
      }
    }
  };

  const handleSaveAndTest = async () => {
    // Validate
    const validation: ValidationResult = validateWorkerApiUrl(urlInput);
    if (!validation.valid) {
      setValidationError(validation.error);
      return;
    }

    setValidationError(null);
    setSaveError(null);
    setSaved(false);

    // Save normalized URL
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

    // Test connection
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

        {/* Validation error */}
        {validationError && (
          <p className="text-xs text-red-600">{validationError}</p>
        )}

        {/* Save error */}
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
          {(connectionState.status === 'offline' ||
            connectionState.status === 'server-error') && (
            <button
              onClick={handleSaveAndTest}
              className="mt-2 px-3 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded transition-colors"
            >
              Test Again
            </button>
          )}
        </div>
      )}

      {/* Save confirmation */}
      {saved && !saveError && connectionState?.status === 'connected' && (
        <p className="mt-3 text-xs text-green-600">
          ✓ Settings saved and connection verified.
        </p>
      )}

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
