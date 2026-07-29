/**
 * Teslimat / yakıt hesapları için saf yardımcılar.
 * delivery.ts ve truckFuel.ts birbirini import etmeden burayı kullanır.
 */

import type { Contract, Driver, Product, Route, Truck } from '../types/game';
import { getProductByIdSafe } from './entityLookup';
import {
  calculateFuelUsed as calculateCanonicalFuelUsed,
  getFuelDriverMultiplier,
  getFuelLoadMultiplier,
  getFuelRouteMultiplier,
} from './truckFuel';

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
  return getFuelLoadMultiplier(cargoWeight, truckCapacity);
}

/** Rota zorluğu yakıt çarpanı */
export function calculateRouteFuelMultiplier(route: Route): number {
  return getFuelRouteMultiplier(route.difficulty);
}

/** Şoför yakıt tasarrufu çarpanı — yüksek fuelSaving = daha az yakıt */
export function calculateDriverFuelSkillMultiplier(driver: Driver): number {
  return getFuelDriverMultiplier(driver.fuelSaving);
}

/** Toplam yakıt tüketimini hesaplar (litre) */
export function calculateFuelUsed(
  contract: Contract,
  truck: Truck,
  driver: Driver,
  route: Route,
  product: Product,
): number {
  return calculateCanonicalFuelUsed({
    distanceKm: contract.distanceKm,
    truck,
    cargoWeightTons: calculateCargoWeight(contract, product),
    routeDifficulty: route.difficulty,
    driverFuelSaving: driver.fuelSaving,
  });
}

/** Progress 0–1 aralığına normalize eder (yüzde girişi destekler) */
export function normalizeJobProgress(progress: number | undefined | null): number {
  if (progress == null || !Number.isFinite(progress)) {
    return 0;
  }
  return Math.min(1, Math.max(0, progress > 1 ? progress / 100 : progress));
}
