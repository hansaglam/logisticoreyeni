/**
 * Cloud-save reconcile must not undo a committed marketplace purchase or sale.
 * Stale local fleet/cash can be newer on disk timestamps while older in content.
 */

export function resolveStaleCloudMarketplaceOverwrite(params: {
  existingCash: number;
  cloudCash: number;
  existingVehicleIds: string[];
  cloudVehicleIds: string[];
  soldTruckIds: string[];
  existingMarketplaceStateVersion?: number;
  cloudSourceSaveVersion?: number;
}): {
  cash: number;
  preservedVehicleIds: string[];
  rejectedStaleCashRestore: boolean;
  rejectedStaleVehicleRemoval: boolean;
  keptMarketplaceMutation: boolean;
} {
  const sold = new Set(params.soldTruckIds);
  const cloudIds: string[] = [];
  const seen = new Set<string>();
  for (const id of params.cloudVehicleIds) {
    if (sold.has(id) || seen.has(id)) continue;
    seen.add(id);
    cloudIds.push(id);
  }
  const extras = params.existingVehicleIds.filter(
    (id) => !sold.has(id) && !seen.has(id),
  );
  for (const id of extras) {
    seen.add(id);
  }

  const staleCloudFleetHasSoldTruck = params.cloudVehicleIds.some((id) => sold.has(id));
  const saleProceedsOnMarketplace =
    sold.size > 0 && params.existingCash > params.cloudCash + 1e-9;
  const purchaseDebitOnMarketplace =
    extras.length > 0 && params.existingCash + 1e-9 < params.cloudCash;
  const keepMarketplaceMutation =
    extras.length > 0 ||
    staleCloudFleetHasSoldTruck ||
    saleProceedsOnMarketplace ||
    purchaseDebitOnMarketplace;

  return {
    cash: keepMarketplaceMutation ? params.existingCash : params.cloudCash,
    preservedVehicleIds: [...cloudIds, ...extras],
    rejectedStaleCashRestore:
      keepMarketplaceMutation && params.cloudCash !== params.existingCash,
    rejectedStaleVehicleRemoval: extras.length > 0 || staleCloudFleetHasSoldTruck,
    keptMarketplaceMutation: keepMarketplaceMutation,
  };
}
