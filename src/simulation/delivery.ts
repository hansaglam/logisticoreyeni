/**
 * LogistiCore - Teslimat simülasyon motoru
 *
 * Sözleşme kabul edildikten sonra kamyon/şoför ataması, yolculuk süresi,
 * yakıt maliyeti, risk hesapları ve teslimat tamamlama/başarısızlık akışını yönetir.
 */

import type {
  Contract,
  Delivery,
  DeliveryFailureReason,
  Driver,
  SimulationGameState,
  GlobalEconomy,
  Product,
  Route,
  Truck,
} from '../types/game';
import { truckBalance } from '../config/balance';
import { PRODUCT_BY_ID } from '../data/products';

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

/** Şoför hız etkisi çarpanı — speed ±100 skalasında */
const DRIVER_SPEED_EFFECT = 0.28;

/** Düşük dikkat → ek aşınma çarpanı üst sınırı */
const DRIVER_ATTENTION_WEAR_MAX = 0.35;

/** Arıza / kaza olasılığı üst sınırı */
const MAX_RISK_CHANCE = 0.85;

/** Geç teslimde otomatik başarısızlık eşiği — deadlineHours × çarpan */
const CRITICAL_LATE_MULTIPLIER = 2;

/** Başarısız teslimat sabit ceza oranı — ödemenin yüzdesi */
const FAILURE_PENALTY_RATIO = 0.25;

/** Başarısız teslimat ek hasar maliyeti ($) */
const FAILURE_BASE_DAMAGE_COST = 500;

// ---------------------------------------------------------------------------
// Hata tipleri
// ---------------------------------------------------------------------------

