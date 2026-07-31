import { httpsCallable, type Functions } from 'firebase/functions';

import {
  VEHICLE_MARKETPLACE_ENABLED,
  isVehicleMarketplaceMutationAllowed,
} from '../config/backendRoadmap';
import type { AuthoritativeMarketplaceReconciliation } from '../domain/vehicleMarketplaceReconciliation';
import {
  getMarketplaceBackendReason,
  getMarketplaceFirebaseErrorCode,
  mapMarketplaceCallableError,
} from '../domain/vehicleMarketplaceErrors';
import type {
  VehicleMarketplaceActionResult,
  VehicleMarketplaceCursor,
  VehicleMarketplaceFailureReason,
  VehicleMarketplaceListing,
  VehicleMarketplacePage,
} from '../types/vehicleMarketplace';
import {
  FIREBASE_FUNCTIONS_REGION,
  getFirebaseAppSafe,
  getFirebaseAuthSafe,
  getFirebaseFunctionsSafe,
} from './firebase';
import { isCloudSaveAccountConflictPending } from './cloudSaveConflictState';

export const VEHICLE_MARKETPLACE_FUNCTIONS_REGION = FIREBASE_FUNCTIONS_REGION;
export const VEHICLE_MARKETPLACE_CALLABLES = {
  create: 'createVehicleListing',
  cancel: 'cancelVehicleListing',
  purchase: 'purchaseVehicleListing',
  list: 'getVehicleMarketplaceListings',
  myListings: 'getMyVehicleListings',
  accountDeletion: 'prepareVehicleMarketplaceAccountDeletion',
} as const;

let createAuditLogged = false;
let marketplaceOperationCount = 0;
const callableConfigAudits = new Set<string>();

export function isVehicleMarketplaceOperationActive(): boolean {
  return marketplaceOperationCount > 0;
}

function getVehicleMarketplaceFunctions(): Functions | null {
  return getFirebaseFunctionsSafe(VEHICLE_MARKETPLACE_FUNCTIONS_REGION);
}

function callable<TInput, TOutput>(name: string) {
  const firebaseApp = getFirebaseAppSafe();
  const functions = getVehicleMarketplaceFunctions();
  if (!firebaseApp || !functions) return null;
  if (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    !callableConfigAudits.has(name)
  ) {
    callableConfigAudits.add(name);
    const user = getFirebaseAuthSafe()?.currentUser;
    console.info('[marketplace-callable-config]', {
      projectId: firebaseApp.options.projectId ?? null,
      region: VEHICLE_MARKETPLACE_FUNCTIONS_REGION,
      callableName: name,
      authenticated: Boolean(user && !user.isAnonymous),
      uidPresent: Boolean(user?.uid),
    });
  }
  return httpsCallable<TInput, TOutput>(functions, name);
}

type TimestampLike = number | { seconds?: number; _seconds?: number };

function timestampToMs(value: TimestampLike | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  const seconds = value?.seconds ?? value?._seconds;
  return Number.isFinite(seconds) ? Number(seconds) * 1_000 : undefined;
}

function normalizeListing(
  listing: VehicleMarketplaceListing & {
    createdAt: TimestampLike;
    updatedAt: TimestampLike;
    expiresAt: TimestampLike;
    soldAt?: TimestampLike;
  },
): VehicleMarketplaceListing {
  return {
    ...listing,
    createdAt: timestampToMs(listing.createdAt) ?? 0,
    updatedAt: timestampToMs(listing.updatedAt) ?? 0,
    expiresAt: timestampToMs(listing.expiresAt) ?? 0,
    soldAt: timestampToMs(listing.soldAt),
  };
}

export interface MarketplaceActionEnvelope {
  transactionId: string;
  idempotencyKey: string;
}

function failure<T>(
  input: MarketplaceActionEnvelope,
  reason: VehicleMarketplaceFailureReason,
): VehicleMarketplaceActionResult<T> {
  return { ok: false, reason, ...input };
}

function errorRecord(error: unknown): Record<string, unknown> {
  return error && typeof error === 'object'
    ? (error as Record<string, unknown>)
    : {};
}

function logCallableError(error: unknown): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  const details = errorRecord(errorRecord(error).details);
  console.warn('[vehicle-marketplace-callable-error]', {
    firebaseCode: getMarketplaceFirebaseErrorCode(error) || null,
    backendReason: getMarketplaceBackendReason(error) ?? null,
    message:
      typeof errorRecord(error).message === 'string'
        ? errorRecord(error).message
        : null,
    details: {
      reason: typeof details.reason === 'string' ? details.reason : null,
    },
  });
}

function currentNetworkAvailability(): boolean | null {
  if (typeof navigator === 'undefined' || !('onLine' in navigator)) return null;
  return navigator.onLine;
}

function anonymizedUid(uid?: string): string | null {
  return uid ? `${uid.slice(0, 4)}…${uid.slice(-3)}` : null;
}

