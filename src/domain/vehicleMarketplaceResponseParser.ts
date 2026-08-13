import type {
  VehicleMarketplaceCursor,
  VehicleMarketplaceFailureReason,
  VehicleMarketplaceListing,
  VehicleMarketplacePage,
} from '../types/vehicleMarketplace';

export const VEHICLE_MARKETPLACE_CLIENT_API_VERSION = 1;

type TimestampLike =
  | number
  | string
  | {
      seconds?: number;
      _seconds?: number;
      nanoseconds?: number;
      _nanoseconds?: number;
      toMillis?: () => number;
    }
  | null
  | undefined;

export type MarketplaceParseResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      reason: VehicleMarketplaceFailureReason;
      field?: string;
      detail?: string;
    };

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
  if (typeof value === 'object') {
    if (typeof value.toMillis === 'function') {
      const millis = value.toMillis();
      return Number.isFinite(millis) ? Math.floor(millis) : null;
    }
    const seconds = value.seconds ?? value._seconds;
    if (Number.isFinite(seconds)) {
      const nanos = value.nanoseconds ?? value._nanoseconds ?? 0;
      return Math.floor(Number(seconds) * 1_000 + Number(nanos) / 1_000_000);
    }
  }
  return null;
}

function maskListingId(id: string): string {
  return id.length > 6 ? `${id.slice(0, 3)}…${id.slice(-2)}` : id;
}

function normalizeStatus(value: unknown): VehicleMarketplaceListing['status'] | null {
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

function normalizeCondition(value: unknown): number | null {
  const parsed = finiteNumber(value, { min: 0 });
  if (parsed == null) return null;
  if (parsed <= 1) return Math.round(parsed * 100);
  return Math.min(100, Math.round(parsed));
}

function parseTruckSnapshot(raw: unknown): VehicleMarketplaceListing['truckSnapshot'] | null {
  const source = record(raw);
  const truckId =
    typeof source.truckId === 'string'
      ? source.truckId
      : typeof source.id === 'string'
        ? source.id
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

  const condition = normalizeCondition(source.condition);
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

  return {
    truckId,
    templateId,
    ...(typeof source.customName === 'string' && source.customName.trim().length > 0
      ? { customName: source.customName.trim() }
      : {}),
    currentCityId,
    condition,
    totalMileageKm,
    currentFuelL,
    fuelTankCapacityL,
    ...(upgrades ? { upgrades } : {}),
    ...(timestampToMillis(source.acquiredAt as TimestampLike) != null
      ? { acquiredAt: timestampToMillis(source.acquiredAt as TimestampLike)! }
      : {}),
  };
}

export function parseVehicleMarketplaceListing(
  raw: unknown,
  index: number,
): MarketplaceParseResult<VehicleMarketplaceListing> {
  const source = record(raw);
  const id = typeof source.id === 'string' ? source.id : '';
  if (!id) {
    return {
      success: false,
      reason: 'invalid-request',
      field: 'id',
      detail: 'missing-id',
    };
  }

  const sellerUid = typeof source.sellerUid === 'string' ? source.sellerUid : '';
  if (!sellerUid) {
    return {
      success: false,
      reason: 'invalid-request',
      field: 'sellerUid',
      detail: 'missing-seller-uid',
    };
  }

  const truckSnapshot = parseTruckSnapshot(source.truckSnapshot ?? source.truck);
  if (!truckSnapshot) {
    return {
      success: false,
      reason: 'invalid-request',
      field: 'truckSnapshot',
      detail: 'invalid-truck-snapshot',
    };
  }

  const askingPrice = finiteNumber(source.askingPrice ?? source.price, {
    min: 0,
    integer: true,
  });
  const recommendedPrice = finiteNumber(source.recommendedPrice, {
    min: 0,
    integer: true,
  });
  const marketplaceFeeRate = finiteNumber(source.marketplaceFeeRate, { min: 0 });
  const version = finiteNumber(source.version, { min: 1, integer: true });
  const status = normalizeStatus(source.status);
  const createdAt =
    timestampToMillis(source.createdAtMs as TimestampLike) ??
    timestampToMillis(source.createdAt as TimestampLike);
  const updatedAt =
    timestampToMillis(source.updatedAtMs as TimestampLike) ??
    timestampToMillis(source.updatedAt as TimestampLike);
  const expiresAt =
    timestampToMillis(source.expiresAtMs as TimestampLike) ??
    timestampToMillis(source.expiresAt as TimestampLike);

  if (
    askingPrice == null ||
    recommendedPrice == null ||
    marketplaceFeeRate == null ||
    version == null ||
    !status ||
    createdAt == null ||
    updatedAt == null ||
    expiresAt == null
  ) {
    logInvalidListing({
      index,
      listingIdMasked: maskListingId(id),
      field: 'listing',
      reason: 'invalid-fields',
      receivedType: typeof raw,
    });
    return {
      success: false,
      reason: 'invalid-request',
      field: 'listing',
      detail: 'invalid-fields',
    };
  }

  const soldAt =
    timestampToMillis(source.soldAtMs as TimestampLike) ??
    timestampToMillis(source.soldAt as TimestampLike);

  return {
    success: true,
    data: {
      id,
      sellerUid,
      sellerDisplayName:
        typeof source.sellerDisplayName === 'string' &&
        source.sellerDisplayName.trim().length > 0
          ? source.sellerDisplayName.trim()
          : typeof source.sellerName === 'string' && source.sellerName.trim().length > 0
            ? source.sellerName.trim()
            : 'Anonim satıcı',
      vehicleType: 'truck',
      truckSnapshot,
      askingPrice,
      recommendedPrice,
      marketplaceFeeRate,
      status,
      createdAt,
      updatedAt,
      expiresAt,
      ...(soldAt != null ? { soldAt } : {}),
      ...(typeof source.buyerUid === 'string' ? { buyerUid: source.buyerUid } : {}),
      ...(typeof source.transactionId === 'string'
        ? { transactionId: source.transactionId }
        : {}),
      version,
    },
  };
}

function parseCursor(raw: unknown): VehicleMarketplaceCursor | null {
  const source = record(raw);
  const id = typeof source.id === 'string' ? source.id : '';
  const createdAt =
    timestampToMillis(source.createdAtMs as TimestampLike) ??
    timestampToMillis(source.createdAt as TimestampLike);
  if (!id || createdAt == null || createdAt <= 0) return null;
  return { id, createdAt };
}

export function logVehicleMarketplaceResponse(payload: {
  stage: 'list' | 'my-listings';
  successFieldType?: string;
  dataPresent?: boolean;
  listingsPresent?: boolean;
  listingsType?: string;
  listingCount?: number;
  firstListingKeys?: string[];
  invalidListingIndex?: number;
  invalidListingIdMasked?: string;
  invalidField?: string;
  expectedType?: string;
  receivedType?: string;
  firestoreTimestampDetected?: boolean;
  errorCode?: string | null;
  rejectedCount?: number;
}): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  console.info('[vehicle-marketplace-response]', payload);
}

