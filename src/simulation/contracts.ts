/**
 * LogistiCore - Dinamik sözleşme oluşturma motoru
 *
 * Şehirlerin stok, fiyat ve üretim/tüketim dengesine göre taşıma sözleşmeleri
 * otomatik üretilir. Hiçbir sözleşme elle yazılmaz; ekonomi verisi kaynak alınır.
 */

import type {
  City,
  Contract,
  Delivery,
  Driver,
  GlobalEconomy,
  MarketContractFilter,
  MarketOpportunity,
  Player,
  Product,
  ProductId,
  ProductMarket,
  Route,
  Trailer,
  Truck,
  WorldEvent,
} from '../types/game';
import {
  contractBalance,
  contractExpiryBalance,
  contractGenerationBalance,
  contractLevelBalance,
  contractPaymentBalance,
} from '../config/balance';
import { debugConfig } from '../config/debug';
import {
  applyWorldEventImpactToContract,
  getContractSpawnWeightMultiplier,
} from './worldEvents';
import { applyContractTypeToContract, getContractSelectionScoreInputs } from './contractTypes';
import {
  applyCapacityProfileToTonnageRange,
  getMaxAllowedContractRequiredLevel,
  getMaxContractTonnageForLevel,
  getRequiredLevelForTonnage,
  pickContractCapacityProfile,
  pickContractGenerationLevelTier,
  resolveContractGenerationRange,
  isWarehouseCityUnlocked,
} from '../config/levelConfig';
import { isRoadGraphPairConnected } from '../components/map/mapRoadUtils';
import { normalizeCityId } from '../data/networkPositions';
import { toProductMarket } from './economy';
import {
  getActiveDeliveryDestinationCityIds,
  getBusyTruckOriginCityIds,
  getContractAvailability,
  getContractCargoWeight,
  getIdleDrivers,
  getIdleTruckOriginCityIds,
  getIdleTrucksAtOrigin,
  getMaxIdleTruckCapacityAtOrigin,
  isContractOfferExpired,
  isTruckAvailableForAssignment,
  canTruckCarryContract,
} from './delivery';
import {
  isContractUnreachableByFleet,
  shouldSpawnBeyondFleetContract,
} from './capacity';
import { meetsDriverLevelRequirement } from './driverProgress';
import { getRoute as findRoute } from '../data/routes';
import { getProductByIdSafe } from '../utils/entityLookup';
import { canAffordVoluntaryPurchase } from '../utils/cashPolicy';
import { measureContractScheduleStage } from '../utils/performanceDiagnostics';
import {
  calculateDeliveryFuelLiters,
  getTruckFuelReadiness,
  normalizeTruckFuel,
} from '../utils/truckFuel';
import { clamp, randomBetween, randomIntBetween } from '../utils/math';
import { getMarketContractMatchScore } from '../utils/marketContractMatch';
import {
  calculateBalancedContractPayment,
  calculateContractEconomics,
  calculateContractDurationHours,
  evaluateContractViability,
  estimateContractTripCostBreakdown,
  isContractEconomicallyViable,
  type ContractPaymentInput,
} from './contractEconomics';
import { sanitizeFuelPricePerLiter } from './economy';

// ---------------------------------------------------------------------------
// Yapılandırma sabitleri
// ---------------------------------------------------------------------------

/** Sözleşme oluşması için minimum kaynak fazlası (ton) */
const MIN_SURPLUS_TONS = 20;

/** Sözleşme oluşması için minimum hedef açığı (ton) */
const MIN_SHORTAGE_TONS = 20;

/** Hedef fiyatın kaynak fiyatından en az bu kadar yüksek olması gerekir */
const MIN_PRICE_DIFF_RATIO = 0.08;

/** Birleşik stok ihtiyacı eşiği — düşükse sözleşme üretilmez */
const MIN_NEED_SCORE = 0.12;

// TODO: contractBalance'e taşınabilir — üretim eşik sabitleri
/** Varsayılan kamyon kapasitesi (ton) — miktar hesabında üst sınır */
const DEFAULT_MAX_TRUCK_CAPACITY = 25;

// ---------------------------------------------------------------------------
// Parametre tipleri
// ---------------------------------------------------------------------------

export interface ContractPaymentParams {
  amount: number;
  product: Product;
  originMarket: ProductMarket;
  destinationMarket: ProductMarket;
  route: Route;
  urgency: number;
  globalEconomy: GlobalEconomy;
  requiredLevel?: number;
  isMarketOpportunity?: boolean;
}

export interface ContractDeadlineParams {
  route: Route;
  product: Product;
  urgency: number;
  amount?: number;
}

export interface ShouldGenerateContractParams {
  originCityId: string;
  destinationCityId: string;
  originMarket: ProductMarket;
  destinationMarket: ProductMarket;
  surplus: number;
  shortage: number;
  existingAvailableCount: number;
}

export interface GenerateContractForProductParams {
  originCity: City;
  destinationCity: City;
  productId: ProductId;
  product: Product;
  route: Route;
  globalEconomy: GlobalEconomy;
  currentTime: number;
  maxTruckCapacity?: number;
  /** Seviyeye uygun minimum tonaj */
  minTonnage?: number;
  /** Seviyeye uygun maksimum tonaj */
  maxTonnage?: number;
  /** Testlerde deterministik ID için sıra numarası */
  sequence?: number;
  /** Piyasa fırsatı rotası — marj bonusu uygulanır */
  isMarketOpportunity?: boolean;
  playerLevel?: number;
  playerReputation?: number;
  activeWorldEvents?: WorldEvent[];
}

export interface PlayerFleetCityContext {
  idleTruckOriginCityIds: string[];
  activeDeliveryDestinationCityIds: string[];
  busyTruckOriginCityIds: string[];
  marketOpportunityOriginCityIds: string[];
}

export interface GenerateContractsOptions {
  maxNewContracts?: number;
  maxTruckCapacity?: number;
  ownedMaxTruckCapacity?: number;
  idleMaxTruckCapacity?: number;
  playerLevel?: number;
  playerReputation?: number;
  currentTime: number;
  /** Boşta kamyonların bulunduğu şehirler — bu çıkışlardan iş üretimine öncelik */
  idleTruckOriginCityIds?: string[];
  /** Aktif teslimat varış şehirleri */
  activeDeliveryDestinationCityIds?: string[];
  /** Meşgul kamyonların bulunduğu şehirler */
  busyTruckOriginCityIds?: string[];
  /** Birleşik filo şehir bağlamı — verilirse diğer şehir listeleri yerine kullanılır */
  fleetCityContext?: PlayerFleetCityContext;
  /** Aktif piyasa olayları — sözleşme aday skoruna spawn ağırlığı uygular */
  activeWorldEvents?: WorldEvent[];
}

/** Dahili: aday sözleşme skoru — en kârlı rotalar önce seçilir */
interface ContractCandidate {
  score: number;
  contract: Contract;
}

// ---------------------------------------------------------------------------
// Temel yardımcılar
// ---------------------------------------------------------------------------

type PlayableContractGeneratorParams = import('./starterContracts').EnsureStarterContractsParams & {
  originCityId: string;
  truckCapacity: number;
  count: number;
};

/** starterContracts ↔ contracts döngüsünü kırar */
function generatePlayableContractsForOriginCityLazy(
  params: PlayableContractGeneratorParams,
): Contract[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { generatePlayableContractsForOriginCity } =
    require('./starterContracts') as typeof import('./starterContracts');
  return generatePlayableContractsForOriginCity(params);
}

/** Benzersiz sözleşme kimliği üretir */
export function createContractId(
  originCityId: string,
  destinationCityId: string,
  productId: ProductId,
  createdAt: number,
  sequence: number,
): string {
  return `contract_${originCityId}_${destinationCityId}_${productId}_${Math.floor(createdAt)}_${sequence}`;
}

/** Rota listesinden iki şehir arası hattı bulur */
export function getRouteBetweenCities(
  routes: Route[],
  originCityId: string,
  destinationCityId: string,
): Route | undefined {
  return routes.find(
    (route) => route.fromCityId === originCityId && route.toCityId === destinationCityId,
  );
}

// ---------------------------------------------------------------------------
// Stok analizi
// ---------------------------------------------------------------------------

/**
 * Kaynak şehirdeki taşınabilir ürün fazlasını hesaplar (ton).
 * stock > targetStock olduğunda pozitif değer döner.
 */
export function calculateSurplus(cityProductMarket: ProductMarket): number {
  return Math.max(0, cityProductMarket.stock - cityProductMarket.targetStock);
}

/**
 * Hedef şehirdeki ürün açığını hesaplar (ton).
 * targetStock > stock olduğunda pozitif değer döner.
 */
export function calculateShortage(cityProductMarket: ProductMarket): number {
  return Math.max(0, cityProductMarket.targetStock - cityProductMarket.stock);
}

/**
 * Taşınacak sözleşme miktarını belirler (ton).
 * Fazla ve açığın minimumu alınır; kamyon kapasitesi üst sınır olur.
 * Gerçekçi seviye için %70 oranında güvenlik payı bırakılır.
 */
export function calculateContractAmount(
  surplus: number,
  shortage: number,
  maxTruckCapacity: number = DEFAULT_MAX_TRUCK_CAPACITY,
): number {
  const transferable = Math.min(surplus, shortage) * 0.7;
  return clamp(transferable, 0, maxTruckCapacity);
}

/**
 * Seviye aralığına uygun sözleşme miktarı (ton).
 * Stok yeterliyse [minTonnage, maxTonnage] içinde rastgele hedefler.
 */
export function calculateContractAmountForRange(
  surplus: number,
  shortage: number,
  minTonnage: number,
  maxTonnage: number,
): number {
  const transferable = Math.min(surplus, shortage) * 0.7;
  if (transferable <= 0) {
    return 0;
  }

  const effectiveMax = Math.min(maxTonnage, transferable);
  if (effectiveMax < 5) {
    return 0;
  }

  const effectiveMin = Math.min(minTonnage, effectiveMax);
  if (effectiveMax <= effectiveMin) {
    return Math.round(effectiveMax * 10) / 10;
  }

  const amount = randomBetween(effectiveMin, effectiveMax);
  return Math.round(amount * 10) / 10;
}

// ---------------------------------------------------------------------------
// Aciliyet, ödeme ve deadline
// ---------------------------------------------------------------------------

/**
 * Hedef şehirdeki aciliyet skorunu hesaplar (0–1).
 * Stok açığı, tüketim hızı ve fiyat baskısı birleştirilir.
 */
export function calculateUrgency(destinationProductMarket: ProductMarket): number {
  const safeTarget = Math.max(destinationProductMarket.targetStock, 1);
  const shortageRatio = calculateShortage(destinationProductMarket) / safeTarget;
  const consumptionPressure = clamp(
    destinationProductMarket.consumptionPerDay / safeTarget,
    0,
    1,
  );
  const pricePressure = clamp(
    destinationProductMarket.currentPrice / destinationProductMarket.basePrice - 1,
    0,
    1,
  );

  const rawUrgency = shortageRatio * 0.5 + consumptionPressure * 0.25 + pricePressure * 0.25;
  return clamp(rawUrgency, 0, 1);
}

/**
 * Sözleşme tahmini işletme maliyeti ($) — ödeme hesabında kullanılır.
 */
export function estimateContractOperatingCosts(params: ContractPaymentParams): number {
  return estimateContractTripCostBreakdown(params).baseTripCost;
}

export function calculateContractPayment(params: ContractPaymentParams): number {
  return calculateContractEconomics({
    contract: {
      payment: 0,
      amount: params.amount,
      distanceKm: params.route.distanceKm,
      urgency: params.urgency,
    },
    route: params.route,
    globalEconomySnapshot: {
      fuelPricePerLiter: params.globalEconomy.fuelPrice,
    },
    pricingContext: {
      product: params.product,
      originMarket: params.originMarket,
      destinationMarket: params.destinationMarket,
      requiredLevel: params.requiredLevel,
      isMarketOpportunity: params.isMarketOpportunity,
    },
  }).revenue;
}

/**
 * Teslim süresi limitini hesaplar (saat).
 *
 * baseTravelHours = distanceKm / averageSpeed
 * Zor rota → deadline uzar; acil/bozulabilir ürün → deadline kısalır.
 */
