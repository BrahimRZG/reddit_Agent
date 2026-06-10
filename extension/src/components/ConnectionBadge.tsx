import type { ConnectionState } from '../types';
import { StatusIndicator } from './StatusIndicator';

interface ConnectionBadgeProps {
  state: ConnectionState;
}

/**
 * Renders a status badge with colored dot and readable status text.
 * Covers all 6 ConnectionState variants.
 */
export function ConnectionBadge({ state }: ConnectionBadgeProps) {
  return (
    <div className="flex items-center gap-2">
      <StatusIndicator state={state} />
      <span className={`text-xs font-medium ${getTextClass(state)}`}>
        {getStatusText(state)}
      </span>
    </div>
  );
}

function getTextClass(state: ConnectionState): string {
  switch (state.status) {
    case 'connected':
      return 'text-green-700';
    case 'update-required':
      return 'text-amber-700';
    case 'offline':
    case 'server-error':
      return 'text-red-700';
    case 'loading':
    case 'not-configured':
      return 'text-gray-500';
  }
}

function getStatusText(state: ConnectionState): string {
  switch (state.status) {
    case 'connected':
      return 'Connected';
    case 'update-required':
      return `Update required (v${state.minimumVersion})`;
    case 'offline':
      return state.reason === 'timeout' ? 'Request timed out' : 'Offline';
    case 'server-error':
      return `Server error (HTTP ${state.httpStatus})`;
    case 'loading':
      return 'Checking connection…';
    case 'not-configured':
      return 'Not configured';
  }
}
