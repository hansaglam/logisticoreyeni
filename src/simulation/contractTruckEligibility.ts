/**
 * Per-truck contract eligibility — shared by assignment UI, availability, and debug logs.
 */

import { normalizeCityId } from '../data/networkPositions';
import { getCityName } from '../utils/entityLookup';
import type {
  Contract,
  Driver,
  Product,
  Trailer,
  TrailerType,
  Truck,
} from '../types/game';
import {
  CAPACITY_EPSILON,
  getContractRequiredCapacityTons,
  getEffectiveCargoCapacity,
  isRefrigeratedContract,
  isTrailerCompatibleWithContract,
} from './capacity';
import { debugConfig } from '../config/debug';
import { getAttachedTrailerForTruck } from './trailerAttachment';

function debugContractEligibility(payload: ContractTruckEligibility): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  if (!debugConfig.contractEligibilityLogsEnabled) return;
  console.log('[contract-truck-eligibility]', payload);
}

function resolveTruckCityCanonical(
  truck: Truck,
  fallbackHomeCityId?: string,
): string {
  return normalizeCityId(
    truck.currentCityId ?? truck.homeCityId ?? fallbackHomeCityId ?? 'izmir',
  );
}

export type ContractTruckRejectionReason =
  | 'no-driver'
  | 'wrong-city'
  | 'truck-not-idle'
  | 'no-trailer'
  | 'incompatible-trailer'
  | 'insufficient-truck-capacity'
  | 'insufficient-trailer-capacity'
  | 'insufficient-capacity'
  | 'wrong-truck-class'
  | 'trailer-not-attached'
  | 'trailer-wrong-city'
  | 'condition-too-low';

export interface ContractTruckEligibility {
  contractId: string;
  contractOriginCityId: string;
  contractTonnage: number;
  contractCargoType: string;
  contractRequiredTrailerType: TrailerType | null;
  contractRequiredTruckClass: string | null;
  contractType: string;

  truckId: string;
  truckName: string;
  truckStatus: string;
  truckCityId: string;
  truckCapacity: number;
  truckClass: string | null;
  assignedDriverId: string | null;

  trailerId: string | null;
  trailerType: TrailerType | null;
  trailerCapacity: number;
  trailerCityId: string | null;
  trailerStatus: string | null;
  trailerAttachedTruckId: string | null;

  effectiveCapacity: number;
  cityMatches: boolean;
  hasDriver: boolean;
  hasTrailer: boolean;
  trailerCompatible: boolean;
  capacityEnough: boolean;
  statusEligible: boolean;

  eligible: boolean;
  rejectionReasons: ContractTruckRejectionReason[];
}

function requiredTrailerTypeForContract(contract: Contract): TrailerType | null {
  if (isRefrigeratedContract(contract)) {
    return 'refrigerated';
  }
  return null;
}

function findAssignedDriver(truckId: string, drivers: Driver[] | undefined): Driver | undefined {
  return (drivers ?? []).find((driver) => driver.assignedTruckId === truckId);
}

function hasIdleDriverPool(drivers: Driver[] | undefined): boolean {
  return (drivers ?? []).some((driver) => driver.status === 'idle');
}

/**
 * Evaluate one truck against a contract using the same capacity/trailer rules as availability.
 * Idle fleet drivers count as hasDriver (assignment happens at startDelivery).
 */
