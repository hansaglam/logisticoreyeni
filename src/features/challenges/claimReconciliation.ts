import { useGameStore } from '../../store/gameStore';
import { getMyVehicleListings } from '../../services/vehicleMarketplaceService';

export async function reconcileChallengeClaimCash(expectedCashAfter?: number): Promise<boolean> {
  if (expectedCashAfter !== undefined && !Number.isFinite(expectedCashAfter)) return false;
  const result = await getMyVehicleListings();
  if (!result.ok || !result.reconciliation) return false;
  const applied = useGameStore
    .getState()
    .applyVehicleMarketplaceReconciliation(result.reconciliation);
  if (!applied) return false;
  const localCash = useGameStore.getState().player?.money;
  return (
    Number.isFinite(localCash) &&
    (expectedCashAfter === undefined || Math.abs(Number(localCash) - expectedCashAfter) < 0.01)
  );
}
