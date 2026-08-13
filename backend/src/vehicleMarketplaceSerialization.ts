import type { Timestamp } from 'firebase-admin/firestore';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';

import type {
  MarketplaceListingDocument,
  MarketplaceListingStatus,
  MarketplaceTruckSnapshot,
} from './vehicleMarketplaceTypes';

export const VEHICLE_MARKETPLACE_API_VERSION = 1;

export interface VehicleMarketplaceListingDTO {
  id: string;
  sellerUid: string;
  sellerDisplayName: string;
  vehicleType: 'truck';
  truckSnapshot: MarketplaceTruckSnapshot;
  askingPrice: number;
  recommendedPrice: number;
  marketplaceFeeRate: number;
  status: MarketplaceListingStatus;
  createdAtMs: number;
  updatedAtMs: number;
  expiresAtMs: number;
  soldAtMs?: number | null;
  buyerUid?: string | null;
  transactionId?: string | null;
  version: number;
}

type TimestampLike =
  | Timestamp
  | Date
  | number
  | string
  | {
      toMillis?: () => number;
      seconds?: number;
      _seconds?: number;
      nanoseconds?: number;
      _nanoseconds?: number;
    }
  | null
  | undefined;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function finiteNumber(
  value: unknown,
  options?: { min?: number; max?: number; integer?: boolean },
): number | null {
  const parsed =
    typeof value === 'string' && value.trim().length > 0
      ? Number(value.trim())
      : Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = options?.integer ? Math.floor(parsed) : parsed;
  if (options?.min != null && normalized < options.min) return null;
  if (options?.max != null && normalized > options.max) return null;
  return normalized;
}

export function timestampToMillis(value: TimestampLike): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? Math.floor(value) : Math.floor(value * 1_000);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'object') {
    const raw = value as {
      toMillis?: () => number;
      seconds?: number;
      _seconds?: number;
      nanoseconds?: number;
      _nanoseconds?: number;
    };
    if (typeof raw.toMillis === 'function') {
      const millis = raw.toMillis();
      return Number.isFinite(millis) ? Math.floor(millis) : null;
    }
    const seconds = raw.seconds ?? raw._seconds;
    if (Number.isFinite(seconds)) {
      const nanos = raw.nanoseconds ?? raw._nanoseconds ?? 0;
      return Math.floor(Number(seconds) * 1_000 + Number(nanos) / 1_000_000);
    }
  }
  return null;
}

function normalizeStatus(value: unknown): MarketplaceListingStatus | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'available') return 'active';
  if (
    normalized === 'active' ||
    normalized === 'sold' ||
    normalized === 'cancelled' ||
    normalized === 'expired' ||
    normalized === 'reserved'
  ) {
    return normalized;
  }
  return null;
}

function normalizeConditionPercent(value: unknown): number | null {
  const parsed = finiteNumber(value, { min: 0 });
  if (parsed == null) return null;
  if (parsed <= 1) return Math.round(parsed * 100);
  return Math.min(100, Math.round(parsed));
}

