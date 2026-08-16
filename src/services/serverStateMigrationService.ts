import { httpsCallable } from 'firebase/functions';

import {
  getAuthUidSnapshot,
  isAuthContextStale,
  withCallableTimeout,
} from './callableServiceUtils';
import { isAuthSessionReady, waitForInitialAuthState } from './authService';
import { FIREBASE_FUNCTIONS_REGION, getFirebaseFunctionsSafe } from './firebase';

const MIGRATE_CALLABLE = 'migrateLegacyServerState';
const RECONCILE_FLEET_CALLABLE = 'reconcileAuthoritativeFleet';

export async function ensureServerStateMigrated(): Promise<{
  ok: boolean;
  reason?: string;
}> {
  if (!isAuthSessionReady()) {
    await waitForInitialAuthState();
  }
  const functions = getFirebaseFunctionsSafe(FIREBASE_FUNCTIONS_REGION);
  if (!functions) {
    return { ok: false, reason: 'firebase-disabled' };
  }
  const uidAtStart = getAuthUidSnapshot();
  const action = httpsCallable<{ dryRun?: boolean }, {
    ok: boolean;
    reason?: string;
  }>(functions, MIGRATE_CALLABLE);
  try {
    const response = await withCallableTimeout(action({ dryRun: false }));
    if (isAuthContextStale(uidAtStart)) {
      return { ok: false, reason: 'auth-required' };
    }
    const data = response.data;
    if (data.ok) {
      return { ok: true };
    }
    if (data.reason === 'migration-already-completed') {
      return { ok: true };
    }
    return { ok: false, reason: data.reason ?? 'service-unavailable' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'migration-failed';
    if (message.includes('not-found')) {
      return { ok: true };
    }
    return { ok: false, reason: message };
  }
}

export async function reconcileAuthoritativeFleet(options?: {
  force?: boolean;
  requestedVehicleId?: string;
}): Promise<{
  ok: boolean;
  reconciled?: boolean;
  ownedTruckIds?: string[];
  reason?: string;
}> {
  if (!isAuthSessionReady()) {
    await waitForInitialAuthState();
  }
  const functions = getFirebaseFunctionsSafe(FIREBASE_FUNCTIONS_REGION);
  if (!functions) {
    return { ok: false, reason: 'firebase-disabled' };
  }
  const uidAtStart = getAuthUidSnapshot();
  const action = httpsCallable<
    { force?: boolean; requestedVehicleId?: string },
    {
      ok: boolean;
      reconciled?: boolean;
      ownedTruckIds?: string[];
      reason?: string;
    }
  >(functions, RECONCILE_FLEET_CALLABLE);
  try {
    const response = await withCallableTimeout(
      action({
        force: options?.force === true,
        requestedVehicleId: options?.requestedVehicleId,
      }),
    );
    if (isAuthContextStale(uidAtStart)) {
      return { ok: false, reason: 'auth-required' };
    }
    const data = response.data;
    if (data.ok) {
      return {
        ok: true,
        reconciled: data.reconciled === true,
        ownedTruckIds: data.ownedTruckIds,
      };
    }
    return { ok: false, reason: data.reason ?? 'service-unavailable' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'reconcile-failed';
    if (message.includes('not-found')) {
      return { ok: false, reason: 'function-not-found' };
    }
    return { ok: false, reason: message };
  }
}

export async function ensureAuthoritativeFleetReady(options?: {
  requestedVehicleId?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const migration = await ensureServerStateMigrated();
  if (!migration.ok && migration.reason !== 'function-not-found') {
    return migration;
  }
  const reconcile = await reconcileAuthoritativeFleet({
    requestedVehicleId: options?.requestedVehicleId,
  });
  if (!reconcile.ok) {
    if (reconcile.reason === 'marketplace-state-missing') {
      return { ok: true };
    }
    return reconcile;
  }
  return { ok: true };
}
