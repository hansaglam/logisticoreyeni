/**
 * Signed-in vs guest cash authority policy (Map V2 Step 29D).
 *
 * Pure. No React. No Firebase. Does not mutate money.
 *
 * Target (not enabled): signed-in authoritative cash = serverState.current.cash.
 * Current production: ROAD/economy still mutate local save player.money.
 * Overlaying server cash onto the HUD would revert ROAD revenue and purchases.
 *
 * Outcome of this step: UNIFIED_SIGNED_IN_CASH_AUTHORITY_BLOCKED_ROAD_ECONOMY
 *
 * Step 29E adds canonical cash *transaction infrastructure* without overlay.
 * See canonicalCashOperation.ts. canUseServerAuthoritativeSettlement stays false.
 */

export const SIGNED_IN_CASH_AUTHORITY_TARGET = 'SERVER_STATE_CASH' as const;
export const GUEST_CASH_AUTHORITY = 'LOCAL_SAVE_PLAYER_MONEY' as const;
export const PROFILE_MONEY_AUTHORITY = 'NONE' as const;

export const SIGNED_IN_CASH_PATH = 'users/{uid}/serverState/current.cash' as const;
export const PROFILE_MONEY_PATH = 'users/{uid}.money' as const;
export const SAVE_BLOB_MONEY_PATH = 'users/{uid}/saves/current player.money' as const;

/** Not rolled out. Presence of serverState.cash alone is not a migration marker. */
export const CASH_AUTHORITY_VERSION_UNMIGRATED = 0 as const;
export const CASH_AUTHORITY_VERSION_SERVER_STATE_V1 = 1 as const;

export const UNIFIED_SIGNED_IN_CASH_AUTHORITY_STATUS =
  'UNIFIED_SIGNED_IN_CASH_AUTHORITY_BLOCKED_ROAD_ECONOMY' as const;

export const UNIFIED_CASH_BLOCK_REASON =
  'ROAD_ECONOMY_NOT_SERVER_CANONICAL_PRODUCTION_FLEET' as const;

export const ROAD_CASH_PATHS_NOT_FULLY_CANONICAL = 'ROAD_CASH_PATHS_NOT_FULLY_CANONICAL' as const;
export const FUEL_NOT_CANONICAL = 'FUEL_NOT_CANONICAL' as const;
export const CATALOG_PURCHASE_NOT_CANONICAL = 'CATALOG_PURCHASE_NOT_CANONICAL' as const;
export const WAREHOUSE_NOT_CANONICAL = 'WAREHOUSE_NOT_CANONICAL' as const;
export const CARGO_MARKET_NOT_CANONICAL = 'CARGO_MARKET_NOT_CANONICAL' as const;
export const REWARD_PATH_NOT_CANONICAL = 'REWARD_PATH_NOT_CANONICAL' as const;

export const SIGNED_IN_CASH_PATH_DIAGNOSTIC_REASONS = [
  ROAD_CASH_PATHS_NOT_FULLY_CANONICAL,
  FUEL_NOT_CANONICAL,
  CATALOG_PURCHASE_NOT_CANONICAL,
  WAREHOUSE_NOT_CANONICAL,
  CARGO_MARKET_NOT_CANONICAL,
  REWARD_PATH_NOT_CANONICAL,
] as const;

export const GUEST_TO_SIGNED_IN_CASH_MIGRATION = 'GUEST_TO_SIGNED_IN_CASH_MIGRATION_DEFERRED' as const;

export const SIGNED_IN_OFFLINE_CASH_POLICY =
  'SIGNED_IN_ROAD_LOCAL_CASH_MUTATIONS_REMAIN_ALLOWED_UNTIL_CANONICAL_ROAD_ECONOMY' as const;

export const AUTHORITATIVE_CASH_LISTENER_ENABLED = false;
export const AUTHORITATIVE_CASH_OVERLAY_ENABLED = false;
export const ARBITRARY_CLIENT_CASH_DELTA_API = false;

