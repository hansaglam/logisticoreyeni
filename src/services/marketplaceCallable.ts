import { httpsCallable, type Functions } from 'firebase/functions';

import {
  MARKETPLACE_TIMEOUT_ERROR,
  mapFirebaseErrorToMarketplaceKind,
} from '../domain/marketplaceErrorModel';
import {
  getMarketplaceBackendReason,
  getMarketplaceFirebaseErrorCode,
} from '../domain/vehicleMarketplaceErrors';
import type { VehicleMarketplaceFailureReason } from '../types/vehicleMarketplace';

export const MARKETPLACE_CALL_TIMEOUT_MS = 15_000;

export type MarketplaceCallableName =
  | 'getVehicleMarketplaceListings'
  | 'getMyVehicleListings'
  | 'createVehicleListing'
  | 'purchaseVehicleListing'
  | 'cancelVehicleListing'
  | 'prepareVehicleMarketplaceAccountDeletion';

function mapThrownCallableError(error: unknown): VehicleMarketplaceFailureReason {
  const backendReason = getMarketplaceBackendReason(error);
  if (backendReason) return backendReason;

  if (error instanceof Error && error.message === MARKETPLACE_TIMEOUT_ERROR) {
    return 'timeout';
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'network-error';
  }

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
    case 'rate-limited':
      return 'rate-limited';
    case 'conflict':
      return 'save-conflict';
    case 'invalid-response':
      return 'invalid-request';
    case 'index-building':
    case 'server-error':
    case 'offline':
    case 'unknown':
      return 'service-unavailable';
    default:
      return 'service-unavailable';
  }
}

export function logMarketplaceCallableFailure(
  callableName: MarketplaceCallableName,
  error: unknown,
): void {
  console.warn('[marketplace-callable-failed]', {
    callableName,
    firebaseCode: getMarketplaceFirebaseErrorCode(error) || null,
    backendReason: getMarketplaceBackendReason(error) ?? null,
  });
}

async function withMarketplaceTimeout<T>(
  promise: Promise<T>,
  timeoutMs = MARKETPLACE_CALL_TIMEOUT_MS,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(MARKETPLACE_TIMEOUT_ERROR)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function callMarketplaceFunction<TRequest, TResponse>(
  name: MarketplaceCallableName,
  functions: Functions,
  payload: TRequest,
): Promise<TResponse> {
  const action = httpsCallable<TRequest, TResponse>(functions, name);
  try {
    const result = await withMarketplaceTimeout(action(payload));
    return result.data;
  } catch (error) {
    logMarketplaceCallableFailure(name, error);
    throw Object.assign(new Error(mapThrownCallableError(error)), {
      marketplaceReason: mapThrownCallableError(error),
      cause: error,
    });
  }
}

export function getThrownMarketplaceReason(error: unknown): VehicleMarketplaceFailureReason {
  const reason = (error as { marketplaceReason?: unknown })?.marketplaceReason;
  if (typeof reason === 'string') {
    return reason as VehicleMarketplaceFailureReason;
  }
  return mapThrownCallableError(error);
}