function normalizeTruckSnapshot(raw: unknown): MarketplaceTruckSnapshot | null {
  const source = record(raw);
  const truckId =
    typeof source.truckId === 'string'
      ? source.truckId
      : typeof source.id === 'string'
        ? source.id
        : typeof source.vehicleId === 'string'
          ? source.vehicleId
          : null;
  const templateId =
    typeof source.templateId === 'string'
      ? source.templateId
      : typeof source.catalogId === 'string'
        ? source.catalogId
        : null;
  const currentCityId =
    typeof source.currentCityId === 'string'
      ? source.currentCityId
      : typeof source.cityId === 'string'
        ? source.cityId
        : null;
  if (!truckId || !templateId || !currentCityId) return null;

  const condition = normalizeConditionPercent(source.condition);
  const totalMileageKm = finiteNumber(source.totalMileageKm ?? source.mileageKm, {
    min: 0,
  });
  const currentFuelL = finiteNumber(source.currentFuelL, { min: 0 });
  const fuelTankCapacityL = finiteNumber(source.fuelTankCapacityL, { min: 1 });
  if (
    condition == null ||
    totalMileageKm == null ||
    currentFuelL == null ||
    fuelTankCapacityL == null
  ) {
    return null;
  }

  const upgradesRaw = record(source.upgrades);
  const upgrades =
    Object.keys(upgradesRaw).length > 0
      ? {
          engine: finiteNumber(upgradesRaw.engine, { min: 0, integer: true }) ?? 0,
          fuelEfficiency:
            finiteNumber(upgradesRaw.fuelEfficiency, { min: 0, integer: true }) ?? 0,
          cargo: finiteNumber(upgradesRaw.cargo, { min: 0, integer: true }) ?? 0,
          durability:
            finiteNumber(upgradesRaw.durability, { min: 0, integer: true }) ?? 0,
        }
      : undefined;

  const acquiredAtMs = timestampToMillis(source.acquiredAt as TimestampLike);

  return {
    truckId,
    templateId,
    ...(typeof source.customName === 'string' && source.customName.trim().length > 0
      ? { customName: source.customName.trim().slice(0, 48) }
      : {}),
    currentCityId,
    condition,
    totalMileageKm,
    currentFuelL,
    fuelTankCapacityL,
    ...(upgrades ? { upgrades } : {}),
    ...(acquiredAtMs != null ? { acquiredAt: acquiredAtMs } : {}),
    ...(record(source.visualCustomization) &&
    Object.keys(record(source.visualCustomization)).length > 0
      ? {
          visualCustomization: Object.fromEntries(
            Object.entries(record(source.visualCustomization)).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          ) as Record<string, string>,
        }
      : {}),
  };
}

export type NormalizeStoredListingResult =
  | { ok: true; listing: VehicleMarketplaceListingDTO }
  | { ok: false; field: string; reason: string };

export function normalizeStoredMarketplaceListing(
  raw: Record<string, unknown>,
  fallbackId?: string,
): NormalizeStoredListingResult {
  const id =
    typeof raw.id === 'string' && raw.id.length > 0
      ? raw.id
      : typeof fallbackId === 'string' && fallbackId.length > 0
        ? fallbackId
        : null;
  if (!id) {
    return { ok: false, field: 'id', reason: 'missing-id' };
  }

  const sellerUid = typeof raw.sellerUid === 'string' ? raw.sellerUid : null;
  if (!sellerUid) {
    return { ok: false, field: 'sellerUid', reason: 'missing-seller-uid' };
  }

  const truckSnapshot = normalizeTruckSnapshot(
    raw.truckSnapshot ?? raw.truck ?? raw.vehicle,
  );
  if (!truckSnapshot) {
    return { ok: false, field: 'truckSnapshot', reason: 'invalid-truck-snapshot' };
  }

  const askingPrice = finiteNumber(raw.askingPrice ?? raw.price, {
    min: 0,
    integer: true,
  });
  const recommendedPrice = finiteNumber(raw.recommendedPrice, {
    min: 0,
    integer: true,
  });
  const marketplaceFeeRate = finiteNumber(raw.marketplaceFeeRate, { min: 0 });
  const version = finiteNumber(raw.version, { min: 1, integer: true });
  if (
    askingPrice == null ||
    recommendedPrice == null ||
    marketplaceFeeRate == null ||
    version == null
  ) {
    return { ok: false, field: 'pricing', reason: 'invalid-pricing' };
  }

  const status = normalizeStatus(raw.status);
  if (!status) {
    return { ok: false, field: 'status', reason: 'invalid-status' };
  }

  const createdAtMs =
    timestampToMillis(raw.createdAtMs as TimestampLike) ??
    timestampToMillis(raw.createdAt as TimestampLike);
  const updatedAtMs =
    timestampToMillis(raw.updatedAtMs as TimestampLike) ??
    timestampToMillis(raw.updatedAt as TimestampLike);
  const expiresAtMs =
    timestampToMillis(raw.expiresAtMs as TimestampLike) ??
    timestampToMillis(raw.expiresAt as TimestampLike);
  if (createdAtMs == null || updatedAtMs == null || expiresAtMs == null) {
    return { ok: false, field: 'timestamps', reason: 'invalid-timestamps' };
  }

  const sellerDisplayName =
    typeof raw.sellerDisplayName === 'string' && raw.sellerDisplayName.trim().length > 0
      ? raw.sellerDisplayName.trim().slice(0, 48)
      : typeof raw.sellerName === 'string' && raw.sellerName.trim().length > 0
        ? raw.sellerName.trim().slice(0, 48)
        : 'Anonim satıcı';

  const soldAtMs =
    timestampToMillis(raw.soldAtMs as TimestampLike) ??
    timestampToMillis(raw.soldAt as TimestampLike);

  return {
    ok: true,
    listing: {
      id,
      sellerUid,
      sellerDisplayName,
      vehicleType: 'truck',
      truckSnapshot,
      askingPrice,
      recommendedPrice,
      marketplaceFeeRate,
      status,
      createdAtMs,
      updatedAtMs,
      expiresAtMs,
      soldAtMs: soldAtMs ?? null,
      buyerUid:
        typeof raw.buyerUid === 'string' && raw.buyerUid.length > 0
          ? raw.buyerUid
          : null,
      transactionId:
        typeof raw.transactionId === 'string' && raw.transactionId.length > 0
          ? raw.transactionId
          : null,
      version,
    },
  };
}

