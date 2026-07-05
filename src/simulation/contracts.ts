/**
 * LogistiCore - Dinamik sözleşme oluşturma motoru
 *
 * Şehirlerin stok, fiyat ve üretim/tüketim dengesine göre taşıma sözleşmeleri
 * otomatik üretilir. Hiçbir sözleşme elle yazılmaz; ekonomi verisi kaynak alınır.
 */

import type {
  City,
  Contract,
  GlobalEconomy,
  MarketContractFilter,
  MarketOpportunity,
  Product,
  ProductId,
  ProductMarket,
  Route,
} from '../types/game';
import { contractBalance, contractLevelBalance, deliveryBalance, timeBalance } from '../config/balance';
import {
  applyCapacityProfileToTonnageRange,
  getMaxAllowedContractRequiredLevel,
  getMaxContractTonnageForLevel,
  getRequiredLevelForTonnage,
  pickContractCapacityProfile,
  pickContractGenerationLevelTier,
  resolveContractGenerationRange,
} from '../config/levelConfig';
import { toProductMarket } from './economy';

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
}

/** Dahili: aday sözleşme skoru — en kârlı rotalar önce seçilir */
interface ContractCandidate {
  score: number;
  contract: Contract;
}

// ---------------------------------------------------------------------------
// Temel yardımcılar
// ---------------------------------------------------------------------------

/** Değeri [min, max] aralığına sıkıştırır */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** [min, max] aralığında uniform rastgele sayı üretir */
export function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
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
 * Sözleşme ödemesini hesaplar ($).
 *
 * Maliyet tabanlı fiyatlandırma: yakıt, bakım, şoför zamanı, operasyon ve risk
 * payları üzerine hedef net kâr marjı eklenir.
 */
export function estimateContractOperatingCosts(params: ContractPaymentParams): number {
  const { amount, originMarket, destinationMarket, route, urgency, globalEconomy } = params;
  const referencePrice = (originMarket.basePrice + destinationMarket.basePrice) / 2;
  const distanceKm = route.distanceKm;

  const fuelCost =
    distanceKm *
    contractBalance.estimateFuelPerKm *
    globalEconomy.fuelPrice *
    (1 + amount / 30);

  const maintenanceCost =
    distanceKm * contractBalance.estimateMaintenancePerKm * (1 + route.difficulty * 0.3);

  const travelHours = distanceKm / contractBalance.averageSpeedKmh;
  const driverHourlyCost =
    deliveryBalance.fallbackDriverSalaryPerDay / timeBalance.hoursPerDay;
  const driverTimeCost = travelHours * driverHourlyCost * deliveryBalance.driverCostMultiplier;

  const operationsCost = distanceKm * contractBalance.operationsCostPerKm;

  const cargoValueRisk = amount * referencePrice * contractBalance.cargoValueRiskRate;
  const urgencyRisk = amount * referencePrice * urgency * 0.02;
  const difficultyRisk = amount * referencePrice * route.difficulty * 0.025;

  return (
    fuelCost +
    maintenanceCost +
    driverTimeCost +
    operationsCost +
    cargoValueRisk +
    urgencyRisk +
    difficultyRisk
  );
}

function resolveTargetProfitMargin(params: ContractPaymentParams): number {
  const { amount, route, urgency } = params;
  const difficulty = route.difficulty;
  const isLarge = amount >= contractBalance.largeContractTonnage;
  const isRisky = urgency >= 0.65 || difficulty >= 0.7;
  const isEasy = urgency < 0.35 && difficulty < 0.4 && route.distanceKm < 400;

  let minMargin: number;
  let maxMargin: number;

  if (isLarge) {
    minMargin = contractBalance.profitMarginLargeMin;
    maxMargin = contractBalance.profitMarginLargeMax;
  } else if (isRisky) {
    minMargin = contractBalance.profitMarginRiskyMin;
    maxMargin = contractBalance.profitMarginRiskyMax;
  } else if (isEasy) {
    minMargin = contractBalance.profitMarginEasyMin;
    maxMargin = contractBalance.profitMarginEasyMax;
  } else {
    minMargin = contractBalance.profitMarginMediumMin;
    maxMargin = contractBalance.profitMarginMediumMax;
  }

  const blend = clamp(urgency * 0.4 + difficulty * 0.35 + (amount / 40) * 0.25, 0, 1);
  return minMargin + (maxMargin - minMargin) * blend;
}

