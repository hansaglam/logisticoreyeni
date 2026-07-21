/**
 * Sözleşme tipi dengesi — spawn oranları ve çarpan aralıkları.
 */

import type { ContractType, ProductId } from '../types/game';

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  standard: 'Standart',
  urgent: 'Acil',
  fragile: 'Hassas Yük',
  high_reputation: 'Prestijli',
  bulk: 'Ağır Yük',
  refrigerated: 'Soğuk Zincir',
};

export interface ContractTypeSpawnWeight {
  type: ContractType;
  weight: number;
}

/** Seviye ve itibara göre spawn ağırlıkları — aday seçiminden bağımsız tip dağılımı */
export function getContractTypeSpawnWeights(
  playerLevel: number,
  playerReputation: number,
): ContractTypeSpawnWeight[] {
  const level = Math.max(1, playerLevel);
  const rep = Math.max(0, playerReputation);

  if (level <= 2) {
    return [
      { type: 'standard', weight: 88 },
      { type: 'urgent', weight: 12 },
    ];
  }

  if (level <= 4) {
    const weights: ContractTypeSpawnWeight[] = [
      { type: 'standard', weight: 68 },
      { type: 'urgent', weight: 15 },
      { type: 'fragile', weight: 9 },
      { type: 'bulk', weight: 8 },
    ];
    if (rep >= 70) {
      weights.push({ type: 'high_reputation', weight: 4 });
      weights[0]!.weight -= 4;
    }
    if (level >= 4) {
      weights.push({ type: 'refrigerated', weight: 3 });
      weights[0]!.weight -= 3;
    }
    return weights;
  }

  const weights: ContractTypeSpawnWeight[] = [
    { type: 'standard', weight: 52 },
    { type: 'urgent', weight: 12 },
    { type: 'fragile', weight: 10 },
    { type: 'bulk', weight: 12 },
  ];
  if (rep >= 70) {
    weights.push({ type: 'high_reputation', weight: 6 });
    weights[0]!.weight -= 4;
  }
  weights.push({ type: 'refrigerated', weight: 3 });
  weights[0]!.weight -= 2;
  return weights;
}

/** Soğuk zincir uygun ürünler */
export const REFRIGERATED_PRODUCT_IDS: ProductId[] = ['fruit', 'beverage'];

export const CONTRACT_TYPE_PAYMENT_RANGE: Record<
  Exclude<ContractType, 'standard'>,
  { min: number; max: number }
> = {
  urgent: { min: 1.15, max: 1.3 },
  fragile: { min: 1.2, max: 1.35 },
  high_reputation: { min: 1.25, max: 1.45 },
  bulk: { min: 1.1, max: 1.2 },
  refrigerated: { min: 1.15, max: 1.28 },
};

export const FRAGILE_RECOMMENDED_CONDITION = 70;
export const HIGH_REPUTATION_REQUIRED = 70;
export const HIGH_REPUTATION_SUCCESS_BONUS = 1;
