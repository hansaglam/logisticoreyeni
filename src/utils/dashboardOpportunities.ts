/**
 * Ana Sayfa "En İyi Fırsatlar" seçimi ve badge mantığı.
 */

import { tradingBalance } from '../config/balance';
import { findMarketOpportunities } from '../simulation/contracts';
import {
  buildContractPreview,
  isUrgentContractPreview,
  type ContractPreview,
} from '../simulation/contractPreview';
import { hasIdleTruckAtOrigin } from '../simulation/delivery';
import type {
  City,
  Contract,
  Delivery,
  Driver,
  GlobalEconomy,
  Product,
  Route,
  Truck,
} from '../types/game';
import { getActiveDeliveryDestinationCityIds } from './contractSorting';

export interface DashboardOpportunityBadge {
  key: string;
  label: string;
  textColor: string;
  backgroundColor: string;
  borderColor: string;
}

export interface DashboardOpportunityItem {
  contract: Contract;
  preview: ContractPreview;
  badges: DashboardOpportunityBadge[];
  estimatedProfit: number;
}

export interface BuildDashboardOpportunitiesInput {
  contracts: Contract[];
  trucks: Truck[];
  drivers: Driver[];
  playerLevel: number;
  currentTime: number;
  globalEconomy?: GlobalEconomy;
  activeDeliveries: Delivery[];
  cities: City[];
  routes: Route[];
  products: Product[];
  limit?: number;
}

const BADGE_STYLES = {
  ready: {
    textColor: '#4ADE80',
    backgroundColor: 'rgba(74, 222, 128, 0.12)',
    borderColor: 'rgba(74, 222, 128, 0.45)',
  },
  profit: {
    textColor: '#FBBF24',
    backgroundColor: 'rgba(251, 191, 36, 0.12)',
    borderColor: 'rgba(251, 191, 36, 0.5)',
  },
  urgent: {
    textColor: '#F87171',
    backgroundColor: 'rgba(248, 113, 113, 0.10)',
    borderColor: 'rgba(248, 113, 113, 0.65)',
  },
  route: {
    textColor: '#38BDF8',
    backgroundColor: 'rgba(56, 189, 248, 0.10)',
    borderColor: 'rgba(56, 189, 248, 0.45)',
  },
  market: {
    textColor: '#A78BFA',
    backgroundColor: 'rgba(167, 139, 250, 0.12)',
    borderColor: 'rgba(167, 139, 250, 0.45)',
  },
} as const;

function getContractRouteKey(contract: Contract): string {
  return `${contract.originCityId}-${contract.destinationCityId}`;
}

function getContractRouteKeyFull(contract: Contract): string {
  return `${contract.originCityId}-${contract.destinationCityId}-${contract.productId}`;
}

/**
 * Dashboard önizlemesi için skor sırasını koruyarak farklı rota/ürün çeşitliliği sağlar.
 */
export function pickDiverseDashboardOpportunities(
  items: DashboardOpportunityItem[],
  limit = 2,
): DashboardOpportunityItem[] {
  if (items.length <= limit) {
    return items;
  }

  const picked: DashboardOpportunityItem[] = [items[0]];
  const first = items[0];
  const firstRoute = getContractRouteKey(first.contract);
  const firstProduct = first.contract.productId ?? '';

  const diverse = items.slice(1).find((item) => {
    const route = getContractRouteKey(item.contract);
    const product = item.contract.productId ?? '';
    return route !== firstRoute || product !== firstProduct;
  });

  if (diverse) {
    picked.push(diverse);
  } else {
    picked.push(items[1]);
  }

  return picked.slice(0, limit);
}

function buildMarketOpportunityKeySet(
  cities: City[],
  routes: Route[],
  products: Product[],
): Set<string> {
  const keys = new Set<string>();
  for (const opportunity of findMarketOpportunities(cities, routes, products, 12)) {
    keys.add(`${opportunity.fromCityId}-${opportunity.toCityId}-${opportunity.productId}`);
  }
  return keys;
}

function isHighProfitContract(preview: ContractPreview): boolean {
  const marginRatio = preview.estimatedMarginPercent ?? 0;
  return marginRatio * 100 >= tradingBalance.highProfitHintPercent;
}

