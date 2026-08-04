/**
 * Ödüllü reklam sağlayıcı — AdMob Rewarded Ads + stub/test fallback.
 *
 * Store doğrudan SDK import etmez; yalnızca showRewardedAd / isAdProviderAvailable kullanır.
 *
 * TODO (production release öncesi — iOS):
 * - App Tracking Transparency (expo-tracking-transparency) entegrasyonu
 * - Google UMP consent (EEA kullanıcıları)
 */

import Constants from 'expo-constants';
import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';

import {
  getAdsConfigAudit,
  getConfiguredAppId,
  getProductionRewardedAdUnitId,
  isAdsEnabled,
  isRunningInExpoGo,
  resolveAdsMode,
  shouldUseTestAdUnitIds,
  type AdsMode,
} from '../config/adMob';
import type { AdRewardSlotId } from '../types/monetization';

export type AdShowResult = 'completed' | 'skipped' | 'failed';

export type RewardedAdLifecycle =
  | 'idle'
  | 'loading'
  | 'loaded'
  | 'showing'
  | 'reward-earned'
  | 'closed'
  | 'failed';

export type RewardedAdErrorCategory =
  | 'no-fill'
  | 'network-error'
  | 'invalid-request'
  | 'app-id-missing'
  | 'ad-unit-id-missing'
  | 'ad-not-loaded'
  | 'internal-error'
  | 'consent-required'
  | 'sdk-not-initialized'
  | 'ads-disabled'
  | 'unsupported-platform'
  | 'module-unavailable'
  | 'timeout'
  | 'unknown';

export type AdsDiagnosticsSnapshot = {
  sdkInitialized: boolean;
  appIdConfigured: boolean;
  platformUnitConfigured: boolean;
  testIdActive: boolean;
  adsEnabled: boolean;
  mode: AdsMode;
  lifecycle: RewardedAdLifecycle;
  rewardedLoaded: boolean;
  lastErrorCategory: RewardedAdErrorCategory | null;
  lastRewardEvent: 'earned' | 'skipped' | 'failed' | null;
  adapterCount: number | null;
  platform: string;
};

declare const __DEV__: boolean | undefined;

const STUB_AD_DELAY_MS = 350;
const REWARDED_LOAD_TIMEOUT_MS = 20_000;
const REWARDED_SHOW_TIMEOUT_MS = 120_000;

let isShowingAd = false;
let mobileAdsInitPromise: Promise<boolean> | null = null;
let sdkInitialized = false;
let adapterCount: number | null = null;
let lifecycle: RewardedAdLifecycle = 'idle';
let lastErrorCategory: RewardedAdErrorCategory | null = null;
let lastRewardEvent: AdsDiagnosticsSnapshot['lastRewardEvent'] = null;
let rewardedLoaded = false;
let diagnosticsListeners = new Set<() => void>();

type MobileAdsModule = typeof import('react-native-google-mobile-ads');

function isDevEnvironment(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

function isSupportedPlatform(): boolean {
  return Platform.OS === 'android' || Platform.OS === 'ios';
}

function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}

function notifyDiagnostics(): void {
  for (const listener of [...diagnosticsListeners]) {
    listener();
  }
}

function setLifecycle(next: RewardedAdLifecycle): void {
  lifecycle = next;
  rewardedLoaded = next === 'loaded' || next === 'showing' || next === 'reward-earned';
  notifyDiagnostics();
}

function categorizeAdError(error: unknown): RewardedAdErrorCategory {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : String(error ?? '');
  const blob = `${code} ${message}`.toLowerCase();

  if (blob.includes('no-fill') || blob.includes('error_code_no_fill') || blob.includes('no fill')) {
    return 'no-fill';
  }
  if (blob.includes('network') || blob.includes('offline') || blob.includes('error_code_network')) {
    return 'network-error';
  }
  if (blob.includes('invalid') || blob.includes('error_code_invalid_request')) {
    return 'invalid-request';
  }
  if (blob.includes('consent') || blob.includes('ump')) {
    return 'consent-required';
  }
  if (blob.includes('not loaded') || blob.includes('ad-not-loaded')) {
    return 'ad-not-loaded';
  }
  if (blob.includes('timeout')) {
    return 'timeout';
  }
  if (blob.includes('internal')) {
    return 'internal-error';
  }
  return 'unknown';
}

function logRewardedFailure(input: {
  stage: string;
  category: RewardedAdErrorCategory;
  usingTestId: boolean;
  networkOnline: boolean | null;
}): void {
  lastErrorCategory = input.category;
  notifyDiagnostics();
  console.warn('[rewarded-ad-failed]', {
    platform: Platform.OS,
    stage: input.stage,
    code: input.category,
    messageCategory: input.category,
    usingTestId: input.usingTestId,
    sdkInitialized,
    adLoaded: rewardedLoaded,
    networkOnline: input.networkOnline,
  });
}

