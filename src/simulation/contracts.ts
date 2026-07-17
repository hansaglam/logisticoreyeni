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
  Truck,
} from '../types/game';
import { contractBalance, contractExpiryBalance, contractGenerationBalance, contractLevelBalance } from '../config/balance';
import {
  applyCapacityProfileToTonnageRange,
  getMaxAllowedContractRequiredLevel,
  getMaxContractTonnageForLevel,
  getRequiredLevelForTonnage,
  pickContractCapacityProfile,
  pickContractGenerationLevelTier,
  resolveContractGenerationRange,
} from '../config/levelConfig';
import { toProductMarket, getSafeGlobalEconomy } from './economy';
import {
  calculateFuelCost,
  getActiveDeliveryDestinationCityIds,
  getBusyTruckOriginCityIds,
  getContractAvailability,
  getIdleDrivers,
  getIdleTruckOriginCityIds,
  getMaxIdleTruckCapacityAtOrigin,
  isContractOfferExpired,
  selectIdleTruckForContract,
} from './delivery';
import { getRoute as findRoute } from '../data/routes';
import { getProductByIdSafe } from '../utils/entityLookup';
import { canAffordVoluntaryPurchase } from '../utils/cashPolicy';
import { clamp, randomBetween, randomIntBetween } from '../utils/math';
import { getMarketContractMatchScore } from '../utils/marketContractMatch';
import {
  calculateBalancedContractPayment,
  estimateContractTripCostBreakdown,
  type ContractPaymentInput,
} from './contractEconomics';

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
  currentTime: number;
  /** Boşta kamyonların bulunduğu şehirler — bu çıkışlardan iş üretimine öncelik */
  idleTruckOriginCityIds?: string[];
  /** Aktif teslimat varış şehirleri */
  activeDeliveryDestinationCityIds?: string[];
  /** Meşgul kamyonların bulunduğu şehirler */
  busyTruckOriginCityIds?: string[];
  /** Birleşik filo şehir bağlamı — verilirse diğer şehir listeleri yerine kullanılır */
  fleetCityContext?: PlayerFleetCityContext;
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
  const paymentInput: ContractPaymentInput = {
    amount: params.amount,
    product: params.product,
    originMarket: params.originMarket,
    destinationMarket: params.destinationMarket,
    route: params.route,
    urgency: params.urgency,
    globalEconomy: params.globalEconomy,
    requiredLevel: params.requiredLevel,
    isMarketOpportunity: params.isMarketOpportunity,
  };
  return calculateBalancedContractPayment(paymentInput);
}

/**
 * Teslim süresi limitini hesaplar (saat).
 *
 * baseTravelHours = distanceKm / averageSpeed
 * Zor rota → deadline uzar; acil/bozulabilir ürün → deadline kısalır.
 */
