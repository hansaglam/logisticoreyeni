import type { Functions } from 'firebase/functions';
import { Platform } from 'react-native';

import {
  VEHICLE_MARKETPLACE_ENABLED,
  isVehicleMarketplaceMutationAllowed,
} from '../config/backendRoadmap';
import type { AuthoritativeMarketplaceReconciliation } from '../domain/vehicleMarketplaceReconciliation';
import {
  parseVehicleMarketplaceListResponse,
  parseVehicleMarketplaceMyListingsResponse,
} from '../domain/vehicleMarketplaceResponseParser';
import {
  getMarketplaceBackendReason,
  getMarketplaceFirebaseErrorCode,
} from '../domain/vehicleMarketplaceErrors';
import type {
  VehicleMarketplaceActionResult,
  VehicleMarketplaceCursor,
  VehicleMarketplaceFailureReason,
  VehicleMarketplaceListing,
  VehicleMarketplacePage,
} from '../types/vehicleMarketplace';
import {
  isAuthSessionReady,
  waitForInitialAuthState,
} from './authService';
import { isCloudSaveAccountConflictPending } from './cloudSaveConflictState';
import {
  FIREBASE_FUNCTIONS_REGION,
  getFirebaseAppSafe,
  getFirebaseAuthSafe,
  getFirebaseFunctionsSafe,
} from './firebase';
import {
  callMarketplaceFunction,
  getThrownMarketplaceReason,
  type MarketplaceCallableName,
} from './marketplaceCallable';
import { recordMarketplaceCallableResult } from './backendDiagnostics';
import { logMarketplaceLoadError } from '../utils/marketplaceSellDiagnostics';

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

async function ensureMarketplaceAuthReady(): Promise<{
  ok: true;
  uid: string;
} | { ok: false; reason: VehicleMarketplaceFailureReason }> {
  await waitForInitialAuthState();
  const user = getFirebaseAuthSafe()?.currentUser ?? null;
  if (!user || user.isAnonymous) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.info('[MARKETPLACE_AUTH]', {
        source: 'ensureMarketplaceAuthReady',
        firebaseCurrentUserUid: user?.uid ?? null,
        firebaseIsAnonymous: user?.isAnonymous ?? null,
        providerIds: (user?.providerData ?? []).map((entry) => entry.providerId),
        authReady: isAuthSessionReady(),
        marketplaceAccessResult: 'GUEST',
      });
    }
    return { ok: false, reason: 'auth-required' };
  }
  return { ok: true, uid: user.uid };
}

function auditCallableConfig(name: MarketplaceCallableName): void {
  if (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    !callableConfigAudits.has(name)
  ) {
    callableConfigAudits.add(name);
    const firebaseApp = getFirebaseAppSafe();
    const user = getFirebaseAuthSafe()?.currentUser;
    console.info('[vehicle-marketplace-config]', {
      platform: Platform.OS,
      projectId: firebaseApp?.options.projectId ?? null,
      functionsRegion: VEHICLE_MARKETPLACE_FUNCTIONS_REGION,
      callableName: name,
      featureEnabled: VEHICLE_MARKETPLACE_ENABLED,
      authenticated: Boolean(user && !user.isAnonymous),
      uidPresent: Boolean(user?.uid),
    });
  }
}

type TimestampLike = number | { seconds?: number; _seconds?: number };

/** @deprecated Use vehicleMarketplaceResponseParser */
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

function logCallableError(error: unknown, callableName: string): void {
  const user = getFirebaseAuthSafe()?.currentUser ?? null;
  const firebaseCode = getMarketplaceFirebaseErrorCode(error) || null;
  const backendReason = getMarketplaceBackendReason(error) ?? null;
  console.warn('[marketplace-callable-failed]', {
    callableName,
    firebaseCode,
    firestoreErrorCode:
      typeof errorRecord(error).code === 'string'
        ? errorRecord(error).code
        : null,
    firestoreErrorMessage:
      typeof errorRecord(error).message === 'string'
        ? errorRecord(error).message
        : null,
    collections: [
      'vehicleMarketplaceListings',
      'vehicleMarketplaceTransactions',
      'vehicleMarketplaceRateLimits',
      'vehicleMarketplaceIdempotency',
      'vehicleMarketplaceActionReceipts',
    ],
    authReady: isAuthSessionReady(),
    userPresent: Boolean(user),
    anonymous: user?.isAnonymous ?? null,
    uid: user?.uid ?? null,
    providerIds: (user?.providerData ?? []).map((entry) => entry.providerId),
    region: VEHICLE_MARKETPLACE_FUNCTIONS_REGION,
    projectId: getFirebaseAppSafe()?.options.projectId ?? null,
    backendReason,
  });
  recordMarketplaceCallableResult({
    success: false,
    code: firebaseCode ?? backendReason ?? 'callable-failed',
    detail: callableName,
  });
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    const details = errorRecord(errorRecord(error).details);
    console.warn('[vehicle-marketplace-callable-error]', {
      firebaseCode,
      backendReason,
      message:
        typeof errorRecord(error).message === 'string'
          ? errorRecord(error).message
          : null,
      details: {
        reason: typeof details.reason === 'string' ? details.reason : null,
      },
    });
  }
}

