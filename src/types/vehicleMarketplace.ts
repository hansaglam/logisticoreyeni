import type { TruckUpgrades } from './game';

export type VehicleMarketplaceListingStatus =
  | 'active'
  | 'sold'
  | 'cancelled'
  | 'expired'
  | 'reserved';

export interface TransferableTruckSnapshot {
  truckId: string;
  templateId: string;
  customName?: string;
  currentCityId: string;
  condition: number;
  totalMileageKm: number;
  currentFuelL: number;
  fuelTankCapacityL: number;
  upgrades?: TruckUpgrades;
  acquiredAt?: number;
  visualCustomization?: Record<string, string>;
}

export interface VehicleMarketplaceListing {
  id: string;
  sellerUid: string;
  sellerDisplayName: string;
  vehicleType: 'truck';
  truckSnapshot: TransferableTruckSnapshot;
  askingPrice: number;
  recommendedPrice: number;
  marketplaceFeeRate: number;
  status: VehicleMarketplaceListingStatus;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  soldAt?: number;
  buyerUid?: string;
  transactionId?: string;
  version: number;
}

export type VehicleMarketplaceFailureReason =
  | 'auth-required'
  | 'username-required'
  | 'marketplace-state-missing'
  | 'network-error'
  | 'function-not-found'
  | 'permission-denied'
  | 'service-unavailable'
  | 'unauthenticated'
  | 'invalid-request'
  | 'truck-not-found'
  | 'not-owner'
  | 'truck-busy'
  | 'driver-attached'
  | 'trailer-attached'
  | 'active-job'
  | 'already-listed'
  | 'leased-truck'
  | 'starter-protection'
  | 'invalid-price'
  | 'unsupported-truck'
  | 'save-conflict'
  | 'listing-not-found'
  | 'listing-not-active'
  | 'stale-listing-version'
  | 'self-purchase'
  | 'insufficient-funds'
  | 'fleet-limit'
  | 'rate-limited'
  | 'already-completed'
  | 'marketplace-unavailable';

export interface VehicleMarketplaceActionResult<T = undefined> {
  ok: boolean;
  reason?: VehicleMarketplaceFailureReason;
  transactionId: string;
  idempotencyKey: string;
  data?: T;
  retryCount?: number;
}

/** Local/cloud save yalnız backend görünümünün küçük bir referans cache'ini tutar. */
export interface VehicleMarketplaceSaveCache {
  activeMarketplaceListingIds: string[];
  lastMarketplaceSyncAt?: number;
  marketplaceStateVersion?: number;
  soldTruckIds?: string[];
}

export interface VehicleMarketplaceCursor {
  createdAt: number;
  id: string;
}

export interface VehicleMarketplacePage {
  ok: boolean;
  listings: VehicleMarketplaceListing[];
  nextCursor?: VehicleMarketplaceCursor;
  hasMore: boolean;
  reason?: VehicleMarketplaceFailureReason;
}

export interface VehicleMarketplaceStateSummary {
  created: boolean;
  marketplaceStateVersion: number;
  sourceSaveVersion: number;
  hasMarketplaceState: boolean;
}
