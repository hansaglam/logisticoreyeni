/**
 * Dorse satın alma, bağlama ve filo senkronizasyonu — Trailer System V1.
 */

import type { ContractType, Trailer, TrailerStatus, Truck } from '../types/game';
import { findTrailerMarketItem, type TrailerMarketItem } from '../data/trailers';
import {
  getAttachedTrailer,
  getTrailerCapacityBonus,
  getTruckEffectiveCapacityTons,
} from './capacity';
import { isTruckIdle, resolveTruckCityId } from './delivery';

export type TrailerActionErrorCode =
  | 'TRAILER_NOT_FOUND'
  | 'TRUCK_NOT_FOUND'
  | 'TRUCK_NOT_OWNED'
  | 'TRAILER_NOT_OWNED'
  | 'DIFFERENT_CITY'
  | 'TRUCK_NOT_IDLE'
  | 'TRAILER_NOT_IDLE'
  | 'TRAILER_ALREADY_ATTACHED'
  | 'TRUCK_ALREADY_HAS_TRAILER'
  | 'TRUCK_ON_ACTIVE_JOB'
  | 'TEMPLATE_NOT_FOUND'
  | 'LEVEL_TOO_LOW'
  | 'INSUFFICIENT_FUNDS';

export interface TrailerActionResult {
  success: boolean;
  message: string;
  errorCode?: TrailerActionErrorCode;
}

export function normalizeTrailer(
  trailer: Trailer,
  fallbackCity = 'izmir',
  trucks: Truck[] | undefined = [],
): Trailer {
  const truckList = trucks ?? [];
  const attachedTruckId =
    typeof trailer.attachedTruckId === 'string' ? trailer.attachedTruckId : null;
  const linkedTruck = attachedTruckId
    ? truckList.find((truck) => truck.id === attachedTruckId)
    : undefined;

  let status: TrailerStatus = trailer.status ?? 'idle';
  if (attachedTruckId && linkedTruck) {
    status =
      linkedTruck.status === 'on_route' ||
      linkedTruck.status === 'transferring' ||
      linkedTruck.status === 'out_of_fuel'
        ? 'in_use'
        : 'attached';
  } else if (attachedTruckId && !linkedTruck) {
    status = 'idle';
  } else if (status === 'attached' || status === 'in_use') {
    status = 'idle';
  }

  const city =
    trailer.city ??
    linkedTruck?.currentCityId ??
    linkedTruck?.homeCityId ??
    fallbackCity;

  return {
    ...trailer,
    condition: Math.max(0, Math.min(100, trailer.condition ?? 100)),
    city,
    status,
    attachedTruckId: status === 'idle' ? null : attachedTruckId,
    isOwned: trailer.isOwned ?? true,
    capacityBonusTons: Math.max(0, trailer.capacityBonusTons ?? 0),
    purchasePrice: Math.max(0, trailer.purchasePrice ?? 0),
    createdAtGameTime: trailer.createdAtGameTime ?? 0,
  };
}

export function normalizePlayerTrailers(
  trailers: Trailer[] | undefined,
  homeCityId: string,
  trucks: Truck[] | undefined = [],
): Trailer[] {
  const fallbackCity = homeCityId || 'izmir';
  const normalized = (trailers ?? []).map((trailer) =>
    normalizeTrailer(trailer, fallbackCity, trucks),
  );

  const seenTruckIds = new Set<string>();
  return normalized.map((trailer) => {
    if (!trailer.attachedTruckId) {
      return { ...trailer, status: 'idle' as const, attachedTruckId: null };
    }
    if (seenTruckIds.has(trailer.attachedTruckId)) {
      return { ...trailer, status: 'idle' as const, attachedTruckId: null };
    }
    seenTruckIds.add(trailer.attachedTruckId);
    return trailer;
  });
}