function logAuthRequiredCallable(callableName: string): void {
  const user = getFirebaseAuthSafe()?.currentUser ?? null;
  console.warn('[marketplace-callable-failed]', {
    callableName,
    firebaseCode: 'auth-required',
    authReady: isAuthSessionReady(),
    userPresent: Boolean(user),
    anonymous: user?.isAnonymous ?? null,
    region: VEHICLE_MARKETPLACE_FUNCTIONS_REGION,
    projectId: getFirebaseAppSafe()?.options.projectId ?? null,
  });
  recordMarketplaceCallableResult({
    success: false,
    code: 'auth-required',
    detail: callableName,
  });
}

function currentNetworkAvailability(): boolean | null {
  if (typeof navigator === 'undefined' || !('onLine' in navigator)) return null;
  return navigator.onLine;
}

function anonymizedUid(uid?: string): string | null {
  return uid ? `${uid.slice(0, 4)}…${uid.slice(-3)}` : null;
}

async function invokeMarketplaceCallable<TRequest, TResponse>(
  name: MarketplaceCallableName,
  payload: TRequest,
): Promise<
  | { ok: true; data: TResponse }
  | { ok: false; reason: VehicleMarketplaceFailureReason }
> {
  const functions = getVehicleMarketplaceFunctions();
  if (!getFirebaseAppSafe() || !functions) {
    return { ok: false, reason: 'service-unavailable' };
  }
  auditCallableConfig(name);
  try {
    const data = await callMarketplaceFunction<TRequest, TResponse>(
      name,
      functions,
      payload,
    );
    return { ok: true, data };
  } catch (error) {
    logCallableError(error, name);
    return { ok: false, reason: getThrownMarketplaceReason(error) };
  }
}

export async function createVehicleListing(input: MarketplaceActionEnvelope & {
  truckId: string;
  askingPrice: number;
  clientSaveVersion?: number;
}): Promise<VehicleMarketplaceActionResult<{ listingId: string; recommendedPrice: number }>> {
  if (!isVehicleMarketplaceMutationAllowed()) {
    return failure(input, 'service-unavailable');
  }
  if (isCloudSaveAccountConflictPending()) return failure(input, 'save-conflict');
  const auth = await ensureMarketplaceAuthReady();
  if (!auth.ok) {
    logAuthRequiredCallable(VEHICLE_MARKETPLACE_CALLABLES.create);
    return failure(input, auth.reason);
  }

  marketplaceOperationCount += 1;
  try {
    const result = await invokeMarketplaceCallable<
      typeof input,
      VehicleMarketplaceActionResult<{
        listingId: string;
        recommendedPrice: number;
      }>
    >(VEHICLE_MARKETPLACE_CALLABLES.create, input);
    if (!result.ok) return failure(input, result.reason);
    const data = result.data;
    if (typeof __DEV__ !== 'undefined' && __DEV__ && !createAuditLogged) {
      createAuditLogged = true;
      console.info('[vehicle-marketplace-create-audit]', {
        featureEnabled: VEHICLE_MARKETPLACE_ENABLED,
        authenticated: true,
        uid: anonymizedUid(auth.uid),
        functionsRegion: VEHICLE_MARKETPLACE_FUNCTIONS_REGION,
        callableName: VEHICLE_MARKETPLACE_CALLABLES.create,
        hasMarketplaceState:
          data.reason !== 'marketplace-state-missing',
        marketplaceStateVersion: null,
        selectedTruckId: input.truckId,
        requestedPrice: input.askingPrice,
        clientSaveVersion: input.clientSaveVersion ?? null,
        networkAvailable: currentNetworkAvailability(),
      });
    }
    return data;
  } finally {
    marketplaceOperationCount = Math.max(0, marketplaceOperationCount - 1);
  }
}

