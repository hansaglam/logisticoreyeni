import { Asset } from 'expo-asset';

import { getTurkeyLogisticsNetworkMapModule } from '../assets/mapAssets';
import { logPerfMapAsset, measureAsyncTask, readPerfNow } from './performanceDiagnostics';

let preloadPromise: Promise<void> | null = null;
let preloadedAt: number | null = null;

export function isMapAssetPreloaded(): boolean {
  return preloadedAt != null;
}

export function preloadMapAssets(): Promise<void> {
  if (preloadPromise) {
    return preloadPromise;
  }
  preloadPromise = measureAsyncTask('map-asset-preload', async () => {
    const started = readPerfNow();
    const asset = Asset.fromModule(getTurkeyLogisticsNetworkMapModule());
    await asset.downloadAsync();
    preloadedAt = Date.now();
    logPerfMapAsset({
      phase: 'preload',
      durationMs: Math.round((readPerfNow() - started) * 10) / 10,
      cached: false,
    });
  }, 'boot-preload').catch((error) => {
    preloadPromise = null;
    console.warn('[map] asset preload failed', error);
  }) as Promise<void>;
  return preloadPromise;
}