export function calculateDeadlineHours(params: ContractDeadlineParams): number {
  const { route, product, urgency } = params;

  const baseTravelHours = route.distanceKm / contractBalance.averageSpeedKmh;

  // Zor rotalarda ek süre tanınır
  const routeDifficultyMultiplier = 1 + route.difficulty * 0.35;

  // Aciliyet arttıkça süre kısalır
  const urgencyMultiplier = clamp(1 - urgency * 0.4, 0.55, 1);

  // Bozulabilir ürünlerde süre kısalır
  const productPerishabilityMultiplier = clamp(1 - product.perishability * 0.45, 0.5, 1);

  const rawDeadline =
    baseTravelHours * routeDifficultyMultiplier * urgencyMultiplier * productPerishabilityMultiplier;

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

/** Sözleşme üretimi ile aynı stok/fiyat mantığına dayalı piyasa fırsatları */
export function findMarketOpportunities(
  cities: City[],
  routes: Route[],
  products: Product[],
  maxResults = 3,
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
    ).canStart
  ) {
    return false;
  }

  if (context?.playerMoney == null || context?.globalEconomy == null) {
    return true;
  }

  const product = getProductByIdSafe(contract.productId);
  const route = findRoute(contract.originCityId, contract.destinationCityId);
  const truck = selectIdleTruckForContract(
    trucks,
    contract,
    product ?? undefined,
    currentTime,
  );
  const driver = getIdleDrivers(drivers)[0];

  if (!truck || !driver || !route || !product) {
    return false;
  }

  const fuelCost = calculateFuelCost(
    contract,
    truck,
    driver,
    route,
    product,
    getSafeGlobalEconomy(context.globalEconomy),
  );
  return canAffordVoluntaryPurchase(context.playerMoney, fuelCost);
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
      contract.originCityId === originCityId &&
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

  const payment = calculateContractPayment({
    amount,
    product,
    originMarket,
    destinationMarket,
    route,
    urgency,
    globalEconomy,
    requiredLevel,
    isMarketOpportunity,
  });

  const deadlineHours = calculateDeadlineHours({ route, product, urgency });

  return {
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
  };
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
  const maxNewContracts = options.maxNewContracts ?? contractBalance.maxContractsPerTick;
  const playerLevel = Math.max(1, options.playerLevel ?? 1);
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
        const contract = generateContractForProduct({
          originCity,
          destinationCity,
          productId: product.id,
          product,
          route,
          globalEconomy,
          currentTime,
          maxTruckCapacity: tonnageBounds.maxTonnage,
          minTonnage: tonnageBounds.minTonnage,
          maxTonnage: tonnageBounds.maxTonnage,
          sequence: sequenceCounter,
          isMarketOpportunity,
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

        const dedupeKey = getContractDedupeKey(finalContract);
        if (existingDedupeKeys.has(dedupeKey)) {
          continue;
        }

        const priceDiffRatio = calculatePriceDiffRatio(originMarket, destinationMarket);
        const routeMarketBonus = isMarketOpportunity
          ? contractGenerationBalance.originCityWeights.marketOpportunityCity
          : 0;
        const originWeightBonus = getOriginCityWeightBonus(originCity.id, fleetContext);
        const score =
          calculateContractScore(
            finalContract.payment,
            finalContract.urgency,
            finalContract.amount,
            priceDiffRatio,
          ) +
          originWeightBonus +
          routeMarketBonus;

        candidates.push({ score, contract: finalContract });
      }
    }
  }

  // En yüksek skorlu adaylar önce; tick başına üst sınır uygulanır
  candidates.sort((a, b) => b.score - a.score);

  const selected: Contract[] = [];
  const batchDedupeKeys = new Set(existingDedupeKeys);

  for (const candidate of candidates) {
    if (selected.length >= maxNewContracts) break;
    const key = getContractDedupeKey(candidate.contract);
    if (batchDedupeKeys.has(key)) continue;
    batchDedupeKeys.add(key);
    selected.push(candidate.contract);
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
 * Boşta kamyon şehirlerinden alınabilir sözleşme sayısını garanti eder.
 */
export function ensurePlayableContractSupply(
  params: EnsurePlayableContractsParams,
): EnsurePlayableContractsResult {
  const gen = contractGenerationBalance;
  const playerLevel = Math.max(1, params.playerLevel ?? 1);
  const trucks = params.trucks ?? [];
  const drivers = params.drivers ?? [];
  const idleOriginCityIds = params.idleTruckOriginCityIds ?? [];
  const currentTime = params.currentTime ?? 0;

  let contracts = expireOldContracts(params.contracts ?? [], currentTime);
  const availableCount = countAvailableContracts(contracts);
  const headroom = Math.max(0, gen.maxAvailableContracts - availableCount);

  if (headroom <= 0 || idleOriginCityIds.length === 0) {
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
    (originCityId) =>
      countPlayableContractsFromOrigin(
        contracts,
        originCityId,
        trucks,
        drivers,
        playerLevel,
        currentTime,
      ) < gen.minAvailableContractsPerIdleTruckCity,
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
    params.maxNewContracts ?? gen.maxPlayableContractsGeneratedAtOnce,
    headroom,
    gen.maxContractsGeneratedAtOnce,
  );

  const generated: Contract[] = [];
  const batchBase = buildPlayableGenerationBaseParams(params, contracts);

  for (const originCityId of idleOriginCityIds) {
    if (generated.length >= maxGenerate) {
      break;
    }

    const cityCapacity = getMaxIdleTruckCapacityAtOrigin(trucks, originCityId, params.homeCityId);
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
    const cityCapacity = getMaxIdleTruckCapacityAtOrigin(trucks, originCityId, params.homeCityId);
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
  idleTruckOriginCityIds?: string[];
  activeDeliveryDestinationCityIds?: string[];
  busyTruckOriginCityIds?: string[];
  fleetCityContext?: PlayerFleetCityContext;
  trucks?: Truck[];
  drivers?: Driver[];
  homeCityId?: string;
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
      idleTruckOriginCityIds: params.idleTruckOriginCityIds,
      activeDeliveryDestinationCityIds: params.activeDeliveryDestinationCityIds,
      busyTruckOriginCityIds: params.busyTruckOriginCityIds,
      fleetCityContext: params.fleetCityContext,
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
    playableContractsCount: countPlayableContracts(
      params.contracts,
      params.trucks,
      params.drivers,
      playerLevel,
      safeTime,
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

/**
 * advanceTime sırasında kademeli sözleşme üretim zamanlamasını işler.
 * Küçük (3s), orta (6s) ve günlük (24s) tick'leri toplu hesapla; while döngüsü yok.
 */
export function processContractGenerationSchedule(
  params: ProcessContractGenerationScheduleParams,
): ProcessContractGenerationScheduleResult {
  const gen = contractGenerationBalance;
  const newTime = params.newTime ?? params.currentTime ?? 0;

  let contracts = params.contracts ?? [];
  const initialCleanup = params.lastDailyCleanupTime ?? 0;
  const initialMarket = params.lastMarketRefreshTime ?? 0;
  const initialGen = params.lastContractGenerationTime ?? params.previousTime ?? 0;

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
    idleTruckOriginCityIds: params.idleTruckOriginCityIds,
  };

  const elapsedDailyTicks = computeElapsedTicks(
    initialCleanup,
    newTime,
    gen.dailyCleanupIntervalHours,
  );

  if (elapsedDailyTicks > 0) {
    offlineCatchup = offlineCatchup || elapsedDailyTicks > gen.maxDailyCleanupTicksProcessedAtOnce;
    const cleanupTime = initialCleanup + elapsedDailyTicks * gen.dailyCleanupIntervalHours;

    const beforeDaily = contracts;
    contracts = expireOldContracts(contracts, cleanupTime);
    totalExpiredRemoved += countNewlyExpiredContracts(beforeDaily, contracts);

    const boost = runContractGenerationTick({
      ...baseParams,
      contracts,
      currentTime: cleanupTime,
      tick: 'cleanup_boost',
    });
    contracts = boost.contracts;
    allNewContracts.push(...boost.newContracts);
    totalExpiredRemoved += boost.expiredRemoved;

    lastCleanup = initialCleanup + elapsedDailyTicks * gen.dailyCleanupIntervalHours;
  }

  const elapsedMediumTicks = computeElapsedTicks(
    initialMarket,
    newTime,
    gen.mediumGenerationIntervalHours,
  );
  const mediumResult = runBoundedGenerationTicks({
    baseParams,
    contracts,
    tick: 'medium',
    initialLastTime: initialMarket,
    intervalHours: gen.mediumGenerationIntervalHours,
    elapsedTicks: elapsedMediumTicks,
    maxProcessedTicks: gen.maxMediumTicksProcessedAtOnce,
  });
  contracts = mediumResult.contracts;
  allNewContracts.push(...mediumResult.newContracts);
  totalExpiredRemoved += mediumResult.expiredRemoved;
  offlineCatchup = offlineCatchup || mediumResult.catchup;
  if (elapsedMediumTicks > 0) {
    lastMarket = initialMarket + elapsedMediumTicks * gen.mediumGenerationIntervalHours;
  }

  const elapsedSmallTicks = computeElapsedTicks(
    initialGen,
    newTime,
    gen.smallGenerationIntervalHours,
  );
  const smallResult = runBoundedGenerationTicks({
    baseParams,
    contracts,
    tick: 'small',
    initialLastTime: initialGen,
    intervalHours: gen.smallGenerationIntervalHours,
    elapsedTicks: elapsedSmallTicks,
    maxProcessedTicks: gen.maxSmallTicksProcessedAtOnce,
  });
  contracts = smallResult.contracts;
  allNewContracts.push(...smallResult.newContracts);
  totalExpiredRemoved += smallResult.expiredRemoved;
  offlineCatchup = offlineCatchup || smallResult.catchup;
  if (elapsedSmallTicks > 0) {
    lastGen = initialGen + elapsedSmallTicks * gen.smallGenerationIntervalHours;
  }

  const generatedContractsCount = allNewContracts.length;

  let lastPlayableGenerated = params.lastPlayableContractGeneratedTime ?? 0;
  const playableResult = ensurePlayableContractSupply({
    ...baseParams,
    contracts,
    currentTime: newTime,
    lastPlayableContractGeneratedTime: lastPlayableGenerated,
    maxNewContracts: gen.maxPlayableContractsGeneratedAtOnce,
  });
  if (playableResult.newContracts.length > 0) {
    contracts = playableResult.contracts;
    allNewContracts.push(...playableResult.newContracts);
    lastPlayableGenerated =
      playableResult.updatedLastPlayableContractGeneratedTime ?? lastPlayableGenerated;
  }

  const debug = buildContractGenerationDebugSnapshot({
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
  });

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
      idleTruckOriginCityIds: params.idleTruckOriginCityIds,
      activeDeliveryDestinationCityIds: params.activeDeliveryDestinationCityIds,
      busyTruckOriginCityIds: params.busyTruckOriginCityIds,
      fleetCityContext: params.fleetCityContext,
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
      idleTruckOriginCityIds: params.idleTruckOriginCityIds,
      activeDeliveryDestinationCityIds: params.activeDeliveryDestinationCityIds,
      busyTruckOriginCityIds: params.busyTruckOriginCityIds,
      fleetCityContext: params.fleetCityContext,
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
  return contracts.map((contract) => {
    if (contract.status === 'available' && currentTime >= contract.expiresAt) {
      return { ...contract, status: 'expired' as const };
    }
    return contract;
  });
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
