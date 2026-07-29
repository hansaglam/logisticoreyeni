/**
 * Sözleşme tipi atama ve ekonomi etkileri — Phase 3.
 */

import {
  CONTRACT_TYPE_LABELS,
  CONTRACT_TYPE_PAYMENT_RANGE,
  FRAGILE_RECOMMENDED_CONDITION,
  getContractTypeSpawnWeights,
  HIGH_REPUTATION_REQUIRED,
  REFRIGERATED_PRODUCT_IDS,
} from '../config/contractTypes';
import type {
  Contract,
  ContractRiskTier,
  ContractType,
  Product,
  ProductId,
} from '../types/game';
import { clamp, randomBetween } from '../utils/math';

export { CONTRACT_TYPE_LABELS };

export function normalizeContractType(contract: Contract): ContractType {
  return contract.contractType ?? 'standard';
}

export function normalizeContractRiskLevel(contract: Contract): ContractRiskTier {
  return contract.riskLevel ?? 'low';
}

export function normalizeContract(contract: Contract): Contract {
  const contractType = normalizeContractType(contract);
  return {
    ...contract,
    contractType,
    riskLevel: contract.riskLevel ?? (contractType === 'standard' ? 'low' : 'medium'),
  };
}

function mixContractTypeSeed(
  seed: number,
  originCityId: string,
  destinationCityId: string,
  productId: ProductId,
): number {
  let hash = seed >>> 0;
  for (const part of [originCityId, destinationCityId, productId]) {
    for (let i = 0; i < part.length; i += 1) {
      hash = (hash * 31 + part.charCodeAt(i)) >>> 0;
    }
  }
  return hash;
}

function pickContractType(
  playerLevel: number,
  playerReputation: number,
  productId: ProductId,
  seed: number,
  originCityId: string,
  destinationCityId: string,
): ContractType {
  let weights = getContractTypeSpawnWeights(playerLevel, playerReputation);

  if (!REFRIGERATED_PRODUCT_IDS.includes(productId)) {
    weights = weights.filter((w) => w.type !== 'refrigerated');
  }

  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  if (total <= 0) {
    return 'standard';
  }

  const mixed = mixContractTypeSeed(seed, originCityId, destinationCityId, productId);
  const roll = ((mixed % 10_000) / 10_000) * total;
  let cumulative = 0;
  for (const entry of weights) {
    cumulative += entry.weight;
    if (roll <= cumulative) {
      return entry.type;
    }
  }
  return 'standard';
}

function randomMultiplier(min: number, max: number, seed: number): number {
  const t = (seed % 100) / 100;
  return min + (max - min) * t;
}

export interface ApplyContractTypeParams {
  contract: Contract;
  product: Product;
  playerLevel: number;
  playerReputation: number;
  sequence?: number;
  /** Bulk tipinin oyuncunun üretim kapasitesini aşmasını engeller. */
  maxCargoTons?: number;
}

