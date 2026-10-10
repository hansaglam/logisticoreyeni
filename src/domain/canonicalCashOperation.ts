/**
 * Canonical signed-in ROAD cash operations (Map V2 Step 29E).
 *
 * Pure. No React. No Firebase.
 *
 * This module classifies production cash writes and defines operation identity.
 * It does not mutate money and does not enable HUD overlay or multimodal settlement.
 *
 * Transaction cashAuthorityVersion (schema) is independent of account migration
 * (users remain CASH_AUTHORITY_VERSION_UNMIGRATED = 0).
 */

export const CANONICAL_ROAD_CASH_OPERATIONS_FOUNDATION_STATUS =
  'CANONICAL_ROAD_CASH_OPERATIONS_FOUNDATION_PASS' as const;

export const CANONICAL_CASH_TRANSACTIONS_PATH =
  'users/{uid}/canonicalCashTransactions/{transactionId}' as const;

export const CANONICAL_CASH_CURRENCY = 'USD_GAME_INTEGER' as const;

/** Schema version stored on each canonical cash transaction document. */
export const CANONICAL_CASH_TRANSACTION_AUTHORITY_VERSION = 1 as const;

/**
 * Account-wide HUD/save migration. Must stay 0 until ROAD economy is canonical
 * and overlay is proven. Distinct from CANONICAL_CASH_TRANSACTION_AUTHORITY_VERSION.
 */
export const ACCOUNT_CASH_AUTHORITY_MIGRATION_VERSION_UNMIGRATED = 0 as const;

export const ROAD_DELIVERY_CANONICAL_STATUS =
  'ROAD_DELIVERY_SERVER_SETTLEMENT_BLOCKED_MISSING_CANONICAL_DELIVERY' as const;

export const FUEL_PURCHASE_CANONICAL_STATUS =
  'FUEL_CASH_AUTHORITY_INTERNAL_TEST_PROGRESSIVE_PUBLIC_BLOCKED' as const;

export const CATALOG_TRUCK_PURCHASE_CANONICAL_STATUS =
  'CATALOG_TRUCK_PURCHASE_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED' as const;

export const CANONICAL_ROAD_DELIVERIES_PATH_RESERVED =
  'users/{uid}/canonicalRoadDeliveries/{deliveryId}' as const;

export type CashCanonicalizationReadiness =
  | 'CANONICAL_READY_NOW'
  | 'CANONICAL_READY_WITH_SMALL_SERVER_PORT'
  | 'BLOCKED_MISSING_SERVER_STATE'
  | 'BLOCKED_CLIENT_ONLY_GAMEPLAY_CONTEXT'
  | 'LOCAL_ONLY_DEBUG'
  | 'LEGACY_TEST_ONLY';

export type CanonicalCashOperationType =
  | 'INTERNAL_TEST_CREDIT'
  | 'INTERNAL_TEST_DEBIT'
  | 'MARKETPLACE_PURCHASE'
  | 'MARKETPLACE_LISTING_FEE'
  | 'CANONICAL_REWARD'
  | 'ROAD_DELIVERY_SETTLEMENT'
  | 'CANONICAL_FLEET_REPAIR'
  | 'CANONICAL_FLEET_UPGRADE'
  | 'CANONICAL_ROAD_INCIDENT'
  | 'FUEL_PURCHASE'
  | 'TRUCK_PURCHASE'
  | 'TRAILER_PURCHASE'
  | 'CANONICAL_CATALOG_PURCHASE'
  | 'CANONICAL_FUEL_PURCHASE'
  | 'CANONICAL_VEHICLE_LEASE_START'
  | 'CANONICAL_DRIVER_HIRE'
  | 'CANONICAL_DRIVER_FIRE'
  | 'CANONICAL_VEHICLE_SALE'
  | 'CANONICAL_DAILY_OPEX'
  | 'CANONICAL_WAREHOUSE_OPEN'
  | 'CANONICAL_WAREHOUSE_UPGRADE'
  | 'CANONICAL_CARGO_BUY'
  | 'CANONICAL_CARGO_SELL'
  | 'CANONICAL_MISSION_REWARD'
  | 'CANONICAL_MILESTONE_REWARD'
  | 'MULTIMODAL_SETTLEMENT';

export type CanonicalCashOperationSpec = {
  type: CanonicalCashOperationType;
  readiness: CashCanonicalizationReadiness;
  productionCallable: boolean;
  existingCallable?: string;
  notes: string;
};

