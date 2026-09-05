/**
 * Fail-closed store production config policy — shared by runtime audit + CI validator.
 */

import {
  ADMOB_APP_IDS,
  ADMOB_REWARDED_UNIT_IDS,
  isValidAdMobAppId,
  isValidAdMobUnitId,
} from './adMobConstants';

export const GOOGLE_SAMPLE_ADMOB_APP_ID_PREFIX = 'ca-app-pub-3940256099942544~';
export const GOOGLE_SAMPLE_ADMOB_UNIT_PREFIX = 'ca-app-pub-3940256099942544/';

const LOCALHOST_PATTERNS = [
  /^localhost\b/i,
  /^127\.0\.0\.1\b/,
  /^10\.\d+\.\d+\.\d+/,
  /^192\.168\.\d+\.\d+/,
  /firebase emulators/i,
  /use emulator/i,
];

export type StoreProductionValidationInput = {
  env: Record<string, string>;
  sourceFiles?: string[];
  /** Test-only overrides for AdMob ID validation. */
  adMobAppIds?: Partial<typeof ADMOB_APP_IDS>;
  adMobRewardedUnitIds?: Partial<typeof ADMOB_REWARDED_UNIT_IDS>;
};

export function validateStoreProductionEnv(input: StoreProductionValidationInput): string[] {
  const errors: string[] = [];
  const env = input.env;

  if (env.EXPO_PUBLIC_ADS_USE_TEST_IDS === 'true') {
    errors.push('EXPO_PUBLIC_ADS_USE_TEST_IDS must be false for store production');
  }
  if (env.EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED === 'true') {
    errors.push('EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED must be false for store production');
  }
  if (env.EXPO_PUBLIC_ADS_MODE?.trim().toLowerCase() === 'test') {
    errors.push('EXPO_PUBLIC_ADS_MODE must not be "test" for store production');
  }
  if (env.EXPO_PUBLIC_ADS_MODE?.trim().toLowerCase() === 'stub') {
    errors.push('EXPO_PUBLIC_ADS_MODE must not be "stub" for store production');
  }
  if (env.EXPO_PUBLIC_ADS_CONSENT_DEBUG_EEA === 'true') {
    errors.push('EXPO_PUBLIC_ADS_CONSENT_DEBUG_EEA must be false/unset for store production');
  }
  if (env.EXPO_PUBLIC_USE_FIREBASE_EMULATOR === 'true') {
    errors.push('EXPO_PUBLIC_USE_FIREBASE_EMULATOR must be false for store production');
  }
  if (env.EXPO_PUBLIC_MOCK_GLOBAL_ECONOMY === 'true') {
    errors.push('EXPO_PUBLIC_MOCK_GLOBAL_ECONOMY must be false for store production');
  }
  if (env.EXPO_PUBLIC_DEBUG_CLOUD_SAVE_CONFLICT === '1') {
    errors.push('EXPO_PUBLIC_DEBUG_CLOUD_SAVE_CONFLICT must be unset for store production');
  }
  if (env.EXPO_PUBLIC_ENABLE_TEST_MONEY_SYNC === 'true') {
    errors.push('EXPO_PUBLIC_ENABLE_TEST_MONEY_SYNC must be false/unset for store production');
  }
  if (env.EXPO_PUBLIC_ENABLE_SEASONS === 'true') {
    errors.push('EXPO_PUBLIC_ENABLE_SEASONS must remain false for store production');
  }
  if (env.EXPO_PUBLIC_ENABLE_CHALLENGES === 'true') {
    errors.push('EXPO_PUBLIC_ENABLE_CHALLENGES must remain false for store production');
  }
  if (env.EXPO_PUBLIC_ENABLE_DRIVER_PROGRESSION === 'true') {
    errors.push('EXPO_PUBLIC_ENABLE_DRIVER_PROGRESSION must remain false for store production');
  }
  if (env.EXPO_PUBLIC_ENABLE_COMPANY_STATS === 'true') {
    errors.push('EXPO_PUBLIC_ENABLE_COMPANY_STATS must remain false for store production');
  }
  if (env.EXPO_PUBLIC_ENABLE_ACHIEVEMENTS === 'true') {
    errors.push('EXPO_PUBLIC_ENABLE_ACHIEVEMENTS must remain false for store production');
  }
  if (env.EXPO_PUBLIC_ENABLE_SEASON_HISTORY === 'true') {
    errors.push('EXPO_PUBLIC_ENABLE_SEASON_HISTORY must remain false for store production');
  }
  if (env.EXPO_PUBLIC_ENABLE_INBOX === 'true') {
    errors.push('EXPO_PUBLIC_ENABLE_INBOX must remain false for store production');
  }
  if (env.EXPO_PUBLIC_ENABLE_MARKET_ALERTS === 'true') {
    errors.push('EXPO_PUBLIC_ENABLE_MARKET_ALERTS must remain false for store production');
  }
  if (env.EXPO_PUBLIC_ENABLE_NOTIFICATION_CENTER === 'true') {
    errors.push('EXPO_PUBLIC_ENABLE_NOTIFICATION_CENTER must remain false for store production');
  }
  if (env.EXPO_PUBLIC_ENABLE_V11_ANALYTICS === 'true') {
    errors.push('EXPO_PUBLIC_ENABLE_V11_ANALYTICS must remain false for store production');
  }

  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    if (!key.startsWith('EXPO_PUBLIC_')) continue;
    if (LOCALHOST_PATTERNS.some((pattern) => pattern.test(value))) {
      errors.push(`${key} appears to reference localhost/emulator (${value})`);
    }
  }

  const appIds = { ...ADMOB_APP_IDS, ...input.adMobAppIds };
  const rewardedIds = { ...ADMOB_REWARDED_UNIT_IDS, ...input.adMobRewardedUnitIds };

  for (const [label, appId] of Object.entries(appIds)) {
    if (!isValidAdMobAppId(appId)) {
      errors.push(`Missing/invalid production AdMob App ID (${label})`);
    }
    if (appId.startsWith(GOOGLE_SAMPLE_ADMOB_APP_ID_PREFIX)) {
      errors.push(`AdMob App ID (${label}) uses Google sample/test App ID`);
    }
  }

  for (const [label, unitId] of Object.entries(rewardedIds)) {
    if (!isValidAdMobUnitId(unitId)) {
      errors.push(`Missing/invalid production rewarded unit ID (${label})`);
    }
    if (unitId.startsWith(GOOGLE_SAMPLE_ADMOB_UNIT_PREFIX)) {
      errors.push(`Rewarded unit ID (${label}) uses Google sample/test unit ID`);
    }
  }

  if (env.EXPO_PUBLIC_ADS_ENABLED === 'false') {
    // Allowed for store if ads intentionally off — not an error.
  } else if (env.EXPO_PUBLIC_ADS_ENABLED !== 'true') {
    errors.push('EXPO_PUBLIC_ADS_ENABLED must be explicitly true or false for store production');
  }

  return errors;
}

