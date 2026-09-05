/**
 * Backend yol haritası — Faz 1 yayın altyapısı aktif.
 *
 * Faz 1: Anonymous auth, private cloud save, manual sync, account deletion
 * Faz 2+: Cloud restore UI, Google/Apple login, leaderboard, remote config
 */

import Constants from 'expo-constants';

export const BACKEND_ENABLED = true;
export const CLOUD_SAVE_WRITE_ENABLED = true;
/**
 * Legacy Faz-1 flag — removed. Account-linked cloud auto-restore is handled in
 * `accountCloudLogin.runPostSignInSaveFlow` when local save is not meaningful
 * (see `isMeaningfulLocalSave`). There is no separate runtime toggle.
 */

function readExtraFeatureFlag(key: string): string | undefined {
  const extra = Constants.expoConfig?.extra as
    | { features?: Record<string, unknown> }
    | undefined;
  const value = extra?.features?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** Server-authoritative workers tamamlanana kadar production'da kapalıdır. */
export const LEADERBOARD_ENABLED =
  (typeof __DEV__ !== 'undefined' && __DEV__) ||
  process.env.EXPO_PUBLIC_LEADERBOARD_ENABLED === 'true' ||
  readExtraFeatureFlag('leaderboardEnabled') === 'true';
export const MARKET_ALARMS_ENABLED =
  (typeof __DEV__ !== 'undefined' && __DEV__) ||
  process.env.EXPO_PUBLIC_MARKET_ALARMS_ENABLED === 'true' ||
  readExtraFeatureFlag('marketAlarmsEnabled') === 'true';

/** V1.1 foundation: production remains fail-closed until backend deploy/canary. */
export const SEASONS_ENABLED =
  process.env.EXPO_PUBLIC_ENABLE_SEASONS === 'true' ||
  readExtraFeatureFlag('seasonsEnabled') === 'true';
export const CHALLENGES_ENABLED =
  SEASONS_ENABLED &&
  (process.env.EXPO_PUBLIC_ENABLE_CHALLENGES === 'true' ||
    readExtraFeatureFlag('challengesEnabled') === 'true');
/** V1.1 Phase 2 read-only foundation; store production remains fail-closed. */
export const DRIVER_PROGRESSION_ENABLED =
  process.env.EXPO_PUBLIC_ENABLE_DRIVER_PROGRESSION === 'true' ||
  readExtraFeatureFlag('driverProgressionEnabled') === 'true';
export const COMPANY_STATS_ENABLED =
  process.env.EXPO_PUBLIC_ENABLE_COMPANY_STATS === 'true' ||
  readExtraFeatureFlag('companyStatsEnabled') === 'true';
export const ACHIEVEMENTS_ENABLED =
  process.env.EXPO_PUBLIC_ENABLE_ACHIEVEMENTS === 'true' ||
  readExtraFeatureFlag('achievementsEnabled') === 'true';
export const SEASON_HISTORY_ENABLED =
  process.env.EXPO_PUBLIC_ENABLE_SEASON_HISTORY === 'true' ||
  readExtraFeatureFlag('seasonHistoryEnabled') === 'true';
export const INBOX_ENABLED =
  process.env.EXPO_PUBLIC_ENABLE_INBOX === 'true' ||
  readExtraFeatureFlag('inboxEnabled') === 'true';
/** V1.1 Phase 4 retention/observability foundation; store production remains fail-closed. */
export const MARKET_ALERTS_ENABLED =
  process.env.EXPO_PUBLIC_ENABLE_MARKET_ALERTS === 'true' ||
  readExtraFeatureFlag('marketAlertsEnabled') === 'true';
export const NOTIFICATION_CENTER_ENABLED =
  process.env.EXPO_PUBLIC_ENABLE_NOTIFICATION_CENTER === 'true' ||
  readExtraFeatureFlag('notificationCenterEnabled') === 'true';
export const V11_ANALYTICS_ENABLED =
  process.env.EXPO_PUBLIC_ENABLE_V11_ANALYTICS === 'true' ||
  readExtraFeatureFlag('v11AnalyticsEnabled') === 'true';
/** Migration + production canary doğrulanana kadar hiçbir UI giriş noktası açılmamalı. */
export type VehicleMarketplaceFeatureSource = 'dev' | 'env' | 'disabled';

export function resolveVehicleMarketplaceFeatureFlag(input: {
  isDevelopment: boolean;
  envValue?: string;
}): { enabled: boolean; source: VehicleMarketplaceFeatureSource } {
  if (input.isDevelopment) return { enabled: true, source: 'dev' };
  if (input.envValue === 'true') return { enabled: true, source: 'env' };
  return { enabled: false, source: 'disabled' };
}

const vehicleMarketplaceEnvValue =
  process.env.EXPO_PUBLIC_VEHICLE_MARKETPLACE_ENABLED ??
  readExtraFeatureFlag('vehicleMarketplaceEnabled');

const vehicleMarketplaceFeature = resolveVehicleMarketplaceFeatureFlag({
  isDevelopment: typeof __DEV__ !== 'undefined' && __DEV__,
  envValue: vehicleMarketplaceEnvValue,
});

/** Development'ta açık; internal/production build'de yalnız explicit env=true ile açık. */
export const VEHICLE_MARKETPLACE_ENABLED = vehicleMarketplaceFeature.enabled;
export const VEHICLE_MARKETPLACE_FEATURE_SOURCE = vehicleMarketplaceFeature.source;

export function isVehicleMarketplaceMutationAllowed(
  enabled = VEHICLE_MARKETPLACE_ENABLED,
): boolean {
  return enabled;
}

if (typeof __DEV__ !== 'undefined' && __DEV__) {
  console.info('[vehicle-marketplace-feature]', {
    enabled: VEHICLE_MARKETPLACE_ENABLED,
    source: VEHICLE_MARKETPLACE_FEATURE_SOURCE,
  });
}
export const INTERNAL_TEST_VERSION = '0.1.0';
