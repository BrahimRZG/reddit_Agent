import { useEffect, useRef, useState } from 'react';
import type { ConnectionState } from '../types';
import { getWorkerApiBaseUrl } from '../lib/storage';
import { checkStatus } from '../lib/api-client';
import { satisfiesMinimum } from '../lib/semver';
import { DraftCoPilot } from '../components/DraftCoPilot';
import { ConnectionBadge } from '../components/ConnectionBadge';
import { OnboardingGate } from '../components/OnboardingGate';
import { IntentScanner } from '../components/IntentScanner';

/** Current extension version — read from manifest at build time */
const EXTENSION_VERSION = '1.0.0';

export function Popup() {
  const [state, setState] = useState<ConnectionState>({ status: 'loading' });
  const checkingRef = useRef(false);

  const performCheck = async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setState({ status: 'loading' });

    try {
      const baseUrl = await getWorkerApiBaseUrl();

      // If the URL is empty or clearly not configured, show not-configured
      if (!baseUrl) {
        setState({ status: 'not-configured' });
        checkingRef.current = false;
        return;
      }

      const result = await checkStatus(baseUrl);

      if (result.success) {
        // Check version compatibility
        if (!satisfiesMinimum(EXTENSION_VERSION, result.data.minimum_extension_version)) {
          setState({
            status: 'update-required',
            minimumVersion: result.data.minimum_extension_version,
          });
        } else {
          setState({ status: 'connected', data: result.data });
        }
      } else {
        // Map error type to connection state
        switch (result.error.type) {
          case 'timeout':
            setState({ status: 'offline', reason: 'timeout' });
            break;
          case 'network':
            setState({ status: 'offline', reason: 'network' });
            break;
          case 'server':
          case 'parse':
            setState({
              status: 'server-error',
              httpStatus: result.error.status ?? 0,
            });
            break;
        }
      }
    } catch {
      setState({ status: 'offline', reason: 'network' });
    } finally {
      checkingRef.current = false;
    }
  };

  useEffect(() => {
    performCheck();
  }, []);

  const handleRetry = () => {
    performCheck();
  };

  const handleOpenSettings = () => {
    chrome.runtime.openOptionsPage();
  };

  return (
    <div className="w-80 p-4 bg-white">
      {/* Header — always rendered (outside the gate) so the Operator can reach
          Settings even while Compliance_Onboarding is incomplete (Req 5.4 path
          to the ungated Save & Test lives in Settings). */}
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-sm font-semibold text-gray-900">
          Reddit Marketing Agent
        </h1>
        <button
          onClick={handleOpenSettings}
          className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
          aria-label="Open settings"
          title="Settings"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-4 h-4"
          >
            <path
              fillRule="evenodd"
              d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.206 1.25l-1.18 2.045a1 1 0 01-1.187.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.114a7.05 7.05 0 010-2.227L1.821 7.773a1 1 0 01-.206-1.25l1.18-2.045a1 1 0 011.187-.447l1.598.54A6.993 6.993 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* The popup body is gated: while onboarding is incomplete the surface
          shows the Onboarding_Screen (Req 2.1). The public status check itself
          stays ungated (Property 6) and Settings keeps the always-available
          public Save & Test path (Req 5.4). */}
      <OnboardingGate>
        {/* Connection Status */}
        <div className="py-2">
          <ConnectionBadge state={state} />
        </div>

        {/* Retry button for error states */}
        {(state.status === 'offline' || state.status === 'server-error') && (
          <button
            onClick={handleRetry}
            className="mt-3 w-full px-3 py-1.5 text-xs font-medium text-white bg-gray-700 hover:bg-gray-800 rounded transition-colors"
          >
            Retry
          </button>
        )}

        {/* Not configured prompt */}
        {state.status === 'not-configured' && (
          <button
            onClick={handleOpenSettings}
            className="mt-3 w-full px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors"
          >
            Configure Connection
          </button>
        )}

       {/* Intent Scanner */}
        <IntentScanner />

        <DraftCoPilot />

        {/* Version info */}
        <p className="mt-3 text-[10px] text-gray-400">v{EXTENSION_VERSION}</p>
      </OnboardingGate>
    </div>
  );
}
