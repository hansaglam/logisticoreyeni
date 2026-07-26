/**
 * Kamyon + dorse efektif kapasite — tek kaynak.
 * Contract availability, delivery start, generation guard ve UI aynı helper'ları kullanır.
 */

import { TRAILER_MARKET } from '../data/trailers';
import { TRUCK_MARKET } from '../data/trucks';
import type { Contract, ContractType, Product, Trailer, Truck } from '../types/game';
import { getProductByIdSafe } from '../utils/entityLookup';
import {
  applyTruckUpgrade,
  canUpgradeTruck,
  getCargoCapacityBonus,
  getEffectiveTruckCapacity,
  normalizeTruckUpgrades,
} from './truckUpgrades';

/** Floating point toleransı — 45.0 t kapasite, 45.0 t yük alabilmeli */
export const CAPACITY_EPSILON = 0.001;

export const HEAVY_CARGO_FEATURE_LEVEL_GUARD = 8;
export const OVERSIZED_CARGO_SYSTEM_MAX_TONS = 100;
export const MAX_UNREACHABLE_CONTRACT_LIST_RATIO = 0.25;
export const WELL_BEYOND_FLEET_SPAWN_CHANCE = 0.05;

export type CargoWeightClass = 'light' | 'medium' | 'heavy' | 'oversized';

export function hasEnoughCargoCapacity(availableTons: number, requiredTons: number): boolean {
  const safeCapacity = Math.max(0, availableTons);
  const safeRequired = Math.max(0, requiredTons);
  return safeRequired > 0 && safeCapacity + CAPACITY_EPSILON >= safeRequired;
}

/** @deprecated use hasEnoughCargoCapacity */
export const hasEnoughCapacity = hasEnoughCargoCapacity;

export function getTruckBaseCapacity(truck: Truck): number {
  return normalizeTruckUpgrades(truck).capacity ?? 0;
}

export function getTruckUpgradeCapacityBonus(truck: Truck): number {
  return getCargoCapacityBonus(normalizeTruckUpgrades(truck));
}

export function getAttachedTrailer(
  truckId: string | undefined,
  trailers: Trailer[] | undefined,
): Trailer | undefined {
  if (!truckId) {
    return undefined;
  }
  return (trailers ?? []).find(
    (trailer) => trailer.attachedTruckId === truckId && trailer.status !== 'idle',
  );
}

export function getTrailerCapacityBonus(trailer: Trailer | undefined): number {
  if (!trailer) {
    return 0;
  }
  return Math.max(0, trailer.capacityBonusTons ?? 0);
}

export function getTruckEffectiveCapacityTons(
  truck: Truck,
  trailers: Trailer[] | undefined = [],
): number {
  const truckCapacity = getEffectiveTruckCapacity(normalizeTruckUpgrades(truck));
  const attached = getAttachedTrailer(truck.id, trailers);
  return truckCapacity + getTrailerCapacityBonus(attached);
}

/** @deprecated use getTruckEffectiveCapacityTons(truck, trailers) */
export function getEffectiveTruckCapacityTons(truck: Truck): number {
  return getTruckEffectiveCapacityTons(truck, []);
}

export function canTruckCarryCargo(
  truck: Truck,
  requiredTons: number,
  trailers: Trailer[] | undefined = [],
): boolean {
  return hasEnoughCargoCapacity(getTruckEffectiveCapacityTons(truck, trailers), requiredTons);
}

export function getContractRequiredCapacityTons(
  contract: Contract,
  product?: Product,
): number {
  if (contract.cargoWeight != null && contract.cargoWeight > 0) {
    return contract.cargoWeight;
  }
  if (contract.amount != null && contract.amount > 0) {
    return contract.amount;
  }
  const resolved = product ?? getProductByIdSafe(contract.productId);
  return resolved?.weightPerUnit ?? 0;
}

export function isRefrigeratedContract(contract: Contract): boolean {
  return (contract.contractType ?? 'standard') === 'refrigerated';
}

export function isTrailerCompatibleWithContract(
  trailer: Trailer,
  contract: Contract,
): boolean {
  if (isRefrigeratedContract(contract)) {
    return trailer.type === 'refrigerated';
  }
  return true;
}

