/**
 * Persist recovered marketplace purchase acknowledgements so the
 * "Araç satın alımı tamamlandı" toast is not shown on every launch.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const ACK_KEY = '@logisticore/marketplaceRecoveredPurchaseAcks';
const MAX_ACKS = 100;

export type MarketplaceAckStore = {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
};

export async function readRecoveredMarketplacePurchaseAcks(
  store: MarketplaceAckStore = AsyncStorage,
): Promise<string[]> {
  try {
    const raw = await store.getItem(ACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { vehicleIds?: unknown };
    if (!Array.isArray(parsed.vehicleIds)) return [];
    return parsed.vehicleIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

export async function rememberRecoveredMarketplacePurchaseAcks(
  vehicleIds: string[],
  store: MarketplaceAckStore = AsyncStorage,
): Promise<string[]> {
  if (vehicleIds.length === 0) {
    return readRecoveredMarketplacePurchaseAcks(store);
  }
  const existing = await readRecoveredMarketplacePurchaseAcks(store);
  const merged = [...existing];
  const seen = new Set(existing);
  for (const id of vehicleIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  const next = merged.slice(-MAX_ACKS);
  try {
    await store.setItem(ACK_KEY, JSON.stringify({ vehicleIds: next }));
  } catch {
    // best-effort
  }
  return next;
}

export function shouldShowRecoveredPurchaseToast(
  recoveredVehicleIds: string[],
  acknowledgedVehicleIds: string[],
): string[] {
  const acknowledged = new Set(acknowledgedVehicleIds);
  return recoveredVehicleIds.filter((id) => !acknowledged.has(id));
}
