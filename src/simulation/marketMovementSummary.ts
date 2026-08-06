import type {
  CityId,
  GlobalEconomySnapshot,
  GlobalSupplyDemandStatus,
  ProductId,
} from '../types/game';

export const MARKET_MOVEMENT_THRESHOLD_PERCENT = 2;

export type MarketMovementDominantDirection = 'up' | 'down' | 'mixed' | 'stable';

export interface MarketMovementSummary {
  total: number;
  increases: number;
  decreases: number;
  unchanged: number;
  dominantDirection: MarketMovementDominantDirection;
}

export const STABLE_MARKET_MOVEMENT_SUMMARY: MarketMovementSummary = {
  total: 0,
  increases: 0,
  decreases: 0,
  unchanged: 0,
  dominantDirection: 'stable',
};

function statusRank(status: GlobalSupplyDemandStatus): number {
  if (status === 'shortage') return 0;
  if (status === 'balanced') return 1;
  return 2;
}

function resolveStatusDirection(
  previousStatus: GlobalSupplyDemandStatus,
  currentStatus: GlobalSupplyDemandStatus,
): 'up' | 'down' | null {
  if (previousStatus === currentStatus) return null;
  const delta = statusRank(currentStatus) - statusRank(previousStatus);
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return null;
}

function collectCityProductKeys(
  snapshot: GlobalEconomySnapshot,
): Set<string> {
  const keys = new Set<string>();
  for (const cityId of Object.keys(snapshot.cityMarketPrices) as CityId[]) {
    const products = snapshot.cityMarketPrices[cityId] ?? {};
    for (const productId of Object.keys(products) as ProductId[]) {
      keys.add(`${cityId}:${productId}`);
    }
  }
  for (const cityId of Object.keys(snapshot.supplyDemandState) as CityId[]) {
    const products = snapshot.supplyDemandState[cityId] ?? {};
    for (const productId of Object.keys(products) as ProductId[]) {
      keys.add(`${cityId}:${productId}`);
    }
  }
  return keys;
}

function resolveDominantDirection(
  increases: number,
  decreases: number,
): MarketMovementDominantDirection {
  if (increases === 0 && decreases === 0) return 'stable';
  if (increases > decreases) return 'up';
  if (decreases > increases) return 'down';
  return 'mixed';
}

export function snapshotsAreEquivalentForMovement(
  current: GlobalEconomySnapshot,
  previous: GlobalEconomySnapshot,
): boolean {
  return (
    current.epoch === previous.epoch &&
    current.generatedAt === previous.generatedAt
  );
}

/** İki canonical snapshot arasındaki anlamlı piyasa hareketini hesaplar. */
export function selectMarketMovementSummary(
  currentMarket: GlobalEconomySnapshot | null | undefined,
  previousMarketSnapshot: GlobalEconomySnapshot | null | undefined,
): MarketMovementSummary {
  if (!currentMarket || !previousMarketSnapshot) {
    return STABLE_MARKET_MOVEMENT_SUMMARY;
  }
  if (snapshotsAreEquivalentForMovement(currentMarket, previousMarketSnapshot)) {
    return STABLE_MARKET_MOVEMENT_SUMMARY;
  }

  const keys = new Set([
    ...collectCityProductKeys(currentMarket),
    ...collectCityProductKeys(previousMarketSnapshot),
  ]);

  let increases = 0;
  let decreases = 0;
  let unchanged = 0;

  for (const key of keys) {
    const [cityId, productId] = key.split(':') as [CityId, ProductId];
    const currentPrice = currentMarket.cityMarketPrices[cityId]?.[productId];
    const previousPrice = previousMarketSnapshot.cityMarketPrices[cityId]?.[productId];
    const currentStatus =
      currentMarket.supplyDemandState[cityId]?.[productId]?.status;
    const previousStatus =
      previousMarketSnapshot.supplyDemandState[cityId]?.[productId]?.status;

    let moved = false;
    let direction: 'up' | 'down' | null = null;

    if (
      typeof currentPrice === 'number' &&
      typeof previousPrice === 'number' &&
      Number.isFinite(currentPrice) &&
      Number.isFinite(previousPrice) &&
      previousPrice > 0
    ) {
      const changePercent =
        (Math.abs(currentPrice - previousPrice) / previousPrice) * 100;
      if (changePercent >= MARKET_MOVEMENT_THRESHOLD_PERCENT) {
        moved = true;
        direction = currentPrice > previousPrice ? 'up' : 'down';
      }
    }

    if (currentStatus && previousStatus) {
      const statusDirection = resolveStatusDirection(previousStatus, currentStatus);
      if (statusDirection) {
        moved = true;
        if (!direction) {
          direction = statusDirection;
        }
      }
    }

    if (!moved) {
      unchanged += 1;
      continue;
    }

    if (direction === 'up') {
      increases += 1;
    } else if (direction === 'down') {
      decreases += 1;
    } else {
      unchanged += 1;
    }
  }

  const total = increases + decreases;
  return {
    total,
    increases,
    decreases,
    unchanged,
    dominantDirection: resolveDominantDirection(increases, decreases),
  };
}

export function formatMarketMovementHelper(
  summary: MarketMovementSummary,
  compact = false,
): string {
  if (summary.total <= 0) {
    return 'Piyasa sakin';
  }
  if (compact) {
    return 'Aktif değişim';
  }
  if (summary.increases > 0 && summary.decreases > 0) {
    return `${summary.increases} yükseliş · ${summary.decreases} düşüş`;
  }
  if (summary.increases > 0) {
    return `${summary.increases} yükseliş`;
  }
  if (summary.decreases > 0) {
    return `${summary.decreases} düşüş`;
  }
  return 'Aktif değişim';
}

export function resolveMarketMovementAccentColor(
  summary: MarketMovementSummary,
): string {
  switch (summary.dominantDirection) {
    case 'up':
      return '#34D399';
    case 'down':
      return '#F87171';
    case 'mixed':
      return '#60A5FA';
    default:
      return '#8BA3C7';
  }
}

export function resolveMarketMovementIcon(
  summary: MarketMovementSummary,
): 'revenue' | 'expense' | 'market' | 'alert' {
  switch (summary.dominantDirection) {
    case 'up':
      return 'revenue';
    case 'down':
      return 'expense';
    case 'mixed':
      return 'alert';
    default:
      return 'market';
  }
}