export const CANONICAL_CASH_OPERATION_SPECS: readonly CanonicalCashOperationSpec[] = [
  {
    type: 'INTERNAL_TEST_CREDIT',
    readiness: 'LOCAL_ONLY_DEBUG',
    productionCallable: false,
    notes: 'Backend helper unit tests only. Not an onCall. Not HUD.',
  },
  {
    type: 'INTERNAL_TEST_DEBIT',
    readiness: 'LOCAL_ONLY_DEBUG',
    productionCallable: false,
    notes: 'Backend helper unit tests only. Not an onCall. Not HUD.',
  },
  {
    type: 'MARKETPLACE_PURCHASE',
    readiness: 'CANONICAL_READY_NOW',
    productionCallable: true,
    existingCallable: 'purchaseVehicleListing',
    notes: 'Existing server debit of marketplace.canonicalCash + serverState.cash.',
  },
  {
    type: 'MARKETPLACE_LISTING_FEE',
    readiness: 'CANONICAL_READY_NOW',
    productionCallable: true,
    existingCallable: 'createVehicleListing',
    notes: 'Existing server listing-fee debit. Do not duplicate.',
  },
  {
    type: 'CANONICAL_REWARD',
    readiness: 'CANONICAL_READY_NOW',
    productionCallable: true,
    existingCallable: 'claimWeeklyMissionReward / claimSeasonReward / claimChallengeReward',
    notes: 'Server-derived cash; client cannot choose amount. Dual-writes marketplace + serverState.',
  },
  {
    type: 'ROAD_DELIVERY_SETTLEMENT',
    readiness: 'BLOCKED_MISSING_SERVER_STATE',
    productionCallable: false,
    notes:
      'Production completeDeliveryById still local. INTERNAL_TEST shadow settleCanonicalRoadDeliveryInternal mutates serverState.cash only. HUD not authority.',
  },
  {
    type: 'CANONICAL_FLEET_REPAIR',
    readiness: 'BLOCKED_MISSING_SERVER_STATE',
    productionCallable: false,
    notes:
      'INTERNAL_TEST repairCanonicalFleetAsset debit. Production repairTruck remains local. HUD not authority.',
  },
  {
    type: 'CANONICAL_FLEET_UPGRADE',
    readiness: 'BLOCKED_MISSING_SERVER_STATE',
    productionCallable: false,
    notes:
      'INTERNAL_TEST upgradeCanonicalFleetAsset debit. Production upgradeTruck remains local. HUD not authority.',
  },
  {
    type: 'CANONICAL_ROAD_INCIDENT',
    readiness: 'BLOCKED_MISSING_SERVER_STATE',
    productionCallable: false,
    notes:
      'INTERNAL_TEST finalizeCanonicalRoadExecution catalog cash. Production resolveDeliveryIncident remains local.',
  },
  {
    type: 'FUEL_PURCHASE',
    readiness: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    productionCallable: false,
    notes: FUEL_PURCHASE_CANONICAL_STATUS,
  },
  {
    type: 'CANONICAL_FUEL_PURCHASE',
    readiness: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    productionCallable: false,
    existingCallable: 'purchaseCanonicalFuel',
    notes:
      'INTERNAL_TEST purchaseCanonicalFuel. Public refuelTruck local. Production consumption remains progressive.',
  },
  {
    type: 'TRUCK_PURCHASE',
    readiness: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    productionCallable: false,
    notes: CATALOG_TRUCK_PURCHASE_CANONICAL_STATUS,
  },
  {
    type: 'TRAILER_PURCHASE',
    readiness: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    productionCallable: false,
    notes: 'CATALOG_TRAILER_PURCHASE_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED',
  },
  {
    type: 'CANONICAL_CATALOG_PURCHASE',
    readiness: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    productionCallable: false,
    existingCallable: 'purchaseCanonicalCatalogAsset',
    notes:
      'INTERNAL_TEST only. Server derives catalog price+model. Public buyTruck/buyTrailer remain local.',
  },
  {
    type: 'CANONICAL_VEHICLE_LEASE_START',
    readiness: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    productionCallable: false,
    existingCallable: 'createCanonicalVehicleLease',
    notes:
      'INTERNAL_TEST prepaid lease from TRUCK_MARKET.weeklyLeaseCost. Recurring not billed here. Public leaseTruck local.',
  },
  {
    type: 'CANONICAL_DRIVER_HIRE',
    readiness: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    productionCallable: false,
    existingCallable: 'hireCanonicalDriver',
    notes: 'INTERNAL_TEST DRIVER_POOL catalog. Company level not server-owned. Public hireDriver local.',
  },
  {
    type: 'CANONICAL_DRIVER_FIRE',
    readiness: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    productionCallable: false,
    existingCallable: 'fireCanonicalDriver',
    notes: 'INTERNAL_TEST roster severance. Salary daily opex deferred. Public fireDriver local.',
  },
  {
    type: 'CANONICAL_VEHICLE_SALE',
    readiness: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    productionCallable: false,
    existingCallable: 'sellCanonicalFleetAsset',
    notes: 'INTERNAL_TEST canonical asset + mileage. Public sellTruck local.',
  },
  {
    type: 'CANONICAL_DAILY_OPEX',
    readiness: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    productionCallable: false,
    existingCallable: 'settleCanonicalDailyOpexInternal',
    notes:
      'INTERNAL_TEST 24h server clock. Canonical drivers/leases/operations/warehouses. Public processDailyOperatingCosts local.',
  },
  {
    type: 'CANONICAL_WAREHOUSE_OPEN',
    readiness: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    productionCallable: false,
    existingCallable: 'openCanonicalWarehouse',
    notes:
      'INTERNAL_TEST server-derived open. Public openWarehouse local. Company level INTERNAL policy 10.',
  },
  {
    type: 'CANONICAL_WAREHOUSE_UPGRADE',
    readiness: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    productionCallable: false,
    existingCallable: 'upgradeCanonicalWarehouse',
    notes:
      'INTERNAL_TEST server-derived upgrade. Public upgradeWarehouse local. Inventory not in scope.',
  },
  {
    type: 'CANONICAL_CARGO_BUY',
    readiness: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    productionCallable: false,
    existingCallable: 'buyCanonicalCargo',
    notes:
      'INTERNAL_TEST fixed market snapshot. Public buyProductForWarehouse local. No tick/events.',
  },
  {
    type: 'CANONICAL_CARGO_SELL',
    readiness: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    productionCallable: false,
    existingCallable: 'sellCanonicalCargo',
    notes:
      'INTERNAL_TEST canonical inventory. Public sellProductFromWarehouse local.',
  },
  {
    type: 'CANONICAL_MISSION_REWARD',
    readiness: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    productionCallable: false,
    existingCallable: 'claimCanonicalLocalReward',
    notes: 'INTERNAL_TEST own_2_trucks from canonical fleet count. Other missions stay local.',
  },
  {
    type: 'CANONICAL_MILESTONE_REWARD',
    readiness: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    productionCallable: false,
    existingCallable: 'claimCanonicalLocalReward',
    notes: 'INTERNAL_TEST ms_second_truck from canonical fleet count. Other milestones stay local.',
  },
  {
    type: 'MULTIMODAL_SETTLEMENT',
    readiness: 'BLOCKED_MISSING_SERVER_STATE',
    productionCallable: false,
    notes: 'settleCanonicalMultimodalShipment must not exist. ROAD economy not canonical.',
  },
] as const;