export function calculateDeadlineHours(params: ContractDeadlineParams): number {
  const { route, product, urgency } = params;
  const duration = calculateContractDurationHours({
    distanceKm: route.distanceKm,
    cargoTons: params.amount ?? 0,
    routeDifficulty: route.difficulty,
  }).durationHours;
  const urgencyBuffer = clamp(1.55 - urgency * 0.35, 1.15, 1.55);
  const perishabilityBuffer = clamp(1.35 - product.perishability * 0.15, 1.15, 1.35);
  const rawDeadline = duration * Math.min(urgencyBuffer, perishabilityBuffer);

  return clamp(rawDeadline, contractBalance.minDeadlineHours, contractBalance.maxDeadlineHours);
}

/**
 * Teklifin piyasada kalma süresini hesaplar (oyun saati).
 * Acil işler daha kısa; uzun rotalar daha uzun süre listede kalır.
 */
export function calculateContractExpiresAt(
  currentTime: number,
  deadlineHours: number,
  urgency: number,
): number {
  const balance = contractExpiryBalance;
  let minHours: number;
  let maxHours: number;

  if (urgency >= 0.65) {
    minHours = balance.urgentMinHours;
    maxHours = balance.urgentMaxHours;
  } else if (deadlineHours >= 18) {
    minHours = balance.longMinHours;
    maxHours = balance.longMaxHours;
  } else {
    minHours = balance.normalMinHours;
    maxHours = balance.normalMaxHours;
  }

  const offerLifetimeHours = randomBetween(minHours, maxHours);
  return currentTime + offerLifetimeHours;
}

// ---------------------------------------------------------------------------
// Sözleşme üretim kararı
// ---------------------------------------------------------------------------

/** Birleşik stok ihtiyacı skoru — shouldGenerateContract içinde kullanılır */
export function calculateNeedScore(
  originMarket: ProductMarket,
  destinationMarket: ProductMarket,
  surplus: number,
  shortage: number,
): number {
  const originTarget = Math.max(originMarket.targetStock, 1);
  const destTarget = Math.max(destinationMarket.targetStock, 1);
  return surplus / originTarget + shortage / destTarget;
}

/** Fiyat farkı oranı — hedef şehir fiyatının kaynak şehre göre primi */
export function calculatePriceDiffRatio(
  originMarket: ProductMarket,
  destinationMarket: ProductMarket,
): number {
  const safeOriginPrice = Math.max(originMarket.currentPrice, 1);
  return (destinationMarket.currentPrice - safeOriginPrice) / safeOriginPrice;
}

/**
 * Bu rota/ürün kombinasyonu için sözleşme oluşturulmalı mı?
 * Tüm ön koşullar sağlanmazsa false döner.
 */
export function shouldGenerateContract(params: ShouldGenerateContractParams): boolean {
  const {
    originCityId,
    destinationCityId,
    originMarket,
    destinationMarket,
    surplus,
    shortage,
    existingAvailableCount,
  } = params;

  if (originCityId === destinationCityId) {
    return false;
  }

  if (surplus < MIN_SURPLUS_TONS || shortage < MIN_SHORTAGE_TONS) {
    return false;
  }

  if (calculatePriceDiffRatio(originMarket, destinationMarket) < MIN_PRICE_DIFF_RATIO) {
    return false;
  }

  const needScore = calculateNeedScore(originMarket, destinationMarket, surplus, shortage);
  if (needScore < MIN_NEED_SCORE) {
    return false;
  }

  if (existingAvailableCount >= contractBalance.maxDuplicateContractsPerRouteProduct) {
    return false;
  }

  return true;
}

/** UI ve üretim tarafında duplicate kontrolü için benzersiz anahtar */
export function getContractDedupeKey(
  contract: Pick<Contract, 'originCityId' | 'destinationCityId' | 'productId' | 'amount'>,
): string {
  return `${contract.originCityId}-${contract.destinationCityId}-${contract.productId}-${contract.amount.toFixed(1)}`;
}

/** Available listede aynı rota + ürün + miktar tekrarlarını temizler (yüksek ödemeli kalır) */
export function dedupeAvailableContracts(contracts: Contract[]): Contract[] {
  const bestByKey = new Map<string, Contract>();

  for (const contract of contracts) {
    if (contract.status !== 'available') continue;
    const key = getContractDedupeKey(contract);
    const existing = bestByKey.get(key);
    if (!existing || contract.payment > existing.payment) {
      bestByKey.set(key, contract);
    }
  }

  return Array.from(bestByKey.values());
}

export {
  countExactMarketContractMatches,
  countMarketContractMatches,
  countRelatedMarketContractMatches,
  getContractMarketSortScore,
  getMarketContractMatchScore,
  getMarketContractMatchTier,
  isExactMarketContractMatch,
  isRelatedMarketContractMatch,
  MARKET_MATCH_BADGE_LABEL,
  MARKET_MATCH_SCORE,
  type MarketContractMatchTier,
  type MarketMatchBadgeVariant,
} from '../utils/marketContractMatch';

/**
 * Harita önerisi filtresi için sıralama ağırlığı (düşük = daha iyi).
 * Piyasa fırsatı sıralaması ContractsScreen'de match score ile yapılır.
 */
export function getContractFilterSortTier(
  contract: Contract,
  filter: MarketContractFilter,
): number {
  if (filter.contractId && contract.id === filter.contractId) {
    return -1;
  }
  const score = getMarketContractMatchScore(contract, filter);
  return 100 - score;
}

export function findFirstExactMarketContractMatch(
  contracts: Contract[] | undefined,
  filter: Pick<MarketContractFilter, 'fromCityId' | 'toCityId' | 'productId'>,
): Contract | undefined {
  return (contracts ?? []).find(
    (contract) =>
      contract.status === 'available' &&
      contract.originCityId === filter.fromCityId &&
      contract.destinationCityId === filter.toCityId &&
      contract.productId === filter.productId,
  );
}

function getOpportunityDemandLevel(score: number): MarketOpportunity['demandLevel'] {
  if (score > 1200) return 'high';
  if (score >= 700) return 'medium';
  return 'low';
}

function isContractCityPairEligible(
  originCityId: string,
  destinationCityId: string,
  playerLevel: number,
): boolean {
  if (originCityId === destinationCityId) {
    return false;
  }
  if (!isWarehouseCityUnlocked(originCityId, playerLevel)) {
    return false;
  }
  if (!isWarehouseCityUnlocked(destinationCityId, playerLevel)) {
    return false;
  }
  return isRoadGraphPairConnected(originCityId, destinationCityId);
}

/** Sözleşme üretimi ile aynı stok/fiyat mantığına dayalı piyasa fırsatları */
export function findMarketOpportunities(
  cities: City[],
  routes: Route[],
  products: Product[],
  maxResults = 3,
  playerLevel = 99,
): MarketOpportunity[] {
  const opportunities: MarketOpportunity[] = [];

  for (const product of products) {
    for (const originCity of cities) {
      const originMarket = toProductMarket(originCity.products[product.id]);
      const surplus = calculateSurplus(originMarket);

      for (const destinationCity of cities) {
        if (destinationCity.id === originCity.id) {
          continue;
        }

        if (!isContractCityPairEligible(originCity.id, destinationCity.id, playerLevel)) {
          continue;
        }

        const destinationMarket = toProductMarket(destinationCity.products[product.id]);
        const shortage = calculateShortage(destinationMarket);
        const route = getRouteBetweenCities(routes, originCity.id, destinationCity.id);

        if (
          !route ||
          !shouldGenerateContract({
            originCityId: originCity.id,
            destinationCityId: destinationCity.id,
            originMarket,
            destinationMarket,
            surplus,
            shortage,
            existingAvailableCount: 0,
          })
        ) {
          continue;
        }

        const priceGap = destinationMarket.currentPrice - originMarket.currentPrice;
        const originTarget = Math.max(originMarket.targetStock, 1);
        const destTarget = Math.max(destinationMarket.targetStock, 1);
        const stockPressure = surplus / originTarget + shortage / destTarget;
        const distancePenalty = route.distanceKm / 1000;
        const score = priceGap * stockPressure - distancePenalty;

        opportunities.push({
          id: `${originCity.id}-${destinationCity.id}-${product.id}`,
          fromCityId: originCity.id,
          toCityId: destinationCity.id,
          productId: product.id,
          fromCityName: originCity.name,
          toCityName: destinationCity.name,
          productName: product.name,
          priceGap,
          distanceKm: route.distanceKm,
          score,
          demandLevel: getOpportunityDemandLevel(score),
        });
      }
    }
  }

  return opportunities.sort((a, b) => b.score - a.score).slice(0, maxResults);
}

/** Mevcut available sözleşmelerde aynı rota+ürün sayısını döndürür */
export function countAvailableDuplicates(
  existingContracts: Contract[],
  originCityId: string,
  destinationCityId: string,
  productId: ProductId,
): number {
  return existingContracts.filter(
    (contract) =>
      contract.status === 'available' &&
      contract.originCityId === originCityId &&
      contract.destinationCityId === destinationCityId &&
      contract.productId === productId,
  ).length;
}

/** Aday sözleşmenin öncelik skoru — yüksek = daha kârlı / acil */
export function calculateContractScore(
  payment: number,
  urgency: number,
  amount: number,
  priceDiffRatio: number,
): number {
  return payment * 0.4 + urgency * 100 * 0.25 + amount * 0.15 + priceDiffRatio * 100 * 0.2;
}

export function buildPlayerFleetCityContext(params: {
  trucks?: Truck[];
  activeDeliveries?: Delivery[];
  marketOpportunityOriginCityIds?: string[];
  homeCityId?: string;
  idleTruckOriginCityIds?: string[];
}): PlayerFleetCityContext {
  return {
    idleTruckOriginCityIds:
      params.idleTruckOriginCityIds ??
      getIdleTruckOriginCityIds(params.trucks, params.homeCityId),
    activeDeliveryDestinationCityIds: getActiveDeliveryDestinationCityIds(params.activeDeliveries),
    busyTruckOriginCityIds: getBusyTruckOriginCityIds(params.trucks, params.homeCityId),
    marketOpportunityOriginCityIds: params.marketOpportunityOriginCityIds ?? [],
  };
}

function resolveFleetCityContext(
  options: GenerateContractsOptions,
  marketOpportunityOriginCityIds: string[],
): PlayerFleetCityContext {
  if (options.fleetCityContext) {
    return options.fleetCityContext;
  }

  return {
    idleTruckOriginCityIds: options.idleTruckOriginCityIds ?? [],
    activeDeliveryDestinationCityIds: options.activeDeliveryDestinationCityIds ?? [],
    busyTruckOriginCityIds: options.busyTruckOriginCityIds ?? [],
    marketOpportunityOriginCityIds: marketOpportunityOriginCityIds,
  };
}

function getOriginCityWeightBonus(
  originCityId: string,
  fleetContext: PlayerFleetCityContext,
): number {
  const weights = contractGenerationBalance.originCityWeights;
  let bonus = weights.otherCity as number;

  if (fleetContext.marketOpportunityOriginCityIds.includes(originCityId)) {
    bonus = Math.max(bonus, weights.marketOpportunityCity as number);
  }
  if (fleetContext.busyTruckOriginCityIds.includes(originCityId)) {
    bonus = Math.max(bonus, weights.busyTruckCity as number);
  }
  if (fleetContext.activeDeliveryDestinationCityIds.includes(originCityId)) {
    bonus = Math.max(bonus, weights.activeDeliveryDestinationCity as number);
  }
  if (fleetContext.idleTruckOriginCityIds.includes(originCityId)) {
    bonus = Math.max(bonus, weights.idleTruckCity as number);
  }

  return bonus;
}

export interface PlayableContractContext {
  playerMoney?: number;
  globalEconomy?: GlobalEconomy;
  playerReputation?: number;
  homeCityId?: string;
  trailers?: Trailer[];
}

const MIN_TRUCK_CONDITION_FOR_PLAYABLE = 30;

