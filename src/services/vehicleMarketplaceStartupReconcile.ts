/**
 * Non-blocking post-startup marketplace reconcile.
 * Runs after GAME_READY / first main screen render. Must never block boot.
 */

import { VEHICLE_MARKETPLACE_ENABLED } from '../config/backendRoadmap';
import {
  getMarketplaceVehicleDisplayName,
  MARKETPLACE_RECOVERED_PURCHASE_TOAST,
  MARKETPLACE_STARTUP_RECONCILE_TIMEOUT_MS,
  planMarketplaceStartupReconcile,
} from '../domain/vehicleMarketplaceStartupReconcile';
import { withMarketplacePurchaseTimeout } from '../domain/vehicleMarketplacePurchaseFlow';
import { useGameStore } from '../store/gameStore';
import { markStartup } from '../utils/startupPerformance';
import { isFirebaseEnabled } from './firebase';
import {
  beginPostStartupMarketplaceCloudHold,
  endPostStartupMarketplaceCloudHold,
  isPostStartupMarketplaceCloudHoldActive,
} from './marketplaceStartupCloudHold';
import {
  readRecoveredMarketplacePurchaseAcks,
  rememberRecoveredMarketplacePurchaseAcks,
} from './marketplaceRecoveredPurchaseAck';
import { getMyVehicleListings } from './vehicleMarketplaceService';

let reconcileInFlight: Promise<void> | null = null;
let completedThisSession = false;
let failedThisSession = false;

export function __resetPostStartupMarketplaceReconcileForTests(): void {
  reconcileInFlight = null;
  completedThisSession = false;
  failedThisSession = false;
}

export function hasPostStartupMarketplaceReconcileFailed(): boolean {
  return failedThisSession && !completedThisSession;
}

async function runPostStartupMarketplaceReconcileOnce(): Promise<void> {
  if (!VEHICLE_MARKETPLACE_ENABLED || !isFirebaseEnabled()) {
    completedThisSession = true;
    failedThisSession = false;
    return;
  }

  markStartup('MARKETPLACE_STARTUP_RECONCILE_START');
  try {
    const mine = await withMarketplacePurchaseTimeout(
      getMyVehicleListings(),
      MARKETPLACE_STARTUP_RECONCILE_TIMEOUT_MS,
    );
    if (!mine.ok || !mine.reconciliation) {
      failedThisSession = mine.reason !== 'auth-required' && mine.reason !== 'unauthenticated';
      if (mine.reason === 'auth-required' || mine.reason === 'unauthenticated') {
        completedThisSession = true;
        failedThisSession = false;
      }
      return;
    }

    const live = useGameStore.getState();
    const acknowledged = await readRecoveredMarketplacePurchaseAcks();
    const plan = planMarketplaceStartupReconcile({
      localTruckIds: live.player.trucks.map((truck) => truck.id),
      localCash: live.player.money,
      localMarketplaceStateVersion: live.vehicleMarketplace?.marketplaceStateVersion ?? 0,
      acknowledgedVehicleIds: acknowledged,
      authoritative: mine.reconciliation,
    });

    if (plan.shouldApply) {
      useGameStore.getState().applyVehicleMarketplaceReconciliation(mine.reconciliation);
    }

    if (plan.toastVehicleIds.length > 0) {
      const recovered = mine.reconciliation.vehicles.find(
        (vehicle) => vehicle.truckId === plan.toastVehicleIds[0],
      );
      const vehicleName = getMarketplaceVehicleDisplayName(
        recovered?.templateId ?? plan.toastVehicleIds[0],
      );
      useGameStore.getState().addNotification({
        time: useGameStore.getState().currentTime,
        type: 'success',
        title: MARKETPLACE_RECOVERED_PURCHASE_TOAST.title,
        message: MARKETPLACE_RECOVERED_PURCHASE_TOAST.messageFor(vehicleName),
      });
      await rememberRecoveredMarketplacePurchaseAcks(plan.toastVehicleIds);
    }

    completedThisSession = true;
    failedThisSession = false;
  } catch (error) {
    failedThisSession = true;
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.info('[MARKETPLACE_STARTUP_RECONCILE] skipped', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    markStartup('MARKETPLACE_STARTUP_RECONCILE_DONE');
  }
}

export async function runPostStartupMarketplaceReconcile(): Promise<void> {
  if (completedThisSession) {
    endPostStartupMarketplaceCloudHold();
    return;
  }
  if (reconcileInFlight) {
    await reconcileInFlight;
    return;
  }
  beginPostStartupMarketplaceCloudHold();
  reconcileInFlight = (async () => {
    try {
      await runPostStartupMarketplaceReconcileOnce();
    } finally {
      endPostStartupMarketplaceCloudHold();
      reconcileInFlight = null;
    }
  })();
  await reconcileInFlight;
}

export function retryPostStartupMarketplaceReconcileIfNeeded(): void {
  if (!failedThisSession || completedThisSession) return;
  if (isPostStartupMarketplaceCloudHoldActive()) return;
  void runPostStartupMarketplaceReconcile();
}

/**
 * Foreground reconcile for offline sales / purchases while the app was backgrounded.
 * Lightweight: fetches authoritative marketplace state and patches local fleet/cash when behind.
 */
export async function reconcileVehicleMarketplaceOnForeground(): Promise<void> {
  if (!VEHICLE_MARKETPLACE_ENABLED || !isFirebaseEnabled()) return;
  if (isPostStartupMarketplaceCloudHoldActive()) return;
  if (reconcileInFlight) {
    await reconcileInFlight;
    return;
  }

  reconcileInFlight = (async () => {
    try {
      const mine = await withMarketplacePurchaseTimeout(
        getMyVehicleListings(),
        MARKETPLACE_STARTUP_RECONCILE_TIMEOUT_MS,
      );
      if (!mine.ok || !mine.reconciliation) return;

      const live = useGameStore.getState();
      const plan = planMarketplaceStartupReconcile({
        localTruckIds: live.player.trucks.map((truck) => truck.id),
        localCash: live.player.money,
        localMarketplaceStateVersion: live.vehicleMarketplace?.marketplaceStateVersion ?? 0,
        acknowledgedVehicleIds: await readRecoveredMarketplacePurchaseAcks(),
        authoritative: mine.reconciliation,
      });

      if (plan.shouldApply) {
        useGameStore.getState().applyVehicleMarketplaceReconciliation(mine.reconciliation);
      }
    } catch (error) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.info('[MARKETPLACE_FOREGROUND_RECONCILE] skipped', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      reconcileInFlight = null;
    }
  })();

  await reconcileInFlight;
}
