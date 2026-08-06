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

export function isValidAdMobAppId(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^ca-app-pub-\d+~\d+$/.test(value);
}

export function isValidAdMobUnitId(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^ca-app-pub-\d+\/\d+$/.test(value);
}
