/**
 * Aktif teslimat ödüllü reklam hızlandırma — canonical ayarlar.
 */

export const DELIVERY_AD_BOOST_ENABLED = true;

/** Bir reklam kalan sürenin bu oranını azaltır. */
export const DELIVERY_AD_BOOST_REDUCTION_RATIO = 0.25;

/** Teslimat başına maksimum reklam kullanımı. */
export const DELIVERY_AD_BOOST_MAX_USES = 2;

/** Toplam hızlandırma başlangıç süresinin en fazla bu kadarı olabilir. */
export const DELIVERY_AD_BOOST_MAX_TOTAL_RATIO = 0.5;

/** Kalan süre bu değerin altındaysa hızlandırma kapalı (gerçek ms). */
export const DELIVERY_AD_BOOST_MIN_REMAINING_MS = 5 * 60 * 1000;

/** Canonical minimum kalan süre (saniye). */
export const DELIVERY_BOOST_MIN_REMAINING_SECONDS =
  DELIVERY_AD_BOOST_MIN_REMAINING_MS / 1000;

/** Ardışık hızlandırma reklamları arası minimum bekleme (gerçek ms). */
export const DELIVERY_AD_BOOST_COOLDOWN_MS = 30 * 1000;

/** processedRewardIds dizisi üst sınırı. */
export const DELIVERY_AD_BOOST_MAX_PROCESSED_REWARD_IDS = 10;
