/**
 * Sözleşme listesi akıllı sıralama — boşta kamyon şehri ve aktif teslimat varışlarına göre.
 */

import { getContractFilterSortTier } from '../simulation/contracts';
import { hasIdleTruckAtOrigin, hasTruckAtOrigin } from '../simulation/delivery';
import type { ContractPreview } from '../simulation/contractPreview';
import type { Contract, Delivery, Driver, MarketContractFilter, Truck } from '../types/game';
import { getContractMarketSortScore } from './marketContractMatch';

export interface ContractSortContext {
  trucks: Truck[];
  drivers: Driver[];
  playerLevel: number;
  activeDeliveries: Delivery[];
  previewById: Map<string, ContractPreview>;
  marketFilter?: MarketContractFilter | null;
  fallbackHomeCityId?: string;
}

/** 1 = şimdi alınabilir, 2 = boşta kamyon var ama kilitli, 3 = varış şehri önerisi, 4 = diğer */
export type ContractSortTier = 1 | 2 | 3 | 4;

const TIER_BASE_SCORE: Record<ContractSortTier, number> = {
  1: 40_000,
  2: 30_000,
  3: 20_000,
  4: 10_000,
};

export function isMarketOpportunityFilter(
  filter: MarketContractFilter | null | undefined,
): filter is MarketContractFilter {
  return filter?.source === 'market';
}

export function isRouteContractFilter(
  filter: MarketContractFilter | null | undefined,
): filter is MarketContractFilter {
  return filter?.source === 'market' || filter?.source === 'map';
}

export function getActiveDeliveryDestinationCityIds(deliveries: Delivery[] | undefined): Set<string> {
  const ids = new Set<string>();
  for (const delivery of deliveries ?? []) {
    if (
      delivery.status === 'on_route' ||
      delivery.status === 'preparing' ||
      delivery.status === 'paused'
    ) {
      if (delivery.destinationCityId) {
        ids.add(delivery.destinationCityId);
      }
    }
  }
  return ids;
}

function getLockPenalty(availability: ContractPreview['availability'], requiredLevel: number, playerLevel: number): number {
  if (availability.canStart) {
    return 0;
  }

  if (availability.reason === 'LEVEL_INSUFFICIENT') {
    const gap = requiredLevel - Math.max(1, playerLevel);
    return gap > 1 ? 8000 : 4000;
  }

  return 800;
}

export function getContractSortTier(contract: Contract, ctx: ContractSortContext): ContractSortTier {
  const preview = ctx.previewById.get(contract.id);
  if (!preview) {
    return 4;
  }

  const originId = contract.originCityId;
  const hasIdleAtOrigin =
    !!originId && hasIdleTruckAtOrigin(ctx.trucks, originId, ctx.fallbackHomeCityId);

  if (hasIdleAtOrigin && preview.availability.canStart) {
    return 1;
  }
  if (hasIdleAtOrigin && !preview.availability.canStart) {
    return 2;
  }

  const destinationIds = getActiveDeliveryDestinationCityIds(ctx.activeDeliveries);
  if (originId && destinationIds.has(originId)) {
    return 3;
  }

  return 4;
}

export function getContractSmartSortScore(contract: Contract, ctx: ContractSortContext): number {
  const preview = ctx.previewById.get(contract.id);
  if (!preview) {
    return -99999;
  }

  const safePlayerLevel = Math.max(1, ctx.playerLevel ?? 1);
  const originId = contract.originCityId;
  const { availability } = preview;
  const tier = getContractSortTier(contract, ctx);
  let score = TIER_BASE_SCORE[tier];

  if (ctx.marketFilter?.contractId && contract.id === ctx.marketFilter.contractId) {
    score += 50_000;
  }

  if (ctx.marketFilter?.source === 'map' && isRouteContractFilter(ctx.marketFilter)) {
    score += getContractFilterSortTier(contract, ctx.marketFilter) * 5000;
  }

  if (isMarketOpportunityFilter(ctx.marketFilter)) {
    score += getContractMarketSortScore(contract, ctx.marketFilter) * 100;
  }

  if (tier === 3 && availability.canStart) {
    score += 500;
  }

  if (
    tier === 4 &&
    originId &&
    hasTruckAtOrigin(ctx.trucks, originId, ctx.fallbackHomeCityId) &&
    !hasIdleTruckAtOrigin(ctx.trucks, originId, ctx.fallbackHomeCityId)
  ) {
    score += 500;
  }

  const profitRatio = contract.payment > 0 ? preview.estimatedOperationalProfit / contract.payment : 0;
  score += Math.min(Math.max(profitRatio, 0) * 500, 500);

  if (preview.isUrgent) {
    score += 200;
  }

  score -= getLockPenalty(availability, contract.requiredLevel ?? 1, safePlayerLevel);

  return score;
}

export function compareContractsBySmartScore(a: Contract, b: Contract, ctx: ContractSortContext): number {
  if (isMarketOpportunityFilter(ctx.marketFilter)) {
    const marketDiff =
      getContractMarketSortScore(b, ctx.marketFilter) - getContractMarketSortScore(a, ctx.marketFilter);
    if (marketDiff !== 0) {
      return marketDiff;
    }
  }

  return getContractSmartSortScore(b, ctx) - getContractSmartSortScore(a, ctx);
}
