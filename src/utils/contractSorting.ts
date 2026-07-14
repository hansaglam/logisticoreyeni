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
}

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
    if (delivery.status === 'on_route' || delivery.status === 'preparing') {
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

export function getContractSmartSortScore(contract: Contract, ctx: ContractSortContext): number {
  const preview = ctx.previewById.get(contract.id);
  if (!preview) {
    return -99999;
  }

  const safePlayerLevel = Math.max(1, ctx.playerLevel ?? 1);
  const originId = contract.originCityId;
  const { availability } = preview;
  let score = 0;

  if (ctx.marketFilter?.contractId && contract.id === ctx.marketFilter.contractId) {
    score += 50000;
  }

  if (ctx.marketFilter?.source === 'map' && isRouteContractFilter(ctx.marketFilter)) {
    score += getContractFilterSortTier(contract, ctx.marketFilter) * 5000;
  }

  if (isMarketOpportunityFilter(ctx.marketFilter)) {
    score += getContractMarketSortScore(contract, ctx.marketFilter) * 100;
  }

  if (originId && hasIdleTruckAtOrigin(ctx.trucks, originId) && availability.canStart) {
    score += 10000;
  }

  const destinationIds = getActiveDeliveryDestinationCityIds(ctx.activeDeliveries);
  if (originId && destinationIds.has(originId)) {
    score += 8000;
    if (availability.canStart) {
      score += 2000;
    }
  }

  if (originId && hasTruckAtOrigin(ctx.trucks, originId) && !hasIdleTruckAtOrigin(ctx.trucks, originId)) {
    score += 5000;
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