export function canTruckCarryContract(
  truck: Truck,
  trailers: Trailer[] | undefined,
  contract: Contract,
  product?: Product,
): boolean {
  const requiredTons = getContractRequiredCapacityTons(contract, product);
  if (!canTruckCarryCargo(truck, requiredTons, trailers)) {
    return false;
  }

  if (isRefrigeratedContract(contract)) {
    const attached = getAttachedTrailer(truck.id, trailers);
    if (attached && !isTrailerCompatibleWithContract(attached, contract)) {
      return false;
    }
  }

  return true;
}

export function getCargoWeightClass(tons: number): CargoWeightClass {
  const safe = Math.max(0, tons);
  if (safe <= 20) {
    return 'light';
  }
  if (safe <= 45) {
    return 'medium';
  }
  if (safe <= 80) {
    return 'heavy';
  }
  return 'oversized';
}

export function getCargoWeightClassLabel(weightClass: CargoWeightClass): string | null {
  switch (weightClass) {
    case 'heavy':
      return 'Ağır Yük';
    case 'oversized':
      return 'Çok Ağır Yük';
    default:
      return null;
  }
}

export function getMaxPotentialTruckCapacityTons(truck: Truck): number {
  let normalized = normalizeTruckUpgrades(truck);
  while (canUpgradeTruck(normalized, 'cargo')) {
    normalized = applyTruckUpgrade(normalized, 'cargo');
  }
  return getEffectiveTruckCapacity(normalized);
}

export function getMaxFleetCapacityTons(
  trucks: Truck[] | undefined,
  trailers: Trailer[] | undefined = [],
): number {
  return (trucks ?? []).reduce(
    (max, truck) => Math.max(max, getTruckEffectiveCapacityTons(truck, trailers)),
    0,
  );
}

export function getMaxPotentialFleetCapacityTons(
  trucks: Truck[] | undefined,
  trailers: Trailer[] | undefined = [],
): number {
  const truckList = trucks ?? [];
  const trailerList = trailers ?? [];
  let max = 0;

  for (const truck of truckList) {
    const truckPotential = getMaxPotentialTruckCapacityTons(truck);
    const attachedBonus = getTrailerCapacityBonus(getAttachedTrailer(truck.id, trailerList));
    max = Math.max(max, truckPotential + attachedBonus);

    const idleTrailersInCity = trailerList.filter(
      (trailer) =>
        trailer.status === 'idle' &&
        trailer.city === (truck.currentCityId ?? truck.homeCityId),
    );
    for (const trailer of idleTrailersInCity) {
      max = Math.max(max, truckPotential + getTrailerCapacityBonus(trailer));
    }
  }

  for (const trailer of trailerList.filter((item) => item.status === 'idle')) {
    max = Math.max(max, getTrailerCapacityBonus(trailer));
  }

  return max;
}

export function getSystemMaxTruckCapacityTons(): number {
  let max = 0;
  for (const template of TRUCK_MARKET) {
    let truck: Truck = {
      ...template,
      catalogId: template.id,
      currentCityId: 'izmir',
      homeCityId: 'izmir',
      status: 'idle',
    };
    max = Math.max(max, getMaxPotentialTruckCapacityTons(truck));
  }
  return max;
}

export function getSystemMaxFleetCapacityTons(): number {
  const maxTrailerBonus = TRAILER_MARKET.reduce(
    (max, item) => Math.max(max, item.capacityBonusTons),
    0,
  );
  return getSystemMaxTruckCapacityTons() + maxTrailerBonus;
}

export function isContractBeyondSystemCapacity(requiredTons: number): boolean {
  return requiredTons > getSystemMaxFleetCapacityTons() + CAPACITY_EPSILON;
}

export function isContractUnreachableByFleet(
  requiredTons: number,
  maxFleetCapacityTons: number,
): boolean {
  if (maxFleetCapacityTons <= 0) {
    return requiredTons > CAPACITY_EPSILON;
  }
  return !hasEnoughCargoCapacity(maxFleetCapacityTons, requiredTons);
}

export function isContractWellBeyondFleet(
  requiredTons: number,
  maxFleetCapacityTons: number,
): boolean {
  if (maxFleetCapacityTons <= 0) {
    return requiredTons > CAPACITY_EPSILON;
  }
  return requiredTons > maxFleetCapacityTons * 1.5 + CAPACITY_EPSILON;
}