function hasFuelReadyOrAffordableAssignment(
  contract: Contract,
  trucks: Truck[] | undefined,
  drivers: Driver[] | undefined,
  currentTime: number,
  context: PlayableContractContext,
): boolean {
  const product = getProductByIdSafe(contract.productId);
  const route = findRoute(contract.originCityId, contract.destinationCityId);
  if (!product || !route || context.playerMoney == null || context.globalEconomy == null) {
    return false;
  }

  const fuelPrice = Math.max(0, context.globalEconomy.fuelPrice ?? 0);
  const idleDrivers = getIdleDrivers(drivers);
  const requiredDriverLevel = contract.requiredDriverLevel ?? 1;
  const qualifiedDrivers =
    requiredDriverLevel > 1
      ? idleDrivers.filter((driver) => meetsDriverLevelRequirement(driver, requiredDriverLevel))
      : idleDrivers;

  if (qualifiedDrivers.length === 0) {
    return false;
  }

  const assignableTrucks = getIdleTrucksAtOrigin(
    trucks,
    contract.originCityId,
    context.homeCityId,
  ).filter(
    (truck) =>
      isTruckAvailableForAssignment(truck, currentTime) &&
      canTruckCarryContract(truck, contract, product, context.trailers) &&
      (truck.condition ?? 100) >= MIN_TRUCK_CONDITION_FOR_PLAYABLE,
  );

  for (const truck of assignableTrucks) {
    for (const driver of qualifiedDrivers) {
      const requiredFuelL = calculateDeliveryFuelLiters({
        contract,
        truck,
        driver,
        route,
        product,
      });
      const normalizedTruck = normalizeTruckFuel(truck);
      if (requiredFuelL > (normalizedTruck.fuelTankCapacityL ?? 0) + 1e-6) {
        continue;
      }
      const readiness = getTruckFuelReadiness(truck, requiredFuelL, fuelPrice);
      if (
        readiness.canCompleteWithoutRefuel ||
        (readiness.estimatedRefuelCost > 0 &&
          canAffordVoluntaryPurchase(
            context.playerMoney,
            readiness.estimatedRefuelCost,
          ))
      ) {
        return true;
      }
    }
  }

  return false;
}

export function isPlayableContract(
  contract: Contract,
  trucks: Truck[] | undefined,
  drivers: Driver[] | undefined,
  playerLevel: number,
  currentTime: number,
  context?: PlayableContractContext,
): boolean {
  if (contract.status !== 'available') {
    return false;
  }
  if (isContractOfferExpired(contract, currentTime)) {
    return false;
  }
  if (
    !getContractAvailability(
      contract,
      trucks,
      drivers,
      playerLevel,
      currentTime,
      context?.playerReputation ?? 0,
      context?.homeCityId,
      context?.trailers,
    ).canStart
  ) {
    return false;
  }

  if (context?.playerMoney == null || context?.globalEconomy == null) {
    return true;
  }

  return hasFuelReadyOrAffordableAssignment(
    contract,
    trucks,
    drivers,
    currentTime,
    context,
  );
}

export function countPlayableContracts(
  contracts: Contract[] | undefined,
  trucks: Truck[] | undefined,
  drivers: Driver[] | undefined,
  playerLevel: number,
  currentTime: number,
  context?: PlayableContractContext,
): number {
  return (contracts ?? []).filter((contract) =>
    isPlayableContract(contract, trucks, drivers, playerLevel, currentTime, context),
  ).length;
}

export function countPlayableContractsFromOrigin(
  contracts: Contract[] | undefined,
  originCityId: string,
  trucks: Truck[] | undefined,
  drivers: Driver[] | undefined,
  playerLevel: number,
  currentTime: number,
  context?: PlayableContractContext,
): number {
  return (contracts ?? []).filter(
    (contract) =>
      normalizeCityId(contract.originCityId) === normalizeCityId(originCityId) &&
      isPlayableContract(contract, trucks, drivers, playerLevel, currentTime, context),
  ).length;
}

export function countContractsByOriginCity(
  contracts: Contract[] | undefined,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const contract of contracts ?? []) {
    if (contract.status !== 'available') {
      continue;
    }
    const originId = contract.originCityId;
    if (!originId) {
      continue;
    }
    counts[originId] = (counts[originId] ?? 0) + 1;
  }
  return counts;
}

/**
 * Tek bir ürün için sözleşme nesnesi oluşturur.
 * Ön koşullar sağlanmazsa null döner.
 */
export function generateContractForProduct(
  params: GenerateContractForProductParams,
): Contract | null {
  const {
    originCity,
    destinationCity,
    productId,
    product,
    route,
    globalEconomy,
    currentTime,
    maxTruckCapacity = DEFAULT_MAX_TRUCK_CAPACITY,
    minTonnage,
    maxTonnage,
    sequence = randomIntBetween(1, 999_999),
    isMarketOpportunity = false,
  } = params;

  const originMarket = toProductMarket(originCity.products[productId]);
  const destinationMarket = toProductMarket(destinationCity.products[productId]);

  const surplus = calculateSurplus(originMarket);
  const shortage = calculateShortage(destinationMarket);
  const amount =
    minTonnage != null && maxTonnage != null
      ? calculateContractAmountForRange(surplus, shortage, minTonnage, maxTonnage)
      : calculateContractAmount(surplus, shortage, maxTruckCapacity);

  if (amount <= 0) {
    return null;
  }

  const urgency = calculateUrgency(destinationMarket);
  const requiredLevel = getRequiredLevelForTonnage(amount);
  const safeEconomy = {
    ...globalEconomy,
    fuelPrice: sanitizeFuelPricePerLiter(globalEconomy.fuelPrice),
  };

  const payment = calculateContractPayment({
    amount,
    product,
    originMarket,
    destinationMarket,
    route,
    urgency,
    globalEconomy: safeEconomy,
    requiredLevel,
    isMarketOpportunity,
  });

  const paymentInput = {
    amount,
    product,
    originMarket,
    destinationMarket,
    route,
    urgency,
    globalEconomy: safeEconomy,
    requiredLevel,
    isMarketOpportunity,
  };
  if (!isContractEconomicallyViable(paymentInput) && !isMarketOpportunity) {
    return null;
  }

  const deadlineHours = calculateDeadlineHours({ route, product, urgency, amount });

  const baseContract: Contract = {
    id: createContractId(originCity.id, destinationCity.id, productId, currentTime, sequence),
    originCityId: originCity.id,
    destinationCityId: destinationCity.id,
    productId,
    amount,
    cargoWeight: amount,
    payment,
    deadlineHours,
    distanceKm: route.distanceKm,
    urgency,
    status: 'available',
    createdAt: currentTime,
    expiresAt: calculateContractExpiresAt(currentTime, deadlineHours, urgency),
    requiredLevel,
    contractType: 'standard',
    riskLevel: 'low',
  };

  const typedContract = applyContractTypeToContract({
    contract: baseContract,
    product,
    playerLevel: params.playerLevel ?? 1,
    playerReputation: params.playerReputation ?? 0,
    sequence,
    maxCargoTons: maxTruckCapacity,
  });
  const preEventEconomics = calculateContractEconomics({
    contract: typedContract,
    route,
    globalEconomySnapshot: { fuelPricePerLiter: safeEconomy.fuelPrice },
    activeEvents: params.activeWorldEvents,
  });
  const eventAdjustment = applyWorldEventImpactToContract(
    typedContract,
    params.activeWorldEvents ?? [],
    typedContract.payment,
    preEventEconomics.estimatedDurationHours,
  );
  let finalTypedContract: Contract = {
    ...typedContract,
    payment: Math.min(
      contractPaymentBalance.absolutePaymentMax,
      Math.round(typedContract.payment * eventAdjustment.paymentMultiplier),
    ),
    deadlineHours: clamp(
      typedContract.deadlineHours * eventAdjustment.durationMultiplier,
      contractBalance.minDeadlineHours,
      contractBalance.maxDeadlineHours,
    ),
  };
  const eventAdjustedEconomics = calculateContractEconomics({
    contract: finalTypedContract,
    route,
    globalEconomySnapshot: { fuelPricePerLiter: safeEconomy.fuelPrice },
    activeEvents: params.activeWorldEvents,
  });
  const isControlledRiskOffer =
    finalTypedContract.riskLevel === 'high' && sequence % 7 === 0;
  if (isControlledRiskOffer) {
    finalTypedContract = {
      ...finalTypedContract,
      payment: Math.max(1, Math.round(eventAdjustedEconomics.totalCost * 0.98)),
      specialRules: [
        ...(finalTypedContract.specialRules ?? []),
        'Yüksek riskli düşük marj — beklenmeyen gider ihtimali açıkça yüksektir.',
      ],
    };
  }
  const viability = evaluateContractViability({
    contract: finalTypedContract,
    route,
    globalEconomySnapshot: {
      fuelPricePerLiter: safeEconomy.fuelPrice,
    },
    activeEvents: params.activeWorldEvents,
    maxFleetCapacityTons: maxTruckCapacity,
  });

  if (
    typeof __DEV__ !== 'undefined' &&
    __DEV__ &&
    debugConfig.contractGenerationAuditEnabled
  ) {
    console.log('[contract-generation-audit]', {
      contractId: finalTypedContract.id,
      origin: finalTypedContract.originCityId,
      destination: finalTypedContract.destinationCityId,
      distanceKm: route.distanceKm,
      cargoType: finalTypedContract.contractType ?? 'standard',
      cargoTons: finalTypedContract.amount,
      payment: finalTypedContract.payment,
      requiredTruckCapacity: finalTypedContract.cargoWeight,
      estimatedDurationHours: viability.economics.estimatedDurationHours,
      fuelRequiredL: viability.economics.fuelLiters,
      fuelCost: viability.economics.costs.fuel,
      allocatedDriverCost: viability.economics.costs.driver,
      maintenanceCost: viability.economics.costs.maintenance,
      tollCost: viability.economics.costs.toll,
      totalEstimatedCost: viability.economics.totalCost,
      estimatedProfit: viability.economics.estimatedProfit,
      marginPercent: viability.economics.profitMarginPercent,
      generationModifiers: {
        marketOpportunity: isMarketOpportunity,
        eventPaymentMultiplier: eventAdjustment.paymentMultiplier,
        eventDurationMultiplier: eventAdjustment.durationMultiplier,
        activeEventIds: (params.activeWorldEvents ?? [])
          .filter((event) => event.isActive)
          .map((event) => event.id),
      },
      acceptedByViabilityGuard: viability.accepted,
    });
  }

  return viability.accepted ? finalTypedContract : null;
}

// ---------------------------------------------------------------------------
// Toplu üretim ve süre dolumu
// ---------------------------------------------------------------------------

/**
 * Tüm şehir çiftleri ve ürünler için sözleşme adaylarını tarar,
 * en yüksek skorlu olanları seçerek yeni sözleşme listesi döndürür.
 *
 * Mevcut sözleşmeler mutate edilmez; yalnızca yeni üretilenler döner.
 */
export function generateContracts(
  cities: Record<string, City>,
  routes: Route[],
  products: Product[],
  globalEconomy: GlobalEconomy,
  existingContracts: Contract[],
  options: GenerateContractsOptions,
): Contract[] {
  return measureContractScheduleStage(
    'route-eligibility',
    () => generateContractsCore(cities, routes, products, globalEconomy, existingContracts, options),
    { maxNewContracts: options.maxNewContracts ?? contractBalance.maxContractsPerTick },
  );
}

