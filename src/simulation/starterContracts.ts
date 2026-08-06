/**
 * Yeni oyun / reset için garanti başlangıç sözleşmeleri.
 * Tutorial ve ilk oyun deneyiminde en az 1 alınabilir iş sağlar.
 */

import type {
  City,
  Contract,
  GlobalEconomy,
  Player,
  Product,
  ProductId,
  Route,
  Truck,
} from '../types/game';
import { contractBalance } from '../config/balance';
import { normalizeCityId } from '../data/networkPositions';
import { toProductMarket } from './economy';
import {
  calculateContractPayment,
  calculateDeadlineHours,
  createContractId,
  getRouteBetweenCities,
} from './contracts';
import { getContractAvailability } from './delivery';
import { clamp, randomIntBetween } from '../utils/math';

const STARTER_DESTINATIONS = ['ankara', 'bursa', 'antalya'] as const;
const STARTER_PRODUCTS: ProductId[] = ['textile', 'fruit', 'beverage'];
const STARTER_OFFER_LIFETIME_HOURS = 16;

export interface EnsureStarterContractsParams {
  contracts: Contract[];
  cities: Record<string, City>;
  routes: Route[];
  products: Product[];
  globalEconomy: GlobalEconomy;
  player: Pick<Player, 'level' | 'companyLevel' | 'trucks' | 'drivers' | 'homeCityId'>;
  currentTime: number;
  /** Minimum garanti sözleşme sayısı */
  minCount?: number;
}

function resolveStarterTruck(trucks: Truck[] | undefined): Truck | null {
  const idle = trucks?.find((truck) => truck.status === 'idle');
  return idle ?? trucks?.[0] ?? null;
}

function resolveStarterOriginCityId(truck: Truck | null, homeCityId?: string): string {
  return truck?.currentCityId ?? truck?.homeCityId ?? homeCityId ?? 'izmir';
}

function countStartableStarterContracts(
  contracts: Contract[],
  params: EnsureStarterContractsParams,
  originCityId: string,
  truckCapacity: number,
  playerLevel: number,
): number {
  const { currentTime, player } = params;
  const drivers = player.drivers ?? [];
  const trucks = player.trucks ?? [];

  return contracts.filter((contract) => {
    if (contract.status !== 'available') {
      return false;
    }
    if (contract.expiresAt <= currentTime) {
      return false;
    }
    if (contract.originCityId !== originCityId) {
      return false;
    }
    if ((contract.requiredLevel ?? 1) > playerLevel) {
      return false;
    }
    const weight = contract.cargoWeight ?? contract.amount ?? 0;
    if (weight > truckCapacity) {
      return false;
    }
    const availability = getContractAvailability(contract, trucks, drivers, playerLevel);
    return availability.canStart;
  }).length;
}

function buildGuaranteedStarterContract(
  params: EnsureStarterContractsParams,
  originCityId: string,
  destinationCityId: string,
  productId: ProductId,
  amount: number,
  sequence: number,
): Contract | null {
  const { cities, routes, products, globalEconomy, currentTime } = params;
  const originCity = cities[originCityId];
  const destinationCity = cities[destinationCityId];
  const product = products.find((item) => item.id === productId);
  const route = getRouteBetweenCities(routes, originCityId, destinationCityId);

  if (!originCity || !destinationCity || !product || !route) {
    return null;
  }

  const originMarket = toProductMarket(originCity.products[productId]);
  const destinationMarket = toProductMarket(destinationCity.products[productId]);
  const urgency = 0.28;
  const deadlineHours = calculateDeadlineHours({ route, product, urgency });
  const payment = calculateContractPayment({
    amount,
    product,
    originMarket,
    destinationMarket,
    route,
    urgency,
    globalEconomy,
    requiredLevel: 1,
  });

  return {
    id: createContractId(originCityId, destinationCityId, productId, currentTime, sequence),
    originCityId,
    destinationCityId,
    productId,
    amount,
    cargoWeight: amount,
    payment,
    deadlineHours,
    distanceKm: route.distanceKm,
    urgency,
    status: 'available',
    createdAt: currentTime,
    expiresAt: currentTime + STARTER_OFFER_LIFETIME_HOURS,
    requiredLevel: 1,
  };
}

