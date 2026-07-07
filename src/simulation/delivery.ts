/**
 * LogistiCore - Teslimat simülasyon motoru
 *
 * Sözleşme kabul edildikten sonra kamyon/şoför ataması, yolculuk süresi,
 * yakıt maliyeti, risk hesapları ve teslimat tamamlama/başarısızlık akışını yönetir.
 */

import type {
  Contract,
  ContractAvailability,
  ContractAvailabilityReason,
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
import { getSafeFuelPrice } from './economy';
import { clamp, randomBetween, randomIntBetween } from '../utils/math';
import { getCityName, getProductByIdSafe } from '../utils/entityLookup';

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

export const DEFAULT_TRUCK_CITY_ID = 'izmir';

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

export { clamp, randomBetween, randomIntBetween } from '../utils/math';

/** Benzersiz teslimat kimliği üretir */
export function createDeliveryId(contractId: string, startedAt: number, sequence: number): string {
  return `delivery_${contractId}_${Math.floor(startedAt)}_${sequence}`;
}

/** Kamyon kondisyonu bu eşiğin altındaysa teslimat başlatılamaz */
const MIN_TRUCK_CONDITION_FOR_DELIVERY = 30;

/**
 * Sözleşmenin kamyon kapasitesi için geçerli yük ağırlığı (ton).
 * Tek kaynak: contract.cargoWeight
 */
export function getContractCargoWeight(contract: Contract, product?: Product): number {
  if (contract.cargoWeight != null && contract.cargoWeight > 0) {
    return contract.cargoWeight;
  }

  // Eski kayıtlar: amount zaten ton cinsinden tutuluyordu
  if (contract.amount != null && contract.amount > 0) {
    return contract.amount;
  }

  const resolved = product ?? getProductByIdSafe(contract.productId);
  return resolved?.weightPerUnit ?? 0;
}

/**
 * Taşınan kargo ağırlığını döndürür (ton).
 * @deprecated getContractCargoWeight kullanın — aynı değeri döndürür.
 */
export function calculateCargoWeight(contract: Contract, product?: Product): number {
  return getContractCargoWeight(contract, product);
}

/** Kamyon sözleşme yükünü taşıyabilir mi? */
// TODO: Add multi-truck or multi-trip contracts for cargoWeight greater than truck capacity.
export function canTruckCarryContract(truck: Truck, contract: Contract, product?: Product): boolean {
  const cargoWeight = getContractCargoWeight(contract, product);
  return cargoWeight <= (truck.capacity ?? 0) && cargoWeight > 0;
}

/** Kamyon teslimat için boşta mı? */
export function isTruckLeaseActive(truck: Truck, currentTime: number): boolean {
  if (truck.leaseExpired) {
    return false;
  }
  if ((truck.ownershipType ?? 'owned') !== 'leased') {
    return true;
  }
  if (truck.leaseExpiresAt == null) {
    return true;
  }
  if (truck.status === 'on_route' || truck.status === 'transferring') {
    return true;
  }
  return truck.leaseExpiresAt > currentTime;
}

export function isTruckIdle(truck: Truck): boolean {
  return truck.status === 'idle' && !truck.leaseExpired;
}

/** Kamyon görev atanabilir mi? */
export function isTruckAvailableForAssignment(truck: Truck, currentTime: number): boolean {
  return isTruckIdle(truck) && isTruckLeaseActive(truck, currentTime);
}

/** Kamyon boş transferde mi? */
export function isTruckTransferring(truck: Truck): boolean {
  return truck.status === 'transferring';
}

/** Şoför görev için boşta mı? */
export function isDriverIdle(driver: Driver): boolean {
  return driver.status === 'idle';
}

export function resolveTruckCityId(truck: Truck, fallbackHomeCityId?: string): string {
  return truck.currentCityId ?? truck.homeCityId ?? fallbackHomeCityId ?? DEFAULT_TRUCK_CITY_ID;
}

export function normalizeTruckCity(truck: Truck, fallbackHomeCityId?: string): Truck {
  const currentCityId = resolveTruckCityId(truck, fallbackHomeCityId);
  return {
    ...truck,
    currentCityId,
    homeCityId: truck.homeCityId ?? fallbackHomeCityId ?? currentCityId,
    ownershipType: truck.ownershipType ?? 'owned',
    purchasePrice: truck.purchasePrice ?? 45_000,
    leaseExpiresAt: truck.leaseExpiresAt ?? null,
    leaseExpired: truck.leaseExpired ?? false,
  };
}

export function getIdleTruckOriginCityIds(
  trucks: Truck[] | undefined,
  fallbackHomeCityId?: string,
): string[] {
  const cities = new Set<string>();
  for (const truck of getIdleTrucks(trucks)) {
    cities.add(resolveTruckCityId(truck, fallbackHomeCityId));
  }
  return [...cities];
}

export function getTrucksAtOrigin(
  trucks: Truck[] | undefined,
  originCityId: string | undefined,
  fallbackHomeCityId?: string,
): Truck[] {
  if (!originCityId) {
    return [];
  }
  return (trucks ?? []).filter(
    (truck) => resolveTruckCityId(truck, fallbackHomeCityId) === originCityId,
  );
}

export function getIdleTrucksAtOrigin(
  trucks: Truck[] | undefined,
  originCityId: string | undefined,
  fallbackHomeCityId?: string,
): Truck[] {
  return getTrucksAtOrigin(trucks, originCityId, fallbackHomeCityId).filter(isTruckIdle);
}

export function hasTruckAtOrigin(
  trucks: Truck[] | undefined,
  originCityId: string | undefined,
  fallbackHomeCityId?: string,
): boolean {
  return getTrucksAtOrigin(trucks, originCityId, fallbackHomeCityId).length > 0;
}

export function hasIdleTruckAtOrigin(
  trucks: Truck[] | undefined,
  originCityId: string | undefined,
  fallbackHomeCityId?: string,
): boolean {
  return getIdleTrucksAtOrigin(trucks, originCityId, fallbackHomeCityId).length > 0;
}

export function isTruckAtContractOrigin(
  truck: Truck,
  contract: Pick<Contract, 'originCityId'>,
  fallbackHomeCityId?: string,
): boolean {
  if (!contract.originCityId) return false;
  return resolveTruckCityId(truck, fallbackHomeCityId) === contract.originCityId;
}

export function getIdleTrucks(trucks: Truck[] | undefined): Truck[] {
  return (trucks ?? []).filter(isTruckIdle);
}

export function getIdleDrivers(drivers: Driver[] | undefined): Driver[] {
  return (drivers ?? []).filter(isDriverIdle);
}

/** Boşta kamyonlar arasındaki en yüksek kapasite (ton) */
export function getMaxIdleTruckCapacity(trucks: Truck[] | undefined): number {
  const idle = getIdleTrucks(trucks);
  if (idle.length === 0) return 0;
  return Math.max(...idle.map((truck) => truck.capacity ?? 0));
}

/** Oyuncunun sahip olduğu en yüksek kamyon kapasitesi (ton) */
export function getHighestOwnedTruckCapacity(trucks: Truck[] | undefined): number {
  return (trucks ?? []).reduce((max, truck) => Math.max(max, truck.capacity ?? 0), 0);
}

/**
 * İşi taşıyabilen boşta kamyonlar içinden en küçük uygun kamyonu seçer.
 * Gereksiz yere büyük kamyonu küçük işe göndermemek için kapasiteye göre sıralanır.
 */
export function selectIdleTruckForContract(
  trucks: Truck[] | undefined,
  contract: Contract,
  product?: Product,
  currentTime = 0,
): Truck | undefined {
  const resolved = product ?? getProductByIdSafe(contract.productId);
  if (!resolved) return undefined;

  return (trucks ?? [])
    .filter(
      (truck) =>
        isTruckAvailableForAssignment(truck, currentTime) &&
        isTruckAtContractOrigin(truck, contract) &&
        canTruckCarryContract(truck, contract, resolved),
    )
    .sort((a, b) => (a.capacity ?? 0) - (b.capacity ?? 0))[0];
}

export function getContractAvailability(
  contract: Contract,
  trucks: Truck[] | undefined,
  drivers: Driver[] | undefined,
  playerLevel: number = 1,
): ContractAvailability {
  const safePlayerLevel = Math.max(1, playerLevel);
  const requiredLevel = contract.requiredLevel ?? 1;
  const truckList = trucks ?? [];
  const driverList = drivers ?? [];
  const product = getProductByIdSafe(contract.productId);
  const requiredCapacity = getContractCargoWeight(contract, product ?? undefined);
  const idleTrucks = getIdleTrucks(truckList);
  const idleDrivers = getIdleDrivers(driverList);
  const maxIdleTruckCapacity =
    idleTrucks.length > 0 ? Math.max(...idleTrucks.map((truck) => truck.capacity ?? 0)) : 0;

  if (requiredLevel > safePlayerLevel) {
    return {
      canStart: false,
      reason: 'LEVEL_INSUFFICIENT',
      buttonLabel: `Level ${requiredLevel} Gerekli`,
      title: 'Seviye yetersiz',
      message: `Bu sözleşme için şirket seviyen Level ${requiredLevel} olmalı.`,
      requiredLevel,
      playerLevel: safePlayerLevel,
      requiredCapacity,
    };
  }

  if (truckList.length === 0) {
    return {
      canStart: false,
      reason: 'NO_TRUCKS',
      buttonLabel: 'Kamyon yok',
      title: 'Kamyon yok',
      message: 'Bu işi almak için önce bir kamyon satın almalısın.',
      requiredCapacity,
    };
  }

  if (idleTrucks.length === 0) {
    return {
      canStart: false,
      reason: 'NO_IDLE_TRUCKS',
      buttonLabel: 'Müsait kamyon yok',
      title: 'Müsait kamyon yok',
      message:
        'Bu işi almak için şu anda uygun boştaki kamyonun yok. Mevcut teslimatların bitmesini bekleyebilir veya yeni kamyon satın alabilirsin.',
      requiredCapacity,
    };
  }

  if (driverList.length === 0) {
    return {
      canStart: false,
      reason: 'NO_DRIVERS',
      buttonLabel: 'Şoför Yok',
      title: 'Şoför yok',
      message: 'Bu işi almak için önce bir şoför işe almalısın.',
      maxIdleTruckCapacity,
      requiredCapacity,
    };
  }

  if (idleDrivers.length === 0) {
    return {
      canStart: false,
      reason: 'NO_IDLE_DRIVERS',
      buttonLabel: 'Müsait Şoför Yok',
      title: 'Müsait şoför yok',
      message:
        'Tüm şoförlerin şu anda görevde. Yeni bir şoför işe alabilir veya mevcut teslimatın bitmesini bekleyebilirsin.',
      maxIdleTruckCapacity,
      requiredCapacity,
    };
  }

  const originCityId = contract.originCityId;
  if (!originCityId) {
    return {
      canStart: false,
      reason: 'INVALID_ORIGIN_CITY',
      buttonLabel: 'Geçersiz çıkış',
      title: 'Geçersiz sözleşme',
      message: 'Bu sözleşmenin çıkış şehri tanımlı değil.',
      maxIdleTruckCapacity,
      requiredCapacity,
    };
  }

  const fromCityName = getCityName(originCityId) || 'bu şehir';
  const trucksAtOrigin = getTrucksAtOrigin(truckList, originCityId);
  const idleTrucksAtOrigin = getIdleTrucksAtOrigin(truckList, originCityId);
  const maxIdleTruckCapacityAtOrigin =
    idleTrucksAtOrigin.length > 0
      ? Math.max(...idleTrucksAtOrigin.map((truck) => truck.capacity ?? 0))
      : 0;

  if (trucksAtOrigin.length === 0) {
    return {
      canStart: false,
      reason: 'NO_TRUCK_IN_ORIGIN_CITY',
      buttonLabel: 'Şehirde kamyon yok',
      title: 'Şehirde kamyon yok',
      message:
        `Bu iş ${fromCityName} çıkışlı. Bu şehirde kamyonun yok. ` +
        'Bu işi alabilmek için kamyonunu bu şehre taşımalı veya bu şehirden çıkan başka uygun bir iş beklemelisin.',
      maxIdleTruckCapacity: maxIdleTruckCapacityAtOrigin,
      requiredCapacity,
    };
  }

  if (idleTrucksAtOrigin.length === 0) {
    return {
      canStart: false,
      reason: 'NO_IDLE_TRUCK_IN_ORIGIN_CITY',
      buttonLabel: 'Şehirde müsait kamyon yok',
      title: 'Şehirde müsait kamyon yok',
      message:
        `Bu iş ${fromCityName} çıkışlı. Bu şehirde kamyonun var ancak şu anda müsait değil. ` +
        'Mevcut teslimatın bitmesini bekleyebilir veya bu şehir için yeni bir kamyon ayırabilirsin.',
      maxIdleTruckCapacity: maxIdleTruckCapacityAtOrigin,
      requiredCapacity,
    };
  }

  const fittingTruck = selectIdleTruckForContract(truckList, contract, product ?? undefined);
  if (!fittingTruck) {
    return {
      canStart: false,
      reason: 'CAPACITY_INSUFFICIENT',
      buttonLabel: 'Kapasite yetersiz',
      title: 'Kapasite yetersiz',
      message:
        `Bu iş için ${requiredCapacity.toFixed(1)} ton kapasite gerekiyor. ` +
        `${fromCityName} şehrindeki müsait kamyonların en yüksek kapasitesi ${maxIdleTruckCapacityAtOrigin.toFixed(1)} ton.`,
      maxIdleTruckCapacity: maxIdleTruckCapacityAtOrigin,
      requiredCapacity,
    };
  }

  const capacityFittingTrucksAtOrigin = idleTrucksAtOrigin.filter((truck) =>
    canTruckCarryContract(truck, contract, product ?? undefined),
  );
  const healthyTruck = capacityFittingTrucksAtOrigin.find(
    (truck) => (truck.condition ?? 100) >= MIN_TRUCK_CONDITION_FOR_DELIVERY,
  );

  if (!healthyTruck) {
    const bestCondition = Math.max(
      ...capacityFittingTrucksAtOrigin.map((truck) => truck.condition ?? 0),
      0,
    );
    return {
      canStart: false,
      reason: 'TRUCK_CONDITION_TOO_LOW',
      buttonLabel: 'Kondisyon düşük',
      title: 'Kondisyon düşük',
      message:
        `Bu iş için kamyon kondisyonunun en az %${MIN_TRUCK_CONDITION_FOR_DELIVERY} olması gerekir. ` +
        `${fromCityName} şehrindeki en iyi müsait kamyon: %${Math.round(bestCondition)}.`,
      maxIdleTruckCapacity: maxIdleTruckCapacityAtOrigin,
      requiredCapacity,
    };
  }

  return {
    canStart: true,
    reason: 'OK',
    buttonLabel: 'Ekibi Seç',
    maxIdleTruckCapacity: maxIdleTruckCapacityAtOrigin,
    requiredCapacity,
  };
}

export function getContractAvailabilityWarningText(
  availability: ContractAvailability,
): string | null {
  switch (availability.reason) {
    case 'LEVEL_INSUFFICIENT':
      return null;
    case 'NO_TRUCKS':
    case 'NO_IDLE_TRUCKS':
      return availability.reason === 'NO_IDLE_TRUCKS' ? 'Müsait kamyon yok' : 'Kamyon yok';
    case 'INVALID_ORIGIN_CITY':
      return 'Geçersiz çıkış şehri';
    case 'NO_TRUCK_IN_ORIGIN_CITY':
      return 'Şehirde kamyon yok';
    case 'NO_IDLE_TRUCK_IN_ORIGIN_CITY':
      return 'Şehirde müsait kamyon yok';
    case 'NO_TRUCK_AT_ORIGIN':
      return 'Şehirde kamyon yok';
    case 'NO_DRIVERS':
      return 'Şoför yok';
    case 'NO_IDLE_DRIVERS':
      return 'Müsait şoför yok';
    case 'CAPACITY_INSUFFICIENT':
      return `${(availability.requiredCapacity ?? 0).toFixed(1)}t gerekli / en iyi kamyonun ${(availability.maxIdleTruckCapacity ?? 0).toFixed(1)}t`;
    case 'TRUCK_CONDITION_TOO_LOW':
      return 'Kamyon tamir gerekli';
    default:
      return null;
  }
}

export function availabilityReasonToStartDeliveryErrorCode(
  reason: ContractAvailabilityReason,
): import('../types/game').StartDeliveryErrorCode {
  switch (reason) {
    case 'LEVEL_INSUFFICIENT':
      return 'DELIVERY_CREATE_FAILED';
    case 'NO_TRUCKS':
      return 'TRUCK_NOT_FOUND';
    case 'NO_IDLE_TRUCKS':
      return 'TRUCK_BUSY';
    case 'NO_DRIVERS':
      return 'DRIVER_NOT_FOUND';
    case 'NO_IDLE_DRIVERS':
      return 'DRIVER_BUSY';
    case 'INVALID_ORIGIN_CITY':
    case 'NO_TRUCK_IN_ORIGIN_CITY':
    case 'NO_IDLE_TRUCK_IN_ORIGIN_CITY':
    case 'NO_TRUCK_AT_ORIGIN':
      return 'NO_TRUCK_AT_ORIGIN';
    case 'CAPACITY_INSUFFICIENT':
      return 'CAPACITY_INSUFFICIENT';
    case 'TRUCK_CONDITION_TOO_LOW':
      return 'TRUCK_CONDITION_TOO_LOW';
    default:
      return 'DELIVERY_CREATE_FAILED';
  }
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
  return fuelUsed * getSafeFuelPrice(globalEconomy);
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
  const payment = contract.payment ?? 0;
  return payment - (fuelCost ?? 0) - (maintenanceCost ?? 0) - (penaltyCost ?? 0);
}

export interface DeliverySettlementParams {
  contractPayment: number;
  fuelCost?: number;
  maintenanceCost?: number;
  penaltyCost?: number;
  /** Yakıt startDelivery'de peşin ödendiyse true — tamamlanınca tekrar düşülmez */
  fuelAlreadyPaid?: boolean;
}

export interface DeliverySettlementResult {
  grossRevenue: number;
  fuelCost: number;
  maintenanceCost: number;
  penaltyCost: number;
  totalCost: number;
  netProfit: number;
  cashDeltaOnCompletion: number;
}

/** Debug — son teslimat para mutabakatı */
export interface DeliverySettlementDebugSnapshot {
  phase: 'start' | 'complete' | 'fail';
  cashBefore: number;
  cashAfter: number;
  fuelCost: number;
  contractPayment: number;
  maintenanceCost: number;
  penaltyCost: number;
  reportedNetProfit: number;
  cashDeltaOnCompletion: number;
}

function safeSettlementAmount(value: number | undefined | null): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Teslimat para mutabakatı — tek kaynak.
 * fuelAlreadyPaid true ise cashDeltaOnCompletion yakıtı tekrar düşmez.
 */
export function calculateDeliverySettlement(
  params: DeliverySettlementParams,
): DeliverySettlementResult {
  const grossRevenue = safeSettlementAmount(params.contractPayment);
  const fuelCost = safeSettlementAmount(params.fuelCost);
  const maintenanceCost = safeSettlementAmount(params.maintenanceCost);
  const penaltyCost = safeSettlementAmount(params.penaltyCost);
  const fuelAlreadyPaid = params.fuelAlreadyPaid ?? true;

  const totalCost = fuelCost + maintenanceCost + penaltyCost;
  const netProfit = grossRevenue - totalCost;
  const cashDeltaOnCompletion = fuelAlreadyPaid
    ? grossRevenue - maintenanceCost - penaltyCost
    : grossRevenue - totalCost;

  return {
    grossRevenue,
    fuelCost,
    maintenanceCost,
    penaltyCost,
    totalCost,
    netProfit,
    cashDeltaOnCompletion,
  };
}

/** Başarısız teslimat cezası ($) */
export function calculateFailurePenalty(contract: Contract | undefined): number {
  return contract
    ? (contract.payment ?? 0) * FAILURE_PENALTY_RATIO + FAILURE_BASE_DAMAGE_COST
    : FAILURE_BASE_DAMAGE_COST;
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
    sequence = randomIntBetween(1, 999_999),
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

/** Floating-point toleransı — progress bu eşiğin üstündeyse tamamlanmış sayılır */
export const DELIVERY_COMPLETE_PROGRESS_THRESHOLD = 0.999;

export function normalizeDeliveryProgress(progress: number | undefined | null): number {
  const n = Number(progress);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.min(1, Math.max(0, n));
}

export function isDeliveryProgressComplete(progress: number | undefined | null): boolean {
  return normalizeDeliveryProgress(progress) >= DELIVERY_COMPLETE_PROGRESS_THRESHOLD;
}

export type CompleteDeliveryErrorCode =
  | 'DELIVERY_NOT_FOUND'
  | 'DELIVERY_NOT_READY'
  | 'DELIVERY_ALREADY_COMPLETED'
  | 'DELIVERY_ALREADY_FAILED'
  | 'CONTRACT_NOT_FOUND'
  | 'SIMULATION_ERROR';

export interface CompleteDeliveryResult {
  success: boolean;
  errorCode?: CompleteDeliveryErrorCode;
  message?: string;
  updatedState?: SimulationGameState;
}

export interface DeliveryIntegrityStats {
  activeCount: number;
  invalidProgressCount: number;
  missingTruckCount: number;
  missingDriverCount: number;
  missingContractCount: number;
}

export function getDeliveryIntegrityStats(
  deliveries: Delivery[],
  options: {
    truckIds?: Set<string>;
    driverIds?: Set<string>;
    contractIds?: Set<string>;
  } = {},
): DeliveryIntegrityStats {
  const active = deliveries.filter((d) => d.status === 'on_route' || d.status === 'preparing');
  let invalidProgressCount = 0;
  let missingTruckCount = 0;
  let missingDriverCount = 0;
  let missingContractCount = 0;

  for (const delivery of active) {
    const raw = delivery.progress;
    const normalized = normalizeDeliveryProgress(raw);
    if (raw === undefined || !Number.isFinite(Number(raw)) || normalized < 0 || normalized > 1) {
      invalidProgressCount += 1;
    }
    if (options.truckIds && !options.truckIds.has(delivery.truckId)) {
      missingTruckCount += 1;
    }
    if (options.driverIds && !options.driverIds.has(delivery.driverId)) {
      missingDriverCount += 1;
    }
    if (options.contractIds && !options.contractIds.has(delivery.contractId)) {
      missingContractCount += 1;
    }
  }

  return {
    activeCount: active.length,
    invalidProgressCount,
    missingTruckCount,
    missingDriverCount,
    missingContractCount,
  };
}

/**
 * Teslimat tamamlamayı güvenli şekilde dener; asla throw etmez.
 */
export function safeCompleteDelivery(
  gameState: SimulationGameState,
  deliveryId: string,
): CompleteDeliveryResult {
  const delivery = gameState.deliveries.find((d) => d.id === deliveryId);

  if (!delivery) {
    console.warn('[delivery] complete skipped: delivery not found', deliveryId);
    return {
      success: false,
      errorCode: 'DELIVERY_NOT_FOUND',
      message: `Teslimat bulunamadı: ${deliveryId}`,
    };
  }

  if (delivery.status === 'completed') {
    return {
      success: false,
      errorCode: 'DELIVERY_ALREADY_COMPLETED',
      message: 'Teslimat zaten tamamlandı.',
    };
  }

  if (delivery.status === 'failed') {
    console.warn('[delivery] complete skipped: already failed', deliveryId);
    return {
      success: false,
      errorCode: 'DELIVERY_ALREADY_FAILED',
      message: 'Teslimat başarısız durumda.',
    };
  }

  if (!isDeliveryProgressComplete(delivery.progress)) {
    console.warn(
      '[delivery] complete skipped: delivery not ready',
      deliveryId,
      delivery.progress,
    );
    return {
      success: false,
      errorCode: 'DELIVERY_NOT_READY',
      message: `Teslimat henüz tamamlanmadı: progress=${delivery.progress}`,
    };
  }

  const contract = gameState.contracts.find((c) => c.id === delivery.contractId);
  if (!contract) {
    console.warn('[delivery] complete skipped: contract not found', delivery.contractId);
    return {
      success: false,
      errorCode: 'CONTRACT_NOT_FOUND',
      message: `Sözleşme bulunamadı: ${delivery.contractId}`,
    };
  }

  try {
    const updatedState = completeDelivery(gameState, deliveryId);
    return { success: true, updatedState };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Teslimat simülasyonu başarısız.';
    console.warn('[delivery] completeDeliverySim error', deliveryId, error);
    return {
      success: false,
      errorCode: 'SIMULATION_ERROR',
      message,
    };
  }
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

  if (!isDeliveryProgressComplete(delivery.progress)) {
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

  const product = getProductByIdSafe(delivery.productId);
  const penaltyCost = product
    ? calculateLatePenalty(
        contract,
        delivery.travelHours,
        actualTravelHours,
        product,
      )
    : 0;

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
import { DEFAULT_GLOBAL_ECONOMY, getSafeFuelPrice } from './economy';
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
