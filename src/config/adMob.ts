/**
 * AdMob App ID + rewarded ad unit yapılandırması.
 *
 * EXPO_PUBLIC_ADS_MODE:
 * - stub       → 350ms stub (yalnızca __DEV__)
 * - test       → Google TestIds.REWARDED
 * - production → gerçek ad unit ID'leri
 *
 * EXPO_PUBLIC_ADS_USE_TEST_IDS=true
 * → Play Internal Testing release build'de bile TestIds.REWARDED kullanır.
 * Mağaza yayını öncesi false yapılmalı.
 *
 * EXPO_PUBLIC_ADS_ENABLED=false → reklam UI/SDK kapalı
 *
 * Env yoksa: __DEV__ → test, release → production
 */

import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

export type AdsMode = 'stub' | 'test' | 'production';

/**
 * Expo Go, native AdMob modülünü (RNGoogleMobileAdsModule) içermez;
 * SDK require edilirse TurboModuleRegistry.getEnforcing hatası fırlatır.
 * Bu yüzden Expo Go'da her zaman stub moda düşülür.
 */
export function isRunningInExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

/** App ID (~) — native config plugin / AndroidManifest / Info.plist */
export const ADMOB_APP_IDS = {
  android: 'ca-app-pub-8214453687597896~5560651696',
  ios: 'ca-app-pub-8214453687597896~4247570027',
} as const;

/** Rewarded Ad Unit ID (/) — JS request */
export const ADMOB_REWARDED_UNIT_IDS = {
  android: 'ca-app-pub-8214453687597896/1840898530',
  ios: 'ca-app-pub-8214453687597896/4313204541',
} as const;

declare const __DEV__: boolean | undefined;

function isDevEnvironment(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

function readExtraAdsFlag(key: string): string | undefined {
  const extra = Constants.expoConfig?.extra as
    | { ads?: Record<string, unknown> }
    | undefined;
  const value = extra?.ads?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function isAdsEnabled(): boolean {
  const env = process.env.EXPO_PUBLIC_ADS_ENABLED?.trim().toLowerCase();
  if (env === 'false' || env === '0') return false;
  const extra = readExtraAdsFlag('enabled')?.toLowerCase();
  if (extra === 'false' || extra === '0') return false;
  return true;
}

export function shouldUseTestAdUnitIds(): boolean {
  if (process.env.EXPO_PUBLIC_ADS_USE_TEST_IDS === 'true') return true;
  if (readExtraAdsFlag('useTestIds') === 'true') return true;
  return false;
}

export function resolveAdsMode(): AdsMode {
  if (isRunningInExpoGo()) {
    return 'stub';
  }
  if (!isAdsEnabled()) {
    return 'stub';
  }

  // Internal Testing / diagnostics: force Google test rewarded units.
  if (shouldUseTestAdUnitIds()) {
    return 'test';
  }

  const raw =
    process.env.EXPO_PUBLIC_ADS_MODE?.trim().toLowerCase() ||
    readExtraAdsFlag('mode')?.toLowerCase();
  if (raw === 'stub' || raw === 'test' || raw === 'production') {
    return raw;
  }
  return isDevEnvironment() ? 'test' : 'production';
}

export function getConfiguredAppId(platform: 'android' | 'ios' = Platform.OS === 'ios' ? 'ios' : 'android'): string {
  return platform === 'ios' ? ADMOB_APP_IDS.ios : ADMOB_APP_IDS.android;
}

export function getProductionRewardedAdUnitId(): string {
  if (Platform.OS === 'ios') {
    return ADMOB_REWARDED_UNIT_IDS.ios;
  }
  return ADMOB_REWARDED_UNIT_IDS.android;
}

export function isValidAdMobAppId(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^ca-app-pub-\d+~\d+$/.test(value);
}

export function isValidAdMobUnitId(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^ca-app-pub-\d+\/\d+$/.test(value);
}

export function shouldShowTestAdLabel(mode: AdsMode = resolveAdsMode()): boolean {
  return mode === 'stub' || mode === 'test';
}

export function getAdsConfigAudit() {
  const androidAppId = ADMOB_APP_IDS.android;
  const iosAppId = ADMOB_APP_IDS.ios;
  const androidUnit = ADMOB_REWARDED_UNIT_IDS.android;
  const iosUnit = ADMOB_REWARDED_UNIT_IDS.ios;
  return {
    adsEnabled: isAdsEnabled(),
    mode: resolveAdsMode(),
    useTestIds: shouldUseTestAdUnitIds() || resolveAdsMode() === 'test',
    androidAppIdConfigured: isValidAdMobAppId(androidAppId),
    iosAppIdConfigured: isValidAdMobAppId(iosAppId),
    androidUnitConfigured: isValidAdMobUnitId(androidUnit),
    iosUnitConfigured: isValidAdMobUnitId(iosUnit),
    platform: Platform.OS,
  };
}
