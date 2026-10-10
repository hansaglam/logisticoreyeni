/**
 * Map V2 Step 29L production fleet authority migration foundation.
 * Run: ./node_modules/.bin/tsx scripts/map-v2-production-fleet-authority-migration-regression-test.ts
 */
import './test-globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'path';

import { ROAD_CANONICAL_SETTLEMENT_READINESS } from '../src/domain/canonicalRoadContract';
import {
  CATALOG_FLEET_LINEAGE,
  MARKETPLACE_FLEET_LINEAGE,
  PRODUCTION_FLEET_AUTHORITY_MIGRATION_STATUS,
  PRODUCTION_FLEET_LEGACY_POLICY,
  STARTER_FLEET_LINEAGE,
  buildCanonicalFleetAssetFromCatalogPurchase,
  buildCanonicalFleetAssetFromMarketplacePurchase,
  classifyLocalFleetAssetAuthority,
  classifyMarketplaceFleetLineage,
  classifyProductionFleetAuthority,
  hasOnlyCanonicalProductionMintKeys,
  issueCanonicalStarterFleetAsset,
  rejectLegacySaveFleetImport,
} from '../src/domain/canonicalProductionFleet';
import {
  CANONICAL_FLEET_ASSET_SCHEMA_VERSION,
  LEGACY_CLIENT_FLEET_UNVERIFIED,
} from '../src/domain/canonicalRoadFleet';
import {
  AUTHORITATIVE_CASH_LISTENER_ENABLED,
  AUTHORITATIVE_CASH_OVERLAY_ENABLED,
  canUseServerAuthoritativeSettlement,
  UNIFIED_CASH_BLOCK_REASON,
} from '../src/domain/cashAuthority';
import { MODE_OPERATIONAL_READINESS } from '../src/mapV2/domain/multimodal';
import { SAVE_GAME_VERSION } from '../src/storage/saveGame';
import { STARTER_TRUCK } from '../src/data/trucks';

let pass = 0;
let fail = 0;
function assert(cond: unknown, label: string): void {
  if (cond) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error(`FAIL ${label}`);
}
function read(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf8');
}

console.log('\n=== Map V2 Production Fleet Authority Migration (Step 29L) ===\n');

assert(
  PRODUCTION_FLEET_AUTHORITY_MIGRATION_STATUS ===
    'PRODUCTION_FLEET_AUTHORITY_MIGRATION_PASS_NEW_ASSETS_ONLY',
  'status',
);
assert(PRODUCTION_FLEET_LEGACY_POLICY === 'NO_AUTOMATIC_LEGACY_MIGRATION', 'G no auto migrate');
assert(read('src/store/gameStore.ts').includes('buyTruck'), 'A public buyTruck');
assert(read('src/store/gameStore.ts').includes('Guests'), 'B guest');
assert(
  classifyLocalFleetAssetAuthority({ id: STARTER_TRUCK.id, fleetAuthorityClass: 'SERVER_CANONICAL' }) ===
    'LEGACY_CLIENT_UNVERIFIED',
  'C E G self-promote ignored',
);
assert(classifyLocalFleetAssetAuthority({ id: 'trailer-standard-1' }) === 'LEGACY_CLIENT_UNVERIFIED', 'D trailer');
assert(rejectLegacySaveFleetImport().reason === LEGACY_CLIENT_FLEET_UNVERIFIED, 'X save import');
assert(!hasOnlyCanonicalProductionMintKeys({ catalogModelId: 'x', purchaseId: 'p', condition: 100 }), 'F L condition');
assert(!hasOnlyCanonicalProductionMintKeys({ catalogModelId: 'x', purchaseId: 'p', upgrades: [] }), 'F M upgrades');
assert(!hasOnlyCanonicalProductionMintKeys({ catalogModelId: 'x', purchaseId: 'p', authorityClass: 'SERVER_CANONICAL' }), 'G authority class');

