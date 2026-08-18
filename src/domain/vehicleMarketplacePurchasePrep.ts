/**
 * Araç Pazarı satın alma öncesi authoritative nakit okuma.
 * Confirm path must not await cloud save / fleet migrate — those can hang.
 */

import { getMyVehicleListings } from '../services/vehicleMarketplaceService';
import { SAVE_GAME_VERSION } from '../storage/saveGame';
import { getSaveContentRevision } from '../storage/saveRevision';
import { useGameStore } from '../store/gameStore';
import type { VehicleMarketplaceFailureReason } from '../types/vehicleMarketplace';
import {
  logMarketplacePurchase,
  withMarketplacePurchaseTimeout,
} from './vehicleMarketplacePurchaseFlow';

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
  const failed = (
    reason: VehicleMarketplaceFailureReason | string,
  ): MarketplacePurchasePrepResult => ({
    ok: false,
    cash: fallbackCash(),
    clientSaveVersion: resolveMarketplaceClientSaveVersion(),
    reason,
  });

  try {
    const mine = await withMarketplacePurchaseTimeout(getMyVehicleListings());
    if (!mine.ok) {
      logMarketplacePurchase('server balance confirmed', {
        ok: false,
        reason: mine.reason ?? 'service-unavailable',
      });
      return failed(mine.reason ?? 'service-unavailable');
    }

    if (mine.reconciliation) {
      applyReconciliation(mine.reconciliation);
    }

    const cash = mine.reconciliation?.cash ?? fallbackCash();
    logMarketplacePurchase('server balance confirmed', {
      ok: true,
      cash,
      fleetLimit: mine.reconciliation?.fleetLimit ?? null,
    });
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
  } catch (error) {
    logMarketplacePurchase('server balance confirmed', { ok: false, error });
    return failed('timeout');
  }
}