/** Teslimat oluşturma hataları */
export class DeliveryError extends Error {
  constructor(
    message: string,
    public readonly reason: DeliveryFailureReason = 'capacity_exceeded',
  ) {
    super(message);
    this.name = 'DeliveryError';
  }
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

/** Benzersiz teslimat kimliği üretir */
export function createDeliveryId(contractId: string, startedAt: number, sequence: number): string {
  return `delivery_${contractId}_${Math.floor(startedAt)}_${sequence}`;
}

// ---------------------------------------------------------------------------
// Yük ve kapasite
// ---------------------------------------------------------------------------

/**
 * Taşınan kargo ağırlığını hesaplar (ton).
 * amount × weightPerUnit — kapasite kontrolünde kullanılır.
 */
export function calculateCargoWeight(contract: Contract, product: Product): number {
  return contract.amount * product.weightPerUnit;
}

/** Kamyon sözleşme yükünü taşıyabilir mi? */
export function canTruckCarryContract(truck: Truck, contract: Contract, product: Product): boolean {
  const cargoWeight = calculateCargoWeight(contract, product);
  return cargoWeight <= (truck.capacity ?? 0) && cargoWeight > 0;
}

/** Sözleşmenin toplam kargo ağırlığı (ton) */
export function getContractCargoWeight(contract: Contract, product?: Product): number {
  const resolved = product ?? PRODUCT_BY_ID[contract.productId];
  if (!resolved) return contract.amount ?? 0;
  return calculateCargoWeight(contract, resolved);
}

/** Boşta kamyonlar arasındaki en yüksek kapasite (ton) */
export function getMaxIdleTruckCapacity(trucks: Truck[] | undefined): number {
  const idle = (trucks ?? []).filter((truck) => truck.status === 'idle');
  if (idle.length === 0) return 0;
  return Math.max(...idle.map((truck) => truck.capacity ?? 0));
}

/**
 * İşi taşıyabilen boşta kamyonlar içinden en küçük uygun kamyonu seçer.
 * Gereksiz yere büyük kamyonu küçük işe göndermemek için kapasiteye göre sıralanır.
 */
export function selectIdleTruckForContract(
  trucks: Truck[] | undefined,
  contract: Contract,
  product?: Product,
): Truck | undefined {
  const resolved = product ?? PRODUCT_BY_ID[contract.productId];
  if (!resolved) return undefined;

  return (trucks ?? [])
    .filter(
      (truck) => truck.status === 'idle' && canTruckCarryContract(truck, contract, resolved),
    )
    .sort((a, b) => (a.capacity ?? 0) - (b.capacity ?? 0))[0];
}

export function formatCapacityExceededMessage(
  cargoWeight: number,
  maxIdleTruckCapacity: number,
): string {
  return (
    `Bu iş için ${cargoWeight.toFixed(1)} ton kapasite gerekiyor. ` +
    `Boşta en yüksek kamyon kapasiten ${maxIdleTruckCapacity.toFixed(1)} ton. ` +
    `Daha büyük kamyon satın al veya daha düşük tonajlı bir iş seç.`
  );
}

/** Yük doluluk çarpanı — ağır yük yakıt ve aşınmayı artırır */
export function calculateLoadWeightMultiplier(cargoWeight: number, truckCapacity: number): number {
  const safeCapacity = Math.max(truckCapacity, 1);
  return 1 + (cargoWeight / safeCapacity) * 0.25;
}

// ---------------------------------------------------------------------------
// Hız ve süre
// ---------------------------------------------------------------------------

/** Rota zorluğu hız çarpanı — yüksek zorluk = daha yavaş */
export function calculateRouteSpeedMultiplier(route: Route): number {
  return clamp(1 - route.difficulty * 0.3, 0.55, 1);
}

/**
 * Şoför hız çarpanı.
 * Pozitif speed hızlandırır, negatif yavaşlatır.
 */
export function calculateDriverSpeedMultiplier(driver: Driver): number {
  return clamp(1 + (driver.speed / 100) * DRIVER_SPEED_EFFECT, 0.65, 1.4);
}

/** Kamyon kondisyonu hız çarpanı — düşük kondisyon yavaşlatır */
export function calculateConditionSpeedMultiplier(truck: Truck): number {
  return clamp(0.5 + (truck.condition / 100) * 0.5, 0.45, 1);
}

/** Ortalama seyahat hızını hesaplar (km/saat) */
export function calculateAverageSpeed(truck: Truck, driver: Driver, route: Route): number {
  const routeMultiplier = calculateRouteSpeedMultiplier(route);
  const driverMultiplier = calculateDriverSpeedMultiplier(driver);
  const conditionMultiplier = calculateConditionSpeedMultiplier(truck);

  return Math.max(15, truck.speed * routeMultiplier * driverMultiplier * conditionMultiplier);
}

/** Toplam seyahat süresini hesaplar (saat) */
export function calculateTravelHours(
  contract: Contract,
  truck: Truck,
  driver: Driver,
  route: Route,
  _product: Product,
): number {
  const averageSpeed = calculateAverageSpeed(truck, driver, route);
  return contract.distanceKm / averageSpeed;
}

// ---------------------------------------------------------------------------
// Yakıt ve maliyet
// ---------------------------------------------------------------------------

/** Rota zorluğu yakıt çarpanı */
export function calculateRouteFuelMultiplier(route: Route): number {
  return 1 + route.difficulty * 0.45;
}

/** Şoför yakıt tasarrufu çarpanı — yüksek fuelSaving = daha az yakıt */
export function calculateDriverFuelSkillMultiplier(driver: Driver): number {
  return clamp(1 - driver.fuelSaving / 100, 0.35, 1);
}

/** Toplam yakıt tüketimini hesaplar (litre) */
export function calculateFuelUsed(
  contract: Contract,
  truck: Truck,
  driver: Driver,
  route: Route,
  product: Product,
): number {
  const cargoWeight = calculateCargoWeight(contract, product);
  const loadMultiplier = calculateLoadWeightMultiplier(cargoWeight, truck.capacity);
  const driverFuelMultiplier = calculateDriverFuelSkillMultiplier(driver);
  const routeFuelMultiplier = calculateRouteFuelMultiplier(route);

  return (
    contract.distanceKm *
    truck.fuelConsumptionPerKm *
    loadMultiplier *
    driverFuelMultiplier *
    routeFuelMultiplier
  );
}

/** Yakıt maliyetini hesaplar ($) */
export function calculateFuelCost(
  contract: Contract,
  truck: Truck,
  driver: Driver,
  route: Route,
  product: Product,
  globalEconomy: GlobalEconomy,
): number {
  const fuelUsed = calculateFuelUsed(contract, truck, driver, route, product);
  return fuelUsed * globalEconomy.fuelPrice;
}

/** Bakım maliyetini hesaplar ($) */
export function calculateMaintenanceCost(truck: Truck, route: Route): number {
  return truck.maintenanceCost * route.distanceKm;
}

// ---------------------------------------------------------------------------
// Kondisyon kaybı ve risk
// ---------------------------------------------------------------------------

/** Düşük dikkat → ek aşınma çarpanı */
export function calculateDriverAttentionWearMultiplier(driver: Driver): number {
  return 1 + ((100 - driver.attention) / 100) * DRIVER_ATTENTION_WEAR_MAX;
}

/** Teslimat kayıtlarında eksik conditionLoss için güvenli fallback */
export function resolveDeliveryConditionLoss(delivery: Delivery): number {
  const loss = delivery.conditionLoss;
  if (typeof loss === 'number' && loss > 0) {
    return loss;
  }
  return truckBalance.conditionLossFallback;
}

/** Seyahat sonrası kondisyon kaybını hesaplar */
export function calculateConditionLoss(
  contract: Contract,
  truck: Truck,
  driver: Driver,
  route: Route,
  product: Product,
): number {
  const cargoWeight = calculateCargoWeight(contract, product);
  const safeCapacity = Math.max(truck.capacity, 1);
  const loadRatio = cargoWeight / safeCapacity;

  const distanceFactor = contract.distanceKm / 500;
  const loadFactor = 1 + loadRatio * 0.35;
  const routeFactor = route.difficulty || 1;
  const driverAttentionFactor = 1 + ((100 - driver.attention) / 100) * 0.25;

  const rawLoss =
    truckBalance.baseConditionWear * distanceFactor * loadFactor * routeFactor * driverAttentionFactor;

  const isHeavyLoad = loadRatio >= truckBalance.heavyLoadRatio;
  const isHardRoute = route.difficulty >= truckBalance.hardRouteDifficulty;
  const maxLoss =
    isHeavyLoad || isHardRoute
      ? truckBalance.maxHardConditionLoss
      : truckBalance.maxNormalConditionLoss;

  return clamp(rawLoss, 1, maxLoss);
}

/** Kamyon tamir maliyetini hesaplar ($) — condition 100 ise 0 döner */
export function calculateTruckRepairCost(truck: Truck): number {
  const condition = truck.condition ?? 100;
  if (condition >= 100) {
    return 0;
  }

  const missingCondition = 100 - condition;
  const maintenanceCost = truck.maintenanceCost ?? 0;

  let repairCost: number;
  if (maintenanceCost >= 5) {
    repairCost = missingCondition * maintenanceCost;
  } else if (maintenanceCost > 0) {
    repairCost = missingCondition * truckBalance.repairFallbackCostPerCondition;
  } else {
    repairCost = missingCondition * truckBalance.repairFallbackCostPerConditionAlt;
  }

  return Math.max(truckBalance.minRepairCost, Math.round(repairCost));
}

/** Arıza olasılığını hesaplar (0–1) */
export function calculateBreakdownChance(
  contract: Contract,
  truck: Truck,
  driver: Driver,
  route: Route,
  product: Product,
): number {
  const cargoWeight = calculateCargoWeight(contract, product);
  const loadRatio = cargoWeight / Math.max(truck.capacity, 1);

  const baseChance = 0.02;
  const conditionRisk = ((100 - truck.condition) / 100) * 0.18;
  const reliabilityRisk = ((100 - truck.reliability) / 100) * 0.12;
  const routeRisk = route.difficulty * 0.1;
  const loadRisk = loadRatio * 0.06;
  const driverAttentionRisk = ((100 - driver.attention) / 100) * 0.1;

  return clamp(
    baseChance + conditionRisk + reliabilityRisk + routeRisk + loadRisk + driverAttentionRisk,
    0,
    MAX_RISK_CHANCE,
  );
}

/** Kaza olasılığını hesaplar (0–1) */
export function calculateAccidentChance(
  contract: Contract,
  truck: Truck,
  driver: Driver,
  route: Route,
  product: Product,
): number {
  const baseChance = 0.01;
  const driverSpeedRisk = Math.max(0, driver.speed / 100) * 0.12;
  const driverAttentionRisk = ((100 - driver.attention) / 100) * 0.14;
  const routeRisk = route.difficulty * 0.11;
  const conditionRisk = ((100 - truck.condition) / 100) * 0.08;

  // Ağır yük manevra kabiliyetini düşürür
  const cargoWeight = calculateCargoWeight(contract, product);
  const loadRatio = cargoWeight / Math.max(truck.capacity, 1);
  const loadRisk = loadRatio * 0.04;

  return clamp(
    baseChance + driverSpeedRisk + driverAttentionRisk + routeRisk + conditionRisk + loadRisk,
    0,
    MAX_RISK_CHANCE,
  );
}

// ---------------------------------------------------------------------------
// Ceza ve kâr
// ---------------------------------------------------------------------------

/**
 * Geç teslim cezasını hesaplar ($).
 * Bozulabilir ürünlerde ceza daha yüksektir.
 */
export function calculateLatePenalty(
  contract: Contract,
  estimatedTravelHours: number,
  actualTravelHours: number,
  product: Product,
): number {
  const deadlineHours = contract.deadlineHours;
  const hoursLate = Math.max(0, actualTravelHours - deadlineHours);

  if (hoursLate <= 0) {
    return 0;
  }

  const latenessRatio = hoursLate / Math.max(deadlineHours, 1);
  const perishabilityFactor = 0.25 + product.perishability * 0.55;

  return contract.payment * latenessRatio * perishabilityFactor;
}

/** Teslimat çok geç mi? — kritik eşik aşılırsa failed sayılır */
export function isCriticallyLate(
  contract: Contract,
  actualTravelHours: number,
): boolean {
  return actualTravelHours > contract.deadlineHours * CRITICAL_LATE_MULTIPLIER;
}

/** Net teslimat kârını hesaplar ($) */
export function calculateDeliveryProfit(
  contract: Contract,
  fuelCost: number,
  maintenanceCost: number,
  penaltyCost: number,
): number {
  return contract.payment - fuelCost - maintenanceCost - penaltyCost;
}

// ---------------------------------------------------------------------------
// Teslimat oluşturma ve ilerleme
// ---------------------------------------------------------------------------

export interface CreateDeliveryParams {
  contract: Contract;
  truck: Truck;
  driver: Driver;
  route: Route;
  product: Product;
  globalEconomy: GlobalEconomy;
  currentTime: number;
  sequence?: number;
}

/**
 * Yeni teslimat görevi oluşturur.
 * Kapasite yetersizse DeliveryError fırlatır.
 */
export function createDelivery(params: CreateDeliveryParams): Delivery {
  const {
    contract,
    truck,
    driver,
    route,
    product,
    globalEconomy,
    currentTime,
    sequence = Math.floor(randomBetween(1, 999_999)),
  } = params;

  if (!canTruckCarryContract(truck, contract, product)) {
    const cargoWeight = calculateCargoWeight(contract, product);
    throw new DeliveryError(
      `Kamyon "${truck.name}" bu yükü taşıyamaz: ${cargoWeight.toFixed(1)} ton / ${truck.capacity} ton kapasite`,
      'capacity_exceeded',
    );
  }

  const travelHours = calculateTravelHours(contract, truck, driver, route, product);
  const fuelCost = calculateFuelCost(contract, truck, driver, route, product, globalEconomy);
  const maintenanceCost = calculateMaintenanceCost(truck, route);
  const conditionLoss = calculateConditionLoss(contract, truck, driver, route, product);
  const breakdownChance = calculateBreakdownChance(contract, truck, driver, route, product);
  const accidentChance = calculateAccidentChance(contract, truck, driver, route, product);

  const estimatedProfit = calculateDeliveryProfit(contract, fuelCost, maintenanceCost, 0);
  const estimatedArrivalTime = currentTime + travelHours;
  const deadlineTime = currentTime + contract.deadlineHours;

  return {
    id: createDeliveryId(contract.id, currentTime, sequence),
    contractId: contract.id,
    truckId: truck.id,
    driverId: driver.id,
    originCityId: contract.originCityId,
    destinationCityId: contract.destinationCityId,
    productId: contract.productId,
    amount: contract.amount,
    distanceKm: contract.distanceKm,
    progress: 0,
    status: 'on_route',
    startedAt: currentTime,
    estimatedArrivalTime,
    deadlineTime,
    fuelCost,
    maintenanceCost,
    estimatedProfit,
    travelHours,
    breakdownChance,
    accidentChance,
    conditionLoss,
  };
}

/**
 * Geçen süreye göre teslimat ilerlemesini günceller.
 * progress 1'e ulaştığında completeDelivery çağrılmaya hazırdır.
 */
export function updateDeliveryProgress(delivery: Delivery, hoursPassed: number): Delivery {
  if (delivery.status !== 'on_route' && delivery.status !== 'preparing') {
    return delivery;
  }

  const safeTravelHours = Math.max(delivery.travelHours, 0.1);
  const progressDelta = hoursPassed / safeTravelHours;
  const newProgress = clamp(delivery.progress + progressDelta, 0, 1);

  return {
    ...delivery,
    progress: newProgress,
  };
}

// ---------------------------------------------------------------------------
// GameState güncellemeleri
// ---------------------------------------------------------------------------

/** Dizi içinde id ile eşleşen öğeyi immutable günceller */
function updateById<T extends { id: string }>(
  items: T[],
  id: string,
  updater: (item: T) => T,
): T[] {
  return items.map((item) => (item.id === id ? updater(item) : item));
}

/** Şehir stoklarını teslimat miktarına göre günceller */
export function applyDeliveryStockChange(
  cities: Record<string, SimulationGameState['cities'][string]>,
  delivery: Delivery,
): Record<string, SimulationGameState['cities'][string]> {
  const { originCityId, destinationCityId, productId, amount } = delivery;

  const originCity = cities[originCityId];
  const destinationCity = cities[destinationCityId];

  if (!originCity || !destinationCity) {
    return cities;
  }

  const originProduct = originCity.products[productId];
  const destinationProduct = destinationCity.products[productId];

  return {
    ...cities,
    [originCityId]: {
      ...originCity,
      products: {
        ...originCity.products,
        [productId]: {
          ...originProduct,
          stock: Math.max(0, originProduct.stock - amount),
        },
      },
    },
    [destinationCityId]: {
      ...destinationCity,
      products: {
        ...destinationCity.products,
        [productId]: {
          ...destinationProduct,
          stock: destinationProduct.stock + amount,
        },
      },
    },
  };
}

/**
 * Teslimatı tamamlar; yeni GameState döndürür.
 * Geç teslimde ceza uygulanır; kritik gecikmede otomatik fail.
 */
export function completeDelivery(gameState: SimulationGameState, deliveryId: string): SimulationGameState {
  const delivery = gameState.deliveries.find((d) => d.id === deliveryId);

  if (!delivery) {
    throw new Error(`Teslimat bulunamadı: ${deliveryId}`);
  }

  if (delivery.status === 'completed' || delivery.status === 'failed') {
    return gameState;
  }

  if (delivery.progress < 1) {
    throw new Error(`Teslimat henüz tamamlanmadı: progress=${delivery.progress}`);
  }

  const contract = gameState.contracts.find((c) => c.id === delivery.contractId);
  if (!contract) {
    throw new Error(`Sözleşme bulunamadı: ${delivery.contractId}`);
  }

  const completionTime = gameState.currentTime;
  const actualTravelHours = completionTime - delivery.startedAt;

  if (isCriticallyLate(contract, actualTravelHours)) {
    return failDelivery(gameState, deliveryId, 'too_late');
  }

  const product = PRODUCT_BY_ID[delivery.productId];

  const penaltyCost = calculateLatePenalty(
    contract,
    delivery.travelHours,
    actualTravelHours,
    product,
  );

  const netProfit = calculateDeliveryProfit(
    contract,
    delivery.fuelCost,
    delivery.maintenanceCost,
    penaltyCost,
  );

  const updatedDeliveries = updateById(gameState.deliveries, deliveryId, (d) => ({
    ...d,
    status: 'completed' as const,
    progress: 1,
  }));

  const updatedContracts = updateById(gameState.contracts, contract.id, (c) => ({
    ...c,
    status: 'completed' as const,
  }));

  const conditionLoss = resolveDeliveryConditionLoss(delivery);

  const updatedTrucks = updateById(gameState.trucks, delivery.truckId, (truck) => ({
    ...truck,
    status: 'idle' as const,
    condition: clamp((truck.condition ?? 100) - conditionLoss, 0, 100),
    currentCityId: delivery.destinationCityId,
  }));

  const updatedDrivers = updateById(gameState.drivers, delivery.driverId, (driver) => ({
    ...driver,
    status: 'idle' as const,
  }));

  const updatedCities = applyDeliveryStockChange(gameState.cities, delivery);

  return {
    ...gameState,
    player: {
      ...gameState.player,
      money: gameState.player.money + netProfit,
    },
    deliveries: updatedDeliveries,
    contracts: updatedContracts,
    trucks: updatedTrucks,
    drivers: updatedDrivers,
    cities: updatedCities,
  };
}

/**
 * Teslimatı başarısız sayar; ceza uygular ve filoyu serbest bırakır.
 */
export function failDelivery(
  gameState: SimulationGameState,
  deliveryId: string,
  reason: DeliveryFailureReason,
): SimulationGameState {
  const delivery = gameState.deliveries.find((d) => d.id === deliveryId);

  if (!delivery) {
    throw new Error(`Teslimat bulunamadı: ${deliveryId}`);
  }

  if (delivery.status === 'completed' || delivery.status === 'failed') {
    return gameState;
  }

  const contract = gameState.contracts.find((c) => c.id === delivery.contractId);

  const penaltyAmount = contract
    ? contract.payment * FAILURE_PENALTY_RATIO + FAILURE_BASE_DAMAGE_COST
    : FAILURE_BASE_DAMAGE_COST;

  const updatedDeliveries = updateById(gameState.deliveries, deliveryId, (d) => ({
    ...d,
    status: 'failed' as const,
    failureReason: reason,
  }));

  const updatedContracts = contract
    ? updateById(gameState.contracts, contract.id, (c) => ({
        ...c,
        status: 'failed' as const,
      }))
    : gameState.contracts;

  const conditionLoss = resolveDeliveryConditionLoss(delivery);

  const updatedTrucks = updateById(gameState.trucks, delivery.truckId, (truck) => ({
    ...truck,
    status: 'idle' as const,
    condition: clamp((truck.condition ?? 100) - conditionLoss * 0.5, 0, 100),
    currentCityId: delivery.originCityId,
  }));

  const updatedDrivers = updateById(gameState.drivers, delivery.driverId, (driver) => ({
    ...driver,
    status: 'idle' as const,
  }));

  return {
    ...gameState,
    player: {
      ...gameState.player,
      money: gameState.player.money - penaltyAmount,
    },
    deliveries: updatedDeliveries,
    contracts: updatedContracts,
    trucks: updatedTrucks,
    drivers: updatedDrivers,
  };
}

// ---------------------------------------------------------------------------
// Örnek kullanım (yorum — çalıştırılmaz)
// ---------------------------------------------------------------------------

/*
import { PRODUCT_BY_ID } from '../data/products';
import { getRouteBetweenCities } from './contracts';
import { ROUTES } from '../data/routes';
import { DEFAULT_GLOBAL_ECONOMY } from './economy';
import {
  completeDelivery,
  createDelivery,
  failDelivery,
  updateDeliveryProgress,
} from './delivery';

const contract = gameState.contracts[0];
const truck = gameState.trucks[0];
const driver = gameState.drivers[0];
const route = getRouteBetweenCities(ROUTES, contract.originCityId, contract.destinationCityId)!;
const product = PRODUCT_BY_ID[contract.productId];

const delivery = createDelivery({
  contract,
  truck,
  driver,
  route,
  product,
  globalEconomy: DEFAULT_GLOBAL_ECONOMY,
  currentTime: gameState.currentTime,
});

let activeDelivery = delivery;
activeDelivery = updateDeliveryProgress(activeDelivery, 4);

if (activeDelivery.progress >= 1) {
  gameState = completeDelivery(
    { ...gameState, deliveries: [...gameState.deliveries, activeDelivery] },
    activeDelivery.id,
  );
}

// Arıza durumunda:
// gameState = failDelivery(gameState, delivery.id, 'breakdown');
*/
