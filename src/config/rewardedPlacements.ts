/**
 * Canonical rewarded placement config — Android/iOS unit ID seçimi tek kaynaktan.
 */

import { Platform } from 'react-native';

import {
  ADMOB_DELIVERY_BOOST_REWARDED_UNIT_IDS,
  ADMOB_REWARDED_UNIT_IDS,
  isValidAdMobUnitId,
} from './adMobConstants';
import { isAdsEnabled, resolveAdsMode, shouldUseTestAdUnitIds } from './adMob';
import type { AdRewardSlotId } from '../types/monetization';

export type RewardedPlacement = 'delivery_boost' | 'daily_operations';

export type RewardedPlacementSlotId = 'delivery_boost' | 'daily_ops_bonus';

const DAILY_OPS_ENV_KEYS = {
  android: 'EXPO_PUBLIC_ADMOB_DAILY_REWARDED_ANDROID_ID',
  ios: 'EXPO_PUBLIC_ADMOB_DAILY_REWARDED_IOS_ID',
} as const;

const DELIVERY_BOOST_ENV_KEYS = {
  android: 'EXPO_PUBLIC_DELIVERY_BOOST_REWARDED_ANDROID_ID',
  ios: 'EXPO_PUBLIC_DELIVERY_BOOST_REWARDED_IOS_ID',
} as const;

export function placementToSlotId(placement: RewardedPlacement): RewardedPlacementSlotId {
  return placement === 'daily_operations' ? 'daily_ops_bonus' : 'delivery_boost';
}

export function slotIdToPlacement(slotId: AdRewardSlotId): RewardedPlacement | null {
  if (slotId === 'delivery_boost') {
    return 'delivery_boost';
  }
  if (slotId === 'daily_ops_bonus') {
    return 'daily_operations';
  }
  return null;
}

export function isTrackedRewardedPlacement(slotId: AdRewardSlotId): slotId is RewardedPlacementSlotId {
  return slotId === 'delivery_boost' || slotId === 'daily_ops_bonus';
}

export interface RewardedPlacementConfig {
  placement: RewardedPlacement;
  enabled: boolean;
  androidAdUnitId: string;
  iosAdUnitId: string;
  useTestId: boolean;
}

function readEnvUnitId(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value && isValidAdMobUnitId(value) ? value : undefined;
}

function resolvePlacementUnitIds(placement: RewardedPlacement): {
  android: string;
  ios: string;
} {
  if (placement === 'delivery_boost') {
    return {
      android:
        readEnvUnitId(DELIVERY_BOOST_ENV_KEYS.android) ??
        ADMOB_DELIVERY_BOOST_REWARDED_UNIT_IDS.android,
      ios:
        readEnvUnitId(DELIVERY_BOOST_ENV_KEYS.ios) ??
        ADMOB_DELIVERY_BOOST_REWARDED_UNIT_IDS.ios,
    };
  }
  return {
    android:
      readEnvUnitId(DAILY_OPS_ENV_KEYS.android) ?? ADMOB_REWARDED_UNIT_IDS.android,
    ios: readEnvUnitId(DAILY_OPS_ENV_KEYS.ios) ?? ADMOB_REWARDED_UNIT_IDS.ios,
  };
}

export function getRewardedPlacementConfig(params: {
  placement: RewardedPlacement;
  platform?: 'android' | 'ios';
  environment?: 'internal' | 'production';
}): RewardedPlacementConfig {
  const ids = resolvePlacementUnitIds(params.placement);
  const useTestId =
    params.environment === 'internal' ||
    shouldUseTestAdUnitIds() ||
    resolveAdsMode() === 'test';

  return {
    placement: params.placement,
    enabled: isAdsEnabled(),
    androidAdUnitId: ids.android,
    iosAdUnitId: ids.ios,
    useTestId,
  };
}

export function getRewardedPlacementAdUnitId(
  placement: RewardedPlacement,
  platform: 'android' | 'ios' = Platform.OS === 'ios' ? 'ios' : 'android',
): string {
  const config = getRewardedPlacementConfig({ placement, platform });
  return platform === 'ios' ? config.iosAdUnitId : config.androidAdUnitId;
}

/** Production profilde eksik/geçersiz placement ID'leri döner. */
export function validateProductionRewardedPlacementIds(): string[] {
  if (!isAdsEnabled() || shouldUseTestAdUnitIds() || resolveAdsMode() !== 'production') {
    return [];
  }

  const errors: string[] = [];
  const placements: RewardedPlacement[] = ['delivery_boost', 'daily_operations'];

  for (const placement of placements) {
    const config = getRewardedPlacementConfig({ placement, environment: 'production' });
    if (!isValidAdMobUnitId(config.androidAdUnitId)) {
      errors.push(`${placement}: android ad unit ID missing or invalid`);
    }
    if (!isValidAdMobUnitId(config.iosAdUnitId)) {
      errors.push(`${placement}: ios ad unit ID missing or invalid`);
    }
  }

  return errors;
}