export type CashAuthorityMode =
  | 'LOCAL_GUEST_AUTHORITY'
  | 'SIGNED_IN_ROAD_LOCAL_SAVE_AUTHORITY'
  | 'SIGNED_IN_SERVER_STATE_CASH_AUTHORITY';

export type CashMutationClass =
  | 'REVENUE'
  | 'EXPENSE'
  | 'TRANSFER'
  | 'ADMIN_TEST'
  | 'LEGACY_PROFILE_MIRROR';

export type CashWriteAuditRow = {
  id: string;
  source: string;
  authMode: 'guest' | 'signed-in' | 'both' | 'server-only' | 'test-only';
  field: 'player.money' | 'serverState.cash' | 'marketplace.canonicalCash' | 'users/{uid}.money';
  clientOrServer: 'client' | 'server' | 'both';
  offline: boolean;
  idempotent: boolean;
  usedByRoad: boolean;
  usedByMarket: boolean;
  usedByPurchases: boolean;
  classification: CashMutationClass;
};

/**
 * Production cash mutation catalog (Step 29D audit).
 * Every live write path must appear here. Tests grep sources.
 */
export const PRODUCTION_CASH_WRITE_AUDIT: readonly CashWriteAuditRow[] = [
  {
    id: 'road-delivery-revenue',
    source: 'completeDeliveryById applyCashTransaction delivery:{id}:revenue',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: true,
    usedByRoad: true,
    usedByMarket: false,
    usedByPurchases: false,
    classification: 'REVENUE',
  },
  {
    id: 'road-delivery-completion-expenses',
    source: 'completeDeliveryById delivery:{id}:completion-expenses',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: true,
    usedByRoad: true,
    usedByMarket: false,
    usedByPurchases: false,
    classification: 'EXPENSE',
  },
  {
    id: 'road-delivery-fail-penalty',
    source: 'failDeliveryById applyCashTransaction',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: true,
    usedByRoad: true,
    usedByMarket: false,
    usedByPurchases: false,
    classification: 'EXPENSE',
  },
  {
    id: 'road-fuel',
    source: 'refuelTruck / roadside fuel voluntary-expense',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: true,
    usedByRoad: true,
    usedByMarket: false,
    usedByPurchases: true,
    classification: 'EXPENSE',
  },
  {
    id: 'daily-operating',
    source: 'processDailyOperatingCosts mandatory-expense',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: true,
    usedByRoad: true,
    usedByMarket: false,
    usedByPurchases: false,
    classification: 'EXPENSE',
  },
  {
    id: 'truck-purchase',
    source: 'buyTruck voluntary-expense',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: true,
    usedByRoad: true,
    usedByMarket: false,
    usedByPurchases: true,
    classification: 'EXPENSE',
  },
  {
    id: 'trailer-purchase',
    source: 'buyTrailer voluntary-expense',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: true,
    usedByRoad: true,
    usedByMarket: false,
    usedByPurchases: true,
    classification: 'EXPENSE',
  },
  {
    id: 'truck-lease',
    source: 'leaseTruck voluntary-expense',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: true,
    usedByRoad: true,
    usedByMarket: false,
    usedByPurchases: true,
    classification: 'EXPENSE',
  },
  {
    id: 'driver-hire',
    source: 'hireDriver voluntary-expense',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: true,
    usedByRoad: true,
    usedByMarket: false,
    usedByPurchases: true,
    classification: 'EXPENSE',
  },
  {
    id: 'truck-sale',
    source: 'sellTruck income',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: true,
    usedByRoad: true,
    usedByMarket: false,
    usedByPurchases: true,
    classification: 'REVENUE',
  },
  {
    id: 'driver-severance',
    source: 'fireDriver voluntary-expense',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: true,
    usedByRoad: true,
    usedByMarket: false,
    usedByPurchases: true,
    classification: 'EXPENSE',
  },
  {
    id: 'repair',
    source: 'repairTruck voluntary-expense',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: true,
    usedByRoad: true,
    usedByMarket: false,
    usedByPurchases: true,
    classification: 'EXPENSE',
  },
  {
    id: 'truck-upgrade',
    source: 'upgradeTruck voluntary-expense',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: true,
    usedByRoad: true,
    usedByMarket: false,
    usedByPurchases: true,
    classification: 'EXPENSE',
  },
  {
    id: 'warehouse-open',
    source: 'openWarehouse voluntary-expense',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: true,
    usedByRoad: false,
    usedByMarket: true,
    usedByPurchases: true,
    classification: 'EXPENSE',
  },
  {
    id: 'warehouse-upgrade',
    source: 'upgradeWarehouse voluntary-expense',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: true,
    usedByRoad: false,
    usedByMarket: true,
    usedByPurchases: true,
    classification: 'EXPENSE',
  },
  {
    id: 'cargo-buy',
    source: 'buyProductForWarehouse voluntary-expense',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: true,
    usedByRoad: false,
    usedByMarket: true,
    usedByPurchases: true,
    classification: 'EXPENSE',
  },
  {
    id: 'cargo-sell',
    source: 'sellProductFromWarehouse income',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: true,
    usedByRoad: false,
    usedByMarket: true,
    usedByPurchases: false,
    classification: 'REVENUE',
  },
  {
    id: 'vehicle-recovery',
    source: 'resolveVehicleStateIssue voluntary-expense',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: true,
    usedByRoad: true,
    usedByMarket: false,
    usedByPurchases: true,
    classification: 'EXPENSE',
  },
  {
    id: 'road-delivery-incident',
    source: 'resolveDeliveryIncident applyCashTransaction delivery:{id}:incident',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: true,
    usedByRoad: true,
    usedByMarket: false,
    usedByPurchases: false,
    classification: 'TRANSFER',
  },
  {
    id: 'ad-reward',
    source: 'applyAdReward income',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: false,
    idempotent: true,
    usedByRoad: false,
    usedByMarket: false,
    usedByPurchases: false,
    classification: 'REVENUE',
  },
  {
    id: 'mission-reward',
    source: 'claimMissionReward income',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: true,
    usedByRoad: false,
    usedByMarket: false,
    usedByPurchases: false,
    classification: 'REVENUE',
  },
  {
    id: 'milestone-reward',
    source: 'claimMilestoneReward income',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: true,
    usedByRoad: false,
    usedByMarket: false,
    usedByPurchases: false,
    classification: 'REVENUE',
  },
  {
    id: 'client-weekly-objective',
    source: 'claimWeeklyObjectiveReward income',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: true,
    usedByRoad: false,
    usedByMarket: false,
    usedByPurchases: false,
    classification: 'REVENUE',
  },
  {
    id: 'guest-multimodal-rail-settle',
    source: 'settleRailMultimodalShipmentInternal / commitMultimodalRailSettlement',
    authMode: 'guest',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: true,
    usedByRoad: false,
    usedByMarket: false,
    usedByPurchases: false,
    classification: 'REVENUE',
  },
  {
    id: 'debug-cash',
    source: 'debugAddCash debugRemoveCash debugSetCash',
    authMode: 'both',
    field: 'player.money',
    clientOrServer: 'client',
    offline: true,
    idempotent: false,
    usedByRoad: false,
    usedByMarket: false,
    usedByPurchases: false,
    classification: 'ADMIN_TEST',
  },
  {
    id: 'test-money-sync',
    source: 'testMoneySyncService users/{uid}.money overlay',
    authMode: 'test-only',
    field: 'users/{uid}.money',
    clientOrServer: 'client',
    offline: false,
    idempotent: false,
    usedByRoad: false,
    usedByMarket: false,
    usedByPurchases: false,
    classification: 'ADMIN_TEST',
  },
  {
    id: 'cloud-save-blob',
    source: 'cloudSaveService saves/current player.money LWW',
    authMode: 'signed-in',
    field: 'player.money',
    clientOrServer: 'client',
    offline: false,
    idempotent: false,
    usedByRoad: true,
    usedByMarket: true,
    usedByPurchases: true,
    classification: 'LEGACY_PROFILE_MIRROR',
  },
  {
    id: 'profile-money-write',
    source: 'cloudSaveService users/{uid}.money (omitted if TEST_MONEY_SYNC)',
    authMode: 'signed-in',
    field: 'users/{uid}.money',
    clientOrServer: 'client',
    offline: false,
    idempotent: false,
    usedByRoad: false,
    usedByMarket: false,
    usedByPurchases: false,
    classification: 'LEGACY_PROFILE_MIRROR',
  },
  {
    id: 'marketplace-purchase',
    source: 'purchaseVehicleListingTransaction canonicalCash + serverState.cash',
    authMode: 'signed-in',
    field: 'serverState.cash',
    clientOrServer: 'server',
    offline: false,
    idempotent: true,
    usedByRoad: false,
    usedByMarket: true,
    usedByPurchases: true,
    classification: 'TRANSFER',
  },
  {
    id: 'marketplace-listing-fee',
    source: 'createVehicleListingTransaction listing fee',
    authMode: 'signed-in',
    field: 'serverState.cash',
    clientOrServer: 'server',
    offline: false,
    idempotent: true,
    usedByRoad: false,
    usedByMarket: true,
    usedByPurchases: true,
    classification: 'EXPENSE',
  },
  {
    id: 'marketplace-reconcile-overlay',
    source: 'applyVehicleMarketplaceReconciliation authoritativeCash',
    authMode: 'signed-in',
    field: 'player.money',
    clientOrServer: 'both',
    offline: false,
    idempotent: true,
    usedByRoad: false,
    usedByMarket: true,
    usedByPurchases: true,
    classification: 'TRANSFER',
  },
  {
    id: 'weekly-mission-claim-server',
    source: 'claimWeeklyMissionRewardTransaction',
    authMode: 'server-only',
    field: 'serverState.cash',
    clientOrServer: 'server',
    offline: false,
    idempotent: true,
    usedByRoad: false,
    usedByMarket: false,
    usedByPurchases: false,
    classification: 'REVENUE',
  },
  {
    id: 'season-reward-claim-server',
    source: 'claimSeasonRewardTransaction',
    authMode: 'server-only',
    field: 'serverState.cash',
    clientOrServer: 'server',
    offline: false,
    idempotent: true,
    usedByRoad: false,
    usedByMarket: false,
    usedByPurchases: false,
    classification: 'REVENUE',
  },
  {
    id: 'challenge-claim-server',
    source: 'claimChallengeRewardTransaction',
    authMode: 'server-only',
    field: 'serverState.cash',
    clientOrServer: 'server',
    offline: false,
    idempotent: true,
    usedByRoad: false,
    usedByMarket: false,
    usedByPurchases: false,
    classification: 'REVENUE',
  },
  {
    id: 'legacy-serverstate-bootstrap',
    source: 'migrateLegacyServerStateTransaction / buildBoundedLegacyMigrationFromCloudSave',
    authMode: 'signed-in',
    field: 'serverState.cash',
    clientOrServer: 'server',
    offline: false,
    idempotent: true,
    usedByRoad: false,
    usedByMarket: true,
    usedByPurchases: false,
    classification: 'TRANSFER',
  },
] as const;