function generateContractsCore(
  cities: Record<string, City>,
  routes: Route[],
  products: Product[],
  globalEconomy: GlobalEconomy,
  existingContracts: Contract[],
  options: GenerateContractsOptions,
): Contract[] {
  const maxNewContracts = options.maxNewContracts ?? contractBalance.maxContractsPerTick;
  const playerLevel = Math.max(1, options.playerLevel ?? 1);
  const playerReputation = Math.max(0, options.playerReputation ?? 0);
  const ownedMaxCapacity =
    options.ownedMaxTruckCapacity ??
    options.maxTruckCapacity ??
    getMaxContractTonnageForLevel(playerLevel);
  const idleMaxCapacity = options.idleMaxTruckCapacity ?? ownedMaxCapacity;
  const { currentTime } = options;

  const cityList = Object.values(cities);
  const marketOpportunities = findMarketOpportunities(cityList, routes, products, 12);
  const priorityOpportunityKeys = new Set(
    marketOpportunities.map(
      (opportunity) => `${opportunity.fromCityId}-${opportunity.toCityId}-${opportunity.productId}`,
    ),
  );
  const marketOpportunityOriginCityIds = [
    ...new Set(marketOpportunities.map((opportunity) => opportunity.fromCityId)),
  ];
  const fleetContext = resolveFleetCityContext(options, marketOpportunityOriginCityIds);
  const candidates: ContractCandidate[] = [];
  let sequenceCounter = existingContracts.length;
  const existingDedupeKeys = new Set(
    existingContracts
      .filter((contract) => contract.status === 'available')
      .map((contract) => getContractDedupeKey(contract)),
  );

  for (const originCity of cityList) {
    for (const destinationCity of cityList) {
      if (originCity.id === destinationCity.id) {
        continue;
      }

      if (!isContractCityPairEligible(originCity.id, destinationCity.id, playerLevel)) {
        continue;
      }

      const route = getRouteBetweenCities(routes, originCity.id, destinationCity.id);
      if (!route) {
        continue;
      }

      for (const product of products) {
        const originMarket = toProductMarket(originCity.products[product.id]);
        const destinationMarket = toProductMarket(destinationCity.products[product.id]);

        const surplus = calculateSurplus(originMarket);
        const shortage = calculateShortage(destinationMarket);

        const existingAvailableCount = countAvailableDuplicates(
          existingContracts,
          originCity.id,
          destinationCity.id,
          product.id,
        );

        const canGenerate = shouldGenerateContract({
          originCityId: originCity.id,
          destinationCityId: destinationCity.id,
          originMarket,
          destinationMarket,
          surplus,
          shortage,
          existingAvailableCount,
        });

        if (!canGenerate) {
          continue;
        }

        const levelTier = pickContractGenerationLevelTier(playerLevel);
        const generationRange = resolveContractGenerationRange(playerLevel, levelTier);
        const maxAllowedRequiredLevel = getMaxAllowedContractRequiredLevel(playerLevel);

        if (generationRange.requiredLevel > maxAllowedRequiredLevel) {
          continue;
        }
        const capacityProfile = pickContractCapacityProfile();
        const tonnageBounds = applyCapacityProfileToTonnageRange(
          generationRange.minTonnage,
          generationRange.maxTonnage,
          capacityProfile,
          ownedMaxCapacity,
          idleMaxCapacity,
        );

        if (!tonnageBounds) {
          continue;
        }

        sequenceCounter += 1;

        const routeKey = `${originCity.id}-${destinationCity.id}-${product.id}`;
        const isMarketOpportunity = priorityOpportunityKeys.has(routeKey);
        const fleetBoundMaxTonnage = Math.min(
          tonnageBounds.maxTonnage,
          ownedMaxCapacity,
        );
        const contract = generateContractForProduct({
          originCity,
          destinationCity,
          productId: product.id,
          product,
          route,
          globalEconomy,
          currentTime,
          maxTruckCapacity: fleetBoundMaxTonnage,
          minTonnage: Math.min(
            tonnageBounds.minTonnage,
            fleetBoundMaxTonnage,
          ),
          maxTonnage: fleetBoundMaxTonnage,
          sequence: sequenceCounter,
          isMarketOpportunity,
          playerLevel,
          playerReputation,
          activeWorldEvents: options.activeWorldEvents,
        });

        if (!contract) {
          continue;
        }

        const finalContract: Contract = {
          ...contract,
          requiredLevel:
            levelTier === 'current'
              ? Math.min(
                  getRequiredLevelForTonnage(contract.amount ?? 0),
                  playerLevel,
                )
              : Math.max(
                  getRequiredLevelForTonnage(contract.amount ?? 0),
                  generationRange.requiredLevel,
                ),
        };

        if ((finalContract.requiredLevel ?? 1) > maxAllowedRequiredLevel) {
          continue;
        }

        const contractCargoWeight =
          finalContract.cargoWeight ?? finalContract.amount ?? 0;
        const pendingContracts = [
          ...existingContracts.filter((contract) => contract.status === 'available'),
          ...candidates.map((candidate) => candidate.contract),
        ];
        const pendingTotal = pendingContracts.length;
        const pendingUnreachable = pendingContracts.filter((contract) => {
          const weight = contract.cargoWeight ?? contract.amount ?? 0;
          return isContractUnreachableByFleet(weight, ownedMaxCapacity);
        }).length;
        const pendingUnreachableRatio =
          pendingTotal > 0 ? pendingUnreachable / pendingTotal : 0;

        if (
          !shouldSpawnBeyondFleetContract(
            contractCargoWeight,
            ownedMaxCapacity,
            pendingUnreachableRatio,
            playerLevel,
          )
        ) {
          continue;
        }

        const dedupeKey = getContractDedupeKey(finalContract);
        if (existingDedupeKeys.has(dedupeKey)) {
          continue;
        }

        const priceDiffRatio = calculatePriceDiffRatio(originMarket, destinationMarket);
        const routeMarketBonus = isMarketOpportunity
          ? contractGenerationBalance.originCityWeights.marketOpportunityCity
          : 0;
        const originWeightBonus = getOriginCityWeightBonus(originCity.id, fleetContext);
        const scoreInputs = getContractSelectionScoreInputs(finalContract);
        const baseScore =
          calculateContractScore(
            scoreInputs.payment,
            scoreInputs.urgency,
            scoreInputs.amount,
            priceDiffRatio,
          ) +
          originWeightBonus +
          routeMarketBonus;
        const spawnWeight = getContractSpawnWeightMultiplier(
          originCity.id,
          destinationCity.id,
          product.id,
          options.activeWorldEvents ?? [],
        );
        const score = baseScore * spawnWeight;

        candidates.push({ score, contract: finalContract });
      }
    }
  }

  // En yüksek skorlu adaylar önce; tick başına üst sınır uygulanır
  candidates.sort((a, b) => b.score - a.score);

  const selected: Contract[] = [];
  const batchDedupeKeys = new Set(existingDedupeKeys);
  const selectedRouteKeys = new Set<string>();
  const selectedProductIds = new Set<string>();
  const maxRiskyNegativeContracts = Math.floor(
    maxNewContracts * contractGenerationBalance.maxRiskyNegativeShare,
  );
  let selectedRiskyNegativeContracts = 0;

  const trySelectCandidate = (candidate: ContractCandidate): boolean => {
    if (selected.length >= maxNewContracts) return false;
    const key = getContractDedupeKey(candidate.contract);
    if (batchDedupeKeys.has(key)) return false;
    const candidateRoute = getRouteBetweenCities(
      routes,
      candidate.contract.originCityId,
      candidate.contract.destinationCityId,
    );
    if (!candidateRoute) return false;
    const candidateViability = evaluateContractViability({
      contract: candidate.contract,
      route: candidateRoute,
      globalEconomySnapshot: {
        fuelPricePerLiter: sanitizeFuelPricePerLiter(globalEconomy.fuelPrice),
      },
      activeEvents: options.activeWorldEvents,
      maxFleetCapacityTons: ownedMaxCapacity,
    });
    const isRiskyNegative =
      candidate.contract.riskLevel === 'high' &&
      candidateViability.economics.estimatedProfit < 0;
    if (
      isRiskyNegative &&
      selectedRiskyNegativeContracts >= maxRiskyNegativeContracts
    ) {
      return false;
    }
    batchDedupeKeys.add(key);
    selected.push(candidate.contract);
    selectedRouteKeys.add(`${candidate.contract.originCityId}-${candidate.contract.destinationCityId}`);
    selectedProductIds.add(candidate.contract.productId);
    if (isRiskyNegative) selectedRiskyNegativeContracts += 1;
    return true;
  };

  // En yüksek skorlu adaylar korunur; ilk turda aynı rotanın veya ürünün tüm
  // havuzu kaplamasına izin vermeyerek kartlarda gerçek pazar çeşitliliği sağlanır.
  for (const candidate of candidates) {
    if (selected.length >= maxNewContracts) break;
    const routeKey = `${candidate.contract.originCityId}-${candidate.contract.destinationCityId}`;
    if (selectedRouteKeys.has(routeKey) || selectedProductIds.has(candidate.contract.productId)) {
      continue;
    }
    trySelectCandidate(candidate);
  }

  for (const candidate of candidates) {
    if (selected.length >= maxNewContracts) break;
    const routeKey = `${candidate.contract.originCityId}-${candidate.contract.destinationCityId}`;
    if (selectedRouteKeys.has(routeKey)) continue;
    trySelectCandidate(candidate);
  }

  for (const candidate of candidates) {
    if (selected.length >= maxNewContracts) break;
    trySelectCandidate(candidate);
  }

  return selected;
}

export interface ContractLevelMixStats {
  playerLevel: number;
  totalAvailable: number;
  availableAtCurrentLevel: number;
  oneLevelAboveContracts: number;
  lockedContracts: number;
  lockedRatio: number;
}

/** Debug / denge kontrolü için müsait sözleşme seviye dağılımı */
export function getContractLevelMixStats(
  contracts: Contract[] | undefined,
  playerLevel: number,
): ContractLevelMixStats {
  const safeLevel = Math.max(1, playerLevel ?? 1);
  const available = (contracts ?? []).filter((contract) => contract.status === 'available');
  const totalAvailable = available.length;
  let availableAtCurrentLevel = 0;
  let oneLevelAboveContracts = 0;
  let lockedContracts = 0;

  for (const contract of available) {
    const requiredLevel = contract.requiredLevel ?? 1;
    if (requiredLevel <= safeLevel) {
      availableAtCurrentLevel += 1;
    } else if (requiredLevel === safeLevel + 1) {
      oneLevelAboveContracts += 1;
      lockedContracts += 1;
    } else if (requiredLevel > safeLevel) {
      lockedContracts += 1;
    }
  }

  return {
    playerLevel: safeLevel,
    totalAvailable,
    availableAtCurrentLevel,
    oneLevelAboveContracts,
    lockedContracts,
    lockedRatio: totalAvailable > 0 ? lockedContracts / totalAvailable : 0,
  };
}

/**
 * Müsait listede kilitli sözleşme oranını sınırlar.
 * Fazla yüksek seviye işler expired yapılır (en yüksek requiredLevel önce).
 */
export function balanceAvailableContractLevelMix(
  contracts: Contract[],
  playerLevel: number,
): Contract[] {
  const safeLevel = Math.max(1, playerLevel ?? 1);
  const maxLockedRatio = contractLevelBalance.maxLockedContractRatio;
  const available = contracts.filter((contract) => contract.status === 'available');

  if (available.length === 0) {
    return contracts;
  }

  const locked = available.filter((contract) => (contract.requiredLevel ?? 1) > safeLevel);
  const maxLocked = Math.max(0, Math.floor(available.length * maxLockedRatio));

  if (locked.length <= maxLocked) {
    return contracts;
  }

  const excessCount = locked.length - maxLocked;
  const toExpire = [...locked]
    .sort((a, b) => (b.requiredLevel ?? 1) - (a.requiredLevel ?? 1))
    .slice(0, excessCount);
  const expireIds = new Set(toExpire.map((contract) => contract.id));

  return contracts.map((contract) =>
    expireIds.has(contract.id) ? { ...contract, status: 'expired' as const } : contract,
  );
}

/** Müsait sözleşme sayısını döndürür */
export function countAvailableContracts(contracts: Contract[] | undefined): number {
  return (contracts ?? []).filter((contract) => contract.status === 'available').length;
}

/** Available sözleşmeleri birleştirirken duplicate rota+ürün+miktar tekrarlarını temizler */
export function mergeContractLists(existing: Contract[], incoming: Contract[]): Contract[] {
  const nonAvailable = existing.filter((contract) => contract.status !== 'available');
  const dedupedAvailable = dedupeAvailableContracts([
    ...existing.filter((contract) => contract.status === 'available'),
    ...incoming.filter((contract) => contract.status === 'available'),
  ]);
  return [...nonAvailable, ...dedupedAvailable];
}

function buildPlayableGenerationBaseParams(
  params: EnsurePlayableContractsParams,
  contracts: Contract[],
): {
  contracts: Contract[];
  cities: Record<string, City>;
  routes: Route[];
  products: Product[];
  globalEconomy: GlobalEconomy;
  currentTime: number;
  player: Pick<Player, 'level' | 'companyLevel' | 'trucks' | 'drivers' | 'homeCityId'>;
} {
  const playerLevel = Math.max(1, params.playerLevel ?? 1);
  return {
    contracts,
    cities: params.cities,
    routes: params.routes,
    products: params.products,
    globalEconomy: params.globalEconomy,
    currentTime: params.currentTime,
    player: {
      level: playerLevel,
      companyLevel: playerLevel,
      trucks: params.trucks ?? [],
      drivers: params.drivers ?? [],
      homeCityId: params.homeCityId ?? 'izmir',
    },
  };
}

/**
 * Kamyon şehirleri için havuzda yer açar — dolu listede playable üretimini engellemez.
 */
function freeContractPoolSlots(
  contracts: Contract[],
  protectedOriginCityIds: string[],
  slotsNeeded: number,
): Contract[] {
  if (slotsNeeded <= 0) {
    return contracts;
  }

  const protectedSet = new Set(protectedOriginCityIds.map((cityId) => normalizeCityId(cityId)));
  const removable = contracts
    .filter(
      (contract) =>
        contract.status === 'available' &&
        !protectedSet.has(normalizeCityId(contract.originCityId)),
    )
    .sort((left, right) => (left.payment ?? 0) - (right.payment ?? 0));

  const removeIds = new Set(removable.slice(0, slotsNeeded).map((contract) => contract.id));
  if (removeIds.size === 0) {
    return contracts;
  }

  return contracts.map((contract) =>
    removeIds.has(contract.id) ? { ...contract, status: 'expired' as const } : contract,
  );
}

