/**
 * Offline progression — hafif gerçek zaman meta persist (force close güvenliği).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getEconomyNow } from '../simulation/economyClock';

const OFFLINE_META_STORAGE_KEY = 'logisticore_offline_meta_v1';

export interface OfflineMeta {
  lastSimulatedRealTimeMs: number;
  lastSimulationGameSpeed: number;
  savedAt?: number;
}

export async function saveOfflineMeta(meta: OfflineMeta): Promise<void> {
  if (
    !Number.isFinite(meta.lastSimulatedRealTimeMs) ||
    meta.lastSimulatedRealTimeMs <= 0
  ) {
    return;
  }
  const payload: OfflineMeta = {
    lastSimulatedRealTimeMs: meta.lastSimulatedRealTimeMs,
    lastSimulationGameSpeed:
      Number.isFinite(meta.lastSimulationGameSpeed) && meta.lastSimulationGameSpeed > 0
        ? meta.lastSimulationGameSpeed
        : 1,
    savedAt: getEconomyNow(),
  };
  await AsyncStorage.setItem(OFFLINE_META_STORAGE_KEY, JSON.stringify(payload));
}

export async function loadOfflineMeta(): Promise<OfflineMeta | null> {
  try {
    const json = await AsyncStorage.getItem(OFFLINE_META_STORAGE_KEY);
    if (!json) {
      return null;
    }
    const parsed = JSON.parse(json) as Partial<OfflineMeta>;
    if (
      parsed.lastSimulatedRealTimeMs == null ||
      !Number.isFinite(parsed.lastSimulatedRealTimeMs) ||
      parsed.lastSimulatedRealTimeMs <= 0
    ) {
      return null;
    }
    return {
      lastSimulatedRealTimeMs: parsed.lastSimulatedRealTimeMs,
      lastSimulationGameSpeed:
        parsed.lastSimulationGameSpeed != null &&
        Number.isFinite(parsed.lastSimulationGameSpeed) &&
        parsed.lastSimulationGameSpeed > 0
          ? parsed.lastSimulationGameSpeed
          : 1,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

export async function clearOfflineMeta(): Promise<void> {
  await AsyncStorage.removeItem(OFFLINE_META_STORAGE_KEY);
}
