/**
 * AdMob IDs + validators — headless-safe (no react-native import).
 */

export const ADMOB_APP_IDS = {
  android: 'ca-app-pub-8214453687597896~5560651696',
  ios: 'ca-app-pub-8214453687597896~4247570027',
} as const;

export const ADMOB_REWARDED_UNIT_IDS = {
  android: 'ca-app-pub-8214453687597896/1840898530',
  ios: 'ca-app-pub-8214453687597896/4313204541',
} as const;

/** Teslimat hızlandırma rewarded placement — AdMob Console'da ayrı unit önerilir. */
export const ADMOB_DELIVERY_BOOST_REWARDED_UNIT_IDS = {
  android: 'ca-app-pub-8214453687597896/1840898530',
  ios: 'ca-app-pub-8214453687597896/4313204541',
} as const;

/**
 * Google official sample rewarded units (SDK `TestIds.REWARDED`).
 * DEV/INTERNAL must use these via the SDK — never hardcode as production fallbacks.
 */
export const GOOGLE_OFFICIAL_REWARDED_TEST_UNIT_IDS = {
  android: 'ca-app-pub-3940256099942544/5224354917',
  ios: 'ca-app-pub-3940256099942544/1712485313',
} as const;

export const GOOGLE_SAMPLE_ADMOB_UNIT_PREFIX = 'ca-app-pub-3940256099942544/';
export const GOOGLE_SAMPLE_ADMOB_APP_ID_PREFIX = 'ca-app-pub-3940256099942544~';

export function isValidAdMobAppId(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^ca-app-pub-\d+~\d+$/.test(value);
}

export function isValidAdMobUnitId(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^ca-app-pub-\d+\/\d+$/.test(value);
}

export function isGoogleSampleAdMobUnitId(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(GOOGLE_SAMPLE_ADMOB_UNIT_PREFIX);
}

export function isGoogleSampleAdMobAppId(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(GOOGLE_SAMPLE_ADMOB_APP_ID_PREFIX);
}