export function validateInternalProfileEnv(env: Record<string, string>): string[] {
  const errors: string[] = [];
  if (env.EXPO_PUBLIC_ADS_ENABLED !== 'true') {
    errors.push('internal profile expects EXPO_PUBLIC_ADS_ENABLED=true');
  }
  if (env.EXPO_PUBLIC_ADS_USE_TEST_IDS !== 'true') {
    errors.push('internal profile expects EXPO_PUBLIC_ADS_USE_TEST_IDS=true');
  }
  if (env.EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED !== 'true') {
    errors.push('internal profile expects EXPO_PUBLIC_BACKEND_DIAGNOSTICS_ENABLED=true');
  }
  if (env.EXPO_PUBLIC_ENABLE_SEASONS !== 'true') {
    errors.push('internal profile expects EXPO_PUBLIC_ENABLE_SEASONS=true');
  }
  if (env.EXPO_PUBLIC_ENABLE_CHALLENGES !== 'true') {
    errors.push('internal profile expects EXPO_PUBLIC_ENABLE_CHALLENGES=true');
  }
  if (env.EXPO_PUBLIC_ENABLE_DRIVER_PROGRESSION !== 'true') {
    errors.push('internal profile expects EXPO_PUBLIC_ENABLE_DRIVER_PROGRESSION=true');
  }
  if (env.EXPO_PUBLIC_ENABLE_COMPANY_STATS !== 'true') {
    errors.push('internal profile expects EXPO_PUBLIC_ENABLE_COMPANY_STATS=true');
  }
  if (env.EXPO_PUBLIC_ENABLE_ACHIEVEMENTS !== 'true') {
    errors.push('internal profile expects EXPO_PUBLIC_ENABLE_ACHIEVEMENTS=true');
  }
  if (env.EXPO_PUBLIC_ENABLE_SEASON_HISTORY !== 'true') {
    errors.push('internal profile expects EXPO_PUBLIC_ENABLE_SEASON_HISTORY=true');
  }
  if (env.EXPO_PUBLIC_ENABLE_INBOX !== 'true') {
    errors.push('internal profile expects EXPO_PUBLIC_ENABLE_INBOX=true');
  }
  if (env.EXPO_PUBLIC_ENABLE_MARKET_ALERTS !== 'true') {
    errors.push('internal profile expects EXPO_PUBLIC_ENABLE_MARKET_ALERTS=true');
  }
  if (env.EXPO_PUBLIC_ENABLE_NOTIFICATION_CENTER !== 'true') {
    errors.push('internal profile expects EXPO_PUBLIC_ENABLE_NOTIFICATION_CENTER=true');
  }
  if (env.EXPO_PUBLIC_ENABLE_V11_ANALYTICS !== 'true') {
    errors.push('internal profile expects EXPO_PUBLIC_ENABLE_V11_ANALYTICS=true');
  }
  return errors;
}
