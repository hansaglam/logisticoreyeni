/**
 * Canonical itibar kuralları — tüm reputation delta'ları buradan türetilir.
 */

export const REPUTATION_MIN = 0;
export const REPUTATION_MAX = 100;
export const INITIAL_REPUTATION = 50;
export const REPUTATION_HISTORY_MAX = 20;

/** Teslimat gecikme eşikleri — deadlineHours üzerinden oran */
export const REPUTATION_LATE_MINOR_RATIO = 0.1;
export const REPUTATION_LATE_MAJOR_RATIO = 0.3;

/** Erken teslimat: tahmini süreden bu oran kadar hızlı */
export const REPUTATION_EARLY_TRAVEL_RATIO = 0.92;

export const REPUTATION_RULES = {
  deliveryOnTime: 2,
  deliveryEarly: 3,
  highRiskDeliverySuccess: 1,

  deliveryLateMinor: -2,
  deliveryLateMajor: -4,

  contractCancelled: -6,
  deliveryFailed: -8,

  positiveOperationOutcome: 1,
  negativeOperationOutcome: -2,
} as const;

export type ReputationRuleKey = keyof typeof REPUTATION_RULES;

export const REPUTATION_TIER_THRESHOLDS = {
  critical: { min: 0, max: 19, label: 'Kritik' },
  weak: { min: 20, max: 39, label: 'Zayıf' },
  reliable: { min: 40, max: 59, label: 'Güvenilir' },
  respected: { min: 60, max: 79, label: 'Saygın' },
  elite: { min: 80, max: 100, label: 'Seçkin' },
} as const;

export type ReputationTier = keyof typeof REPUTATION_TIER_THRESHOLDS;

export const REPUTATION_INCREASE_BEHAVIORS: ReadonlyArray<{
  key: ReputationRuleKey | 'operation-positive';
  label: string;
}> = [
  { key: 'deliveryOnTime', label: 'Zamanında teslimat' },
  { key: 'deliveryEarly', label: 'Erken teslimat' },
  { key: 'highRiskDeliverySuccess', label: 'Riskli işi başarıyla tamamlama' },
  { key: 'operation-positive', label: 'Olumlu operasyon sonucu' },
];

export const REPUTATION_DECREASE_BEHAVIORS: ReadonlyArray<{
  key: ReputationRuleKey;
  label: string;
}> = [
  { key: 'deliveryLateMinor', label: 'Hafif gecikme' },
  { key: 'deliveryLateMajor', label: 'Ciddi gecikme' },
  { key: 'contractCancelled', label: 'Sözleşme iptali' },
  { key: 'deliveryFailed', label: 'Başarısız teslimat' },
  { key: 'negativeOperationOutcome', label: 'Olumsuz operasyon sonucu' },
];
