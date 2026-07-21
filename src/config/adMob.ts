/**
 * AdMob App ID + rewarded ad unit yapılandırması.
 *
 * EXPO_PUBLIC_ADS_MODE:
 * - stub       → 350ms stub (yalnızca __DEV__)
 * - test       → Google TestIds.REWARDED
 * - production → gerçek ad unit ID'leri
 *
 * Env yoksa: __DEV__ → test, release → production
 */

import { Platform } from 'react-native';

export type AdsMode = 'stub' | 'test' | 'production';

export const ADMOB_APP_IDS = {
  android: 'ca-app-pub-8214453687597896~5560651696',
  ios: 'ca-app-pub-8214453687597896~4247570027',
} as const;

export const ADMOB_REWARDED_UNIT_IDS = {
  android: 'ca-app-pub-8214453687597896/1840898530',
  ios: 'ca-app-pub-8214453687597896/4313204541',
} as const;

declare const __DEV__: boolean | undefined;

function isDevEnvironment(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

export function resolveAdsMode(): AdsMode {
  const raw = process.env.EXPO_PUBLIC_ADS_MODE?.trim().toLowerCase();
  if (raw === 'stub' || raw === 'test' || raw === 'production') {
    return raw;
  }
  return isDevEnvironment() ? 'test' : 'production';
}

export function getProductionRewardedAdUnitId(): string {
  if (Platform.OS === 'ios') {
    return ADMOB_REWARDED_UNIT_IDS.ios;
  }
  return ADMOB_REWARDED_UNIT_IDS.android;
}

export function shouldShowTestAdLabel(mode: AdsMode = resolveAdsMode()): boolean {
  return mode === 'stub' || (mode === 'test' && isDevEnvironment());
}
