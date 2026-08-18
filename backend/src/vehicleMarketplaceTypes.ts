import type { Timestamp } from 'firebase-admin/firestore';

export type MarketplaceListingStatus =
  | 'active'
  | 'sold'
  | 'cancelled'
  | 'expired'
  | 'reserved';

export interface MarketplaceTruckSnapshot {
  truckId: string;
  templateId: string;
  customName?: string;
  currentCityId: string;
  condition: number;
  totalMileageKm: number;
  currentFuelL: number;
  fuelTankCapacityL: number;
  upgrades?: {
    engine: number;
    fuelEfficiency: number;
    cargo: number;
    durability: number;
  };
  acquiredAt?: number;
  visualCustomization?: Record<string, string>;
}

export interface MarketplaceVehicleRecord extends MarketplaceTruckSnapshot {
  purchasePrice: number;
  ownershipType: 'owned' | 'leased';
  status:
    | 'idle'
    | 'on_route'
    | 'maintenance'
    | 'transferring'
    | 'out_of_fuel'
    | 'marketplace_locked';
  assignedDriverId?: string | null;
  attachedTrailerId?: string | null;
  activeJobIds?: string[];
  marketplaceListingId?: string | null;
}

export interface MarketplacePlayerState {
  ownerUid: string;
  canonicalCash: number;
  fleetLimit: number;
  stateVersion: number;
  sourceSaveVersion: number;
  syncConflict?: boolean;
  ownedTruckSnapshots: MarketplaceVehicleRecord[];
  activeListingIds: string[];
  soldTruckTombstones: string[];
  migratedAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface MarketplaceListingDocument {
  id: string;
  sellerUid: string;
  sellerDisplayName: string;
  vehicleType: 'truck';
  truckSnapshot: MarketplaceTruckSnapshot;
  askingPrice: number;
  recommendedPrice: number;
  marketplaceFeeRate: number;
  status: MarketplaceListingStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expiresAt: Timestamp;
  soldAt?: Timestamp;
  buyerUid?: string;
  transactionId?: string;
  version: number;
}

export type MarketplaceFailureReason =
  | 'username-required'
  | 'auth-required'
  | 'marketplace-state-missing'
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
  | 'listing-sold'
  | 'stale-listing-version'
  | 'self-purchase'
  | 'insufficient-funds'
  | 'fleet-limit'
  | 'rate-limited'
  | 'already-completed';

export interface MarketplaceActionResult<T = Record<string, unknown>> {
  ok: boolean;
  reason?: MarketplaceFailureReason;
  transactionId: string;
  idempotencyKey: string;
  data?: T;
  retryCount?: number;
}

export interface MarketplaceActionIdentity {
  uid: string;
  displayName?: string | null;
}

export interface CreateVehicleListingInput {
  transactionId: string;
  idempotencyKey: string;
  truckId: string;
  askingPrice: number;
  clientSaveVersion?: number;
}

export interface EnsureVehicleMarketplaceStateInput {
  transactionId: string;
  idempotencyKey: string;
  clientSaveVersion?: number;
}

export interface CancelVehicleListingInput {
  transactionId: string;
  idempotencyKey: string;
  listingId: string;
  listingVersion: number;
}

export interface PurchaseVehicleListingInput {
  transactionId: string;
  idempotencyKey: string;
  listingId: string;
  listingVersion: number;
  quotedPrice: number;
  clientSaveVersion?: number;
}
