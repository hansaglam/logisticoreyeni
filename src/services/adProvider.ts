/**
 * Ödüllü reklam sağlayıcı — AdMob Rewarded Ads + stub/test fallback.
 *
 * Store doğrudan SDK import etmez; yalnızca showRewardedAd / isAdProviderAvailable kullanır.
 *
 * TODO (production release öncesi — iOS):
 * - App Tracking Transparency (expo-tracking-transparency) entegrasyonu
 * - Google UMP consent (EEA kullanıcıları, kişiselleştirilmiş / non-personalized ads)
 * - userTrackingUsageDescription app.config.js içinde tanımlı; runtime izin akışı eklenmeli
 */

import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';

import {
  getProductionRewardedAdUnitId,
  isRunningInExpoGo,
  resolveAdsMode,
  type AdsMode,
} from '../config/adMob';
import type { AdRewardSlotId } from '../types/monetization';

export type AdShowResult = 'completed' | 'skipped' | 'failed';

declare const __DEV__: boolean | undefined;

const STUB_AD_DELAY_MS = 350;
const REWARDED_LOAD_TIMEOUT_MS = 20_000;
const REWARDED_SHOW_TIMEOUT_MS = 120_000;

let isShowingAd = false;
let mobileAdsInitPromise: Promise<void> | null = null;
let nativeModuleChecked = false;
let nativeModuleAvailable = false;

function isDevEnvironment(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

function isSupportedPlatform(): boolean {
  return Platform.OS === 'android' || Platform.OS === 'ios';
}

type MobileAdsModule = typeof import('react-native-google-mobile-ads');

function getMobileAdsModule(): MobileAdsModule | null {
  if (!isSupportedPlatform() || isRunningInExpoGo()) {
    return null;
  }

  if (!nativeModuleChecked) {
    nativeModuleChecked = true;
    // Expo Go'nun native binary'sinde AdMob modülü yoktur. require çağrısı
    // TurboModuleRegistry.getEnforcing ile RedBox ürettiği için önce native
    // kayıt kontrolü yapılır; development/production build'lerde modül vardır.
    if (!NativeModules.RNGoogleMobileAdsModule) {
      nativeModuleAvailable = false;
      return null;
    }
    try {
      // Önce native modülün binary'de kayıtlı olduğunu throw etmeyen get() ile
      // doğrula; SDK import'u getEnforcing() çağırdığı için modül yoksa
      // Invariant Violation fırlatır ve LogBox'a ERROR düşer.
      if (TurboModuleRegistry.get('RNGoogleMobileAdsModule') == null) {
        nativeModuleAvailable = false;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('react-native-google-mobile-ads');
        nativeModuleAvailable = true;
      }
    } catch {
      nativeModuleAvailable = false;
    }
  }

  if (!nativeModuleAvailable) {
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-google-mobile-ads') as MobileAdsModule;
  } catch {
    return null;
  }
}

function resolveRewardedAdUnitId(mode: AdsMode): string | null {
  const mod = getMobileAdsModule();
  if (!mod) {
    return null;
  }

  if (mode === 'test') {
    return mod.TestIds.REWARDED;
  }

  if (mode === 'production') {
    return getProductionRewardedAdUnitId();
  }

  return null;
}

async function ensureMobileAdsInitialized(): Promise<boolean> {
  const mod = getMobileAdsModule();
  if (!mod) {
    return false;
  }

  if (!mobileAdsInitPromise) {
    mobileAdsInitPromise = mod
      .default()
      .initialize()
      .then(() => undefined)
      .catch((error) => {
        mobileAdsInitPromise = null;
        if (isDevEnvironment()) {
          console.warn('[adProvider] mobileAds initialize failed', error);
        }
        throw error;
      });
  }

  try {
    await mobileAdsInitPromise;
    return true;
  } catch {
    return false;
  }
}

/** Uygulama açılışında çağrılabilir — SDK init (stub modda no-op). */
export async function initializeAdProvider(): Promise<void> {
  const mode = resolveAdsMode();
  if (mode === 'stub' || !isSupportedPlatform()) {
    return;
  }
  await ensureMobileAdsInitialized();
}

export function getAdsMode(): AdsMode {
  return resolveAdsMode();
}

/** Stub: yalnızca __DEV__. Test/production: native modül mevcut olmalı. */
export function isAdProviderAvailable(): boolean {
  const mode = resolveAdsMode();
  if (mode === 'stub') {
    return isDevEnvironment();
  }
  return isSupportedPlatform() && getMobileAdsModule() != null;
}

async function showStubRewardedAd(): Promise<AdShowResult> {
  await new Promise((resolve) => setTimeout(resolve, STUB_AD_DELAY_MS));
  return 'completed';
}

async function showNativeRewardedAd(_slotId: AdRewardSlotId): Promise<AdShowResult> {
  if (isShowingAd) {
    return 'failed';
  }

  const mode = resolveAdsMode();
  const mod = getMobileAdsModule();
  const adUnitId = resolveRewardedAdUnitId(mode);

  if (!mod || !adUnitId) {
    return 'failed';
  }

  const initialized = await ensureMobileAdsInitialized();
  if (!initialized) {
    return 'failed';
  }

  isShowingAd = true;

  try {
    const { RewardedAd, RewardedAdEventType, AdEventType } = mod;
    const rewarded = RewardedAd.createForAdRequest(adUnitId);

    return await new Promise<AdShowResult>((resolve) => {
      let earned = false;
      let settled = false;
      let shown = false;

      const finish = (result: AdShowResult) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(result);
      };

      const loadTimeout = setTimeout(() => finish('failed'), REWARDED_LOAD_TIMEOUT_MS);
      const showTimeout = setTimeout(() => finish('failed'), REWARDED_SHOW_TIMEOUT_MS);

      const unsubLoaded = rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
        clearTimeout(loadTimeout);
        if (shown) {
          return;
        }
        shown = true;
        void rewarded.show().catch(() => finish('failed'));
      });

      const unsubEarned = rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        earned = true;
      });

      const unsubClosed = rewarded.addAdEventListener(AdEventType.CLOSED, () => {
        clearTimeout(showTimeout);
        finish(earned ? 'completed' : 'skipped');
      });

      const unsubError = rewarded.addAdEventListener(AdEventType.ERROR, () => {
        finish('failed');
      });

      const cleanup = () => {
        clearTimeout(loadTimeout);
        clearTimeout(showTimeout);
        unsubLoaded();
        unsubEarned();
        unsubClosed();
        unsubError();
      };

      rewarded.load();
    });
  } finally {
    isShowingAd = false;
  }
}

export async function showRewardedAd(slotId: AdRewardSlotId): Promise<AdShowResult> {
  const mode = resolveAdsMode();

  if (mode === 'stub') {
    if (!isDevEnvironment()) {
      return 'failed';
    }
    return showStubRewardedAd();
  }

  return showNativeRewardedAd(slotId);
}