export function calculateContractPayment(params: ContractPaymentParams): number {
  const { amount, originMarket, destinationMarket } = params;

  const referencePrice = (originMarket.basePrice + destinationMarket.basePrice) / 2;
  const operatingCosts = estimateContractOperatingCosts(params);
  const targetMargin = resolveTargetProfitMargin(params);
  const rawPayment = operatingCosts * (1 + targetMargin);

  const floor = amount * referencePrice * contractBalance.minContractPayment;
  const ceiling = amount * referencePrice * contractBalance.maxContractPaymentMultiplier;

  return clamp(Math.round(rawPayment), floor, ceiling);
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

/**
 * Piyasa fırsatı ile sözleşme eşleşme önceliği (düşük = daha iyi).
 * 0: birebir · 1: aynı ürün · 2: aynı varış · 3: aynı çıkış · 4: ters rota · 99: eşleşme yok
 */
export function getMarketContractMatchTier(
  contract: Contract,
  filter: Pick<MarketContractFilter, 'fromCityId' | 'toCityId' | 'productId'>,
): number {
  const { fromCityId, toCityId, productId } = filter;

  if (
    contract.originCityId === fromCityId &&
    contract.destinationCityId === toCityId &&
    contract.productId === productId
  ) {
    return 0;
  }

  if (contract.productId === productId) {
    return 1;
  }

  if (contract.destinationCityId === toCityId) {
    return 2;
  }

  if (contract.originCityId === fromCityId) {
    return 3;
  }

  if (contract.originCityId === toCityId && contract.destinationCityId === fromCityId) {
    return 4;
  }

  return 99;
}

/**
 * Filtre sıralaması — contractId varsa en üst öncelik (-1), sonra rota eşleşme tier'ı.
 */
export function getContractFilterSortTier(
  contract: Contract,
  filter: MarketContractFilter,
): number {
  if (filter.contractId && contract.id === filter.contractId) {
    return -1;
  }
  return getMarketContractMatchTier(contract, filter);
}

export function countExactMarketContractMatches(
  contracts: Contract[] | undefined,
  filter: Pick<MarketContractFilter, 'fromCityId' | 'toCityId' | 'productId'>,
): number {
  return (contracts ?? []).filter(
    (contract) =>
      contract.status === 'available' &&
      contract.originCityId === filter.fromCityId &&
      contract.destinationCityId === filter.toCityId &&
      contract.productId === filter.productId,
  ).length;
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
    sequence = Math.floor(randomBetween(1, 999_999)),
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

  const payment = calculateContractPayment({
    amount,
    product,
    originMarket,
    destinationMarket,
    route,
    urgency,
    globalEconomy,
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
    expiresAt: currentTime + deadlineHours * contractBalance.contractExpiryHours,
    requiredLevel: getRequiredLevelForTonnage(amount),
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
  const priorityOpportunityKeys = new Set(
    findMarketOpportunities(cityList, routes, products, 12).map(
      (opportunity) => `${opportunity.fromCityId}-${opportunity.toCityId}-${opportunity.productId}`,
    ),
  );
  const candidates: ContractCandidate[] = [];
  let sequenceCounter = existingContracts.length;
  const existingDedupeKeys = new Set(
    existingContracts
      .filter((contract) => contract.status === 'available')
      .map((contract) => getContractDedupeKey(contract)),
  );

  const idleOriginCitySet = new Set(options.idleTruckOriginCityIds ?? []);

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
        const routeKey = `${originCity.id}-${destinationCity.id}-${product.id}`;
        const marketPriorityBonus = priorityOpportunityKeys.has(routeKey) ? 60 : 0;
        const idleOriginBonus = idleOriginCitySet.has(originCity.id) ? 25 : 0;
        const score =
          calculateContractScore(
            finalContract.payment,
            finalContract.urgency,
            finalContract.amount,
            priceDiffRatio,
          ) +
          marketPriorityBonus +
          idleOriginBonus;

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
}

export interface ReplenishContractsResult {
  contracts: Contract[];
  newContracts: Contract[];
}

/**
 * Süresi dolmuş teklifleri temizler; müsait sözleşme sayısı minimumun altındaysa
 * şehir ekonomisine göre yeni sözleşmeler üretir.
 */
export function replenishAvailableContracts(params: ReplenishContractsParams): ReplenishContractsResult {
  const expired = expireOldContracts(params.contracts, params.currentTime);
  const availableCount = countAvailableContracts(expired);

  if (availableCount >= contractBalance.minAvailableContracts) {
    return { contracts: expired, newContracts: [] };
  }

  const target = Math.floor(
    randomBetween(
      contractBalance.targetAvailableContractsMin,
      contractBalance.targetAvailableContractsMax + 0.999,
    ),
  );
  const needed = Math.min(
    Math.max(0, target - availableCount),
    contractBalance.maxAvailableContracts - availableCount,
    contractBalance.maxContractsPerTick,
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
  const maxTotal = contractBalance.maxAvailableContracts;

  if (availableCount >= maxTotal) {
    return { contracts: expired, newContracts: [] };
  }

  const maxPerRefresh =
    params.maxContractsPerRefresh ?? contractBalance.contractsPerMarketRefresh;
  const targetMin = contractBalance.targetAvailableContractsMin;
  const targetMax = contractBalance.targetAvailableContractsMax;
  const headroom = maxTotal - availableCount;

  let needed = 0;
  if (availableCount < targetMin) {
    needed = Math.min(maxPerRefresh, targetMin - availableCount, headroom);
  } else if (availableCount < targetMax) {
    needed = Math.min(1, headroom);
  }

  const expiredThisCycle = expired.filter(
    (contract, index) =>
      contract.status === 'expired' &&
      params.contracts[index]?.status === 'available',
  ).length;
  if (expiredThisCycle > 0) {
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