export interface ShouldRefreshContractsParams {
  currentTime: number;
  lastContractGenerationTime?: number;
  lastMarketRefreshTime?: number;
  availableCount: number;
  eligibleCount: number;
  idleTruckCityCount: number;
}

/** Save hydrate / ekran açılışı / scheduler için yenileme gereksinimi. */
export function shouldRefreshContracts(params: ShouldRefreshContractsParams): boolean {
  const gen = contractGenerationBalance;
  const lastGen = params.lastContractGenerationTime ?? 0;
  const lastMarket = params.lastMarketRefreshTime ?? 0;

  if (params.availableCount === 0) {
    return true;
  }
  if (params.idleTruckCityCount > 0 && params.eligibleCount === 0) {
    return true;
  }
  if (params.availableCount < gen.minGlobalEligibleContracts) {
    return true;
  }
  if (!Number.isFinite(lastGen) || lastGen < 0) {
    return true;
  }
  if (!Number.isFinite(lastMarket) || lastMarket < 0) {
    return true;
  }
  if (params.currentTime - lastGen >= gen.smallGenerationIntervalHours) {
    return true;
  }
  if (params.currentTime - lastMarket >= gen.mediumGenerationIntervalHours) {
    return true;
  }
  return false;
}

export interface EnsureMinimumEligibleContractsResult extends EnsurePlayableContractsResult {
  refreshedFromMarket: boolean;
  bootstrapped: boolean;
}

/**
 * Kamyon bulunan şehirlerde minimum uygun iş + global minimum ilan garantisi.
 */
export function ensureMinimumEligibleContracts(
  params: EnsurePlayableContractsParams,
): EnsureMinimumEligibleContractsResult {
  const gen = contractGenerationBalance;
  const playerLevel = Math.max(1, params.playerLevel ?? 1);
  const trucks = params.trucks ?? [];
  const drivers = params.drivers ?? [];
  const currentTime = params.currentTime ?? 0;
  const idleCities = [...new Set((params.idleTruckOriginCityIds ?? []).map((cityId) => normalizeCityId(cityId)))];

  let contracts = expireOldContracts(params.contracts ?? [], currentTime);
  const countEligible = () =>
    countPlayableContracts(contracts, trucks, drivers, playerLevel, currentTime);

  const perCityGap = idleCities.reduce((gap, cityId) => {
    const have = countPlayableContractsFromOrigin(
      contracts,
      cityId,
      trucks,
      drivers,
      playerLevel,
      currentTime,
    );
    return gap + Math.max(0, gen.minAvailableContractsPerIdleTruckCity - have);
  }, 0);

  const needsSupply =
    countAvailableContracts(contracts) === 0 ||
    (idleCities.length > 0 && countEligible() === 0) ||
    perCityGap > 0 ||
    countAvailableContracts(contracts) < gen.minGlobalEligibleContracts ||
    countContractsAtOrBelowLevel(contracts, playerLevel) < gen.minPlayerLevelEligibleContracts;

  if (!needsSupply) {
    return {
      contracts,
      newContracts: [],
      playableContractsCount: countEligible(),
      generatedPlayableCount: 0,
      refreshedFromMarket: false,
      bootstrapped: false,
    };
  }

  if (perCityGap > 0) {
    contracts = freeContractPoolSlots(
      contracts,
      idleCities,
      Math.min(perCityGap, gen.bootstrapMaxContractsPerPass),
    );
  }

  const allNew: Contract[] = [];
  const playableResult = ensurePlayableContractSupply({
    ...params,
    contracts,
    idleTruckOriginCityIds: idleCities,
    forceFallback: true,
    maxNewContracts: params.maxNewContracts ?? gen.bootstrapMaxContractsPerPass,
  });
  contracts = playableResult.contracts;
  allNew.push(...playableResult.newContracts);

  let refreshedFromMarket = false;
  if (countAvailableContracts(contracts) < gen.minGlobalEligibleContracts) {
    const marketRefresh = refreshContractsFromMarket({
      ...params,
      contracts,
      maxContractsPerRefresh: gen.bootstrapMaxContractsPerPass,
    });
    contracts = marketRefresh.contracts;
    if (marketRefresh.newContracts.length > 0) {
      allNew.push(...marketRefresh.newContracts);
      refreshedFromMarket = true;
    }
  }

  const stillPerCityGap = idleCities.some(
    (cityId) =>
      countPlayableContractsFromOrigin(
        contracts,
        cityId,
        trucks,
        drivers,
        playerLevel,
        currentTime,
      ) < gen.minAvailableContractsPerIdleTruckCity,
  );
  if (stillPerCityGap) {
    contracts = freeContractPoolSlots(
      contracts,
      idleCities,
      Math.min(gen.minAvailableContractsPerIdleTruckCity, gen.bootstrapMaxContractsPerPass),
    );
    const secondPass = ensurePlayableContractSupply({
      ...params,
      contracts,
      idleTruckOriginCityIds: idleCities,
      forceFallback: true,
      maxNewContracts: params.maxNewContracts ?? gen.bootstrapMaxContractsPerPass,
    });
    contracts = secondPass.contracts;
    allNew.push(...secondPass.newContracts);
  }

  contracts = balanceAvailableContractLevelMix(contracts, playerLevel);

  return {
    contracts,
    newContracts: allNew,
    playableContractsCount: countPlayableContracts(
      contracts,
      trucks,
      drivers,
      playerLevel,
      currentTime,
    ),
    generatedPlayableCount: allNew.length,
    updatedLastPlayableContractGeneratedTime:
      playableResult.updatedLastPlayableContractGeneratedTime ??
      params.lastPlayableContractGeneratedTime,
    refreshedFromMarket,
    bootstrapped: true,
  };
}

/**
 * Boşta kamyon şehirlerinden alınabilir sözleşme sayısını garanti eder.
 */
export function ensurePlayableContractSupply(
  params: EnsurePlayableContractsParams,
): EnsurePlayableContractsResult {
  const gen = contractGenerationBalance;
  const playerLevel = Math.max(1, params.playerLevel ?? 1);
  const trucks = params.trucks ?? [];
  const drivers = params.drivers ?? [];
  const idleOriginCityIds = [...new Set((params.idleTruckOriginCityIds ?? []).map((cityId) => normalizeCityId(cityId)))];
  const currentTime = params.currentTime ?? 0;

  let contracts = expireOldContracts(params.contracts ?? [], currentTime);
  let availableCount = countAvailableContracts(contracts);
  let headroom = Math.max(0, gen.maxAvailableContracts - availableCount);

  const countCityPlayable = (originCityId: string) =>
    countPlayableContractsFromOrigin(
      contracts,
      originCityId,
      trucks,
      drivers,
      playerLevel,
      currentTime,
    );

  const needsPerCityEarly = idleOriginCityIds.some(
    (originCityId) => countCityPlayable(originCityId) < gen.minAvailableContractsPerIdleTruckCity,
  );

  if (headroom <= 0 && needsPerCityEarly && idleOriginCityIds.length > 0) {
    const slotsNeeded = idleOriginCityIds.reduce(
      (sum, originCityId) =>
        sum + Math.max(0, gen.minAvailableContractsPerIdleTruckCity - countCityPlayable(originCityId)),
      0,
    );
    contracts = freeContractPoolSlots(
      contracts,
      idleOriginCityIds,
      Math.min(slotsNeeded, gen.bootstrapMaxContractsPerPass),
    );
    availableCount = countAvailableContracts(contracts);
    headroom = Math.max(0, gen.maxAvailableContracts - availableCount);
  }

  if (idleOriginCityIds.length === 0) {
    return {
      contracts,
      newContracts: [],
      playableContractsCount: countPlayableContracts(contracts, trucks, drivers, playerLevel, currentTime),
      generatedPlayableCount: 0,
    };
  }

  if (headroom <= 0 && !needsPerCityEarly && !params.forceFallback) {
    return {
      contracts,
      newContracts: [],
      playableContractsCount: countPlayableContracts(contracts, trucks, drivers, playerLevel, currentTime),
      generatedPlayableCount: 0,
    };
  }

  let playableCount = countPlayableContracts(contracts, trucks, drivers, playerLevel, currentTime);
  const lastGeneratedAt = params.lastPlayableContractGeneratedTime ?? 0;
  const hoursSinceLastPlayable = Math.max(0, currentTime - lastGeneratedAt);
  const needsPerCity = idleOriginCityIds.some(
    (originCityId) => countCityPlayable(originCityId) < gen.minAvailableContractsPerIdleTruckCity,
  );
  const belowTotalMinimum = playableCount < gen.minTotalPlayableContracts;
  const longWaitFallback =
    params.forceFallback ||
    (playableCount === 0 &&
      hoursSinceLastPlayable >= gen.playableContractFallbackHours);

  if (!needsPerCity && !belowTotalMinimum && !longWaitFallback) {
    return {
      contracts,
      newContracts: [],
      playableContractsCount: playableCount,
      generatedPlayableCount: 0,
    };
  }

  const maxGenerate = Math.min(
    params.maxNewContracts ??
      (params.forceFallback
        ? gen.bootstrapMaxContractsPerPass
        : gen.maxPlayableContractsGeneratedAtOnce),
    headroom > 0
      ? headroom
      : params.forceFallback
        ? gen.bootstrapMaxContractsPerPass
        : 0,
    gen.bootstrapMaxContractsPerPass,
  );

  const generated: Contract[] = [];
  const batchBase = buildPlayableGenerationBaseParams(params, contracts);

  for (const originCityId of idleOriginCityIds) {
    if (generated.length >= maxGenerate) {
      break;
    }

    const cityCapacity = getMaxIdleTruckCapacityAtOrigin(
      trucks,
      originCityId,
      params.homeCityId,
      params.trailers,
    );
    if (cityCapacity <= 0) {
      continue;
    }

    const cityPlayable = countPlayableContractsFromOrigin(
      contracts,
      originCityId,
      trucks,
      drivers,
      playerLevel,
      currentTime,
    );
    const cityNeeded = Math.max(0, gen.minAvailableContractsPerIdleTruckCity - cityPlayable);
    if (cityNeeded <= 0) {
      continue;
    }

    const toCreate = Math.min(cityNeeded, maxGenerate - generated.length);
    const created = generatePlayableContractsForOriginCityLazy({
      ...batchBase,
      originCityId,
      truckCapacity: cityCapacity,
      count: toCreate,
    });

    for (const contract of created) {
      const key = getContractDedupeKey(contract);
      const alreadyExists = [...contracts, ...generated].some(
        (item) => item.status === 'available' && getContractDedupeKey(item) === key,
      );
      if (!alreadyExists) {
        generated.push(contract);
      }
    }
  }

  let merged = mergeContractLists(contracts, generated);
  playableCount = countPlayableContracts(merged, trucks, drivers, playerLevel, currentTime);

  let originIndex = 0;
  while (
    playableCount < gen.minTotalPlayableContracts &&
    generated.length < maxGenerate &&
    idleOriginCityIds.length > 0
  ) {
    const originCityId = idleOriginCityIds[originIndex % idleOriginCityIds.length];
    originIndex += 1;
    const cityCapacity = getMaxIdleTruckCapacityAtOrigin(
      trucks,
      originCityId,
      params.homeCityId,
      params.trailers,
    );
    if (cityCapacity <= 0) {
      if (originIndex > idleOriginCityIds.length * 2) {
        break;
      }
      continue;
    }

    const loopBase = buildPlayableGenerationBaseParams(params, merged);
    const created = generatePlayableContractsForOriginCityLazy({
      ...loopBase,
      originCityId,
      truckCapacity: cityCapacity,
      count: 1,
    });

    let added = false;
    for (const contract of created) {
      if (generated.length >= maxGenerate) {
        break;
      }
      const key = getContractDedupeKey(contract);
      const alreadyExists = merged.some(
        (item) => item.status === 'available' && getContractDedupeKey(item) === key,
      );
      if (!alreadyExists) {
        generated.push(contract);
        merged = mergeContractLists(merged, [contract]);
        added = true;
      }
    }

    playableCount = countPlayableContracts(merged, trucks, drivers, playerLevel, currentTime);
    if (!added && originIndex > idleOriginCityIds.length * 3) {
      break;
    }
  }

  const balanced = balanceAvailableContractLevelMix(merged, playerLevel);
  const finalPlayable = countPlayableContracts(balanced, trucks, drivers, playerLevel, currentTime);

  return {
    contracts: balanced,
    newContracts: generated,
    playableContractsCount: finalPlayable,
    generatedPlayableCount: generated.length,
    updatedLastPlayableContractGeneratedTime:
      generated.length > 0 ? currentTime : params.lastPlayableContractGeneratedTime,
  };
}

