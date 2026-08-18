/**
 * Post-startup marketplace reconcile planning.
 * Pure helpers — no network, no store. Used after first render.
 */

import { findTruckMarketItem, STARTER_TRUCK } from '../data/trucks';
import type { Truck } from '../types/game';
import type { AuthoritativeMarketplaceReconciliation } from './vehicleMarketplaceReconciliation';
import { reconcileFleetWithVehicleMarketplace } from './vehicleMarketplaceReconciliation';

export const MARKETPLACE_STARTUP_RECONCILE_TIMEOUT_MS = 8_000;

export const MARKETPLACE_RECOVERED_PURCHASE_TOAST = {
  title: 'Araç satın alımı tamamlandı',
  messageFor(vehicleName: string): string {
    return `${vehicleName} filona eklendi.`;
  },
};

export function getMarketplaceVehicleDisplayName(templateId: string): string {
  if (templateId === STARTER_TRUCK.catalogId) return STARTER_TRUCK.name;
  return findTruckMarketItem(templateId)?.name ?? 'Bilinmeyen Model';
}

export type MarketplaceStartupReconcilePlan = {
  shouldApply: boolean;
  addedVehicleIds: string[];
  recoveredPurchaseVehicleIds: string[];
  toastVehicleIds: string[];
  nextCash: number;
  authoritativeCash: number | undefined;
};

export function planMarketplaceStartupReconcile(input: {
  localTruckIds: string[];
  localCash: number;
  localMarketplaceStateVersion: number;
  acknowledgedVehicleIds: string[];
  authoritative: AuthoritativeMarketplaceReconciliation;
}): MarketplaceStartupReconcilePlan {
  const localIds = new Set(input.localTruckIds);
  const sold = new Set(input.authoritative.soldTruckIds);
  const addedVehicles = input.authoritative.vehicles.filter(
    (vehicle) => !sold.has(vehicle.truckId) && !localIds.has(vehicle.truckId),
  );
  const addedVehicleIds = addedVehicles.map((vehicle) => vehicle.truckId);
  const recoveredPurchaseVehicleIds = addedVehicles
    .filter((vehicle) => vehicle.status === 'idle')
    .map((vehicle) => vehicle.truckId);
  const acknowledged = new Set(input.acknowledgedVehicleIds);
  const toastVehicleIds = recoveredPurchaseVehicleIds.filter((id) => !acknowledged.has(id));
  const versionIncreased =
    input.authoritative.marketplaceStateVersion > input.localMarketplaceStateVersion;
  const authoritativeCash = Number.isFinite(input.authoritative.cash)
    ? Number(input.authoritative.cash)
    : undefined;
  const nextCash = authoritativeCash ?? input.localCash;
  return {
    shouldApply: addedVehicleIds.length > 0 || versionIncreased,
    addedVehicleIds,
    recoveredPurchaseVehicleIds,
    toastVehicleIds,
    nextCash,
    authoritativeCash,
  };
}

export function applyMarketplaceStartupReconcilePlan(
  localTrucks: Truck[],
  authoritative: AuthoritativeMarketplaceReconciliation,
): ReturnType<typeof reconcileFleetWithVehicleMarketplace> {
  return reconcileFleetWithVehicleMarketplace(localTrucks, authoritative);
}

export function isMarketplaceStartupReconcileNoop(plan: MarketplaceStartupReconcilePlan): boolean {
  return !plan.shouldApply && plan.toastVehicleIds.length === 0;
}