export function serializeMarketplaceListingDocument(
  document: QueryDocumentSnapshot | { id: string; data: () => Record<string, unknown> },
): NormalizeStoredListingResult {
  const raw = document.data() as Record<string, unknown>;
  return normalizeStoredMarketplaceListing(raw, document.id);
}

export function serializeMarketplaceListingsForClient(
  documents: Array<QueryDocumentSnapshot | { id: string; data: () => Record<string, unknown> }>,
): {
  listings: VehicleMarketplaceListingDTO[];
  rejectedCount: number;
  rejected: Array<{ index: number; listingIdMasked: string; field: string; reason: string }>;
} {
  const listings: VehicleMarketplaceListingDTO[] = [];
  const rejected: Array<{
    index: number;
    listingIdMasked: string;
    field: string;
    reason: string;
  }> = [];

  documents.forEach((document, index) => {
    const parsed = serializeMarketplaceListingDocument(document);
    if (parsed.ok) {
      listings.push(parsed.listing);
      return;
    }
    const maskedId =
      document.id.length > 6
        ? `${document.id.slice(0, 3)}…${document.id.slice(-2)}`
        : document.id;
    rejected.push({
      index,
      listingIdMasked: maskedId,
      field: parsed.field,
      reason: parsed.reason,
    });
  });

  return { listings, rejectedCount: rejected.length, rejected };
}

/** Client wire shape — millis timestamps, no undefined. */
export function listingDtoToClientWire(
  listing: VehicleMarketplaceListingDTO,
): Record<string, unknown> {
  return {
    id: listing.id,
    sellerUid: listing.sellerUid,
    sellerDisplayName: listing.sellerDisplayName,
    vehicleType: listing.vehicleType,
    truckSnapshot: listing.truckSnapshot,
    askingPrice: listing.askingPrice,
    recommendedPrice: listing.recommendedPrice,
    marketplaceFeeRate: listing.marketplaceFeeRate,
    status: listing.status,
    createdAt: listing.createdAtMs,
    updatedAt: listing.updatedAtMs,
    expiresAt: listing.expiresAtMs,
    ...(listing.soldAtMs != null ? { soldAt: listing.soldAtMs } : {}),
    ...(listing.buyerUid ? { buyerUid: listing.buyerUid } : {}),
    ...(listing.transactionId ? { transactionId: listing.transactionId } : {}),
    version: listing.version,
  };
}

export function serializeReconciliationVehicleForClient(
  vehicle: Record<string, unknown>,
): Record<string, unknown> | null {
  const snapshot = normalizeTruckSnapshot(vehicle);
  if (!snapshot) return null;
  const status =
    vehicle.status === 'marketplace_locked' || vehicle.status === 'idle'
      ? vehicle.status
      : 'idle';
  return {
    ...snapshot,
    status,
    marketplaceListingId:
      typeof vehicle.marketplaceListingId === 'string'
        ? vehicle.marketplaceListingId
        : null,
  };
}

export type MarketplaceListingDocumentCompat = Omit<
  MarketplaceListingDocument,
  'createdAt' | 'updatedAt' | 'expiresAt' | 'soldAt'
> & {
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expiresAt: Timestamp;
  soldAt?: Timestamp;
};
