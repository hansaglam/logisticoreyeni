/**
 * AdMob App ID + rewarded ad unit yapılandırması.
 *
 * EXPO_PUBLIC_ADS_MODE:
 * - stub       → 350ms stub (yalnızca __DEV__)
 * - test       → Google TestIds.REWARDED
 * - production → gerçek ad unit ID'leri
 *
 * EXPO_PUBLIC_ADS_USE_TEST_IDS=true
 * → Play Internal Testing / DEV builds use SDK TestIds.REWARDED
 *   (iOS: …/1712485313, Android: …/5224354917). Do NOT switch DEV to live ads.
 * Mağaza yayını öncesi false yapılmalı.
 *
 * EXPO_PUBLIC_ADS_ENABLED=false → reklam UI/SDK kapalı
 *
 * Env yoksa: __DEV__ → test, release → production
 * LOGISTICORE_BUILD_PROFILE=production always blocks test unit IDs.
 */

import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

import { isStoreProductionProfile } from './buildProfile';

import {
  ADMOB_APP_IDS,
  ADMOB_DELIVERY_BOOST_REWARDED_UNIT_IDS,
  ADMOB_REWARDED_UNIT_IDS,
  isValidAdMobAppId,
  isValidAdMobUnitId,
} from './adMobConstants';

export {
  ADMOB_APP_IDS,
  ADMOB_REWARDED_UNIT_IDS,
  isValidAdMobAppId,
  isValidAdMobUnitId,
};

export type AdsMode = 'stub' | 'test' | 'production';

/**
 * Expo Go, native AdMob modülünü (RNGoogleMobileAdsModule) içermez;
 * SDK require edilirse TurboModuleRegistry.getEnforcing hatası fırlatır.
 * Bu yüzden Expo Go'da her zaman stub moda düşülür.
 * Native availability itself is Bridge OR TurboModule (see googleMobileAdsNativeAvailability).
 */
export function isRunningInExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

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
  if (process.env.LOGISTICORE_BUILD_PROFILE === 'production') {
    return false;
  }
  if (isStoreProductionProfile()) {
    return false;
  }
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

function readEnvDeliveryBoostUnitId(platform: 'android' | 'ios'): string | undefined {
  const key =
    platform === 'ios'
      ? 'EXPO_PUBLIC_DELIVERY_BOOST_REWARDED_IOS_ID'
      : 'EXPO_PUBLIC_DELIVERY_BOOST_REWARDED_ANDROID_ID';
  const value = process.env[key]?.trim();
  return value && isValidAdMobUnitId(value) ? value : undefined;
}

export function getProductionDeliveryBoostRewardedAdUnitId(): string {
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const fromEnv = readEnvDeliveryBoostUnitId(platform);
  if (fromEnv) {
    return fromEnv;
  }
  return platform === 'ios'
    ? ADMOB_DELIVERY_BOOST_REWARDED_UNIT_IDS.ios
    : ADMOB_DELIVERY_BOOST_REWARDED_UNIT_IDS.android;
}

/**
 * Game UI must never advertise "Test reklam" — Google's own creative may show
 * "Test mode" inside DEV/INTERNAL test units; that is expected and left alone.
 *
 * @deprecated Always false. Kept for import compatibility.
 */
export function shouldShowTestAdLabel(_mode: AdsMode = resolveAdsMode()): boolean {
  return false;
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