export interface EnsurePlayableContractsAfterDeliveryParams extends EnsurePlayableContractsParams {
  destinationCityId: string;
  completedContracts: number;
}

/**
 * Teslimat sonrası kamyonun vardığı şehirden oynanabilir iş garantisi.
 * İlk 3 teslimatta hedef şehirde en az 2 playable; sonrasında config eşiği.
 */
export function ensurePlayableContractsAfterDelivery(
  params: EnsurePlayableContractsAfterDeliveryParams,
): EnsurePlayableContractsResult {
  const gen = contractGenerationBalance;
  const playerLevel = Math.max(1, params.playerLevel ?? 1);
  const trucks = params.trucks ?? [];
  const drivers = params.drivers ?? [];
  const currentTime = params.currentTime ?? 0;
  const destinationCityId = params.destinationCityId;

  const contracts = expireOldContracts(params.contracts ?? [], currentTime);
  const earlyPhase = params.completedContracts <= 3;
  const minAtDestination = earlyPhase ? 2 : gen.minAvailableContractsPerIdleTruckCity;

  const playableAtDestination = countPlayableContractsFromOrigin(
    contracts,
    destinationCityId,
    trucks,
    drivers,
    playerLevel,
    currentTime,
  );

  if (playableAtDestination >= minAtDestination) {
    return {
      contracts,
      newContracts: [],
      playableContractsCount: countPlayableContracts(
        contracts,
        trucks,
        drivers,
        playerLevel,
        currentTime,
      ),
      generatedPlayableCount: 0,
    };
  }

  const needed = minAtDestination - playableAtDestination;

  return ensurePlayableContractSupply({
    ...params,
    contracts,
    idleTruckOriginCityIds: [destinationCityId],
    forceFallback: true,
    maxNewContracts: Math.min(
      needed,
      earlyPhase ? 2 : gen.maxPlayableContractsGeneratedAtOnce,
      params.maxNewContracts ?? gen.maxPlayableContractsGeneratedAtOnce,
    ),
  });
}

export interface ReplenishContractsParams {
  cities: Record<string, City>;
  routes: Route[];
  products: Product[];
  globalEconomy: GlobalEconomy;
  contracts: Contract[];
  currentTime: number;
  maxTruckCapacity?: number;
  ownedMaxTruckCapacity?: number;
  idleMaxTruckCapacity?: number;
  playerLevel?: number;
  playerReputation?: number;
  idleTruckOriginCityIds?: string[];
  activeDeliveryDestinationCityIds?: string[];
  busyTruckOriginCityIds?: string[];
  fleetCityContext?: PlayerFleetCityContext;
  trucks?: Truck[];
  trailers?: Trailer[];
  drivers?: Driver[];
  homeCityId?: string;
  activeWorldEvents?: WorldEvent[];
}

export interface EnsurePlayableContractsParams extends ReplenishContractsParams {
  maxNewContracts?: number;
  forceFallback?: boolean;
  lastPlayableContractGeneratedTime?: number;
}

export interface EnsurePlayableContractsResult extends ReplenishContractsResult {
  playableContractsCount: number;
  generatedPlayableCount: number;
  updatedLastPlayableContractGeneratedTime?: number;
}

export interface ReplenishContractsResult {
  contracts: Contract[];
  newContracts: Contract[];
}

export type ContractGenerationTickKind = 'small' | 'medium' | 'cleanup_boost';

export interface ContractGenerationDebugSnapshot {
  currentTime: number;
  availableContracts: number;
  playableContractsCount: number;
  idleTruckOriginCities: string[];
  activeDeliveryDestinationCities: string[];
  lastPlayableContractGeneratedTime: number;
  lastContractGenerationTime: number;
  lastMarketRefreshTime: number;
  lastDailyCleanupTime: number;
  hoursSinceLastGeneration: number;
  hoursSinceLastMarketRefresh: number;
  lastGeneratedContractsCount: number;
  expiredContractsRemoved: number;
  nextSmallGenerationInHours: number;
  nextMediumGenerationInHours: number;
  nextDailyCleanupInHours: number;
  elapsedSmallTicks: number;
  processedSmallTicks: number;
  elapsedMediumTicks: number;
  processedMediumTicks: number;
  elapsedDailyTicks: number;
  generatedContractsCount: number;
  offlineCatchup: boolean;
}

export interface ProcessContractGenerationScheduleParams extends ReplenishContractsParams {
  previousTime: number;
  newTime: number;
  lastContractGenerationTime: number;
  lastMarketRefreshTime: number;
  lastDailyCleanupTime: number;
  lastPlayableContractGeneratedTime?: number;
}

export interface ProcessContractGenerationScheduleResult {
  contracts: Contract[];
  newContracts: Contract[];
  lastContractGenerationTime: number;
  lastMarketRefreshTime: number;
  lastDailyCleanupTime: number;
  lastPlayableContractGeneratedTime: number;
  debug: ContractGenerationDebugSnapshot;
}

function countNewlyExpiredContracts(before: Contract[], after: Contract[]): number {
  let count = 0;
  for (let index = 0; index < after.length; index += 1) {
    const prev = before[index];
    const next = after[index];
    if (prev?.status === 'available' && next?.status === 'expired') {
      count += 1;
    }
  }
  return count;
}

function resolveContractsToGenerate(params: {
  tick: ContractGenerationTickKind;
  availableCount: number;
}): number {
  const gen = contractGenerationBalance;
  const { tick, availableCount } = params;
  const headroom = Math.max(0, gen.maxAvailableContracts - availableCount);

  if (headroom <= 0) {
    return 0;
  }

  let minPerTick = 0;
  let maxPerTick = 0;

  if (tick === 'small') {
    minPerTick = gen.minContractsPerSmallTick;
    maxPerTick = gen.maxContractsPerSmallTick;
  } else if (tick === 'medium') {
    minPerTick = gen.minContractsPerMediumTick;
    maxPerTick = gen.maxContractsPerMediumTick;
  } else {
    if (availableCount >= gen.minAvailableContracts) {
      return 0;
    }
    minPerTick = 1;
    maxPerTick = gen.maxContractsGeneratedAtOnce;
  }

  let needed = 0;

  if (availableCount < gen.minAvailableContracts) {
    needed = Math.min(
      gen.targetAvailableContracts - availableCount,
      gen.maxContractsGeneratedAtOnce,
    );
  } else if (availableCount < gen.targetAvailableContracts) {
    needed = Math.min(
      randomIntBetween(minPerTick, maxPerTick),
      gen.targetAvailableContracts - availableCount,
    );
  } else if (tick === 'medium' && availableCount < gen.maxAvailableContracts) {
    needed = Math.min(
      randomIntBetween(minPerTick, maxPerTick),
      gen.maxAvailableContracts - availableCount,
    );
  }

  return Math.min(needed, gen.maxContractsGeneratedAtOnce, headroom);
}

function runContractGenerationTick(
  params: ReplenishContractsParams & {
    tick: ContractGenerationTickKind;
    contracts: Contract[];
    currentTime: number;
  },
): { contracts: Contract[]; newContracts: Contract[]; expiredRemoved: number } {
  const beforeExpire = params.contracts;
  const expired = expireOldContracts(beforeExpire, params.currentTime);
  const expiredRemoved = countNewlyExpiredContracts(beforeExpire, expired);
  const availableCount = countAvailableContracts(expired);
  const needed = resolveContractsToGenerate({ tick: params.tick, availableCount });

  if (needed <= 0) {
    return { contracts: expired, newContracts: [], expiredRemoved };
  }

  const playerLevel = Math.max(1, params.playerLevel ?? 1);
  const ownedMaxCapacity =
    params.ownedMaxTruckCapacity ??
    params.maxTruckCapacity ??
    getMaxContractTonnageForLevel(playerLevel);

  const newContracts = generateContracts(
    params.cities,
    params.routes,
    params.products,
    params.globalEconomy,
    expired,
    {
      currentTime: params.currentTime,
      maxNewContracts: needed,
      maxTruckCapacity: ownedMaxCapacity,
      ownedMaxTruckCapacity: ownedMaxCapacity,
      idleMaxTruckCapacity: params.idleMaxTruckCapacity,
      playerLevel,
      playerReputation: params.playerReputation,
      idleTruckOriginCityIds: params.idleTruckOriginCityIds,
      activeDeliveryDestinationCityIds: params.activeDeliveryDestinationCityIds,
      busyTruckOriginCityIds: params.busyTruckOriginCityIds,
      fleetCityContext: params.fleetCityContext,
      activeWorldEvents: params.activeWorldEvents,
    },
  );

  const merged = mergeContractLists(expired, newContracts);

  return {
    contracts: balanceAvailableContractLevelMix(merged, playerLevel),
    newContracts,
    expiredRemoved,
  };
}

function buildContractGenerationDebugSnapshot(params: {
  currentTime: number;
  contracts: Contract[];
  trucks?: Truck[];
  drivers?: Driver[];
  playerLevel?: number;
  idleTruckOriginCityIds?: string[];
  activeDeliveryDestinationCityIds?: string[];
  lastPlayableContractGeneratedTime?: number;
  lastContractGenerationTime: number;
  lastMarketRefreshTime: number;
  lastDailyCleanupTime: number;
  generatedContractsCount: number;
  expiredContractsRemoved: number;
  elapsedSmallTicks: number;
  processedSmallTicks: number;
  elapsedMediumTicks: number;
  processedMediumTicks: number;
  elapsedDailyTicks: number;
  offlineCatchup: boolean;
}): ContractGenerationDebugSnapshot {
  const gen = contractGenerationBalance;
  const safeTime = params.currentTime ?? 0;
  const lastGen = params.lastContractGenerationTime ?? 0;
  const lastMarket = params.lastMarketRefreshTime ?? 0;
  const lastCleanup = params.lastDailyCleanupTime ?? 0;
  const playerLevel = Math.max(1, params.playerLevel ?? 1);

  const hoursSinceGen = Math.max(0, safeTime - lastGen);
  const hoursSinceMarket = Math.max(0, safeTime - lastMarket);

  const nextSmall = Math.max(0, gen.smallGenerationIntervalHours - hoursSinceGen);
  const nextMedium = Math.max(0, gen.mediumGenerationIntervalHours - hoursSinceMarket);
  const nextDaily = Math.max(0, gen.dailyCleanupIntervalHours - (safeTime - lastCleanup));

  return {
    currentTime: safeTime,
    availableContracts: countAvailableContracts(params.contracts),
    playableContractsCount: measureContractScheduleStage('playable-contract-scan', () =>
      countPlayableContracts(
        params.contracts,
        params.trucks,
        params.drivers,
        playerLevel,
        safeTime,
      ),
    ),
    idleTruckOriginCities: params.idleTruckOriginCityIds ?? [],
    activeDeliveryDestinationCities: params.activeDeliveryDestinationCityIds ?? [],
    lastPlayableContractGeneratedTime: params.lastPlayableContractGeneratedTime ?? 0,
    lastContractGenerationTime: lastGen,
    lastMarketRefreshTime: lastMarket,
    lastDailyCleanupTime: lastCleanup,
    hoursSinceLastGeneration: hoursSinceGen,
    hoursSinceLastMarketRefresh: hoursSinceMarket,
    lastGeneratedContractsCount: params.generatedContractsCount,
    expiredContractsRemoved: params.expiredContractsRemoved,
    nextSmallGenerationInHours: nextSmall,
    nextMediumGenerationInHours: nextMedium,
    nextDailyCleanupInHours: nextDaily,
    elapsedSmallTicks: params.elapsedSmallTicks,
    processedSmallTicks: params.processedSmallTicks,
    elapsedMediumTicks: params.elapsedMediumTicks,
    processedMediumTicks: params.processedMediumTicks,
    elapsedDailyTicks: params.elapsedDailyTicks,
    generatedContractsCount: params.generatedContractsCount,
    offlineCatchup: params.offlineCatchup,
  };
}

function computeElapsedTicks(
  lastTime: number,
  currentTime: number,
  intervalHours: number,
): number {
  if (intervalHours <= 0 || currentTime <= lastTime) {
    return 0;
  }
  return Math.floor((currentTime - lastTime) / intervalHours);
}

