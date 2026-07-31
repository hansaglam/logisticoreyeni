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
  const backendReason = getMarketplaceBackendReason(error);
  if (backendReason) return backendReason;
  switch (getMarketplaceFirebaseErrorCode(error)) {
    case 'functions/unauthenticated':
      return 'auth-required';
    case 'functions/permission-denied':
      return 'permission-denied';
    case 'functions/not-found':
      return 'function-not-found';
    case 'functions/deadline-exceeded':
    case 'functions/cancelled':
      return 'network-error';
    case 'functions/failed-precondition':
      return 'save-conflict';
    case 'functions/unavailable':
      return 'service-unavailable';
    default:
      return 'service-unavailable';
  }
}