export type CashAuthorityAuthInput = {
  signedInLinked: boolean;
  cashAuthorityVersion?: number;
};

export type CashAuthorityResolution = {
  mode: CashAuthorityMode;
  authoritativeField:
    | typeof SIGNED_IN_CASH_PATH
    | 'local player.money'
    | typeof SAVE_BLOB_MONEY_PATH;
  savePlayerMoneyRole: 'LOCAL_AUTHORITY' | 'CACHE_MIRROR_NOT_YET' | 'CACHE_MIRROR';
  profileMoneyRole: typeof PROFILE_MONEY_AUTHORITY;
  cashAuthorityVersion: number;
  overlayEnabled: boolean;
  listenerEnabled: boolean;
  blockReason: typeof UNIFIED_CASH_BLOCK_REASON | null;
};

export function getCashAuthority(auth: CashAuthorityAuthInput): CashAuthorityResolution {
  if (!auth.signedInLinked) {
    return {
      mode: 'LOCAL_GUEST_AUTHORITY',
      authoritativeField: 'local player.money',
      savePlayerMoneyRole: 'LOCAL_AUTHORITY',
      profileMoneyRole: PROFILE_MONEY_AUTHORITY,
      cashAuthorityVersion: CASH_AUTHORITY_VERSION_UNMIGRATED,
      overlayEnabled: false,
      listenerEnabled: false,
      blockReason: null,
    };
  }
  return {
    mode: 'SIGNED_IN_ROAD_LOCAL_SAVE_AUTHORITY',
    authoritativeField: SAVE_BLOB_MONEY_PATH,
    savePlayerMoneyRole: 'CACHE_MIRROR_NOT_YET',
    profileMoneyRole: PROFILE_MONEY_AUTHORITY,
    cashAuthorityVersion: CASH_AUTHORITY_VERSION_UNMIGRATED,
    overlayEnabled: AUTHORITATIVE_CASH_OVERLAY_ENABLED,
    listenerEnabled: AUTHORITATIVE_CASH_LISTENER_ENABLED,
    blockReason: UNIFIED_CASH_BLOCK_REASON,
  };
}

