import { useEffect, useState } from 'react';
import type { ConnectionState, ValidationResult } from '../types';
import { DEFAULT_WORKER_API_URL } from '../types';
import { getWorkerApiBaseUrl, setWorkerApiBaseUrl, StorageError } from '../lib/storage';
import { validateWorkerApiUrl } from '../lib/url-validator';
import { checkStatus } from '../lib/api-client';
import { verifyAuth } from '../lib/api-client';
import { satisfiesMinimum } from '../lib/semver';
import {
  getCredentials,
  setCredentials,
  clearCredentials,
  hasCredentials,
  type InstallCredentials,
} from '../lib/credential-storage';
import { ConnectionBadge } from '../components/ConnectionBadge';

const EXTENSION_VERSION = '1.0.0';

export function Settings() {
  // --- URL Config State ---
  const [urlInput, setUrlInput] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [saved, setSaved] = useState(false);

  // --- Credential State ---
  const [installIdInput, setInstallIdInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [credentialStatus, setCredentialStatus] = useState<'idle' | 'saved' | 'error' | 'testing' | 'verified' | 'revoked' | 'invalid'>('idle');
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [storedInstallId, setStoredInstallId] = useState<string | null>(null);
  const [hasStoredCredentials, setHasStoredCredentials] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // --- Load state on mount ---
  useEffect(() => {
    (async () => {
      const currentUrl = await getWorkerApiBaseUrl();
      setUrlInput(currentUrl);

      const creds = await getCredentials();
      if (creds) {
        setStoredInstallId(creds.installId);
        setHasStoredCredentials(true);
        setInstallIdInput(creds.installId);
      }
    })();
  }, []);

  // --- URL Handlers ---
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

  // --- Credential Handlers ---
  const handleSaveCredentials = async () => {
    setCredentialError(null);
    setCredentialStatus('idle');

    if (!installIdInput.trim()) {
      setCredentialError('Install ID is required.');
      return;
    }
    if (!tokenInput.trim()) {
      setCredentialError('Install token is required.');
      return;
    }

    try {
      await setCredentials({ installId: installIdInput.trim(), token: tokenInput.trim() });
      setStoredInstallId(installIdInput.trim());
      setHasStoredCredentials(true);
      setCredentialStatus('saved');
      setTokenInput(''); // Clear token from input after saving
    } catch (err) {
      setCredentialError(err instanceof Error ? err.message : 'Failed to save credentials.');
      setCredentialStatus('error');
    }
  };

  const handleTestAuth = async () => {
    setCredentialStatus('testing');
    setCredentialError(null);

    const baseUrl = await getWorkerApiBaseUrl();
    const result = await verifyAuth(baseUrl);

    if (result.success) {
      setCredentialStatus('verified');
    } else {
      if (result.error.message.includes('revoked')) {
        setCredentialStatus('revoked');
        setCredentialError('Token has been revoked. Please obtain a new token from your admin.');
        await clearCredentials();
        setHasStoredCredentials(false);
        setStoredInstallId(null);
      } else if (result.error.status === 401) {
        setCredentialStatus('invalid');
        setCredentialError('Authentication failed. Verify your token was entered correctly.');
      } else {
        setCredentialStatus('error');
        setCredentialError(result.error.message);
      }
    }
  };

  const handleClearCredentials = async () => {
    await clearCredentials();
    setHasStoredCredentials(false);
    setStoredInstallId(null);
    setInstallIdInput('');
    setTokenInput('');
    setCredentialStatus('idle');
    setCredentialError(null);
    setShowClearConfirm(false);
  };

  const isUrlValid = urlInput.length > 0 && !validationError;

  return (
    <div className="max-w-lg mx-auto p-6 bg-white min-h-screen space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-gray-900">
          Reddit Marketing Agent — Settings
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure your Worker API connection and credentials.
        </p>
      </div>

      {/* Section 1: Worker API URL */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-gray-800">Worker API Endpoint</h2>

        <div className="space-y-2">
          <label htmlFor="worker-url" className="block text-xs text-gray-600">
            Base URL
          </label>
          <input
            id="worker-url"
            type="url"
            value={urlInput}
            onChange={handleUrlChange}
            placeholder="https://your-worker.workers.dev"
            maxLength={256}
            className={`w-full px-3 py-2 text-sm border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              validationError ? 'border-red-300 focus:ring-red-500' : 'border-gray-300'
            }`}
          />
          {validationError && <p className="text-xs text-red-600">{validationError}</p>}
          {saveError && <p className="text-xs text-red-600">{saveError}</p>}
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleSaveAndTest}
            disabled={!isUrlValid || isTesting}
            className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-md transition-colors"
          >
            {isTesting ? 'Testing...' : 'Save & Test'}
          </button>
          <button
            onClick={handleResetDefault}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
          >
            Reset Default
          </button>
        </div>

        {connectionState && (
          <div className="p-2 bg-gray-50 rounded-md">
            <ConnectionBadge state={connectionState} />
          </div>
        )}

        {saved && !saveError && connectionState?.status === 'connected' && (
          <p className="text-xs text-green-600">URL saved and connection verified.</p>
        )}
      </section>

      {/* Divider */}
      <hr className="border-gray-200" />

      {/* Section 2: Credentials */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-gray-800">Authentication</h2>

        {hasStoredCredentials ? (
          /* Credentials are stored — show status and management */
          <div className="space-y-3">
            <div className="p-3 bg-gray-50 rounded-md space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Install ID</span>
                <span className="text-xs font-mono text-gray-700">{storedInstallId}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-block w-2 h-2 rounded-full ${
                  credentialStatus === 'verified' ? 'bg-green-500' :
                  credentialStatus === 'revoked' || credentialStatus === 'invalid' ? 'bg-red-500' :
                  credentialStatus === 'testing' ? 'bg-yellow-400 animate-pulse' :
                  'bg-gray-400'
                }`} />
                <span className="text-xs text-gray-600">
                  {credentialStatus === 'verified' && 'Authenticated'}
                  {credentialStatus === 'revoked' && 'Revoked'}
                  {credentialStatus === 'invalid' && 'Invalid'}
                  {credentialStatus === 'testing' && 'Testing...'}
                  {credentialStatus === 'saved' && 'Saved (not yet tested)'}
                  {credentialStatus === 'idle' && 'Ready'}
                  {credentialStatus === 'error' && 'Error'}
                </span>
              </div>
            </div>

            {credentialError && (
              <p className="text-xs text-red-600">{credentialError}</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleTestAuth}
                disabled={credentialStatus === 'testing'}
                className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-md transition-colors"
              >
                {credentialStatus === 'testing' ? 'Testing...' : 'Test Authentication'}
              </button>

              {!showClearConfirm ? (
                <button
                  onClick={() => setShowClearConfirm(true)}
                  className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                >
                  Clear Credentials
                </button>
              ) : (
                <div className="flex gap-1">
                  <button
                    onClick={handleClearCredentials}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors"
                  >
                    Confirm Remove
                  </button>
                  <button
                    onClick={() => setShowClearConfirm(false)}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* No credentials — show setup form */
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              Enter the install credentials provided by your admin. The token is shown only once during provisioning.
            </p>

            <div className="space-y-2">
              <label htmlFor="install-id" className="block text-xs text-gray-600">
                Install ID
              </label>
              <input
                id="install-id"
                type="text"
                value={installIdInput}
                onChange={(e) => { setInstallIdInput(e.target.value); setCredentialError(null); }}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="w-full px-3 py-2 text-sm font-mono border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="install-token" className="block text-xs text-gray-600">
                Install Token
              </label>
              <div className="relative">
                <input
                  id="install-token"
                  type={showToken ? 'text' : 'password'}
                  value={tokenInput}
                  onChange={(e) => { setTokenInput(e.target.value); setCredentialError(null); }}
                  placeholder="Paste your install token"
                  className="w-full px-3 py-2 pr-16 text-sm font-mono border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700"
                >
                  {showToken ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {credentialError && (
              <p className="text-xs text-red-600">{credentialError}</p>
            )}

            <button
              onClick={handleSaveCredentials}
              disabled={!installIdInput.trim() || !tokenInput.trim()}
              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-md transition-colors"
            >
              Save Credentials
            </button>
          </div>
        )}
      </section>

      {/* Footer */}
      <div className="pt-4 border-t border-gray-200">
        <p className="text-xs text-gray-400">
          The Worker API URL must use HTTPS. Install tokens are stored locally and never sent to any server except your configured Worker API.
        </p>
      </div>
    </div>
  );
}