export function shouldSpawnBeyondFleetContract(
  requiredTons: number,
  maxFleetCapacityTons: number,
  unreachableRatio: number,
  playerLevel: number,
): boolean {
  if (requiredTons >= OVERSIZED_CARGO_SYSTEM_MAX_TONS && playerLevel < HEAVY_CARGO_FEATURE_LEVEL_GUARD) {
    return false;
  }

  if (!isContractUnreachableByFleet(requiredTons, maxFleetCapacityTons)) {
    return true;
  }

  if (isContractWellBeyondFleet(requiredTons, maxFleetCapacityTons)) {
    return Math.random() < WELL_BEYOND_FLEET_SPAWN_CHANCE;
  }

  return unreachableRatio < MAX_UNREACHABLE_CONTRACT_LIST_RATIO;
}

export const FUTURE_TRAILER_SYSTEM_NOTE =
  'Çok ağır yükler için tır/dorse kombinasyonu kullanılır.';

export interface CapacityDisabledReasonInput {
  requiredTons: number;
  maxIdleAtOriginTons: number;
  maxFleetCapacityTons: number;
  maxIdleFleetCapacityTons: number;
  maxPotentialAtOriginTons: number;
  maxPotentialAtOriginWithTrailerTons: number;
  hasTruckWithCapacityElsewhere: boolean;
  needsTrailerForWeight: boolean;
  needsRefrigeratedTrailer: boolean;
  needsTrailerTypeMatch: boolean;
  bestIdleAtOriginTons: number;
}

export function buildCapacityDisabledReasonInput(
  requiredTons: number,
  trucks: Truck[] | undefined,
  trailers: Trailer[] | undefined,
  idleTrucksAtOrigin: Truck[],
  isTruckIdle: (truck: Truck) => boolean,
  resolveTruckCityId: (truck: Truck, fallbackHomeCityId?: string) => string,
  originCityId: string,
  contract?: Contract,
  fallbackHomeCityId?: string,
): CapacityDisabledReasonInput {
  const truckList = trucks ?? [];
  const trailerList = trailers ?? [];

  const maxIdleAtOriginTons =
    idleTrucksAtOrigin.length > 0
      ? Math.max(...idleTrucksAtOrigin.map((truck) => getTruckEffectiveCapacityTons(truck, trailerList)))
      : 0;

  const maxPotentialAtOriginTons =
    idleTrucksAtOrigin.length > 0
      ? Math.max(...idleTrucksAtOrigin.map(getMaxPotentialTruckCapacityTons))
      : 0;

  let maxPotentialAtOriginWithTrailerTons = maxPotentialAtOriginTons;
  const idleTrailersAtOrigin = trailerList.filter(
    (trailer) => trailer.status === 'idle' && trailer.city === originCityId,
  );
  for (const truck of idleTrucksAtOrigin) {
    const truckPotential = getMaxPotentialTruckCapacityTons(truck);
    const attachedBonus = getTrailerCapacityBonus(getAttachedTrailer(truck.id, trailerList));
    maxPotentialAtOriginWithTrailerTons = Math.max(
      maxPotentialAtOriginWithTrailerTons,
      truckPotential + attachedBonus,
    );
    for (const trailer of idleTrailersAtOrigin) {
      maxPotentialAtOriginWithTrailerTons = Math.max(
        maxPotentialAtOriginWithTrailerTons,
        truckPotential + getTrailerCapacityBonus(trailer),
      );
    }
  }

  const idleFleet = truckList.filter(isTruckIdle);
  const maxIdleFleetCapacityTons =
    idleFleet.length > 0
      ? Math.max(...idleFleet.map((truck) => getTruckEffectiveCapacityTons(truck, trailerList)))
      : 0;

  const maxFleetCapacityTons = getMaxFleetCapacityTons(truckList, trailerList);
  const maxPotentialFleetCapacityTons = getMaxPotentialFleetCapacityTons(truckList, trailerList);

  const hasTruckWithCapacityElsewhere = truckList.some((truck) => {
    if (!isTruckIdle(truck)) {
      return false;
    }
    if (resolveTruckCityId(truck, fallbackHomeCityId) === originCityId) {
      return false;
    }
    return canTruckCarryCargo(truck, requiredTons, trailerList);
  });

  const needsTrailerForWeight =
    !hasEnoughCargoCapacity(maxIdleAtOriginTons, requiredTons) &&
    hasEnoughCargoCapacity(maxPotentialAtOriginWithTrailerTons, requiredTons);

  const needsRefrigeratedTrailer =
    contract != null &&
    isRefrigeratedContract(contract) &&
    hasEnoughCargoCapacity(maxIdleAtOriginTons, requiredTons) &&
    !idleTrucksAtOrigin.some((truck) => canTruckCarryContract(truck, trailerList, contract));

  const needsTrailerTypeMatch =
    needsRefrigeratedTrailer ||
    (contract != null &&
      isRefrigeratedContract(contract) &&
      !hasEnoughCargoCapacity(maxPotentialFleetCapacityTons, requiredTons) &&
      idleTrailersAtOrigin.some((trailer) => trailer.type === 'refrigerated'));

  return {
    requiredTons,
    maxIdleAtOriginTons,
    maxFleetCapacityTons,
    maxIdleFleetCapacityTons,
    maxPotentialAtOriginTons,
    maxPotentialAtOriginWithTrailerTons,
    hasTruckWithCapacityElsewhere,
    needsTrailerForWeight,
    needsRefrigeratedTrailer,
    needsTrailerTypeMatch,
    bestIdleAtOriginTons: maxIdleAtOriginTons,
  };
}

