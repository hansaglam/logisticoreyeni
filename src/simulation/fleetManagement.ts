/**
 * Filo yönetimi — kamyon satışı ve şoför işten çıkarma yardımcıları.
 */

import { fleetManagementBalance, operatingCostBalance } from '../config/balance';
import { calculateCanonicalTruckResaleValue } from '../domain/truckResaleValuation';
import type {
  Delivery,
  DeliveryStatus,
  Driver,
  Player,
  Trailer,
  Truck,
  TruckTransfer,
} from '../types/game';

const ACTIVE_DELIVERY_STATUSES: DeliveryStatus[] = ['preparing', 'on_route', 'paused'];

export interface FleetManagementState {
  player: Pick<Player, 'trucks' | 'drivers' | 'money'>;
  activeDeliveries?: Delivery[];
  activeTransfers?: TruckTransfer[];
}

export interface TruckSellCheck {
  canSell: boolean;
  reason?: string;
  salePrice?: number;
}

export interface DriverFireCheck {
  canFire: boolean;
  reason?: string;
  severanceCost?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveTruckPurchasePrice(truck: Truck): number {
  if ((truck.purchasePrice ?? 0) > 0) {
    return truck.purchasePrice;
  }
  const extended = truck as Truck & { price?: number; estimatedValue?: number };
  return extended.price ?? extended.estimatedValue ?? 0;
}

function getConditionMultiplier(condition: number): number {
  const normalized = clamp(condition, 0, 100) / 100;
  return 0.35 + normalized * 0.65;
}

function countOwnedTrucks(trucks: Truck[] | undefined): number {
  return (trucks ?? []).filter(
    (truck) => (truck.ownershipType ?? 'owned') === 'owned' && !truck.leaseExpired,
  ).length;
}

function isTruckOnActiveDelivery(truckId: string, deliveries: Delivery[] | undefined): boolean {
  return (deliveries ?? []).some(
    (delivery) =>
      delivery.truckId === truckId && ACTIVE_DELIVERY_STATUSES.includes(delivery.status),
  );
}

function isTruckOnActiveTransfer(truckId: string, transfers: TruckTransfer[] | undefined): boolean {
  return (transfers ?? []).some(
    (transfer) =>
      transfer.truckId === truckId &&
      (transfer.status === 'active' || transfer.status === 'paused'),
  );
}

function isDriverOnActiveDelivery(driverId: string, deliveries: Delivery[] | undefined): boolean {
  return (deliveries ?? []).some(
    (delivery) =>
      delivery.driverId === driverId && ACTIVE_DELIVERY_STATUSES.includes(delivery.status),
  );
}

export interface TruckResaleValueInput {
  basePrice: number;
  condition: number;
  mileageKm?: number;
  /** Simulation saati veya 0-1 arası doğrudan kullanım oranı. */
  ageOrUsage?: number;
  upgradeValue?: number;
  rarity?: number;
  marketModifier?: number;
  isLeased?: boolean;
}

export interface TruckValueScore {
  capacityValue: number;
  speedValue: number;
  fuelEfficiencyValue: number;
  durabilityValue: number;
  specialCapabilityValue: number;
  valueScore: number;
  pricePerValuePoint: number;
}

function resolveTruckResaleInput(input: Truck | TruckResaleValueInput): TruckResaleValueInput {
  if ('basePrice' in input) {
    return input;
  }
  return {
    basePrice: resolveTruckPurchasePrice(input),
    condition: input.condition,
    mileageKm: input.totalMileageKm,
    upgradeValue: calculateTruckUpgradeInvestmentValue(input),
    isLeased: (input.ownershipType ?? 'owned') === 'leased',
  };
}

export function calculateTruckUpgradeInvestmentValue(truck: Truck): number {
  const levels = truck.upgrades ?? {
    engine: 0,
    fuelEfficiency: 0,
    cargo: 0,
    durability: 0,
  };
  const multipliers = {
    engine: 0.08,
    fuelEfficiency: 0.07,
    cargo: 0.09,
    durability: 0.06,
  } as const;
  let total = 0;
  for (const key of Object.keys(multipliers) as (keyof typeof multipliers)[]) {
    const level = clamp(Number(levels[key]) || 0, 0, 3);
    for (let tier = 0; tier < level; tier += 1) {
      total += truck.purchasePrice * multipliers[key] * (1 + tier * 0.75);
    }
  }
  return Math.round(total);
}

export function calculateTruckResaleValue(input: Truck | TruckResaleValueInput): number {
  const resale = resolveTruckResaleInput(input);
  return calculateCanonicalTruckResaleValue(resale, fleetManagementBalance);
}

export function calculateTrailerResaleValue(
  trailer: Pick<Trailer, 'purchasePrice' | 'condition' | 'createdAtGameTime' | 'isOwned'>,
  params: { currentGameTime?: number; marketModifier?: number } = {},
): number {
  if (!trailer.isOwned) return 0;
  const rawBasePrice = Number(trailer.purchasePrice);
  const basePrice = Number.isFinite(rawBasePrice) ? Math.max(0, rawBasePrice) : 0;
  if (basePrice <= 0) return 0;
  const ageHours = Math.max(
    0,
    (Number(params.currentGameTime) || trailer.createdAtGameTime) -
      trailer.createdAtGameTime,
  );
  const ageDepreciation = clamp(ageHours / (24 * 365 * 5), 0, 1) * 0.12;
  const market = clamp(
    Number(params.marketModifier) || 1,
    fleetManagementBalance.minMarketResaleModifier,
    fleetManagementBalance.maxMarketResaleModifier,
  );
  const raw =
    basePrice *
    fleetManagementBalance.trailerBaseResaleRate *
    getConditionMultiplier(trailer.condition) *
    (1 - ageDepreciation) *
    market;
  return Math.round(
    clamp(
      raw,
      basePrice * fleetManagementBalance.minTrailerResaleRate,
      basePrice * fleetManagementBalance.maxTrailerResaleRate,
    ),
  );
}

export function calculateTruckValueScore(
  truck: Pick<
    Truck,
    | 'capacity'
    | 'speed'
    | 'fuelConsumptionPerKm'
    | 'reliability'
    | 'purchasePrice'
    | 'catalogId'
    | 'id'
  >,
): TruckValueScore {
  const capacityValue = Math.max(0, truck.capacity) * 2.2;
  const speedValue = Math.max(0, truck.speed) * 0.8;
  const fuelEfficiencyValue = clamp(
    (0.5 - Math.max(0, truck.fuelConsumptionPerKm)) * 140,
    0,
    42,
  );
  const durabilityValue = clamp(truck.reliability, 0, 100) * 0.55;
  const catalogId = truck.catalogId ?? truck.id;
  const specialCapabilityValue =
    catalogId.includes('refrigerated') || catalogId.includes('cold')
      ? 40
      : catalogId.includes('heavy')
        ? 22
        : 0;
  const valueScore =
    Math.round(
      (capacityValue +
        speedValue +
        fuelEfficiencyValue +
        durabilityValue +
        specialCapabilityValue) *
        10,
    ) / 10;
  return {
    capacityValue,
    speedValue,
    fuelEfficiencyValue,
    durabilityValue,
    specialCapabilityValue,
    valueScore,
    pricePerValuePoint:
      valueScore > 0 ? Math.round(truck.purchasePrice / valueScore) : 0,
  };
}

export function canSellTruck(truckId: string, state: FleetManagementState): TruckSellCheck {
  const trucks = state.player.trucks ?? [];
  const truck = trucks.find((item) => item.id === truckId);
  if (!truck) {
    return { canSell: false, reason: 'Kamyon bulunamadı.' };
  }

  if ((truck.ownershipType ?? 'owned') === 'leased') {
    return { canSell: false, reason: 'Kiralık kamyonlar satılamaz.' };
  }

  if (countOwnedTrucks(trucks) <= 1) {
    return { canSell: false, reason: 'Son kamyonunu satamazsın.' };
  }

  if (
    truck.status === 'on_route' ||
    truck.status === 'transferring' ||
    truck.status === 'out_of_fuel' ||
    isTruckOnActiveDelivery(truckId, state.activeDeliveries) ||
    isTruckOnActiveTransfer(truckId, state.activeTransfers)
  ) {
    return { canSell: false, reason: 'Bu kamyon aktif teslimatta olduğu için satılamaz.' };
  }

  if (truck.status !== 'idle' && truck.status !== 'maintenance') {
    return { canSell: false, reason: 'Bu kamyon şu anda satılamaz.' };
  }

  const salePrice = calculateTruckResaleValue(truck);
  if (salePrice <= 0) {
    return { canSell: false, reason: 'Bu kamyon için satış değeri hesaplanamadı.' };
  }

  return { canSell: true, salePrice };
}

export function resolveDriverDailySalary(driver: Driver): number {
  return (
    driver.dailySalary ??
    driver.salaryPerDay ??
    operatingCostBalance.fallbackDriverDailySalary ??
    100
  );
}

export function calculateDriverSeveranceCost(driver: Driver): number {
  const dailySalary = resolveDriverDailySalary(driver);
  return Math.round(dailySalary * fleetManagementBalance.driverSeveranceDays);
}

export function canFireDriver(driverId: string, state: FleetManagementState): DriverFireCheck {
  const drivers = state.player.drivers ?? [];
  const driver = drivers.find((item) => item.id === driverId);
  if (!driver) {
    return { canFire: false, reason: 'Şoför bulunamadı.' };
  }

  if ((drivers ?? []).length <= 1) {
    return { canFire: false, reason: 'Son şoförünü işten çıkaramazsın.' };
  }

  if (
    driver.status === 'driving' ||
    isDriverOnActiveDelivery(driverId, state.activeDeliveries)
  ) {
    return { canFire: false, reason: 'Bu şoför aktif teslimatta olduğu için işten çıkarılamaz.' };
  }

  return {
    canFire: true,
    severanceCost: calculateDriverSeveranceCost(driver),
  };
}