export async function createVehicleListing(input: MarketplaceActionEnvelope & {
  truckId: string;
  askingPrice: number;
  clientSaveVersion?: number;
}): Promise<VehicleMarketplaceActionResult<{ listingId: string; recommendedPrice: number }>> {
  const user = getFirebaseAuthSafe()?.currentUser;
  if (!isVehicleMarketplaceMutationAllowed()) {
    return failure(input, 'service-unavailable');
  }
  if (isCloudSaveAccountConflictPending()) return failure(input, 'save-conflict');
  if (!user || user.isAnonymous) return failure(input, 'auth-required');

  const action = callable<typeof input, VehicleMarketplaceActionResult<{
    listingId: string;
    recommendedPrice: number;
  }>>(VEHICLE_MARKETPLACE_CALLABLES.create);
  if (!action) return failure(input, 'service-unavailable');
  marketplaceOperationCount += 1;
  try {
    const result = (await action(input)).data;
    if (typeof __DEV__ !== 'undefined' && __DEV__ && !createAuditLogged) {
      createAuditLogged = true;
      console.info('[vehicle-marketplace-create-audit]', {
        featureEnabled: VEHICLE_MARKETPLACE_ENABLED,
        authenticated: true,
        uid: anonymizedUid(user.uid),
        functionsRegion: VEHICLE_MARKETPLACE_FUNCTIONS_REGION,
        callableName: VEHICLE_MARKETPLACE_CALLABLES.create,
        hasMarketplaceState:
          result.reason !== 'marketplace-state-missing',
        marketplaceStateVersion: null,
        selectedTruckId: input.truckId,
        requestedPrice: input.askingPrice,
        clientSaveVersion: input.clientSaveVersion ?? null,
        networkAvailable: currentNetworkAvailability(),
      });
    }
    return result;
  } catch (error) {
    logCallableError(error);
    return failure(input, mapMarketplaceCallableError(error));
  } finally {
    marketplaceOperationCount = Math.max(0, marketplaceOperationCount - 1);
  }
}

export async function cancelVehicleListing(input: MarketplaceActionEnvelope & {
  listingId: string;
  listingVersion: number;
}): Promise<VehicleMarketplaceActionResult<{ listingId: string }>> {
  if (!isVehicleMarketplaceMutationAllowed()) return failure(input, 'service-unavailable');
  const user = getFirebaseAuthSafe()?.currentUser;
  if (!user || user.isAnonymous) return failure(input, 'auth-required');
  const action = callable<typeof input, VehicleMarketplaceActionResult<{
    listingId: string;
  }>>(VEHICLE_MARKETPLACE_CALLABLES.cancel);
  if (!action) return failure(input, 'service-unavailable');
  marketplaceOperationCount += 1;
  try {
    return (await action(input)).data;
  } catch (error) {
    logCallableError(error);
    return failure(input, mapMarketplaceCallableError(error));
  } finally {
    marketplaceOperationCount = Math.max(0, marketplaceOperationCount - 1);
  }
}

export async function purchaseVehicleListing(input: MarketplaceActionEnvelope & {
  listingId: string;
  listingVersion: number;
  quotedPrice: number;
  clientSaveVersion?: number;
}): Promise<VehicleMarketplaceActionResult<{
  listingId: string;
  grossPrice: number;
  marketplaceFee: number;
  sellerNet: number;
}>> {
  if (!isVehicleMarketplaceMutationAllowed()) return failure(input, 'service-unavailable');
  const user = getFirebaseAuthSafe()?.currentUser;
  if (!user || user.isAnonymous) return failure(input, 'auth-required');
  const action = callable<typeof input, VehicleMarketplaceActionResult<{
    listingId: string;
    grossPrice: number;
    marketplaceFee: number;
    sellerNet: number;
  }>>(VEHICLE_MARKETPLACE_CALLABLES.purchase);
  if (!action) return failure(input, 'service-unavailable');
  marketplaceOperationCount += 1;
  try {
    return (await action(input)).data;
  } catch (error) {
    logCallableError(error);
    return failure(input, mapMarketplaceCallableError(error));
  } finally {
    marketplaceOperationCount = Math.max(0, marketplaceOperationCount - 1);
  }
}

export async function getVehicleMarketplaceListings(
  limit = 20,
  cursor?: VehicleMarketplaceCursor,
): Promise<VehicleMarketplacePage> {
  const action = callable<
    { limit: number; cursor?: VehicleMarketplaceCursor },
    VehicleMarketplacePage
  >(VEHICLE_MARKETPLACE_CALLABLES.list);
  if (!action) {
    return { ok: false, listings: [], hasMore: false, reason: 'service-unavailable' };
  }
  try {
    const result = (await action({ limit, cursor })).data;
    return {
      ...result,
      listings: result.listings.map((listing) =>
        normalizeListing(listing as Parameters<typeof normalizeListing>[0])),
    };
  } catch (error) {
    logCallableError(error);
    return {
      ok: false,
      listings: [],
      hasMore: false,
      reason: mapMarketplaceCallableError(error),
    };
  }
}

export async function getMyVehicleListings(): Promise<{
  ok: boolean;
  listings: VehicleMarketplaceListing[];
  reconciliation?: AuthoritativeMarketplaceReconciliation | null;
  reason?: VehicleMarketplaceFailureReason;
}> {
  const action = callable<
    Record<string, never>,
    {
      ok: boolean;
      listings: VehicleMarketplaceListing[];
      reconciliation?: AuthoritativeMarketplaceReconciliation | null;
      reason?: VehicleMarketplaceFailureReason;
    }
  >(VEHICLE_MARKETPLACE_CALLABLES.myListings);
  if (!action) return { ok: false, listings: [], reason: 'service-unavailable' };
  try {
    const result = (await action({})).data;
    return {
      ...result,
      listings: result.listings.map((listing) =>
        normalizeListing(listing as Parameters<typeof normalizeListing>[0])),
    };
  } catch (error) {
    logCallableError(error);
    return {
      ok: false,
      listings: [],
      reason: mapMarketplaceCallableError(error),
    };
  }
}

export async function prepareVehicleMarketplaceAccountDeletion(): Promise<boolean> {
  const action = callable<Record<string, never>, { ok: boolean }>(
    VEHICLE_MARKETPLACE_CALLABLES.accountDeletion,
  );
  if (!action) return false;
  return (await action({})).data.ok;
}