/** Base sözleşmeye tip özelliklerini uygular — payment/deadline/amount ayarlar */
export function applyContractTypeToContract(params: ApplyContractTypeParams): Contract {
  const { contract, product, playerLevel, playerReputation } = params;
  const sequence = params.sequence ?? 1;
  const seed = sequence + contract.originCityId.length + contract.destinationCityId.length;

  const selectionScoreBasis = {
    payment: contract.payment,
    amount: contract.amount,
    urgency: contract.urgency ?? 0,
  };

  const contractType = pickContractType(
    playerLevel,
    playerReputation,
    product.id,
    seed,
    contract.originCityId,
    contract.destinationCityId,
  );

  if (contractType === 'standard') {
    return {
      ...contract,
      contractType: 'standard',
      riskLevel: 'low',
      selectionScoreBasis,
    };
  }

  let payment = contract.payment;
  let deadlineHours = contract.deadlineHours;
  let amount = contract.amount;
  let cargoWeight = contract.cargoWeight;
  let urgency = contract.urgency;
  let riskLevel: ContractRiskTier = 'medium';
  let requiredReputation: number | undefined;
  let recommendedTruckCondition: number | undefined;
  let requiredDriverLevel: number | undefined;
  let bonusMultiplier: number | undefined;
  let penaltyMultiplier: number | undefined;
  const specialRules: string[] = [];

  switch (contractType) {
    case 'urgent': {
      bonusMultiplier = randomMultiplier(1.15, 1.3, seed);
      penaltyMultiplier = 1.35;
      payment = Math.round(payment * bonusMultiplier);
      deadlineHours = clamp(deadlineHours * 0.78, 4, deadlineHours);
      urgency = clamp(urgency + 0.25, 0, 1);
      riskLevel = 'medium';
      specialRules.push('Kısa teslim süresi — gecikme cezası yüksek.');
      break;
    }
    case 'fragile': {
      bonusMultiplier = randomMultiplier(1.2, 1.35, seed + 7);
      penaltyMultiplier = 1.25;
      payment = Math.round(payment * bonusMultiplier);
      recommendedTruckCondition = FRAGILE_RECOMMENDED_CONDITION;
      requiredDriverLevel = playerLevel >= 4 ? 2 : undefined;
      riskLevel = 'medium';
      specialRules.push('Düşük kamyon kondisyonunda hasar riski artar.');
      break;
    }
    case 'high_reputation': {
      bonusMultiplier = randomMultiplier(1.25, 1.45, seed + 13);
      penaltyMultiplier = 1.15;
      payment = Math.round(payment * bonusMultiplier);
      requiredReputation = HIGH_REPUTATION_REQUIRED;
      requiredDriverLevel = 2;
      riskLevel = 'medium';
      specialRules.push('Başarılı teslimatta ekstra itibar kazanırsın.');
      break;
    }
    case 'bulk': {
      bonusMultiplier = randomMultiplier(1.1, 1.2, seed + 19);
      penaltyMultiplier = 1.1;
      const bulkFactor = randomBetween(1.15, 1.35);
      const baseAmount = amount;
      amount =
        Math.round(
          Math.min(
            amount * bulkFactor,
            params.maxCargoTons ?? Number.POSITIVE_INFINITY,
          ) *
            10,
        ) / 10;
      cargoWeight = amount;
      const appliedBulkFactor = baseAmount > 0 ? amount / baseAmount : 1;
      payment = Math.round(payment * bonusMultiplier * appliedBulkFactor);
      deadlineHours = clamp(deadlineHours * 1.12, deadlineHours, 72);
      riskLevel = 'medium';
      specialRules.push('Yüksek tonaj — daha fazla yakıt ve bakım maliyeti.');
      break;
    }
    case 'refrigerated': {
      bonusMultiplier = randomMultiplier(1.15, 1.28, seed + 23);
      penaltyMultiplier = 1.2;
      payment = Math.round(payment * bonusMultiplier);
      deadlineHours = clamp(deadlineHours * 0.88, 4, deadlineHours);
      recommendedTruckCondition = 60;
      riskLevel = 'medium';
      specialRules.push('Soğuk zincir — süreye dikkat et.');
      break;
    }
    default:
      break;
  }

  if (contractType === 'urgent' || contractType === 'refrigerated') {
    riskLevel = 'high';
  }

  return {
    ...contract,
    amount,
    cargoWeight,
    payment,
    deadlineHours,
    urgency,
    contractType,
    riskLevel,
    requiredReputation,
    recommendedTruckCondition,
    requiredDriverLevel,
    bonusMultiplier,
    penaltyMultiplier,
    specialRules: specialRules.length > 0 ? specialRules : undefined,
    selectionScoreBasis,
  };
}

/** Aday seçim skoru — tip bonusu/tonaj şişmesi yansıtılmaz; gerçek ödeme contract.payment'da kalır */
export function getContractSelectionScoreInputs(contract: Contract): {
  payment: number;
  amount: number;
  urgency: number;
} {
  const basis = contract.selectionScoreBasis;
  if (basis) {
    return basis;
  }
  const bonus = contract.bonusMultiplier ?? 1;
  return {
    payment: bonus > 1 ? Math.round(contract.payment / bonus) : contract.payment,
    amount: contract.amount,
    urgency: contract.urgency ?? 0,
  };
}

export function getContractTypePaymentMultiplier(contract: Contract): number {
  const type = normalizeContractType(contract);
  if (type === 'standard') {
    return 1;
  }
  return contract.bonusMultiplier ?? CONTRACT_TYPE_PAYMENT_RANGE[type]?.min ?? 1;
}

export function getContractTypeDeadlineMultiplier(contract: Contract): number {
  const type = normalizeContractType(contract);
  switch (type) {
    case 'urgent':
      return 0.78;
    case 'refrigerated':
      return 0.88;
    case 'bulk':
      return 1.12;
    default:
      return 1;
  }
}

export function getContractTypePenaltyMultiplier(contract: Contract): number {
  return contract.penaltyMultiplier ?? 1;
}

export function getContractTypeDescription(contract: Contract): string {
  const type = normalizeContractType(contract);
  switch (type) {
    case 'standard':
      return 'Standart taşıma işi — dengeli ödeme ve süre.';
    case 'urgent':
      return 'Acil teslimat — yüksek ödeme, kısa süre, gecikme cezası artar.';
    case 'fragile':
      return 'Hassas yük — iyi bakımlı kamyon önerilir.';
    case 'high_reputation':
      return 'Prestijli iş — yüksek itibar gerektirir, ekstra ödeme sunar.';
    case 'bulk':
      return 'Ağır yük — yüksek tonaj ve kapasite gerektirir.';
    case 'refrigerated':
      return 'Soğuk zincir taşıması — bozulabilir ürün, kısa süre.';
    default:
      return '';
  }
}

export function shouldGrantHighReputationBonus(contract: Contract): boolean {
  return normalizeContractType(contract) === 'high_reputation';
}