export type ServerAuthoritativeSettlementReadiness = {
  ready: boolean;
  reason: string;
  cashPathReason?: string;
  cashPathBlockers?: readonly string[];
};

/**
 * Future settleCanonicalMultimodalShipment gate.
 * FALSE until ROAD credits/debits are server-canonical and overlay is proven.
 */
export function canUseServerAuthoritativeSettlement(input: {
  signedInLinked: boolean;
  cashAuthorityVersion?: number;
  serverStateCashPresent?: boolean;
  reconciliationActive?: boolean;
  staleSaveProtectionActive?: boolean;
}): ServerAuthoritativeSettlementReadiness {
  if (!input.signedInLinked) {
    return { ready: false, reason: 'GUEST_LOCAL_AUTHORITY' };
  }
  if (!AUTHORITATIVE_CASH_OVERLAY_ENABLED || !AUTHORITATIVE_CASH_LISTENER_ENABLED) {
    return {
      ready: false,
      reason: UNIFIED_CASH_BLOCK_REASON,
      cashPathReason: ROAD_CASH_PATHS_NOT_FULLY_CANONICAL,
      cashPathBlockers: SIGNED_IN_CASH_PATH_DIAGNOSTIC_REASONS,
    };
  }
  if (input.cashAuthorityVersion !== CASH_AUTHORITY_VERSION_SERVER_STATE_V1) {
    return { ready: false, reason: 'CASH_AUTHORITY_VERSION_UNSUPPORTED' };
  }
  if (!input.serverStateCashPresent) {
    return { ready: false, reason: 'SERVER_STATE_CASH_MISSING' };
  }
  if (!input.reconciliationActive || !input.staleSaveProtectionActive) {
    return { ready: false, reason: 'RECONCILIATION_INACTIVE' };
  }
  return { ready: true, reason: 'READY' };
}

export function simulateAuthoritativeCashWins(input: {
  saveMoney: number;
  serverCash: number;
  overlayEnabled?: boolean;
}): { displayed: number; serverUnchanged: number; overlayApplied: boolean } {
  const overlay = input.overlayEnabled ?? AUTHORITATIVE_CASH_OVERLAY_ENABLED;
  if (!overlay) {
    return {
      displayed: input.saveMoney,
      serverUnchanged: input.serverCash,
      overlayApplied: false,
    };
  }
  return {
    displayed: input.serverCash,
    serverUnchanged: input.serverCash,
    overlayApplied: true,
  };
}
