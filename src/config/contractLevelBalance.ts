/**
 * Sözleşme seviye dağılımı — oyuncu seviyesine göre üretim ağırlıkları.
 * levelConfig ve contracts tarafından kullanılır (balance.ts döngüsünü önler).
 */

export const contractLevelBalance = {
  sameOrLowerLevelWeight: 0.7,
  oneLevelAboveWeight: 0.2,
  twoLevelAboveWeight: 0.08,
  specialHighLevelWeight: 0.02,
  lowLevelMaxExtraLevel: {
    1: 2,
    2: 2,
    3: 3,
  } as Record<number, number>,
  maxVisibleLevelGapDefault: 3,
  maxLockedContractRatio: 0.3,
} as const;

export type ContractLevelBalance = typeof contractLevelBalance;
