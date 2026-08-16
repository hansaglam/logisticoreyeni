import type { Timestamp } from 'firebase-admin/firestore';

import type { MarketplaceVehicleRecord } from './vehicleMarketplaceTypes';

export const SERVER_STATE_SCHEMA_VERSION = 1;

export type ServerStateMigrationSource =
  | 'default'
  | 'marketplace'
  | 'legacy-save'
  | 'ledger';

export interface ServerOwnedWarehouseSnapshot {
  id: string;
  cityId: string;
  capacityTons: number;
  upgradeTier: number;
}

export interface ServerOwnedTruckRecord {
  truckId: string;
  templateId: string;
  customName?: string;
  currentCityId: string;
  condition: number;
  totalMileageKm: number;
  currentFuelL: number;
  fuelTankCapacityL: number;
  purchasePrice: number;
  ownershipType: 'owned';
  status: MarketplaceVehicleRecord['status'];
  assignedDriverId?: string | null;
  attachedTrailerId?: string | null;
  activeJobIds?: string[];
  marketplaceListingId?: string | null;
  upgrades: {
    engine: number;
    fuelEfficiency: number;
    cargo: number;
    durability: number;
  };
}

export interface ServerStateDocument {
  ownerUid: string;
  cash: number;
  ownedTruckIds: string[];
  ownedTrailerIds: string[];
  ownedTrucks: ServerOwnedTruckRecord[];
  warehouses: ServerOwnedWarehouseSnapshot[];
  companyLevel: number;
  reputation: number;
  completedDeliveries: number;
  failedDeliveries: number;
  lateDeliveries: number;
  companyName: string;
  leaderboardScore: number;
  schemaVersion: number;
  initialized: boolean;
  migrationCompleted: boolean;
  migrationSource: ServerStateMigrationSource;
  sourceVersion: number;
  suspiciousFlags: string[];
  updatedAt: Timestamp;
  createdAt: Timestamp;
  leaderboardSeasonKey?: string;
  weeklySeasonBaselineCompleted?: number;
}

export type ServerStateFailureReason =
  | 'server-state-not-initialized'
  | 'server-state-conflict'
  | 'migration-already-completed'
  | 'save-not-found'
  | 'invalid-player-state';

export interface LegacyMigrationReport {
  uid: string;
  dryRun: boolean;
  migrated: boolean;
  rejected: boolean;
  suspicious: boolean;
  flags: string[];
  reason?: string;
  cashBefore?: number;
  cashAfter?: number;
  truckCountBefore?: number;
  truckCountAfter?: number;
}