export function canAttachTrailerToTruck(
  truck: Truck | undefined,
  trailer: Trailer | undefined,
): TrailerActionResult {
  if (!trailer) {
    return { success: false, errorCode: 'TRAILER_NOT_FOUND', message: 'Dorse bulunamadı.' };
  }
  if (!truck) {
    return { success: false, errorCode: 'TRUCK_NOT_FOUND', message: 'Kamyon bulunamadı.' };
  }
  if ((truck.ownershipType ?? 'owned') !== 'owned') {
    return { success: false, errorCode: 'TRUCK_NOT_OWNED', message: 'Kiralık kamyona dorse bağlanamaz.' };
  }
  if (!trailer.isOwned) {
    return { success: false, errorCode: 'TRAILER_NOT_OWNED', message: 'Dorse oyuncuya ait değil.' };
  }
  if (!isTruckIdle(truck)) {
    return {
      success: false,
      errorCode: 'TRUCK_NOT_IDLE',
      message: 'Kamyon boşta değilken dorse bağlanamaz.',
    };
  }
  if (trailer.status !== 'idle') {
    return {
      success: false,
      errorCode: 'TRAILER_NOT_IDLE',
      message: 'Dorse başka bir kamyona bağlı.',
    };
  }
  const truckCity = resolveTruckCityId(truck);
  if (trailer.city !== truckCity) {
    return {
      success: false,
      errorCode: 'DIFFERENT_CITY',
      message: 'Kamyon ve dorse aynı şehirde olmalı.',
    };
  }
  return { success: true, message: 'Bağlanabilir.' };
}

export function attachTrailerToTruckState(
  trailers: Trailer[],
  trailerId: string,
  truckId: string,
  trucks: Truck[],
): { trailers: Trailer[]; error?: TrailerActionResult } {
  const trailer = trailers.find((item) => item.id === trailerId);
  const truck = trucks.find((item) => item.id === truckId);
  const validation = canAttachTrailerToTruck(truck, trailer);
  if (!validation.success) {
    return { trailers, error: validation };
  }

  if (trailers.some((item) => item.attachedTruckId === truckId && item.id !== trailerId)) {
    return {
      trailers,
      error: {
        success: false,
        errorCode: 'TRUCK_ALREADY_HAS_TRAILER',
        message: 'Kamyonun zaten bağlı bir dorsesi var. Önce ayır.',
      },
    };
  }

  const truckCity = resolveTruckCityId(truck!);
  const updated = trailers.map((item) => {
    if (item.id === trailerId) {
      return {
        ...item,
        status: 'attached' as const,
        attachedTruckId: truckId,
        city: truckCity,
      };
    }
    if (item.attachedTruckId === trailerId) {
      return { ...item, status: 'idle' as const, attachedTruckId: null };
    }
    return item;
  });

  return { trailers: updated };
}

export function detachTrailerFromTruckState(
  trailers: Trailer[],
  trailerId: string,
  trucks: Truck[],
): { trailers: Trailer[]; error?: TrailerActionResult } {
  const trailer = trailers.find((item) => item.id === trailerId);
  if (!trailer) {
    return {
      trailers,
      error: { success: false, errorCode: 'TRAILER_NOT_FOUND', message: 'Dorse bulunamadı.' },
    };
  }

  const attachedTruck = trailer.attachedTruckId
    ? trucks.find((truck) => truck.id === trailer.attachedTruckId)
    : undefined;

  if (attachedTruck && !isTruckIdle(attachedTruck)) {
    return {
      trailers,
      error: {
        success: false,
        errorCode: 'TRUCK_ON_ACTIVE_JOB',
        message: 'Teslimat sırasında dorse ayırılamaz.',
      },
    };
  }

  const city =
    attachedTruck?.currentCityId ??
    attachedTruck?.homeCityId ??
    trailer.city ??
    'izmir';

  const updated = trailers.map((item) =>
    item.id === trailerId
      ? { ...item, status: 'idle' as const, attachedTruckId: null, city }
      : item,
  );

  return { trailers: updated };
}