/** advanceTime no-op fast path — generation parametreleri oluşturmadan kontrol. */
export function canSkipContractScheduleTick(params: {
  contracts: Contract[] | undefined;
  trucks?: Truck[];
  drivers?: Driver[];
  playerLevel?: number;
  currentTime: number;
  newTime: number;
  lastContractGenerationTime: number;
  lastMarketRefreshTime: number;
  lastDailyCleanupTime: number;
  idleTruckOriginCityIds?: string[];
}): boolean {
  return isContractScheduleFastPathEligible({
    contracts: params.contracts,
    trucks: params.trucks,
    drivers: params.drivers,
    playerLevel: params.playerLevel,
    newTime: params.newTime,
    lastContractGenerationTime: params.lastContractGenerationTime,
    lastMarketRefreshTime: params.lastMarketRefreshTime,
    lastDailyCleanupTime: params.lastDailyCleanupTime,
    idleTruckOriginCityIds: params.idleTruckOriginCityIds,
  });
}

function isContractScheduleFastPathEligible(params: {
  contracts: Contract[] | undefined;
  trucks?: Truck[];
  drivers?: Driver[];
  playerLevel?: number;
  newTime: number;
  lastContractGenerationTime: number;
  lastMarketRefreshTime: number;
  lastDailyCleanupTime: number;
  idleTruckOriginCityIds?: string[];
}): boolean {
  const gen = contractGenerationBalance;
  const newTime = params.newTime;
  if (
    computeElapsedTicks(params.lastDailyCleanupTime, newTime, gen.dailyCleanupIntervalHours) > 0 ||
    computeElapsedTicks(params.lastMarketRefreshTime, newTime, gen.mediumGenerationIntervalHours) > 0 ||
    computeElapsedTicks(params.lastContractGenerationTime, newTime, gen.smallGenerationIntervalHours) > 0
  ) {
    return false;
  }
  if (contractsNeedExpiryPass(params.contracts, newTime)) {
    return false;
  }
  return !isContractMinimumSupplyNeeded({
    contracts: params.contracts,
    trucks: params.trucks,
    drivers: params.drivers,
    playerLevel: params.playerLevel,
    currentTime: newTime,
    idleTruckOriginCityIds: params.idleTruckOriginCityIds,
  });
}

function runBoundedGenerationTicks(
  params: {
    baseParams: ReplenishContractsParams;
    contracts: Contract[];
    tick: ContractGenerationTickKind;
    initialLastTime: number;
    intervalHours: number;
    elapsedTicks: number;
    maxProcessedTicks: number;
  },
): {
  contracts: Contract[];
  newContracts: Contract[];
  expiredRemoved: number;
  processedTicks: number;
  catchup: boolean;
} {
  const { elapsedTicks, maxProcessedTicks } = params;
  if (elapsedTicks <= 0) {
    return {
      contracts: params.contracts,
      newContracts: [],
      expiredRemoved: 0,
      processedTicks: 0,
      catchup: false,
    };
  }

  const processedTicks = Math.min(elapsedTicks, maxProcessedTicks);
  const catchup = elapsedTicks > processedTicks;

  let contracts = params.contracts;
  const newContracts: Contract[] = [];
  let expiredRemoved = 0;

  for (let tickIndex = 0; tickIndex < processedTicks; tickIndex += 1) {
    const tickTime = params.initialLastTime + (tickIndex + 1) * params.intervalHours;
    const result = runContractGenerationTick({
      ...params.baseParams,
      contracts,
      currentTime: tickTime,
      tick: params.tick,
    });
    contracts = result.contracts;
    newContracts.push(...result.newContracts);
    expiredRemoved += result.expiredRemoved;
  }

  return { contracts, newContracts, expiredRemoved, processedTicks, catchup };
}

/** Available sözleşmelerden herhangi biri bu tick'te süresi doluyor mu? */
export function contractsNeedExpiryPass(
  contracts: Contract[] | undefined,
  currentTime: number,
): boolean {
  for (const contract of contracts ?? []) {
    if (contract.status === 'available' && currentTime >= contract.expiresAt) {
      return true;
    }
  }
  return false;
}

/** ensureMinimumEligibleContracts needsSupply — expire öncesi hızlı kontrol. */
export function isContractMinimumSupplyNeeded(params: {
  contracts: Contract[] | undefined;
  trucks?: Truck[];
  drivers?: Driver[];
  playerLevel?: number;
  currentTime?: number;
  idleTruckOriginCityIds?: string[];
}): boolean {
  const gen = contractGenerationBalance;
  const contracts = params.contracts ?? [];
  const playerLevel = Math.max(1, params.playerLevel ?? 1);
  const trucks = params.trucks ?? [];
  const drivers = params.drivers ?? [];
  const currentTime = params.currentTime ?? 0;
  const idleCities = [
    ...new Set((params.idleTruckOriginCityIds ?? []).map((cityId) => normalizeCityId(cityId))),
  ];

  if (countAvailableContracts(contracts) === 0) {
    return true;
  }
  if (idleCities.length > 0 && countPlayableContracts(contracts, trucks, drivers, playerLevel, currentTime) === 0) {
    return true;
  }
  const perCityGap = idleCities.reduce((gap, cityId) => {
    const have = countPlayableContractsFromOrigin(
      contracts,
      cityId,
      trucks,
      drivers,
      playerLevel,
      currentTime,
    );
    return gap + Math.max(0, gen.minAvailableContractsPerIdleTruckCity - have);
  }, 0);
  if (perCityGap > 0) {
    return true;
  }
  if (countAvailableContracts(contracts) < gen.minGlobalEligibleContracts) {
    return true;
  }
  if (countContractsAtOrBelowLevel(contracts, playerLevel) < gen.minPlayerLevelEligibleContracts) {
    return true;
  }
  return false;
}

function buildContractScheduleTimingDebugSnapshot(params: {
  currentTime: number;
  contracts: Contract[];
  lastPlayableContractGeneratedTime?: number;
  lastContractGenerationTime: number;
  lastMarketRefreshTime: number;
  lastDailyCleanupTime: number;
  generatedContractsCount: number;
  expiredContractsRemoved: number;
  elapsedSmallTicks: number;
  processedSmallTicks: number;
  elapsedMediumTicks: number;
  processedMediumTicks: number;
  elapsedDailyTicks: number;
  offlineCatchup: boolean;
  idleTruckOriginCityIds?: string[];
  activeDeliveryDestinationCityIds?: string[];
}): ContractGenerationDebugSnapshot {
  const gen = contractGenerationBalance;
  const safeTime = params.currentTime ?? 0;
  const lastGen = params.lastContractGenerationTime ?? 0;
  const lastMarket = params.lastMarketRefreshTime ?? 0;
  const lastCleanup = params.lastDailyCleanupTime ?? 0;
  const hoursSinceGen = Math.max(0, safeTime - lastGen);
  const hoursSinceMarket = Math.max(0, safeTime - lastMarket);

  return {
    currentTime: safeTime,
    availableContracts: countAvailableContracts(params.contracts),
    playableContractsCount: -1,
    idleTruckOriginCities: params.idleTruckOriginCityIds ?? [],
    activeDeliveryDestinationCities: params.activeDeliveryDestinationCityIds ?? [],
    lastPlayableContractGeneratedTime: params.lastPlayableContractGeneratedTime ?? 0,
    lastContractGenerationTime: lastGen,
    lastMarketRefreshTime: lastMarket,
    lastDailyCleanupTime: lastCleanup,
    hoursSinceLastGeneration: hoursSinceGen,
    hoursSinceLastMarketRefresh: hoursSinceMarket,
    lastGeneratedContractsCount: params.generatedContractsCount,
    expiredContractsRemoved: params.expiredContractsRemoved,
    nextSmallGenerationInHours: Math.max(0, gen.smallGenerationIntervalHours - hoursSinceGen),
    nextMediumGenerationInHours: Math.max(0, gen.mediumGenerationIntervalHours - hoursSinceMarket),
    nextDailyCleanupInHours: Math.max(0, gen.dailyCleanupIntervalHours - (safeTime - lastCleanup)),
    elapsedSmallTicks: params.elapsedSmallTicks,
    processedSmallTicks: params.processedSmallTicks,
    elapsedMediumTicks: params.elapsedMediumTicks,
    processedMediumTicks: params.processedMediumTicks,
    elapsedDailyTicks: params.elapsedDailyTicks,
    generatedContractsCount: params.generatedContractsCount,
    offlineCatchup: params.offlineCatchup,
  };
}

/**
 * advanceTime sırasında kademeli sözleşme üretim zamanlamasını işler.
 * Küçük (3s), orta (6s) ve günlük (24s) tick'leri toplu hesapla; while döngüsü yok.
 */
