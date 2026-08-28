/**
 * Per-pass and static indexes for contract generation hot paths.
 * Does not change eligibility or duplicate semantics.
 */

import { isRoadGraphPairConnected } from '../components/map/mapRoadUtils';
import { getRoute } from '../data/routes';
import { isWarehouseCityUnlocked } from '../config/levelConfig';
import type { City, Contract, Product, ProductId, ProductMarket, Route } from '../types/game';
import { toProductMarket } from './economy';

export function makeRouteProductKey(
  originCityId: string,
  destinationCityId: string,
  productId: ProductId,
): string {
  return `${originCityId}|${destinationCityId}|${productId}`;
}

/** O(1) route lookup — canonical network index with array fallback for custom fixtures. */
export function lookupRouteBetweenCities(
  routes: Route[],
  originCityId: string,
  destinationCityId: string,
): Route | undefined {
  const indexed = getRoute(originCityId, destinationCityId);
  if (indexed) {
    return indexed;
  }
  return routes.find(
    (route) => route.fromCityId === originCityId && route.toCityId === destinationCityId,
  );
}

export type AvailableDuplicateIndex = Map<string, number>;

/** Counts available contracts per origin/destination/product — same scope as countAvailableDuplicates. */
export function buildAvailableDuplicateIndex(contracts: Contract[]): AvailableDuplicateIndex {
  const index: AvailableDuplicateIndex = new Map();
  for (const contract of contracts) {
    if (contract.status !== 'available') {
      continue;
    }
    const key = makeRouteProductKey(
      contract.originCityId,
      contract.destinationCityId,
      contract.productId,
    );
    index.set(key, (index.get(key) ?? 0) + 1);
  }
  return index;
}

export function getAvailableDuplicateCount(
  index: AvailableDuplicateIndex,
  originCityId: string,
  destinationCityId: string,
  productId: ProductId,
): number {
  return index.get(makeRouteProductKey(originCityId, destinationCityId, productId)) ?? 0;
}

export interface CityProductEconomyCell {
  originMarket: ProductMarket;
  destinationMarket?: ProductMarket;
  surplus: number;
  shortage: number;
}

export type CityProductEconomyIndex = Map<string, CityProductEconomyCell>;

function cityProductKey(cityId: string, productId: ProductId): string {
  return `${cityId}|${productId}`;
}

function computeSurplus(market: ProductMarket): number {
  return Math.max(0, market.stock - market.targetStock);
}

function computeShortage(market: ProductMarket): number {
  return Math.max(0, market.targetStock - market.stock);
}

/** Per-generation-pass surplus/shortage for each city×product. */
export function buildCityProductEconomyIndex(
  cities: City[],
  products: Product[],
): CityProductEconomyIndex {
  const index: CityProductEconomyIndex = new Map();
  for (const city of cities) {
    for (const product of products) {
      const market = toProductMarket(city.products[product.id]);
      index.set(cityProductKey(city.id, product.id), {
        originMarket: market,
        surplus: computeSurplus(market),
        shortage: computeShortage(market),
      });
    }
  }
  return index;
}

export function getCityProductEconomy(
  index: CityProductEconomyIndex,
  cityId: string,
  productId: ProductId,
): CityProductEconomyCell | undefined {
  return index.get(cityProductKey(cityId, productId));
}

export type CityPairEligibilityCache = Map<string, boolean>;

export function isContractCityPairEligibleCached(
  cache: CityPairEligibilityCache,
  originCityId: string,
  destinationCityId: string,
  playerLevel: number,
): boolean {
  if (originCityId === destinationCityId) {
    return false;
  }
  const key = `${originCityId}|${destinationCityId}|${playerLevel}`;
  const cached = cache.get(key);
  if (cached != null) {
    return cached;
  }
  const eligible =
    isWarehouseCityUnlocked(originCityId, playerLevel) &&
    isWarehouseCityUnlocked(destinationCityId, playerLevel) &&
    isRoadGraphPairConnected(originCityId, destinationCityId);
  cache.set(key, eligible);
  return eligible;
}