export function detachTrailersFromTruckState(
  trailers: Trailer[],
  truckId: string,
  trucks: Truck[],
): Trailer[] {
  const attached = trailers.filter((trailer) => trailer.attachedTruckId === truckId);
  let next = trailers;
  for (const trailer of attached) {
    next = detachTrailerFromTruckState(next, trailer.id, trucks).trailers;
  }
  return next;
}

export function syncTrailersWithTruckLocation(
  trailers: Trailer[],
  truckId: string,
  cityId: string,
  truckStatus: Truck['status'],
): Trailer[] {
  return trailers.map((trailer) => {
    if (trailer.attachedTruckId !== truckId) {
      return trailer;
    }
    const status: TrailerStatus =
      truckStatus === 'on_route' || truckStatus === 'transferring' ? 'in_use' : 'attached';
    return {
      ...trailer,
      city: cityId,
      status,
    };
  });
}

export function syncAllTrailersWithFleet(
  trailers: Trailer[],
  trucks: Truck[],
): Trailer[] {
  return trailers.map((trailer) => {
    if (!trailer.attachedTruckId) {
      return trailer;
    }
    const truck = trucks.find((item) => item.id === trailer.attachedTruckId);
    if (!truck) {
      return { ...trailer, status: 'idle' as const, attachedTruckId: null };
    }
    return syncTrailersWithTruckLocation(
      [trailer],
      truck.id,
      resolveTruckCityId(truck),
      truck.status,
    )[0];
  });
}

export function getTrailerStatusLabel(trailer: Trailer, trucks: Truck[]): string {
  if (trailer.status === 'in_use') {
    return 'Teslimatta';
  }
  if (trailer.status === 'attached') {
    const truck = trucks.find((item) => item.id === trailer.attachedTruckId);
    return truck ? `Bağlı · ${truck.name}` : 'Bağlı';
  }
  return 'Boşta';
}

export function getTrailerTypeLabel(type: Trailer['type']): string {
  switch (type) {
    case 'heavy':
      return 'Ağır Yük';
    case 'refrigerated':
      return 'Soğutmalı';
    case 'container':
      return 'Konteyner';
    default:
      return 'Standart';
  }
}

export function validateTrailerPurchase(
  template: TrailerMarketItem | undefined,
  playerLevel: number,
  playerMoney: number,
): TrailerActionResult {
  if (!template) {
    return { success: false, errorCode: 'TEMPLATE_NOT_FOUND', message: 'Dorse modeli bulunamadı.' };
  }
  const requiredLevel = template.requiredLevel ?? 1;
  if (playerLevel < requiredLevel) {
    return {
      success: false,
      errorCode: 'LEVEL_TOO_LOW',
      message: `Bu dorse için şirket seviyesi ${requiredLevel} gerekir.`,
    };
  }
  if (playerMoney < template.purchasePrice) {
    return {
      success: false,
      errorCode: 'INSUFFICIENT_FUNDS',
      message: 'Yeterli nakit yok.',
    };
  }
  return { success: true, message: 'Satın alınabilir.' };
}

export function getTrailerEffectiveCapacitySummary(
  truck: Truck,
  trailers: Trailer[] | undefined,
): { baseTons: number; trailerBonusTons: number; totalTons: number; trailerName?: string } {
  const baseTons = getTruckEffectiveCapacityTons(truck, []);
  const attached = getAttachedTrailer(truck.id, trailers);
  const trailerBonusTons = getTrailerCapacityBonus(attached);
  return {
    baseTons,
    trailerBonusTons,
    totalTons: baseTons + trailerBonusTons,
    trailerName: attached?.name,
  };
}

export function findCompatibleIdleTrailersAtCity(
  trailers: Trailer[],
  cityId: string,
  contractType?: ContractType,
): Trailer[] {
  return trailers.filter((trailer) => {
    if (trailer.status !== 'idle' || trailer.city !== cityId) {
      return false;
    }
    if (contractType === 'refrigerated') {
      return trailer.type === 'refrigerated';
    }
    return true;
  });
}

export { findTrailerMarketItem };