function getNetworkOnline(): boolean | null {
  if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
    return navigator.onLine;
  }
  return null;
}

let nativeModuleChecked = false;
let nativeModuleAvailable = false;

function getMobileAdsModule(): MobileAdsModule | null {
  if (!isSupportedPlatform() || isRunningInExpoGo() || isExpoGo()) {
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

function resolveRewardedAdUnitId(
  mode: AdsMode,
  mod: MobileAdsModule,
): { unitId: string | null; usingTestId: boolean } {
  if (mode === 'test' || shouldUseTestAdUnitIds()) {
    return { unitId: mod.TestIds.REWARDED, usingTestId: true };
  }
  if (mode === 'production') {
    return { unitId: getProductionRewardedAdUnitId(), usingTestId: false };
  }
  return { unitId: null, usingTestId: false };
}

async function ensureMobileAdsInitialized(): Promise<boolean> {
  const mod = getMobileAdsModule();
  if (!mod) {
    lastErrorCategory = 'module-unavailable';
    notifyDiagnostics();
    return false;
  }

  if (!mobileAdsInitPromise) {
    mobileAdsInitPromise = mod
      .default()
      .initialize()
      .then((status) => {
        sdkInitialized = true;
        const adapters =
          status && typeof status === 'object' ? Object.keys(status as object).length : null;
        adapterCount = adapters;
        console.info('[ads-sdk-init]', {
          platform: Platform.OS,
          initialized: true,
          adapterCount: adapters,
          adsEnabled: isAdsEnabled(),
          appIdConfigured: getAdsConfigAudit().androidAppIdConfigured || getAdsConfigAudit().iosAppIdConfigured,
          mode: resolveAdsMode(),
          testIdActive: resolveAdsMode() === 'test' || shouldUseTestAdUnitIds(),
        });
        notifyDiagnostics();
        return true;
      })
      .catch((error) => {
        mobileAdsInitPromise = null;
        sdkInitialized = false;
        lastErrorCategory = 'sdk-not-initialized';
        console.warn('[ads-sdk-init]', {
          platform: Platform.OS,
          initialized: false,
          adapterCount: null,
          adsEnabled: isAdsEnabled(),
          appIdConfigured: Boolean(getConfiguredAppId()),
          errorCategory: 'sdk-not-initialized',
        });
        if (isDevEnvironment()) {
          console.warn('[adProvider] mobileAds initialize failed', error);
        }
        notifyDiagnostics();
        return false;
      });
  }

  return mobileAdsInitPromise;
}

/** Uygulama açılışında çağrılır — SDK init (stub/Expo Go'da no-op). */
export async function initializeAdProvider(): Promise<void> {
  if (!isAdsEnabled()) {
    console.info('[ads-sdk-init]', {
      platform: Platform.OS,
      initialized: false,
      adsEnabled: false,
      appIdConfigured: getAdsConfigAudit().androidAppIdConfigured,
    });
    return;
  }
  const mode = resolveAdsMode();
  if (mode === 'stub' || !isSupportedPlatform() || isExpoGo()) {
    return;
  }
  await ensureMobileAdsInitialized();
}

export function getAdsMode(): AdsMode {
  return resolveAdsMode();
}

/** Stub: yalnızca __DEV__. Test/production: native modül mevcut olmalı. */
export function isAdProviderAvailable(): boolean {
  if (!isAdsEnabled()) {
    return false;
  }
  const mode = resolveAdsMode();
  if (mode === 'stub') {
    return isDevEnvironment();
  }
  return isSupportedPlatform() && !isExpoGo() && getMobileAdsModule() != null;
}

export function getAdsDiagnosticsSnapshot(): AdsDiagnosticsSnapshot {
  const audit = getAdsConfigAudit();
  const platformUnitConfigured =
    Platform.OS === 'ios' ? audit.iosUnitConfigured : audit.androidUnitConfigured;
  const appIdConfigured =
    Platform.OS === 'ios' ? audit.iosAppIdConfigured : audit.androidAppIdConfigured;
  return {
    sdkInitialized,
    appIdConfigured,
    platformUnitConfigured,
    testIdActive: audit.useTestIds,
    adsEnabled: audit.adsEnabled,
    mode: audit.mode,
    lifecycle,
    rewardedLoaded,
    lastErrorCategory,
    lastRewardEvent,
    adapterCount,
    platform: Platform.OS,
  };
}

export function subscribeAdsDiagnostics(listener: () => void): () => void {
  diagnosticsListeners.add(listener);
  return () => {
    diagnosticsListeners.delete(listener);
  };
}

async function showStubRewardedAd(): Promise<AdShowResult> {
  setLifecycle('showing');
  await new Promise((resolve) => setTimeout(resolve, STUB_AD_DELAY_MS));
  setLifecycle('reward-earned');
  lastRewardEvent = 'earned';
  setLifecycle('closed');
  notifyDiagnostics();
  return 'completed';
}

async function showNativeRewardedAd(_slotId: AdRewardSlotId): Promise<AdShowResult> {
  if (isShowingAd) {
    logRewardedFailure({
      stage: 'double-tap',
      category: 'internal-error',
      usingTestId: resolveAdsMode() === 'test',
      networkOnline: getNetworkOnline(),
    });
    return 'failed';
  }

  const mode = resolveAdsMode();
  const mod = getMobileAdsModule();
  if (!mod) {
    logRewardedFailure({
      stage: 'module',
      category: 'module-unavailable',
      usingTestId: false,
      networkOnline: getNetworkOnline(),
    });
    return 'failed';
  }

  const { unitId, usingTestId } = resolveRewardedAdUnitId(mode, mod);
  if (!unitId) {
    logRewardedFailure({
      stage: 'unit-id',
      category: 'ad-unit-id-missing',
      usingTestId,
      networkOnline: getNetworkOnline(),
    });
    return 'failed';
  }

  const initialized = await ensureMobileAdsInitialized();
  if (!initialized) {
    logRewardedFailure({
      stage: 'initialize',
      category: 'sdk-not-initialized',
      usingTestId,
      networkOnline: getNetworkOnline(),
    });
    return 'failed';
  }

  isShowingAd = true;
  setLifecycle('loading');
  let rewardGrantedForImpression = false;

  try {
    const { RewardedAd, RewardedAdEventType, AdEventType } = mod;
    const rewarded = RewardedAd.createForAdRequest(unitId);

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
        lastRewardEvent =
          result === 'completed' ? 'earned' : result === 'skipped' ? 'skipped' : 'failed';
        setLifecycle(result === 'failed' ? 'failed' : 'closed');
        notifyDiagnostics();
        resolve(result);
      };

      const loadTimeout = setTimeout(() => {
        logRewardedFailure({
          stage: 'load-timeout',
          category: 'timeout',
          usingTestId,
          networkOnline: getNetworkOnline(),
        });
        finish('failed');
      }, REWARDED_LOAD_TIMEOUT_MS);

      const showTimeout = setTimeout(() => {
        logRewardedFailure({
          stage: 'show-timeout',
          category: 'timeout',
          usingTestId,
          networkOnline: getNetworkOnline(),
        });
        finish('failed');
      }, REWARDED_SHOW_TIMEOUT_MS);

      const unsubLoaded = rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
        clearTimeout(loadTimeout);
        setLifecycle('loaded');
        if (shown) {
          return;
        }
        shown = true;
        setLifecycle('showing');
        void rewarded.show().catch((error) => {
          logRewardedFailure({
            stage: 'show',
            category: categorizeAdError(error),
            usingTestId,
            networkOnline: getNetworkOnline(),
          });
          finish('failed');
        });
      });

      const unsubEarned = rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        // Ödül yalnız EARNED_REWARD ile; impression başına tek kez.
        if (rewardGrantedForImpression) {
          return;
        }
        rewardGrantedForImpression = true;
        earned = true;
        setLifecycle('reward-earned');
      });

      const unsubClosed = rewarded.addAdEventListener(AdEventType.CLOSED, () => {
        clearTimeout(showTimeout);
        // Kapama tek başına ödül vermez.
        finish(earned ? 'completed' : 'skipped');
      });

      const unsubError = rewarded.addAdEventListener(AdEventType.ERROR, (error) => {
        logRewardedFailure({
          stage: 'ad-error',
          category: categorizeAdError(error),
          usingTestId,
          networkOnline: getNetworkOnline(),
        });
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
  if (!isAdsEnabled()) {
    lastErrorCategory = 'ads-disabled';
    notifyDiagnostics();
    return 'failed';
  }

  const mode = resolveAdsMode();

  if (mode === 'stub') {
    if (!isDevEnvironment()) {
      return 'failed';
    }
    return showStubRewardedAd();
  }

  if (!isSupportedPlatform()) {
    lastErrorCategory = 'unsupported-platform';
    notifyDiagnostics();
    return 'failed';
  }

  return showNativeRewardedAd(slotId);
}