function createStarterContractBatch(
  params: EnsureStarterContractsParams,
  originCityId: string,
  truckCapacity: number,
  existingLength: number,
  needed: number,
): Contract[] {
  const minTonnage = clamp(truckCapacity * 0.4, 4, truckCapacity);
  const maxTonnage = clamp(truckCapacity * 0.7, minTonnage, truckCapacity);
  const created: Contract[] = [];
  let sequence = existingLength + 1;
  const destinations = STARTER_DESTINATIONS.filter(
    (cityId) => normalizeCityId(cityId) !== normalizeCityId(originCityId),
  );
  const fallbackDestinations =
    destinations.length > 0
      ? destinations
      : (['ankara', 'antalya', 'izmir'] as const).filter(
          (cityId) => normalizeCityId(cityId) !== normalizeCityId(originCityId),
        );

  for (let index = 0; index < needed && index < fallbackDestinations.length; index += 1) {
    const destinationCityId = fallbackDestinations[index]!;
    const productId = STARTER_PRODUCTS[index % STARTER_PRODUCTS.length];
    const amount = Number(
      randomIntBetween(Math.floor(minTonnage), Math.floor(maxTonnage)).toFixed(1),
    );

    const contract = buildGuaranteedStarterContract(
      params,
      originCityId,
      destinationCityId,
      productId,
      amount,
      sequence,
    );
    if (!contract) {
      continue;
    }

    created.push(contract);
    sequence += 1;
  }

  if (created.length === 0) {
    const fallback = buildGuaranteedStarterContract(
      params,
      originCityId,
      'ankara',
      'textile',
      clamp(truckCapacity * 0.55, 6, truckCapacity),
      sequence,
    );
    if (fallback) {
      created.push(fallback);
    }
  }

  return created;
}

/**
 * Belirli bir çıkış şehrinden alınabilir sözleşmeler üretir (tonaj filo kapasitesine uygun).
 */
export function generatePlayableContractsForOriginCity(
  params: EnsureStarterContractsParams & {
    originCityId: string;
    truckCapacity: number;
    count: number;
  },
): Contract[] {
  const safeCount = Math.max(0, Math.min(params.count, 3));
  if (safeCount <= 0 || params.truckCapacity <= 0) {
    return [];
  }

  return createStarterContractBatch(
    params,
    params.originCityId,
    params.truckCapacity,
    params.contracts.length,
    safeCount,
  );
}

/**
 * Oyuncunun kamyon şehrinden alınabilir en az `minCount` sözleşme olduğundan emin olur.
 */
export function ensureStarterContracts(params: EnsureStarterContractsParams): Contract[] {
  const minCount = params.minCount ?? 1;
  const playerLevel = Math.max(1, params.player.level ?? params.player.companyLevel ?? 1);
  const starterTruck = resolveStarterTruck(params.player.trucks);
  const originCityId = resolveStarterOriginCityId(starterTruck, params.player.homeCityId);
  const truckCapacity = starterTruck?.capacity ?? 25;

  const startableCount = countStartableStarterContracts(
    params.contracts,
    params,
    originCityId,
    truckCapacity,
    playerLevel,
  );

  if (startableCount >= minCount) {
    return params.contracts;
  }

  const needed = Math.min(3, Math.max(minCount - startableCount, 1));
  const created = createStarterContractBatch(
    params,
    originCityId,
    truckCapacity,
    params.contracts.length,
    needed,
  );

  if (created.length === 0) {
    return params.contracts;
  }

  return [...params.contracts, ...created];
}
