import type { Contract, MarketContractFilter } from '../types/game';

export type MarketContractMatchTier =
  | 'exact'
  | 'same_route'
  | 'same_origin_product'
  | 'same_destination_product'
  | 'same_origin'
  | 'same_destination'
  | 'same_product'
  | 'none';

export const MARKET_MATCH_SCORE: Record<MarketContractMatchTier, number> = {
  exact: 100,
  same_route: 85,
  same_origin_product: 75,
  same_destination_product: 65,
  same_origin: 55,
  same_destination: 45,
  same_product: 35,
  none: 0,
};

export const MARKET_MATCH_BADGE_LABEL: Record<
  Exclude<MarketContractMatchTier, 'none'>,
  string
> = {
  exact: 'Fırsatla tam eşleşme',
  same_route: 'Aynı rota',
  same_origin_product: 'Aynı şehir + ürün',
  same_destination_product: 'Hedef + ürün',
  same_origin: 'Aynı çıkış şehri',
  same_destination: 'Aynı hedef şehir',
  same_product: 'Aynı ürün',
};

export type MarketMatchBadgeVariant = 'exact' | 'strong' | 'muted';

export function getMarketMatchBadgeVariant(tier: MarketContractMatchTier): MarketMatchBadgeVariant | null {
  if (tier === 'none') return null;
  if (tier === 'exact') return 'exact';
  if (tier === 'same_route' || tier === 'same_origin_product' || tier === 'same_destination_product') {
    return 'strong';
  }
  return 'muted';
}

type MarketMatchFilter = Pick<MarketContractFilter, 'fromCityId' | 'toCityId' | 'productId'>;

function hasFilterField(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function hasContractField(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function getMarketContractMatchTier(
  contract: Contract,
  filter: MarketMatchFilter,
): MarketContractMatchTier {
  const fromCityId = filter.fromCityId;
  const toCityId = filter.toCityId;
  const productId = filter.productId;

  const originCityId = contract.originCityId;
  const destinationCityId = contract.destinationCityId;
  const contractProductId = contract.productId;

  const hasOrigin = hasContractField(originCityId);
  const hasDestination = hasContractField(destinationCityId);
  const hasProduct = hasContractField(contractProductId);
  const hasFilterOrigin = hasFilterField(fromCityId);
  const hasFilterDestination = hasFilterField(toCityId);
  const hasFilterProduct = hasFilterField(productId);

  const sameOrigin = hasOrigin && hasFilterOrigin && originCityId === fromCityId;
  const sameDestination =
    hasDestination && hasFilterDestination && destinationCityId === toCityId;
  const sameProduct = hasProduct && hasFilterProduct && contractProductId === productId;

  if (sameOrigin && sameDestination && sameProduct) {
    return 'exact';
  }

  if (sameOrigin && sameDestination) {
    return 'same_route';
  }

  if (sameOrigin && sameProduct) {
    return 'same_origin_product';
  }

  if (sameDestination && sameProduct) {
    return 'same_destination_product';
  }

  if (sameOrigin) {
    return 'same_origin';
  }

  if (sameDestination) {
    return 'same_destination';
  }

  if (sameProduct) {
    return 'same_product';
  }

  return 'none';
}

export function getMarketContractMatchScore(
  contract: Contract,
  filter: MarketMatchFilter,
): number {
  return MARKET_MATCH_SCORE[getMarketContractMatchTier(contract, filter)];
}

export function isExactMarketContractMatch(
  contract: Contract,
  filter: MarketMatchFilter,
): boolean {
  return getMarketContractMatchTier(contract, filter) === 'exact';
}

export function isRelatedMarketContractMatch(
  contract: Contract,
  filter: MarketMatchFilter,
): boolean {
  const tier = getMarketContractMatchTier(contract, filter);
  return tier !== 'exact' && tier !== 'none';
}

export function countMarketContractMatches(
  contracts: Contract[] | undefined,
  filter: MarketMatchFilter,
): { exactMatchesCount: number; relatedMatchesCount: number } {
  let exactMatchesCount = 0;
  let relatedMatchesCount = 0;

  for (const contract of contracts ?? []) {
    if (contract.status !== 'available') continue;

    const tier = getMarketContractMatchTier(contract, filter);
    if (tier === 'exact') {
      exactMatchesCount += 1;
    } else if (tier !== 'none') {
      relatedMatchesCount += 1;
    }
  }

  return { exactMatchesCount, relatedMatchesCount };
}

export function countExactMarketContractMatches(
  contracts: Contract[] | undefined,
  filter: MarketMatchFilter,
): number {
  return countMarketContractMatches(contracts, filter).exactMatchesCount;
}

export function countRelatedMarketContractMatches(
  contracts: Contract[] | undefined,
  filter: MarketMatchFilter,
): number {
  return countMarketContractMatches(contracts, filter).relatedMatchesCount;
}

export function getContractMarketSortScore(
  contract: Contract,
  filter: MarketContractFilter,
): number {
  if (filter.contractId && contract.id === filter.contractId) {
    return 1000;
  }
  return getMarketContractMatchScore(contract, filter);
}
