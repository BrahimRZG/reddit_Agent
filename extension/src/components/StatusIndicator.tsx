import type { ConnectionState } from '../types';

interface StatusIndicatorProps {
  state: ConnectionState;
}

/**
 * Renders a small accessible colored status dot based on connection state.
 *
 * Colors:
 * - connected → green
 * - update-required → amber
 * - offline / server-error → red
 * - loading / not-configured → gray
 */
export function StatusIndicator({ state }: StatusIndicatorProps) {
  const colorClass = getColorClass(state);

  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${colorClass}`}
      role="status"
      aria-label={getAriaLabel(state)}
    />
  );
}

function getColorClass(state: ConnectionState): string {
  switch (state.status) {
    case 'connected':
      return 'bg-green-500';
    case 'update-required':
      return 'bg-amber-500';
    case 'offline':
    case 'server-error':
      return 'bg-red-500';
    case 'loading':
    case 'not-configured':
      return 'bg-gray-400';
  }
}

function getAriaLabel(state: ConnectionState): string {
  switch (state.status) {
    case 'connected':
      return 'Connected';
    case 'update-required':
      return 'Update required';
    case 'offline':
      return 'Offline';
    case 'server-error':
      return 'Server error';
    case 'loading':
      return 'Loading';
    case 'not-configured':
      return 'Not configured';
  }
}
