import {
  isMarketplaceTimeoutError,
  mapFirebaseErrorToMarketplaceKind,
} from './marketplaceErrorModel';
import type { VehicleMarketplaceFailureReason } from '../types/vehicleMarketplace';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

export function getMarketplaceFirebaseErrorCode(error: unknown): string {
  const raw = String(record(error).code ?? '');
  return raw.startsWith('functions/') ? raw : raw ? `functions/${raw}` : '';
}

export function getMarketplaceBackendReason(
  error: unknown,
): VehicleMarketplaceFailureReason | undefined {
  const details = record(record(error).details);
  const reason =
    typeof details.reason === 'string'
      ? details.reason
      : typeof record(error).reason === 'string'
        ? record(error).reason
        : undefined;
  return reason as VehicleMarketplaceFailureReason | undefined;
}

export function mapMarketplaceCallableError(
  error: unknown,
): VehicleMarketplaceFailureReason {
  if (isMarketplaceTimeoutError(error)) return 'timeout';
  const backendReason = getMarketplaceBackendReason(error);
  if (backendReason) return backendReason;

  const kind = mapFirebaseErrorToMarketplaceKind(error);
  switch (kind) {
    case 'unauthenticated':
      return 'auth-required';
    case 'permission-denied':
      return 'permission-denied';
    case 'not-found':
      return 'function-not-found';
    case 'timeout':
      return 'timeout';
    case 'offline':
      return 'network-error';
    case 'rate-limited':
      return 'rate-limited';
    case 'conflict':
      return 'save-conflict';
    case 'invalid-response':
      return 'invalid-request';
    case 'index-building':
    case 'server-error':
    case 'unknown':
      return 'service-unavailable';
    default:
      return 'service-unavailable';
  }
}
