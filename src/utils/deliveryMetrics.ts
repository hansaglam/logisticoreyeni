/**
 * Teslimat / yakıt hesapları için saf yardımcılar.
 * delivery.ts ve truckFuel.ts birbirini import etmeden burayı kullanır.
 */

import type { Contract, Driver, Product, Route, Truck } from '../types/game';
import { getProductByIdSafe } from './entityLookup';
import { clamp } from './math';

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

/** Yük / kapasite oranı yakıt çarpanı */
export function calculateLoadWeightMultiplier(cargoWeight: number, truckCapacity: number): number {
  const safeCapacity = Math.max(truckCapacity, 1);
  return 1 + (cargoWeight / safeCapacity) * 0.25;
}

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

/** Progress 0–1 aralığına normalize eder (yüzde girişi destekler) */
export function normalizeJobProgress(progress: number | undefined | null): number {
  if (progress == null || !Number.isFinite(progress)) {
    return 0;
  }
  return clamp(progress > 1 ? progress / 100 : progress, 0, 1);
}