const starter = issueCanonicalStarterFleetAsset({ uid: 'uid-a', nowMs: 1 });
assert(starter.ok === true, 'H starter helper');
if (starter.ok) {
  assert(starter.asset.authorityClass === 'SERVER_CANONICAL', 'H class');
  assert(starter.asset.economicCondition === STARTER_TRUCK.condition, 'L condition server');
  assert(starter.asset.economicUpgradeIds.engine === 0, 'M upgrades server');
  assert(starter.asset.maintenanceCostPerKm === STARTER_TRUCK.maintenanceCost, 'N maintenance');
  assert(starter.asset.economicRevision === 1, 'P revision 1');
  assert(starter.asset.assetId.startsWith('cfa_'), 'J server id');
  assert(classifyProductionFleetAuthority(starter.asset) === 'SERVER_CANONICAL_READY', 'H ready');
}
const catalog = buildCanonicalFleetAssetFromCatalogPurchase({
  uid: 'uid-a',
  catalogModelId: 'truck-ford-cargo',
  purchaseId: 'p1',
  nowMs: 1,
});
assert(catalog.ok === true, 'H catalog helper');
if (catalog.ok) {
  assert(catalog.asset.catalogModelId === 'truck-ford-cargo', 'K model');
  assert(catalog.asset.economicUpgradeIds.engine === 0, 'M catalog upgrades 0');
}
const trailer = buildCanonicalFleetAssetFromCatalogPurchase({
  uid: 'uid-a',
  catalogModelId: 'trailer-standard',
  purchaseId: 't1',
  nowMs: 1,
  assetType: 'TRAILER',
});
assert(trailer.ok === true, 'O trailer profile');
assert(CANONICAL_FLEET_ASSET_SCHEMA_VERSION === 1, 'I schema');
assert(classifyMarketplaceFleetLineage() === MARKETPLACE_FLEET_LINEAGE, 'U marketplace');
assert(buildCanonicalFleetAssetFromMarketplacePurchase().ok === false, 'U marketplace blocked');
assert(CATALOG_FLEET_LINEAGE.includes('FOUNDATION_ONLY'), 'V catalog');
assert(STARTER_FLEET_LINEAGE.includes('NEW_ACCOUNT'), 'W starter');

const index = read('backend/src/index.ts');
assert(!index.includes('export const registerFleetAsset'), 'Y no register');
assert(!index.includes('export const updateCanonicalTruck'), 'Y no generic update');
assert(!index.includes('export const issueCanonicalStarterFleet'), 'Y starter not public callable');
assert(index.includes('export const settleCanonicalRoadDeliveryInternal'), 'AA 29K callable remains');
assert(!index.includes('export const settleCanonicalMultimodalShipment'), 'multimodal');
assert(read('src/store/gameStore.ts').includes('completeDeliveryById'), 'AB production ROAD');
assert(AUTHORITATIVE_CASH_OVERLAY_ENABLED === false, 'AE overlay');
assert(AUTHORITATIVE_CASH_LISTENER_ENABLED === false, 'AF listener');
const gate = canUseServerAuthoritativeSettlement({
  signedInLinked: true,
  cashAuthorityVersion: 1,
  serverStateCashPresent: true,
  reconciliationActive: true,
  staleSaveProtectionActive: true,
});
assert(!gate.ready && gate.reason === UNIFIED_CASH_BLOCK_REASON, 'AG settlement false');
assert(SAVE_GAME_VERSION === 6, 'AH v6');
assert(MODE_OPERATIONAL_READINESS.RAIL === 'FOUNDATION_ONLY', 'AI RAIL');
assert(MODE_OPERATIONAL_READINESS.SEA === 'FOUNDATION_ONLY', 'AI SEA');
assert(MODE_OPERATIONAL_READINESS.AIR === 'FOUNDATION_ONLY', 'AI AIR');
assert(read('src/domain/multimodalFeatureRollout.ts').includes("return 'MULTIMODAL_OFF'"), 'AJ OFF');
assert(
  ROAD_CANONICAL_SETTLEMENT_READINESS ===
    'ROAD_CANONICAL_SETTLEMENT_BLOCKED_PRODUCTION_INCIDENT_PARITY',
  'BE repair authority',
);
assert(read('docs/architecture/map-v2/MAP_V2_PRODUCTION_FLEET_AUTHORITY_MIGRATION.md').includes('NO_AUTOMATIC'), 'docs');
assert(read('docs/architecture/map-v2/PRODUCTION_FLEET_AUTHORITY_MATRIX.md').includes('MARKETPLACE'), 'matrix');
assert(read('firestore.rules').includes('canonicalFleetMutationReceipts'), 'receipts rules');

if (fail > 0) {
  console.log(`\nFAILED ${fail}  passed ${pass}\n`);
  process.exit(1);
}
console.log(`\nPASSED ${pass}\n`);