export async function cancelVehicleListing(input: MarketplaceActionEnvelope & {
  listingId: string;
  listingVersion: number;
}): Promise<VehicleMarketplaceActionResult<{ listingId: string }>> {
  if (!isVehicleMarketplaceMutationAllowed()) return failure(input, 'service-unavailable');
  const auth = await ensureMarketplaceAuthReady();
  if (!auth.ok) {
    logAuthRequiredCallable(VEHICLE_MARKETPLACE_CALLABLES.cancel);
    return failure(input, auth.reason);
  }
  marketplaceOperationCount += 1;
  try {
    const result = await invokeMarketplaceCallable<
      typeof input,
      VehicleMarketplaceActionResult<{ listingId: string }>
    >(VEHICLE_MARKETPLACE_CALLABLES.cancel, input);
    if (!result.ok) return failure(input, result.reason);
    return result.data;
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
  const auth = await ensureMarketplaceAuthReady();
  if (!auth.ok) {
    logAuthRequiredCallable(VEHICLE_MARKETPLACE_CALLABLES.purchase);
    return failure(input, auth.reason);
  }
  marketplaceOperationCount += 1;
  try {
    const result = await invokeMarketplaceCallable<
      typeof input,
      VehicleMarketplaceActionResult<{
        listingId: string;
        grossPrice: number;
        marketplaceFee: number;
        sellerNet: number;
      }>
    >(VEHICLE_MARKETPLACE_CALLABLES.purchase, input);
    if (!result.ok) return failure(input, result.reason);
    return result.data;
  } finally {
    marketplaceOperationCount = Math.max(0, marketplaceOperationCount - 1);
  }
}

export async function getVehicleMarketplaceListings(
  limit = 20,
  cursor?: VehicleMarketplaceCursor,
): Promise<VehicleMarketplacePage> {
  const auth = await ensureMarketplaceAuthReady();
  if (!auth.ok) {
    logAuthRequiredCallable(VEHICLE_MARKETPLACE_CALLABLES.list);
    return { ok: false, listings: [], hasMore: false, reason: auth.reason };
  }

  const result = await invokeMarketplaceCallable<
    { limit: number; cursor?: VehicleMarketplaceCursor },
    Record<string, unknown>
  >(VEHICLE_MARKETPLACE_CALLABLES.list, { limit, cursor });
  if (!result.ok) {
    logMarketplaceLoadError({
      code: result.reason,
      message: result.reason,
      callableName: VEHICLE_MARKETPLACE_CALLABLES.list,
    });
    return {
      ok: false,
      listings: [],
      hasMore: false,
      reason: result.reason,
    };
  }

  const parsed = parseVehicleMarketplaceListResponse(result.data, 'list');
  if (!parsed.success) {
    logMarketplaceLoadError({
      code: parsed.reason,
      message: parsed.detail ?? 'list-response-parse-failed',
      callableName: VEHICLE_MARKETPLACE_CALLABLES.list,
      field: parsed.field,
      detail: parsed.detail,
    });
    recordMarketplaceCallableResult({
      success: false,
      code: parsed.reason,
      detail: `${VEHICLE_MARKETPLACE_CALLABLES.list}:${parsed.field ?? 'envelope'}`,
    });
    return {
      ok: false,
      listings: [],
      hasMore: false,
      reason: parsed.reason,
    };
  }

  recordMarketplaceCallableResult({ success: true, code: null });
  return parsed.data;
}

export async function getMyVehicleListings(): Promise<{
  ok: boolean;
  listings: VehicleMarketplaceListing[];
  reconciliation?: AuthoritativeMarketplaceReconciliation | null;
  reason?: VehicleMarketplaceFailureReason;
}> {
  const auth = await ensureMarketplaceAuthReady();
  if (!auth.ok) {
    logAuthRequiredCallable(VEHICLE_MARKETPLACE_CALLABLES.myListings);
    return { ok: false, listings: [], reason: auth.reason };
  }

  const result = await invokeMarketplaceCallable<
    Record<string, never>,
    Record<string, unknown>
  >(VEHICLE_MARKETPLACE_CALLABLES.myListings, {});
  if (!result.ok) {
    return { ok: false, listings: [], reason: result.reason };
  }

  const parsed = parseVehicleMarketplaceMyListingsResponse(result.data);
  if (!parsed.success) {
    recordMarketplaceCallableResult({
      success: false,
      code: parsed.reason,
      detail: `${VEHICLE_MARKETPLACE_CALLABLES.myListings}:${parsed.field ?? 'envelope'}`,
    });
    return { ok: false, listings: [], reason: parsed.reason };
  }

  return {
    ok: true,
    listings: parsed.data.listings,
    reconciliation: parsed.data.reconciliation as AuthoritativeMarketplaceReconciliation | null,
  };
}

export async function prepareVehicleMarketplaceAccountDeletion(): Promise<boolean> {
  const auth = await ensureMarketplaceAuthReady();
  if (!auth.ok) return false;
  const result = await invokeMarketplaceCallable<Record<string, never>, { ok: boolean }>(
    VEHICLE_MARKETPLACE_CALLABLES.accountDeletion,
    {},
  );
  if (!result.ok) return false;
  return result.data.ok;
}
