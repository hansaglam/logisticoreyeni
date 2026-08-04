import AsyncStorage from '@react-native-async-storage/async-storage';

import type { GlobalEconomySnapshot } from '../types/game';
import { validateGlobalEconomySnapshot } from './globalEconomyClient';

const GLOBAL_ECONOMY_CACHE_KEY = 'logisticore_global_economy_cache_v1';
const GLOBAL_ECONOMY_CACHE_SCHEMA = 1;

export interface GlobalEconomyCacheRecord {
  schemaVersion: number;
  snapshot: GlobalEconomySnapshot;
  loadedAt: number;
  trusted: true;
}

export async function loadGlobalEconomyCache(): Promise<GlobalEconomyCacheRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(GLOBAL_ECONOMY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GlobalEconomyCacheRecord>;
    if (
      parsed.schemaVersion !== GLOBAL_ECONOMY_CACHE_SCHEMA ||
      parsed.trusted !== true ||
      !parsed.snapshot ||
      !Number.isFinite(parsed.loadedAt) ||
      !validateGlobalEconomySnapshot(parsed.snapshot).marketDataValid
    ) {
      return null;
    }
    return parsed as GlobalEconomyCacheRecord;
  } catch {
    return null;
  }
}

export async function saveGlobalEconomyCache(
  snapshot: GlobalEconomySnapshot,
  loadedAt: number,
): Promise<void> {
  if (!validateGlobalEconomySnapshot(snapshot).marketDataValid) return;
  const record: GlobalEconomyCacheRecord = {
    schemaVersion: GLOBAL_ECONOMY_CACHE_SCHEMA,
    snapshot,
    loadedAt,
    trusted: true,
  };
  await AsyncStorage.setItem(GLOBAL_ECONOMY_CACHE_KEY, JSON.stringify(record));
}

export { GLOBAL_ECONOMY_CACHE_KEY };