export type CapacityDisabledReasonKind =
  | 'beyond_system'
  | 'trailer_required'
  | 'refrigerated_trailer_required'
  | 'trailer_type_mismatch'
  | 'heavy_haul_required'
  | 'wrong_city'
  | 'upgrade_possible'
  | 'insufficient';

export function resolveCapacityDisabledReasonKind(
  input: CapacityDisabledReasonInput,
): CapacityDisabledReasonKind {
  if (isContractBeyondSystemCapacity(input.requiredTons)) {
    return 'beyond_system';
  }

  if (input.needsRefrigeratedTrailer) {
    return 'refrigerated_trailer_required';
  }

  if (
    input.hasTruckWithCapacityElsewhere &&
    !hasEnoughCargoCapacity(input.maxIdleAtOriginTons, input.requiredTons)
  ) {
    return 'wrong_city';
  }

  if (input.needsTrailerForWeight) {
    return 'trailer_required';
  }

  if (
    !hasEnoughCargoCapacity(input.maxIdleAtOriginTons, input.requiredTons) &&
    hasEnoughCargoCapacity(input.maxPotentialAtOriginTons, input.requiredTons)
  ) {
    return 'upgrade_possible';
  }

  if (!hasEnoughCargoCapacity(input.maxFleetCapacityTons, input.requiredTons)) {
    return 'heavy_haul_required';
  }

  return 'insufficient';
}

export function getCapacityDisabledReasonLabel(kind: CapacityDisabledReasonKind): string {
  switch (kind) {
    case 'beyond_system':
      return 'Çok ağır yük · Tır/dorse gerekir';
    case 'trailer_required':
      return 'Ağır yük için dorse gerekir';
    case 'refrigerated_trailer_required':
      return 'Soğutmalı dorse gerekli';
    case 'trailer_type_mismatch':
      return 'Uygun dorse tipi gerekli';
    case 'heavy_haul_required':
      return 'Bu yük için ağır tonaj aracı gerekir';
    case 'wrong_city':
      return 'Bu şehirde uygun tonajlı kamyon yok';
    case 'upgrade_possible':
      return 'Tonaj yetersiz · Kapasite yükselt';
    case 'insufficient':
    default:
      return 'Tonaj yetersiz';
  }
}

export function formatCapacityShortfallLabel(
  availableTons: number,
  requiredTons: number,
): string {
  return `Tonaj yetersiz · ${availableTons.toFixed(1)} t / ${requiredTons.toFixed(1)} t`;
}

export function formatCombinedCapacityLabel(
  truck: Truck,
  trailers: Trailer[] | undefined,
): string {
  const base = getTruckEffectiveCapacityTons(truck, []);
  const total = getTruckEffectiveCapacityTons(truck, trailers);
  const attached = getAttachedTrailer(truck.id, trailers);
  if (!attached) {
    return `${total.toFixed(1)} t`;
  }
  return `${base.toFixed(1)} t + ${getTrailerCapacityBonus(attached).toFixed(1)} t = ${total.toFixed(1)} t`;
}