export function buildDashboardOpportunityBadges(params: {
  contract: Contract;
  preview: ContractPreview;
  activeDeliveryDestinationIds: Set<string>;
  marketOpportunityKeys: Set<string>;
}): DashboardOpportunityBadge[] {
  const { contract, preview, activeDeliveryDestinationIds, marketOpportunityKeys } = params;
  const candidates: DashboardOpportunityBadge[] = [];

  if (preview.availability.canStart) {
    candidates.push({ key: 'ready', label: 'Kamyon hazır', ...BADGE_STYLES.ready });
  }

  if (isHighProfitContract(preview)) {
    candidates.push({ key: 'profit', label: 'Yüksek kâr', ...BADGE_STYLES.profit });
  }

  if (preview.isUrgent || isUrgentContractPreview(contract, preview.estimatedTravelHours)) {
    candidates.push({ key: 'urgent', label: 'Acil', ...BADGE_STYLES.urgent });
  }

  if (
    contract.originCityId &&
    activeDeliveryDestinationIds.has(contract.originCityId)
  ) {
    candidates.push({ key: 'next-route', label: 'Sıradaki rota', ...BADGE_STYLES.route });
  }

  if (marketOpportunityKeys.has(getContractRouteKeyFull(contract))) {
    candidates.push({ key: 'market', label: 'Piyasa fırsatı', ...BADGE_STYLES.market });
  }

  return candidates.slice(0, 2);
}

function getDashboardOpportunitySortScore(params: {
  contract: Contract;
  preview: ContractPreview;
  trucks: Truck[];
  activeDeliveryDestinationIds: Set<string>;
  marketOpportunityKeys: Set<string>;
}): number {
  const { contract, preview, trucks, activeDeliveryDestinationIds, marketOpportunityKeys } = params;
  let score = 0;

  if (contract.originCityId && hasIdleTruckAtOrigin(trucks, contract.originCityId)) {
    score += 10000;
  }

  const profitRatio = Math.max(0, preview.estimatedMarginPercent ?? 0);
  score += Math.min(profitRatio * 5000, 5000);
  if (isHighProfitContract(preview)) {
    score += 1000;
  }

  if (preview.isUrgent || isUrgentContractPreview(contract, preview.estimatedTravelHours)) {
    score += 2000;
  }

  if (contract.originCityId && activeDeliveryDestinationIds.has(contract.originCityId)) {
    score += 1500;
  }

  if (marketOpportunityKeys.has(getContractRouteKeyFull(contract))) {
    score += 1000;
  }

  return score;
}

export function buildDashboardOpportunities(
  input: BuildDashboardOpportunitiesInput,
): DashboardOpportunityItem[] {
  const {
    contracts,
    trucks,
    drivers,
    playerLevel,
    currentTime,
    globalEconomy,
    activeDeliveries,
    cities,
    routes,
    products,
    limit = 3,
  } = input;

  const safeLevel = Math.max(1, playerLevel);
  const available = contracts.filter((contract) => contract.status === 'available');
  const previewById = new Map<string, ContractPreview>();
  const actionable: Contract[] = [];

  for (const contract of available) {
    const preview = buildContractPreview({
      contract,
      trucks,
      drivers,
      companyLevel: safeLevel,
      currentTime,
      globalEconomy,
    });
    previewById.set(contract.id, preview);
    if (preview.availability.canStart) {
      actionable.push(contract);
    }
  }

  if (actionable.length === 0) {
    return [];
  }

  const marketOpportunityKeys = buildMarketOpportunityKeySet(cities, routes, products);
  const activeDeliveryDestinationIds = getActiveDeliveryDestinationCityIds(activeDeliveries);

  const sorted = [...actionable].sort((a, b) => {
    const previewA = previewById.get(a.id)!;
    const previewB = previewById.get(b.id)!;

    const scoreA = getDashboardOpportunitySortScore({
      contract: a,
      preview: previewA,
      trucks,
      activeDeliveryDestinationIds,
      marketOpportunityKeys,
    });
    const scoreB = getDashboardOpportunitySortScore({
      contract: b,
      preview: previewB,
      trucks,
      activeDeliveryDestinationIds,
      marketOpportunityKeys,
    });
    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }

    const profitDiff = previewB.estimatedOperationalProfit - previewA.estimatedOperationalProfit;
    if (profitDiff !== 0) {
      return profitDiff;
    }

    const deadlineA = a.deadlineHours ?? Number.MAX_SAFE_INTEGER;
    const deadlineB = b.deadlineHours ?? Number.MAX_SAFE_INTEGER;
    if (deadlineA !== deadlineB) {
      return deadlineA - deadlineB;
    }

    return (b.payment ?? 0) - (a.payment ?? 0);
  });

  return sorted.slice(0, limit).map((contract) => {
    const preview = previewById.get(contract.id)!;
    return {
      contract,
      preview,
      estimatedProfit: preview.estimatedOperationalProfit,
      badges: buildDashboardOpportunityBadges({
        contract,
        preview,
        activeDeliveryDestinationIds,
        marketOpportunityKeys,
      }),
    };
  });
}