export type RoadCashCanonicalizationRow = {
  auditId: string;
  family: string;
  currentAuthority: string;
  targetAuthority: string;
  canonicalRecordNeeded: string;
  serverValidationSource: string;
  offlineImpact: string;
  migrationStatus: CashCanonicalizationReadiness;
  nextStep: string;
  ledgerIds: string;
};

/**
 * 1:1 with PRODUCTION_CASH_WRITE_AUDIT ids.
 * Source of truth for Step 29E migration surface.
 */
export const ROAD_CASH_CANONICALIZATION_MATRIX: readonly RoadCashCanonicalizationRow[] = [
  {
    auditId: 'road-delivery-revenue',
    family: 'A. ROAD DELIVERY ECONOMICS',
    currentAuthority: 'client save player.money',
    targetAuthority: 'serverState.cash via completeCanonicalRoadDelivery',
    canonicalRecordNeeded: CANONICAL_ROAD_DELIVERIES_PATH_RESERVED,
    serverValidationSource:
      'Need accepted Delivery+contract snapshot (payment, deadline, fuelCost, maintenanceCost, status). canonicalDeliveryCompletions is count-only.',
    offlineImpact: 'Keep local completeDeliveryById until canonical acceptance exists.',
    migrationStatus: 'BLOCKED_MISSING_SERVER_STATE',
    nextStep: 'STEP 29K INTERNAL_TEST shadow applied; production fleet still blocked',
    ledgerIds: 'delivery:{deliveryId}:revenue',
  },
  {
    auditId: 'road-delivery-completion-expenses',
    family: 'A. ROAD DELIVERY ECONOMICS',
    currentAuthority: 'client save player.money',
    targetAuthority: 'serverState.cash (same settlement txn family)',
    canonicalRecordNeeded: CANONICAL_ROAD_DELIVERIES_PATH_RESERVED,
    serverValidationSource: 'Same snapshot; maintenance+penalty from calculateDeliverySettlement.',
    offlineImpact: 'Unchanged local path.',
    migrationStatus: 'BLOCKED_MISSING_SERVER_STATE',
    nextStep: 'STEP 29F',
    ledgerIds: 'delivery:{deliveryId}:completion-expenses (also :maintenance / :penalty in some paths)',
  },
  {
    auditId: 'road-delivery-fail-penalty',
    family: 'A. ROAD DELIVERY ECONOMICS',
    currentAuthority: 'client save player.money',
    targetAuthority: 'serverState.cash',
    canonicalRecordNeeded: CANONICAL_ROAD_DELIVERIES_PATH_RESERVED,
    serverValidationSource: 'Failure + contract.payment; calculateFailurePenalty.',
    offlineImpact: 'Unchanged local failDeliveryById.',
    migrationStatus: 'BLOCKED_MISSING_SERVER_STATE',
    nextStep: 'STEP 29F',
    ledgerIds: 'delivery:{deliveryId}:failure-penalty',
  },
  {
    auditId: 'road-delivery-incident',
    family: 'A. ROAD DELIVERY ECONOMICS',
    currentAuthority: 'client save player.money',
    targetAuthority: 'serverState.cash (after delivery snapshot)',
    canonicalRecordNeeded: 'canonical delivery + incident choice ids',
    serverValidationSource: 'INTERNAL_TEST catalog effects from server-issued plan. Production UI still client.',
    offlineImpact: 'Must remain local for public ROAD.',
    migrationStatus: 'BLOCKED_CLIENT_ONLY_GAMEPLAY_CONTEXT',
    nextStep: 'STEP 29O INTERNAL_TEST finalizeCanonicalRoadExecution; production incident UI local.',
    ledgerIds: 'buildOperationResolutionId / delivery:{id}:incident',
  },
  {
    auditId: 'road-fuel',
    family: 'C. OPERATING COSTS',
    currentAuthority: 'client save player.money + live tank/quote',
    targetAuthority: 'purchaseCanonicalFuel after trusted fuel state',
    canonicalRecordNeeded: 'server-owned tank + canonical fuel price',
    serverValidationSource:
      'INTERNAL_TEST purchaseCanonicalFuel + accept-burn. Public tank/quote still local. Production consumption is progressive.',
    offlineImpact: 'Public refuel stays local. INTERNAL ONLINE_REQUIRED.',
    migrationStatus: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    nextStep: 'Public wiring only after HUD cash; roadside/incident tank still blocked.',
    ledgerIds: 'fuel:{assetId}:{fuelPurchaseIntentId}',
  },
  {
    auditId: 'daily-operating',
    family: 'C. OPERATING COSTS',
    currentAuthority: 'public local 24h economy clock; INTERNAL server wall clock',
    targetAuthority: 'settleCanonicalDailyOpexInternal',
    canonicalRecordNeeded: 'canonicalOpexState + canonicalDrivers + leases',
    serverValidationSource:
      'INTERNAL 24h period cursor. Mandatory expense parity to minCashBalance. Legacy roster/warehouses unverified. Clock is not production.',
    offlineImpact: 'Public offline catch-up charges 0. INTERNAL online-only.',
    migrationStatus: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    nextStep: 'Legacy state + production clock before HUD. Public tick unwired.',
    ledgerIds: 'opex:p24_{periodIndex}:daily',
  },
  {
    auditId: 'truck-purchase',
    family: 'B. VEHICLE ECONOMICS',
    currentAuthority: 'client catalog + Date.now instance id',
    targetAuthority: 'purchaseCanonicalTruck after catalog port',
    canonicalRecordNeeded: 'server catalog price + ownership list',
    serverValidationSource:
      'TRUCK_MARKET.purchasePrice + catalog mint. INTERNAL_TEST purchaseCanonicalCatalogAsset. Public buyTruck still local.',
    offlineImpact: 'Public catalog buy remains offline-capable. INTERNAL online-only.',
    migrationStatus: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    nextStep: 'Do not wire public HUD until cashAuthorityVersion=1. Avoid dual debit.',
    ledgerIds: 'fleet:{assetId}:purchase:{purchaseId}',
  },
  {
    auditId: 'trailer-purchase',
    family: 'B. VEHICLE ECONOMICS',
    currentAuthority: 'client catalog',
    targetAuthority: 'server catalog purchase',
    canonicalRecordNeeded: 'trailer catalog + ownedTrailerIds',
    serverValidationSource: 'TRAILER_MARKET.purchasePrice. INTERNAL_TEST same callable as truck.',
    offlineImpact: 'Public local. INTERNAL online-only.',
    migrationStatus: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    nextStep: 'Same as truck: no public wiring.',
    ledgerIds: 'fleet:{assetId}:purchase:{purchaseId}',
  },
  {
    auditId: 'truck-lease',
    family: 'B. VEHICLE ECONOMICS',
    currentAuthority: 'public leaseTruck local; INTERNAL prepaid catalog',
    targetAuthority: 'createCanonicalVehicleLease',
    canonicalRecordNeeded: 'canonicalVehicleLeases + leased fleet asset',
    serverValidationSource: 'TRUCK_MARKET.weeklyLeaseCost + weekly/monthly period. Recurring belongs to daily opex (V1 charged 0).',
    offlineImpact: 'Public local. INTERNAL online-only.',
    migrationStatus: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    nextStep: 'Do not wire public lease. Return/expiry remain client clock.',
    ledgerIds: 'fleet:{assetId}:lease:{leaseIntentId}',
  },
  {
    auditId: 'driver-hire',
    family: 'D. STAFF',
    currentAuthority: 'public hireDriver local; INTERNAL DRIVER_POOL',
    targetAuthority: 'hireCanonicalDriver',
    canonicalRecordNeeded: 'canonicalDrivers',
    serverValidationSource: 'DRIVER_POOL hiringFee/salary. Company level INTERNAL_POLICY skip.',
    offlineImpact: 'Public local. INTERNAL online-only.',
    migrationStatus: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    nextStep: 'Do not wire public hire. Daily salary via 29S opex.',
    ledgerIds: 'driver:{driverId}:hire:{hireIntentId}',
  },
  {
    auditId: 'truck-sale',
    family: 'B. VEHICLE ECONOMICS',
    currentAuthority: 'public sellTruck local; INTERNAL canonical valuation',
    targetAuthority: 'sellCanonicalFleetAsset',
    canonicalRecordNeeded: 'canonicalFleetAssets + mileageKm',
    serverValidationSource: 'calculateCanonicalTruckResaleValue from condition/mileage/upgrades.',
    offlineImpact: 'Public local. INTERNAL online-only.',
    migrationStatus: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    nextStep: 'Do not wire public sale. Last-truck UX remains local.',
    ledgerIds: 'fleet:{assetId}:sale:{saleIntentId}',
  },
  {
    auditId: 'driver-severance',
    family: 'D. STAFF',
    currentAuthority: 'public fireDriver local; INTERNAL canonical roster',
    targetAuthority: 'fireCanonicalDriver',
    canonicalRecordNeeded: 'canonicalDrivers',
    serverValidationSource: 'salaryPerDay * driverSeveranceDays. Blocks assignedCanonicalDeliveryId.',
    offlineImpact: 'Public local. INTERNAL online-only.',
    migrationStatus: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    nextStep: 'Do not wire public fire.',
    ledgerIds: 'driver:{driverId}:fire:{fireIntentId}',
  },
  {
    auditId: 'repair',
    family: 'B. VEHICLE ECONOMICS',
    currentAuthority: 'client truck.condition',
    targetAuthority: 'server condition',
    canonicalRecordNeeded: 'authoritative condition',
    serverValidationSource: 'serverState.ownedTrucks.condition may exist but is not ROAD live.',
    offlineImpact: 'Local.',
    migrationStatus: 'BLOCKED_MISSING_SERVER_STATE',
    nextStep: '29N INTERNAL_TEST repairCanonicalFleetAsset; production UI still local.',
    ledgerIds: 'maintenance:{truckId}:{condition}:{currentTime}',
  },
  {
    auditId: 'truck-upgrade',
    family: 'B. VEHICLE ECONOMICS',
    currentAuthority: 'client',
    targetAuthority: 'server upgrades',
    canonicalRecordNeeded: 'upgrade catalog + truck record',
    serverValidationSource: 'Cost embedded in client txn id.',
    offlineImpact: 'Local.',
    migrationStatus: 'BLOCKED_MISSING_SERVER_STATE',
    nextStep: '29N INTERNAL_TEST upgradeCanonicalFleetAsset; production UI still local.',
    ledgerIds: 'truck-upgrade:{truckId}:{upgradeType}:{cost}',
  },
  {
    auditId: 'vehicle-recovery',
    family: 'B. VEHICLE ECONOMICS',
    currentAuthority: 'client vehicle-state issues',
    targetAuthority: 'server vehicle issues',
    canonicalRecordNeeded: 'canonical issue + action',
    serverValidationSource: 'Issue resolution is client simulation.',
    offlineImpact: 'Local.',
    migrationStatus: 'BLOCKED_CLIENT_ONLY_GAMEPLAY_CONTEXT',
    nextStep: 'After vehicle-state is server-owned.',
    ledgerIds: 'vehicle-recovery:{truckId}:{actionId}:{currentTime}',
  },
  {
    auditId: 'warehouse-open',
    family: 'E. INFRASTRUCTURE',
    currentAuthority: 'client warehouses in save',
    targetAuthority: 'server warehouses',
    canonicalRecordNeeded: 'canonical warehouse open',
    serverValidationSource: 'INTERNAL_TEST canonicalWarehouses + CITIES_BY_ID. Public save still local.',
    offlineImpact: 'Local public. INTERNAL ONLINE_REQUIRED.',
    migrationStatus: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    nextStep: 'WAREHOUSE_INTERNAL_CANONICAL_ONLY. Do not trust client currentLevel. No public wire.',
    ledgerIds: 'warehouse:{cityId}:{type}:open',
  },
  {
    auditId: 'warehouse-upgrade',
    family: 'E. INFRASTRUCTURE',
    currentAuthority: 'public save; INTERNAL canonical warehouse',
    targetAuthority: 'server warehouse tier',
    canonicalRecordNeeded: 'canonicalWarehouses + receipts',
    serverValidationSource: 'Server next level/capacity/cost from canonical doc.',
    offlineImpact: 'Local public.',
    migrationStatus: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    nextStep: 'No public wire. Company level INTERNAL-only.',
    ledgerIds: 'warehouse:{warehouseId}:upgrade:{nextLevel}',
  },
  {
    auditId: 'cargo-buy',
    family: 'F. CARGO / MARKET',
    currentAuthority: 'public save city/inventory; INTERNAL canonical market',
    targetAuthority: 'server cargo market',
    canonicalRecordNeeded: 'canonicalWorldMarkets + canonicalCargoInventory',
    serverValidationSource: 'INTERNAL_TEST snapshot prices/stock. Public still local.',
    offlineImpact: 'Local public. INTERNAL ONLINE_REQUIRED.',
    migrationStatus: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    nextStep: 'CARGO_MARKET_INTERNAL_TEST_CANONICAL_PUBLIC_UNWIRED. No tick/events parity.',
    ledgerIds: 'cargo:{city}:{product}:buy:{intent}',
  },
  {
    auditId: 'cargo-sell',
    family: 'F. CARGO / MARKET',
    currentAuthority: 'public save; INTERNAL canonical inventory',
    targetAuthority: 'server cargo market',
    canonicalRecordNeeded: 'canonical inventory + world market',
    serverValidationSource: 'INTERNAL snapshot sell. Public local.',
    offlineImpact: 'Local public.',
    migrationStatus: 'CANONICAL_READY_WITH_SMALL_SERVER_PORT',
    nextStep: 'No public wire. Contract issuance still blocked (tick/events).',
    ledgerIds: 'cargo:{city}:{product}:sell:{intent}',
  },
  {
    auditId: 'ad-reward',
    family: 'H. REWARDS',
    currentAuthority: 'client after ad SDK',
    targetAuthority: 'server attested ad claim (future)',
    canonicalRecordNeeded: 'ad attestation',
    serverValidationSource: 'Client applyAdReward.',
    offlineImpact: 'Ads require network; still local cash.',
    migrationStatus: 'BLOCKED_CLIENT_ONLY_GAMEPLAY_CONTEXT',
    nextStep: 'AD_REWARD_AUTHORITY_BLOCKED_VERIFICATION. Do not trust client ad-watched boolean.',
    ledgerIds: 'ad reward transaction ids (client)',
  },
  {
    auditId: 'mission-reward',
    family: 'H. REWARDS',
    currentAuthority: 'client mission state',
    targetAuthority: 'prefer existing weekly/season/challenge callables',
    canonicalRecordNeeded: 'server mission progress',
    serverValidationSource: 'claimMissionReward is local.',
    offlineImpact: 'Local.',
    migrationStatus: 'BLOCKED_CLIENT_ONLY_GAMEPLAY_CONTEXT',
    nextStep: 'Do not add a second reward cash framework.',
    ledgerIds: 'client claimMissionReward ids',
  },
  {
    auditId: 'milestone-reward',
    family: 'H. REWARDS',
    currentAuthority: 'client',
    targetAuthority: 'server milestones or keep local until HUD',
    canonicalRecordNeeded: 'milestone claims',
    serverValidationSource: 'Local.',
    offlineImpact: 'Local.',
    migrationStatus: 'BLOCKED_CLIENT_ONLY_GAMEPLAY_CONTEXT',
    nextStep: 'After HUD authority.',
    ledgerIds: 'client claimMilestoneReward ids',
  },
  {
    auditId: 'client-weekly-objective',
    family: 'H. REWARDS',
    currentAuthority: 'client weekly objectives',
    targetAuthority: 'weeklyMissionClaims (already canonical for some weeks)',
    canonicalRecordNeeded: 'already exists for server weekly missions',
    serverValidationSource: 'claimWeeklyObjectiveReward is a separate client path.',
    offlineImpact: 'Local client objectives.',
    migrationStatus: 'BLOCKED_CLIENT_ONLY_GAMEPLAY_CONTEXT',
    nextStep: 'Unify with weeklyMissionClaims; do not dual-pay.',
    ledgerIds: 'client weekly objective ids',
  },
  {
    auditId: 'guest-multimodal-rail-settle',
    family: 'H. REWARDS / multimodal local',
    currentAuthority: 'guest local player.money',
    targetAuthority: 'never server for guests',
    canonicalRecordNeeded: 'none',
    serverValidationSource: 'Guest-only local settlement.',
    offlineImpact: 'Must remain local.',
    migrationStatus: 'BLOCKED_CLIENT_ONLY_GAMEPLAY_CONTEXT',
    nextStep: 'Keep guest path. Signed-in multimodal settlement still disabled.',
    ledgerIds: 'multimodal rail local settlement ids',
  },
  {
    auditId: 'debug-cash',
    family: 'I. DEBUG / TEST',
    currentAuthority: 'DEV debugAddCash/Set/Remove',
    targetAuthority: 'never production server',
    canonicalRecordNeeded: 'none',
    serverValidationSource: 'n/a',
    offlineImpact: 'DEV only.',
    migrationStatus: 'LOCAL_ONLY_DEBUG',
    nextStep: 'Remain isolated from canonical helper.',
    ledgerIds: 'debug (non-idempotent)',
  },
  {
    auditId: 'test-money-sync',
    family: 'I. DEBUG / TEST',
    currentAuthority: 'TEST_MONEY_SYNC users/{uid}.money overlay',
    targetAuthority: 'never canonical',
    canonicalRecordNeeded: 'none',
    serverValidationSource: 'testMoneySyncService',
    offlineImpact: 'n/a',
    migrationStatus: 'LOCAL_ONLY_DEBUG',
    nextStep: 'Keep isolated. Canonical tests must not use profile money.',
    ledgerIds: 'n/a',
  },
  {
    auditId: 'cloud-save-blob',
    family: 'save persistence',
    currentAuthority: 'LWW saves/current player.money',
    targetAuthority: 'cache mirror after overlay (later)',
    canonicalRecordNeeded: 'none for 29E',
    serverValidationSource: 'Client cloud save.',
    offlineImpact: 'Save remains HUD authority.',
    migrationStatus: 'BLOCKED_CLIENT_ONLY_GAMEPLAY_CONTEXT',
    nextStep: 'Do not change save cash in 29E.',
    ledgerIds: 'n/a',
  },
  {
    auditId: 'profile-money-write',
    family: 'I. DEBUG / TEST / legacy',
    currentAuthority: 'users/{uid}.money mirror (omitted if TEST_MONEY_SYNC)',
    targetAuthority: 'NONE (not authority)',
    canonicalRecordNeeded: 'none',
    serverValidationSource: 'cloudSaveService',
    offlineImpact: 'n/a',
    migrationStatus: 'LEGACY_TEST_ONLY',
    nextStep: 'Do not add gameplay writes. Do not use in canonical helper.',
    ledgerIds: 'n/a',
  },
  {
    auditId: 'marketplace-purchase',
    family: 'G. MARKETPLACE',
    currentAuthority: 'server marketplace.canonicalCash + serverState.cash',
    targetAuthority: 'already server',
    canonicalRecordNeeded: 'marketplaceHistory / ledger (existing)',
    serverValidationSource: 'Listing price server-owned.',
    offlineImpact: 'Online only.',
    migrationStatus: 'CANONICAL_READY_NOW',
    nextStep: 'Reuse; do not duplicate as ROAD debit API.',
    ledgerIds: 'marketplace transaction ids',
  },
  {
    auditId: 'marketplace-listing-fee',
    family: 'G. MARKETPLACE',
    currentAuthority: 'server',
    targetAuthority: 'already server',
    canonicalRecordNeeded: 'existing listing docs',
    serverValidationSource: 'Server fee table.',
    offlineImpact: 'Online only.',
    migrationStatus: 'CANONICAL_READY_NOW',
    nextStep: 'Reuse.',
    ledgerIds: 'listing fee ids',
  },
  {
    auditId: 'marketplace-reconcile-overlay',
    family: 'G. MARKETPLACE',
    currentAuthority: 'server cash applied onto save for marketplace users',
    targetAuthority: 'keep marketplace-scoped; not HUD-wide overlay',
    canonicalRecordNeeded: 'existing reconcile',
    serverValidationSource: 'applyVehicleMarketplaceReconciliation',
    offlineImpact: 'Online.',
    migrationStatus: 'CANONICAL_READY_NOW',
    nextStep: 'Do not expand into ROAD HUD overlay.',
    ledgerIds: 'reconcile',
  },
  {
    auditId: 'weekly-mission-claim-server',
    family: 'H. REWARDS',
    currentAuthority: 'server weeklyMissionClaims + cash',
    targetAuthority: 'already server',
    canonicalRecordNeeded: 'weeklyMissionClaims/{id}',
    serverValidationSource: 'Mission reward.cash from server table.',
    offlineImpact: 'Online claim.',
    migrationStatus: 'CANONICAL_READY_NOW',
    nextStep: 'Reuse pattern; optional later helper adoption.',
    ledgerIds: 'weekly claim idempotencyKey',
  },
  {
    auditId: 'season-reward-claim-server',
    family: 'H. REWARDS',
    currentAuthority: 'server',
    targetAuthority: 'already server',
    canonicalRecordNeeded: 'season claims',
    serverValidationSource: 'Server entitlement.',
    offlineImpact: 'Online.',
    migrationStatus: 'CANONICAL_READY_NOW',
    nextStep: 'Reuse.',
    ledgerIds: 'season claim ids',
  },
  {
    auditId: 'challenge-claim-server',
    family: 'H. REWARDS',
    currentAuthority: 'server challengeClaims',
    targetAuthority: 'already server',
    canonicalRecordNeeded: 'challengeClaims',
    serverValidationSource: 'Server reward table.',
    offlineImpact: 'Online.',
    migrationStatus: 'CANONICAL_READY_NOW',
    nextStep: 'Reuse.',
    ledgerIds: 'challenge-{createId()} client mirror vs server claim doc',
  },
  {
    auditId: 'legacy-serverstate-bootstrap',
    family: 'bootstrap',
    currentAuthority: 'server migrateLegacyServerStateTransaction',
    targetAuthority: 'serverState.cash init (not HUD)',
    canonicalRecordNeeded: 'serverState/current',
    serverValidationSource: 'Bounded migration from save; clamps suspicious cash.',
    offlineImpact: 'Signed-in migrate.',
    migrationStatus: 'CANONICAL_READY_NOW',
    nextStep: 'Keep bounded. Not a gameplay delta API.',
    ledgerIds: 'n/a',
  },
];

export function listCanonicalizationStatuses(): CashCanonicalizationReadiness[] {
  return [...new Set(ROAD_CASH_CANONICALIZATION_MATRIX.map((row) => row.migrationStatus))];
}

export function matrixRowByAuditId(auditId: string): RoadCashCanonicalizationRow | undefined {
  return ROAD_CASH_CANONICALIZATION_MATRIX.find((row) => row.auditId === auditId);
}