export function processContractGenerationSchedule(
  params: ProcessContractGenerationScheduleParams,
  options?: { includePlayableCountsInDebug?: boolean },
): ProcessContractGenerationScheduleResult {
  const gen = contractGenerationBalance;
  const newTime = params.newTime ?? params.currentTime ?? 0;

  let contracts = params.contracts ?? [];
  const initialCleanup = params.lastDailyCleanupTime ?? 0;
  const initialMarket = params.lastMarketRefreshTime ?? 0;
  const initialGen = params.lastContractGenerationTime ?? params.previousTime ?? 0;

  const elapsedDailyTicks = computeElapsedTicks(
    initialCleanup,
    newTime,
    gen.dailyCleanupIntervalHours,
  );
  const elapsedMediumTicks = computeElapsedTicks(
    initialMarket,
    newTime,
    gen.mediumGenerationIntervalHours,
  );
  const elapsedSmallTicks = computeElapsedTicks(
    initialGen,
    newTime,
    gen.smallGenerationIntervalHours,
  );

  if (
    measureContractScheduleStage('fast-path-eligibility', () =>
      isContractScheduleFastPathEligible({
        contracts,
        trucks: params.trucks,
        drivers: params.drivers,
        playerLevel: params.playerLevel,
        newTime,
        lastContractGenerationTime: initialGen,
        lastMarketRefreshTime: initialMarket,
        lastDailyCleanupTime: initialCleanup,
        idleTruckOriginCityIds: params.idleTruckOriginCityIds,
      }),
    )
  ) {
    return {
      contracts,
      newContracts: [],
      lastContractGenerationTime: initialGen,
      lastMarketRefreshTime: initialMarket,
      lastDailyCleanupTime: initialCleanup,
      lastPlayableContractGeneratedTime: params.lastPlayableContractGeneratedTime ?? 0,
      debug: buildContractScheduleTimingDebugSnapshot({
        currentTime: newTime,
        contracts,
        lastPlayableContractGeneratedTime: params.lastPlayableContractGeneratedTime,
        lastContractGenerationTime: initialGen,
        lastMarketRefreshTime: initialMarket,
        lastDailyCleanupTime: initialCleanup,
        generatedContractsCount: 0,
        expiredContractsRemoved: 0,
        elapsedSmallTicks: 0,
        processedSmallTicks: 0,
        elapsedMediumTicks: 0,
        processedMediumTicks: 0,
        elapsedDailyTicks: 0,
        offlineCatchup: false,
        idleTruckOriginCityIds: params.idleTruckOriginCityIds,
        activeDeliveryDestinationCityIds: params.activeDeliveryDestinationCityIds,
      }),
    };
  }

  let lastCleanup = initialCleanup;
  let lastMarket = initialMarket;
  let lastGen = initialGen;

  const allNewContracts: Contract[] = [];
  let totalExpiredRemoved = 0;
  let offlineCatchup = false;

  const baseParams: ReplenishContractsParams = {
    cities: params.cities,
    routes: params.routes,
    products: params.products,
    globalEconomy: params.globalEconomy,
    contracts,
    currentTime: newTime,
    maxTruckCapacity: params.maxTruckCapacity,
    ownedMaxTruckCapacity: params.ownedMaxTruckCapacity,
    idleMaxTruckCapacity: params.idleMaxTruckCapacity,
    playerLevel: params.playerLevel,
    playerReputation: params.playerReputation,
    idleTruckOriginCityIds: params.idleTruckOriginCityIds,
    activeWorldEvents: params.activeWorldEvents,
  };

  if (elapsedDailyTicks > 0) {
    offlineCatchup = offlineCatchup || elapsedDailyTicks > gen.maxDailyCleanupTicksProcessedAtOnce;
    const cleanupTime = initialCleanup + elapsedDailyTicks * gen.dailyCleanupIntervalHours;

    const beforeDaily = contracts;
    contracts = measureContractScheduleStage(
      'generation-daily-expiry',
      () => expireOldContracts(contracts, cleanupTime),
      { elapsedDailyTicks },
    );
    totalExpiredRemoved += countNewlyExpiredContracts(beforeDaily, contracts);

    const boost = measureContractScheduleStage(
      'generation-daily',
      () =>
        runContractGenerationTick({
          ...baseParams,
          contracts,
          currentTime: cleanupTime,
          tick: 'cleanup_boost',
        }),
      { elapsedDailyTicks },
    );
    contracts = boost.contracts;
    allNewContracts.push(...boost.newContracts);
    totalExpiredRemoved += boost.expiredRemoved;

    lastCleanup = initialCleanup + elapsedDailyTicks * gen.dailyCleanupIntervalHours;
  }

  const mediumResult = measureContractScheduleStage(
    'generation-medium',
    () =>
      runBoundedGenerationTicks({
        baseParams,
        contracts,
        tick: 'medium',
        initialLastTime: initialMarket,
        intervalHours: gen.mediumGenerationIntervalHours,
        elapsedTicks: elapsedMediumTicks,
        maxProcessedTicks: gen.maxMediumTicksProcessedAtOnce,
      }),
    { elapsedMediumTicks },
  );
  contracts = mediumResult.contracts;
  allNewContracts.push(...mediumResult.newContracts);
  totalExpiredRemoved += mediumResult.expiredRemoved;
  offlineCatchup = offlineCatchup || mediumResult.catchup;
  if (elapsedMediumTicks > 0) {
    lastMarket = initialMarket + elapsedMediumTicks * gen.mediumGenerationIntervalHours;
  }

  const smallResult = measureContractScheduleStage(
    'generation-small',
    () =>
      runBoundedGenerationTicks({
        baseParams,
        contracts,
        tick: 'small',
        initialLastTime: initialGen,
        intervalHours: gen.smallGenerationIntervalHours,
        elapsedTicks: elapsedSmallTicks,
        maxProcessedTicks: gen.maxSmallTicksProcessedAtOnce,
      }),
    { elapsedSmallTicks },
  );
  contracts = smallResult.contracts;
  allNewContracts.push(...smallResult.newContracts);
  totalExpiredRemoved += smallResult.expiredRemoved;
  offlineCatchup = offlineCatchup || smallResult.catchup;
  if (elapsedSmallTicks > 0) {
    lastGen = initialGen + elapsedSmallTicks * gen.smallGenerationIntervalHours;
  }

  const generatedContractsCount = allNewContracts.length;

  let lastPlayableGenerated = params.lastPlayableContractGeneratedTime ?? 0;
  const minimumSupplyNeeded = measureContractScheduleStage(
    'minimum-supply-check',
    () =>
      isContractMinimumSupplyNeeded({
        contracts,
        trucks: params.trucks,
        drivers: params.drivers,
        playerLevel: params.playerLevel,
        currentTime: newTime,
        idleTruckOriginCityIds: params.idleTruckOriginCityIds,
      }),
  );
  if (minimumSupplyNeeded) {
    const minimumResult = measureContractScheduleStage('minimum-supply-ensure', () =>
      ensureMinimumEligibleContracts({
        ...baseParams,
        contracts,
        currentTime: newTime,
        trucks: params.trucks,
        trailers: params.trailers,
        drivers: params.drivers,
        homeCityId: params.homeCityId,
        lastPlayableContractGeneratedTime: lastPlayableGenerated,
        maxNewContracts: gen.bootstrapMaxContractsPerPass,
      }),
    );
    if (minimumResult.newContracts.length > 0) {
      contracts = minimumResult.contracts;
      allNewContracts.push(...minimumResult.newContracts);
      lastPlayableGenerated =
        minimumResult.updatedLastPlayableContractGeneratedTime ?? lastPlayableGenerated;
    }
  }

  const debug = measureContractScheduleStage(
    'debug-snapshot',
    () =>
      options?.includePlayableCountsInDebug === false
        ? buildContractScheduleTimingDebugSnapshot({
          currentTime: newTime,
          contracts,
          lastPlayableContractGeneratedTime: lastPlayableGenerated,
          lastContractGenerationTime: lastGen,
          lastMarketRefreshTime: lastMarket,
          lastDailyCleanupTime: lastCleanup,
          generatedContractsCount: allNewContracts.length,
          expiredContractsRemoved: totalExpiredRemoved,
          elapsedSmallTicks,
          processedSmallTicks: smallResult.processedTicks,
          elapsedMediumTicks,
          processedMediumTicks: mediumResult.processedTicks,
          elapsedDailyTicks,
          offlineCatchup,
          idleTruckOriginCityIds: params.idleTruckOriginCityIds,
          activeDeliveryDestinationCityIds: params.activeDeliveryDestinationCityIds,
        })
      : buildContractGenerationDebugSnapshot({
          currentTime: newTime,
          contracts,
          trucks: params.trucks,
          drivers: params.drivers,
          playerLevel: params.playerLevel,
          idleTruckOriginCityIds: params.idleTruckOriginCityIds,
          activeDeliveryDestinationCityIds: params.activeDeliveryDestinationCityIds,
          lastPlayableContractGeneratedTime: lastPlayableGenerated,
          lastContractGenerationTime: lastGen,
          lastMarketRefreshTime: lastMarket,
          lastDailyCleanupTime: lastCleanup,
          generatedContractsCount: allNewContracts.length,
          expiredContractsRemoved: totalExpiredRemoved,
          elapsedSmallTicks,
          processedSmallTicks: smallResult.processedTicks,
          elapsedMediumTicks,
          processedMediumTicks: mediumResult.processedTicks,
          elapsedDailyTicks,
          offlineCatchup,
        }),
  );

  return {
    contracts,
    newContracts: allNewContracts,
    lastContractGenerationTime: lastGen,
    lastMarketRefreshTime: lastMarket,
    lastDailyCleanupTime: lastCleanup,
    lastPlayableContractGeneratedTime: lastPlayableGenerated,
    debug,
  };
}

/**
 * Süresi dolmuş teklifleri temizler; müsait sözleşme sayısı minimumun altındaysa
 * şehir ekonomisine göre yeni sözleşmeler üretir.
 */
export function replenishAvailableContracts(params: ReplenishContractsParams): ReplenishContractsResult {
  const gen = contractGenerationBalance;
  const expired = expireOldContracts(params.contracts, params.currentTime);
  const availableCount = countAvailableContracts(expired);

  if (availableCount >= gen.minAvailableContracts) {
    return { contracts: expired, newContracts: [] };
  }

  const needed = Math.min(
    Math.max(0, gen.targetAvailableContracts - availableCount),
    gen.maxAvailableContracts - availableCount,
    gen.maxContractsGeneratedAtOnce,
  );

  if (needed <= 0) {
    return { contracts: expired, newContracts: [] };
  }

  const playerLevel = Math.max(1, params.playerLevel ?? 1);
  const ownedMaxCapacity =
    params.ownedMaxTruckCapacity ??
    params.maxTruckCapacity ??
    getMaxContractTonnageForLevel(playerLevel);

  const newContracts = generateContracts(
    params.cities,
    params.routes,
    params.products,
    params.globalEconomy,
    expired,
    {
      currentTime: params.currentTime,
      maxNewContracts: needed,
      maxTruckCapacity: ownedMaxCapacity,
      ownedMaxTruckCapacity: ownedMaxCapacity,
      idleMaxTruckCapacity: params.idleMaxTruckCapacity,
      playerLevel,
      playerReputation: params.playerReputation,
      idleTruckOriginCityIds: params.idleTruckOriginCityIds,
      activeDeliveryDestinationCityIds: params.activeDeliveryDestinationCityIds,
      busyTruckOriginCityIds: params.busyTruckOriginCityIds,
      fleetCityContext: params.fleetCityContext,
      activeWorldEvents: params.activeWorldEvents,
    },
  );

  const merged = mergeContractLists(expired, newContracts);

  return {
    contracts: balanceAvailableContractLevelMix(merged, playerLevel),
    newContracts,
  };
}

/** Oyuncu seviyesine uygun müsait sözleşme sayısı */
export function countContractsAtOrBelowLevel(
  contracts: Contract[] | undefined,
  playerLevel: number,
): number {
  const safeLevel = Math.max(1, playerLevel);
  return (contracts ?? []).filter(
    (contract) =>
      contract.status === 'available' && (contract.requiredLevel ?? 1) <= safeLevel,
  ).length;
}

/** Oyuncu seviyesinin üstündeki müsait sözleşme sayısı */
export function countContractsAboveLevel(
  contracts: Contract[] | undefined,
  playerLevel: number,
): number {
  const safeLevel = Math.max(1, playerLevel);
  return (contracts ?? []).filter(
    (contract) =>
      contract.status === 'available' && (contract.requiredLevel ?? 1) > safeLevel,
  ).length;
}

/**
 * Periyodik piyasa yenilemesi — mevcut listeyi korur, süresi dolanları temizler,
 * eksik kadar yeni sözleşme ekler.
 */
export function refreshContractsFromMarket(
  params: ReplenishContractsParams & { maxContractsPerRefresh?: number },
): ReplenishContractsResult {
  const expired = expireOldContracts(params.contracts, params.currentTime);
  const availableCount = countAvailableContracts(expired);
  const gen = contractGenerationBalance;
  const maxTotal = gen.maxAvailableContracts;

  if (availableCount >= maxTotal) {
    return { contracts: expired, newContracts: [] };
  }

  const maxPerRefresh =
    params.maxContractsPerRefresh ?? contractGenerationBalance.manualRefreshMaxContracts;
  const headroom = maxTotal - availableCount;

  let needed = 0;
  if (availableCount < gen.minAvailableContracts) {
    needed = Math.min(maxPerRefresh, gen.targetAvailableContracts - availableCount, headroom);
  }

  const expiredThisCycle = expired.filter(
    (contract, index) =>
      contract.status === 'expired' &&
      params.contracts[index]?.status === 'available',
  ).length;
  if (expiredThisCycle > 0 && availableCount < gen.targetAvailableContracts) {
    needed = Math.max(
      needed,
      Math.min(expiredThisCycle, maxPerRefresh, headroom),
    );
  }

  if (needed <= 0) {
    return { contracts: expired, newContracts: [] };
  }

  const playerLevel = Math.max(1, params.playerLevel ?? 1);
  const ownedMaxCapacity =
    params.ownedMaxTruckCapacity ??
    params.maxTruckCapacity ??
    getMaxContractTonnageForLevel(playerLevel);

  const newContracts = generateContracts(
    params.cities,
    params.routes,
    params.products,
    params.globalEconomy,
    expired,
    {
      currentTime: params.currentTime,
      maxNewContracts: needed,
      maxTruckCapacity: ownedMaxCapacity,
      ownedMaxTruckCapacity: ownedMaxCapacity,
      idleMaxTruckCapacity: params.idleMaxTruckCapacity,
      playerLevel,
      playerReputation: params.playerReputation,
      idleTruckOriginCityIds: params.idleTruckOriginCityIds,
      activeDeliveryDestinationCityIds: params.activeDeliveryDestinationCityIds,
      busyTruckOriginCityIds: params.busyTruckOriginCityIds,
      fleetCityContext: params.fleetCityContext,
      activeWorldEvents: params.activeWorldEvents,
    },
  );

  const merged = mergeContractLists(expired, newContracts);

  return {
    contracts: balanceAvailableContractLevelMix(merged, playerLevel),
    newContracts,
  };
}

/**
 * Süresi dolmuş available sözleşmeleri expired olarak işaretler.
 * Orijinal dizi mutate edilmez; yeni dizi döndürülür.
 */
export function expireOldContracts(contracts: Contract[], currentTime: number): Contract[] {
  let changed = false;
  const next = contracts.map((contract) => {
    if (contract.status === 'available' && currentTime >= contract.expiresAt) {
      changed = true;
      return { ...contract, status: 'expired' as const };
    }
    return contract;
  });
  return changed ? next : contracts;
}

// ---------------------------------------------------------------------------
// Örnek kullanım (yorum — çalıştırılmaz)
// ---------------------------------------------------------------------------

/*
import { CITIES_BY_ID } from '../data/cities';
import { PRODUCTS } from '../data/products';
import { ROUTES } from '../data/routes';
import { DEFAULT_GLOBAL_ECONOMY } from './economy';
import { expireOldContracts, generateContracts } from './contracts';

const currentTime = 48; // oyun saati
const existingContracts: Contract[] = [];

// Süresi dolmuş teklifleri temizle
const activeOffers = expireOldContracts(existingContracts, currentTime);

// Yeni sözleşmeler üret
const newContracts = generateContracts(
  CITIES_BY_ID,
  ROUTES,
  PRODUCTS,
  DEFAULT_GLOBAL_ECONOMY,
  activeOffers,
  { currentTime, maxNewContracts: 8 },
);

// Mevcut listeye ekle (immutable birleştirme)
const allContracts = [...activeOffers, ...newContracts];
*/