export function evaluateContractTruckEligibility(params: {
  contract: Contract;
  truck: Truck;
  trailers?: Trailer[];
  drivers?: Driver[];
  product?: Product;
  fallbackHomeCityId?: string;
  /** When true, require a driver already assigned to this truck (stricter). Default false. */
  requireAssignedDriver?: boolean;
}): ContractTruckEligibility {
  const {
    contract,
    truck,
    trailers = [],
    drivers = [],
    product,
    fallbackHomeCityId,
    requireAssignedDriver = false,
  } = params;

  const originCityId = normalizeCityId(contract.originCityId);
  const truckCityId = resolveTruckCityCanonical(truck, fallbackHomeCityId);
  const tonnage = getContractRequiredCapacityTons(contract, product);
  const trailer = getAttachedTrailerForTruck(truck.id, trailers);
  const assignedDriver = findAssignedDriver(truck.id, drivers);
  const idlePool = hasIdleDriverPool(drivers);
  const hasDriver = requireAssignedDriver ? !!assignedDriver : idlePool || !!assignedDriver;

  const truckCapacity = getEffectiveCargoCapacity(truck, []);
  const trailerCapacity = trailer?.capacityBonusTons ?? 0;
  const effectiveCapacity = getEffectiveCargoCapacity(truck, trailers);
  const cityMatches = truckCityId === originCityId;
  const statusEligible = truck.status === 'idle';
  const hasTrailer = !!trailer;
  const requiredTrailerType = requiredTrailerTypeForContract(contract);
  const trailerCompatible = trailer
    ? isTrailerCompatibleWithContract(trailer, contract)
    : requiredTrailerType == null;
  const capacityEnough = effectiveCapacity + CAPACITY_EPSILON >= tonnage;

  const rejectionReasons: ContractTruckRejectionReason[] = [];

  if (!statusEligible) {
    rejectionReasons.push('truck-not-idle');
  }
  if (!cityMatches) {
    rejectionReasons.push('wrong-city');
  }
  if (!hasDriver) {
    rejectionReasons.push('no-driver');
  }
  if ((truck.condition ?? 100) < 30) {
    rejectionReasons.push('condition-too-low');
  }

  if (requiredTrailerType != null) {
    if (!hasTrailer) {
      rejectionReasons.push('no-trailer');
    } else if (!trailerCompatible) {
      rejectionReasons.push('incompatible-trailer');
    }
  }

  if (!capacityEnough) {
    if (truckCapacity + CAPACITY_EPSILON < tonnage && !hasTrailer) {
      rejectionReasons.push('no-trailer');
      rejectionReasons.push('insufficient-truck-capacity');
    } else if (hasTrailer && truckCapacity + trailerCapacity + CAPACITY_EPSILON < tonnage) {
      rejectionReasons.push('insufficient-trailer-capacity');
      rejectionReasons.push('insufficient-capacity');
    } else {
      rejectionReasons.push('insufficient-capacity');
    }
  }

  // Linked trailer in wrong city (defensive)
  if (trailer && normalizeCityId(trailer.city) !== truckCityId) {
    rejectionReasons.push('trailer-wrong-city');
  }

  const eligible =
    statusEligible &&
    cityMatches &&
    hasDriver &&
    capacityEnough &&
    trailerCompatible &&
    (truck.condition ?? 100) >= 30 &&
    !(trailer && normalizeCityId(trailer.city) !== truckCityId);

  const result: ContractTruckEligibility = {
    contractId: contract.id,
    contractOriginCityId: originCityId,
    contractTonnage: tonnage,
    contractCargoType: contract.productId,
    contractRequiredTrailerType: requiredTrailerType,
    contractRequiredTruckClass: null,
    contractType: contract.contractType ?? 'standard',

    truckId: truck.id,
    truckName: truck.name,
    truckStatus: truck.status,
    truckCityId,
    truckCapacity,
    truckClass: truck.catalogId ?? null,
    assignedDriverId: assignedDriver?.id ?? null,

    trailerId: trailer?.id ?? null,
    trailerType: trailer?.type ?? null,
    trailerCapacity,
    trailerCityId: trailer ? normalizeCityId(trailer.city) : null,
    trailerStatus: trailer?.status ?? null,
    trailerAttachedTruckId: trailer?.attachedTruckId ?? null,

    effectiveCapacity,
    cityMatches,
    hasDriver,
    hasTrailer,
    trailerCompatible,
    capacityEnough,
    statusEligible,

    eligible,
    rejectionReasons: eligible ? [] : [...new Set(rejectionReasons)],
  };

  debugContractEligibility(result);

  return result;
}

export function getPrimaryTruckRejectionMessage(
  eligibility: ContractTruckEligibility,
): string {
  const reasons = eligibility.rejectionReasons;
  if (reasons.length === 0) {
    return 'Uygun';
  }

  const primary = reasons[0];
  switch (primary) {
    case 'no-driver':
      return 'Uygun kamyon var ancak atanmış şoförü yok.';
    case 'no-trailer':
      return eligibility.contractRequiredTrailerType === 'refrigerated'
        ? 'Bu iş için soğutmalı dorse gerekli.'
        : 'Bu iş için Ağır Yük Dorsesi veya ek kapasite gerekir.';
    case 'incompatible-trailer':
      return 'Bağlı dorse bu iş tipi ile uyumlu değil.';
    case 'insufficient-capacity':
    case 'insufficient-truck-capacity':
    case 'insufficient-trailer-capacity':
      return `En az ${eligibility.contractTonnage.toFixed(1)} t etkili kapasite gerekli.`;
    case 'wrong-city':
      return `Uygun araç ${getCityName(eligibility.contractOriginCityId)}'da bulunmuyor.`;
    case 'truck-not-idle':
      return 'Uygun araç şu anda görevde.';
    case 'trailer-wrong-city':
      return 'Dorse kamyon ile aynı şehirde değil.';
    case 'trailer-not-attached':
      return 'Dorse kamyona bağlı değil.';
    case 'condition-too-low':
      return 'Kamyon kondisyonu çok düşük.';
    case 'wrong-truck-class':
      return 'Bu iş için uygun kamyon sınıfı gerekli.';
    default:
      return 'Bu araç bu iş için uygun değil.';
  }
}

export function logContractFleetEligibility(params: {
  contract: Contract;
  trucks: Truck[];
  trailers?: Trailer[];
  drivers?: Driver[];
  product?: Product;
  fallbackHomeCityId?: string;
}): ContractTruckEligibility[] {
  return params.trucks.map((truck) =>
    evaluateContractTruckEligibility({
      contract: params.contract,
      truck,
      trailers: params.trailers,
      drivers: params.drivers,
      product: params.product,
      fallbackHomeCityId: params.fallbackHomeCityId,
    }),
  );
}
