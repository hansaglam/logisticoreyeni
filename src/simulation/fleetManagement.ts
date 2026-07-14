/**
 * Filo yönetimi — kamyon satışı ve şoför işten çıkarma yardımcıları.
 */

import { fleetManagementBalance, operatingCostBalance } from '../config/balance';
import type { Delivery, DeliveryStatus, Driver, Player, Truck, TruckTransfer } from '../types/game';

const ACTIVE_DELIVERY_STATUSES: DeliveryStatus[] = ['preparing', 'on_route'];

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
  if (condition >= 90) return 1;
  if (condition >= 75) return 0.9;
  if (condition >= 60) return 0.75;
  if (condition >= 40) return 0.55;
  if (condition >= 20) return 0.35;
  return 0.2;
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
    (transfer) => transfer.truckId === truckId && transfer.status === 'active',
  );
}

function isDriverOnActiveDelivery(driverId: string, deliveries: Delivery[] | undefined): boolean {
  return (deliveries ?? []).some(
    (delivery) =>
      delivery.driverId === driverId && ACTIVE_DELIVERY_STATUSES.includes(delivery.status),
  );
}

export function calculateTruckResaleValue(truck: Truck): number {
  if ((truck.ownershipType ?? 'owned') === 'leased') {
    return 0;
  }

  const purchasePrice = resolveTruckPurchasePrice(truck);
  if (purchasePrice <= 0) {
    return 0;
  }

  const condition = clamp(truck.condition ?? 100, 0, 100);
  const conditionMultiplier = getConditionMultiplier(condition);
  const { truckBaseResaleRate, minTruckResaleRate, maxTruckResaleRate } = fleetManagementBalance;

  const rawPrice = purchasePrice * truckBaseResaleRate * conditionMultiplier;
  const minPrice = purchasePrice * minTruckResaleRate;
  const maxPrice = purchasePrice * maxTruckResaleRate;

  return Math.round(clamp(rawPrice, minPrice, maxPrice));
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
