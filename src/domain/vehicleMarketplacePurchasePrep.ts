/**
 * Araç Pazarı satın alma öncesi bulut + authoritative nakit senkronu.
 */

import { ensureAuthoritativeFleetReady } from '../services/serverStateMigrationService';
import { getMyVehicleListings } from '../services/vehicleMarketplaceService';
import { syncLocalSaveToCloud } from '../storage/cloudSaveSync';
import { SAVE_GAME_VERSION } from '../storage/saveGame';
import { getSaveContentRevision } from '../storage/saveRevision';
import { useGameStore } from '../store/gameStore';
import type { VehicleMarketplaceFailureReason } from '../types/vehicleMarketplace';

export interface MarketplacePurchasePrepResult {
  ok: boolean;
  cash: number;
  clientSaveVersion: number;
  fleetLimit?: number | null;
  reason?: VehicleMarketplaceFailureReason | string;
}

export function resolveMarketplaceClientSaveVersion(
  marketplaceStateVersion?: number,
): number {
  return Math.max(
    SAVE_GAME_VERSION,
    getSaveContentRevision(),
    useGameStore.getState().vehicleMarketplace?.marketplaceStateVersion ?? 0,
    marketplaceStateVersion ?? 0,
  );
}

export async function prepareMarketplacePurchaseFunds(): Promise<MarketplacePurchasePrepResult> {
  const applyReconciliation = useGameStore.getState().applyVehicleMarketplaceReconciliation;
  const fallbackCash = () => useGameStore.getState().player.money;

  const synced = await syncLocalSaveToCloud('manual', {
    force: true,
    state: useGameStore.getState(),
  });
  if (!synced && typeof __DEV__ !== 'undefined' && __DEV__) {
    console.warn('[vehicle-marketplace] cloud sync before purchase failed');
  }

  const fleetReady = await ensureAuthoritativeFleetReady();
  if (!fleetReady.ok && fleetReady.reason !== 'function-not-found') {
    return {
      ok: false,
      cash: fallbackCash(),
      clientSaveVersion: resolveMarketplaceClientSaveVersion(),
      reason: fleetReady.reason ?? 'service-unavailable',
    };
  }

  const mine = await getMyVehicleListings();
  if (!mine.ok) {
    return {
      ok: false,
      cash: fallbackCash(),
      clientSaveVersion: resolveMarketplaceClientSaveVersion(),
      reason: mine.reason ?? 'service-unavailable',
    };
  }

  if (mine.reconciliation) {
    applyReconciliation(mine.reconciliation);
  }

  const cash = mine.reconciliation?.cash ?? fallbackCash();
  return {
    ok: true,
    cash,
    clientSaveVersion: resolveMarketplaceClientSaveVersion(
      mine.reconciliation?.marketplaceStateVersion,
    ),
    fleetLimit:
      mine.reconciliation?.fleetLimit != null && Number.isFinite(mine.reconciliation.fleetLimit)
        ? Number(mine.reconciliation.fleetLimit)
        : null,
  };
}