export function logInvalidListing(payload: {
  index: number;
  listingIdMasked: string;
  field: string;
  reason: string;
  receivedType?: string;
}): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  console.warn('[vehicle-marketplace-invalid-listing]', payload);
}

export function parseVehicleMarketplaceListResponse(
  raw: unknown,
  stage: 'list' | 'my-listings' = 'list',
): MarketplaceParseResult<VehicleMarketplacePage> {
  const envelope = record(raw);
  const explicitOk = envelope.ok;
  const listingsRaw = envelope.listings;
  const hasListingsArray = Array.isArray(listingsRaw);
  const ok =
    explicitOk === true ||
    (explicitOk === undefined && hasListingsArray);

  logVehicleMarketplaceResponse({
    stage,
    successFieldType: typeof explicitOk,
    dataPresent: Object.keys(envelope).length > 0,
    listingsPresent: listingsRaw != null,
    listingsType: Array.isArray(listingsRaw) ? 'array' : typeof listingsRaw,
    listingCount: hasListingsArray ? listingsRaw.length : 0,
    firstListingKeys:
      hasListingsArray && listingsRaw[0] && typeof listingsRaw[0] === 'object'
        ? Object.keys(record(listingsRaw[0])).slice(0, 12)
        : undefined,
    firestoreTimestampDetected: hasListingsArray
      ? listingsRaw.some((entry) => {
          const createdAt = record(entry).createdAt;
          return (
            createdAt != null &&
            typeof createdAt === 'object' &&
            ('seconds' in (createdAt as object) || '_seconds' in (createdAt as object))
          );
        })
      : false,
    errorCode: typeof envelope.reason === 'string' ? envelope.reason : null,
    rejectedCount:
      typeof envelope.rejectedCount === 'number' ? envelope.rejectedCount : undefined,
  });

  if (!ok) {
    const reason =
      typeof envelope.reason === 'string'
        ? (envelope.reason as VehicleMarketplaceFailureReason)
        : 'invalid-request';
    return {
      success: false,
      reason,
      field: 'envelope',
      detail: 'ok-false-or-missing-listings',
    };
  }

  if (!hasListingsArray) {
    return {
      success: false,
      reason: 'invalid-request',
      field: 'listings',
      detail: 'listings-not-array',
    };
  }

  const apiVersion = finiteNumber(envelope.apiVersion, { min: 1, integer: true });
  if (
    apiVersion != null &&
    apiVersion > VEHICLE_MARKETPLACE_CLIENT_API_VERSION
  ) {
    return {
      success: false,
      reason: 'invalid-request',
      field: 'apiVersion',
      detail: 'unsupported-response-version',
    };
  }

  const listings: VehicleMarketplaceListing[] = [];
  listingsRaw.forEach((entry, index) => {
    const parsed = parseVehicleMarketplaceListing(entry, index);
    if (parsed.success) {
      listings.push(parsed.data);
      return;
    }
    logInvalidListing({
      index,
      listingIdMasked:
        typeof record(entry).id === 'string'
          ? maskListingId(String(record(entry).id))
          : `#${index}`,
      field: parsed.field ?? 'listing',
      reason: parsed.detail ?? 'invalid-listing',
      receivedType: typeof entry,
    });
  });

  const nextCursor = parseCursor(envelope.nextCursor);
  const hasMore = Boolean(envelope.hasMore);

  return {
    success: true,
    data: {
      ok: true,
      listings,
      hasMore,
      ...(nextCursor ? { nextCursor } : {}),
    },
  };
}

export function parseVehicleMarketplaceMyListingsResponse(raw: unknown): MarketplaceParseResult<{
  ok: boolean;
  listings: VehicleMarketplaceListing[];
  reconciliation?: Record<string, unknown> | null;
  reason?: VehicleMarketplaceFailureReason;
}> {
  const parsed = parseVehicleMarketplaceListResponse(raw, 'my-listings');
  if (!parsed.success) {
    return parsed;
  }
  const envelope = record(raw);
  return {
    success: true,
    data: {
      ok: true,
      listings: parsed.data.listings,
      reconciliation:
        envelope.reconciliation === null || envelope.reconciliation === undefined
          ? null
          : record(envelope.reconciliation),
    },
  };
}
