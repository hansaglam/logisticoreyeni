/**
 * Post-startup marketplace reconcile — kill-after-commit recovery.
 * Run: npx tsx scripts/vehicle-marketplace-startup-reconcile-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import './test-globals';

import { STARTER_TRUCK } from '../src/data/trucks';
import {
  applyMarketplaceStartupReconcilePlan,
  getMarketplaceVehicleDisplayName,
  isMarketplaceStartupReconcileNoop,
  MARKETPLACE_RECOVERED_PURCHASE_TOAST,
  MARKETPLACE_STARTUP_RECONCILE_TIMEOUT_MS,
  planMarketplaceStartupReconcile,
} from '../src/domain/vehicleMarketplaceStartupReconcile';
import {
  rememberRecoveredMarketplacePurchaseAcks,
  shouldShowRecoveredPurchaseToast,
  type MarketplaceAckStore,
} from '../src/services/marketplaceRecoveredPurchaseAck';
import {
  beginPostStartupMarketplaceCloudHold,
  endPostStartupMarketplaceCloudHold,
  isPostStartupMarketplaceCloudHoldActive,
  __resetPostStartupMarketplaceCloudHoldForTests,
} from '../src/services/marketplaceStartupCloudHold';
import type { Truck } from '../src/types/game';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  failed += 1;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

const root = resolve(process.cwd());
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

function vehicleSnapshot(truckId: string, templateId: string, status: 'idle' | 'marketplace_locked' = 'idle') {
  return {
    truckId,
    templateId,
    currentCityId: 'izmir' as const,
    condition: 88,
    totalMileageKm: 1000,
    currentFuelL: 80,
    fuelTankCapacityL: 300,
    status,
  };
}

function memoryAckStore(initial: string[] = []): MarketplaceAckStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  if (initial.length > 0) {
    values.set(
      '@logisticore/marketplaceRecoveredPurchaseAcks',
      JSON.stringify({ vehicleIds: initial }),
    );
  }
  return {
    values,
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

console.log('\n=== Vehicle Marketplace Startup Reconcile ===\n');

console.log('TEST 1 — kill after commit, restart hydrate');
{
  const purchasedId = 'purchased-market-truck';
  const local: Truck[] = [{ ...STARTER_TRUCK }];
  const authoritative = {
    marketplaceStateVersion: 12,
    cash: 80_000,
    soldTruckIds: [] as string[],
    vehicles: [
      vehicleSnapshot(STARTER_TRUCK.id, STARTER_TRUCK.catalogId),
      vehicleSnapshot(purchasedId, 'truck-ford-cargo'),
    ],
  };
  const plan = planMarketplaceStartupReconcile({
    localTruckIds: local.map((truck) => truck.id),
    localCash: 100_000,
    localMarketplaceStateVersion: 11,
    acknowledgedVehicleIds: [],
    authoritative,
  });
  assert(plan.shouldApply, 'committed purchase is applied after restart');
  assert(plan.addedVehicleIds.includes(purchasedId), 'missing purchased vehicle is detected');
  assert(plan.recoveredPurchaseVehicleIds.includes(purchasedId), 'idle add is a recovered purchase');
  assert(plan.toastVehicleIds.includes(purchasedId), 'unacked recovery can toast');
  assert(plan.nextCash === 80_000, 'authoritative marketplace cash is used');
  const applied = applyMarketplaceStartupReconcilePlan(local, authoritative);
  assert(applied.authoritativeCash === 80_000, 'money is the committed post-purchase balance');
  const ids = applied.trucks.map((truck) => truck.id);
  assert(ids.filter((id) => id === purchasedId).length === 1, 'purchased vehicle appears exactly once');
  assert(
    MARKETPLACE_RECOVERED_PURCHASE_TOAST.messageFor(
      getMarketplaceVehicleDisplayName('truck-ford-cargo'),
    ).includes('filona eklendi'),
    'toast copy matches the recovered-purchase UX',
  );
}

console.log('\nTEST 2 — offline restart does not corrupt local state');
{
  const localIds = [STARTER_TRUCK.id];
  const localCash = 100_000;
  assert(localIds.length === 1 && localCash === 100_000, 'offline skip leaves the local snapshot untouched');
  assert(
    MARKETPLACE_STARTUP_RECONCILE_TIMEOUT_MS <= 8_000,
    'startup reconcile times out instead of hanging boot',
  );
}

console.log('\nTEST 3 — already reconciled vehicle is not duplicated');
{
  const purchasedId = 'purchased-market-truck';
  const local: Truck[] = [
    { ...STARTER_TRUCK },
    { ...STARTER_TRUCK, id: purchasedId, catalogId: 'truck-ford-cargo', name: 'Fordan CargoPro' },
  ];
  const authoritative = {
    marketplaceStateVersion: 12,
    cash: 80_000,
    soldTruckIds: [] as string[],
    vehicles: [
      vehicleSnapshot(STARTER_TRUCK.id, STARTER_TRUCK.catalogId),
      vehicleSnapshot(purchasedId, 'truck-ford-cargo'),
    ],
  };
  const plan = planMarketplaceStartupReconcile({
    localTruckIds: local.map((truck) => truck.id),
    localCash: 80_000,
    localMarketplaceStateVersion: 12,
    acknowledgedVehicleIds: [purchasedId],
    authoritative,
  });
  assert(plan.addedVehicleIds.length === 0, 'existing vehicle is not added again');
  const applied = applyMarketplaceStartupReconcilePlan(local, authoritative);
  assert(
    applied.trucks.filter((truck) => truck.id === purchasedId).length === 1,
    'stable vehicleId prevents duplicates',
  );
}

console.log('\nTEST 4 — no recent marketplace activity is a no-op');
{
  const plan = planMarketplaceStartupReconcile({
    localTruckIds: [STARTER_TRUCK.id],
    localCash: 100_000,
    localMarketplaceStateVersion: 4,
    acknowledgedVehicleIds: [],
    authoritative: {
      marketplaceStateVersion: 4,
      cash: 100_000,
      soldTruckIds: [],
      vehicles: [vehicleSnapshot(STARTER_TRUCK.id, STARTER_TRUCK.catalogId)],
    },
  });
  assert(isMarketplaceStartupReconcileNoop(plan), 'matching state does not patch or toast');
  assert(plan.shouldApply === false, 'no apply when version and fleet already match');
}

console.log('\nTEST 6 — stale pre-purchase cash cannot win');
{
  const plan = planMarketplaceStartupReconcile({
    localTruckIds: [STARTER_TRUCK.id],
    localCash: 100_000,
    localMarketplaceStateVersion: 10,
    acknowledgedVehicleIds: [],
    authoritative: {
      marketplaceStateVersion: 11,
      cash: 72_500,
      soldTruckIds: [],
      vehicles: [
        vehicleSnapshot(STARTER_TRUCK.id, STARTER_TRUCK.catalogId),
        vehicleSnapshot('purchased-market-truck', 'truck-ford-cargo'),
      ],
    },
  });
  assert(plan.nextCash === 72_500, 'committed marketplace cash remains authoritative');
  assert(plan.shouldApply, 'version bump plus missing truck applies the transaction');
}

console.log('\nCloud hold lifetime');
{
  __resetPostStartupMarketplaceCloudHoldForTests();
  beginPostStartupMarketplaceCloudHold();
  assert(isPostStartupMarketplaceCloudHoldActive(), 'hold is active until startup reconcile finishes');
  endPostStartupMarketplaceCloudHold();
  assert(!isPostStartupMarketplaceCloudHoldActive(), 'hold releases after reconcile');
}

void (async () => {
  console.log('\nTEST 5 — repeated launches do not re-toast the same receipt');
  const store = memoryAckStore();
  const first = shouldShowRecoveredPurchaseToast(['purchased-market-truck'], []);
  assert(first.length === 1, 'first recovery can toast');
  const acked = await rememberRecoveredMarketplacePurchaseAcks(['purchased-market-truck'], store);
  const second = shouldShowRecoveredPurchaseToast(['purchased-market-truck'], acked);
  assert(second.length === 0, 'same vehicle does not toast again');
  const plan = planMarketplaceStartupReconcile({
    localTruckIds: [STARTER_TRUCK.id],
    localCash: 80_000,
    localMarketplaceStateVersion: 11,
    acknowledgedVehicleIds: acked,
    authoritative: {
      marketplaceStateVersion: 12,
      cash: 80_000,
      soldTruckIds: [],
      vehicles: [
        vehicleSnapshot(STARTER_TRUCK.id, STARTER_TRUCK.catalogId),
        vehicleSnapshot('purchased-market-truck', 'truck-ford-cargo'),
      ],
    },
  });
  assert(plan.shouldApply, 'vehicle is still patched if local is stale');
  assert(plan.toastVehicleIds.length === 0, 'acked recovery is silent on later launches');

  console.log('\nTEST 7 — startup performance wiring');
  const app = read('App.tsx');
  const gameStore = read('src/store/gameStore.ts');
  const startup = read('src/utils/startupPerformance.ts');
  const service = read('src/services/vehicleMarketplaceStartupReconcile.ts');
  const cloud = read('src/storage/cloudSaveSync.ts');
  const cold = read('scripts/cold-start-performance-test.ts');

  const initSlice = gameStore.slice(
    gameStore.indexOf('initializeGame: () => {'),
    gameStore.indexOf('resetGame: () => {'),
  );
  assert(initSlice.includes("markStartup('GAME_READY')"), 'GAME_READY is still marked in initializeGame');
  assert(
    !initSlice.includes('getMyVehicleListings'),
    'initializeGame does not await marketplace listings',
  );
  assert(
    !initSlice.includes('runPostStartupMarketplaceReconcile'),
    'initializeGame does not run marketplace reconcile',
  );
  assert(
    initSlice.includes('beginPostStartupMarketplaceCloudHold'),
    'cloud upload is held before GAME_READY so stale local cannot upload first',
  );
  assert(
    app.includes('runPostStartupMarketplaceReconcile'),
    'post-startup reconcile is triggered from App after game ready',
  );
  assert(
    /if \(!isGameReady \|\| bootPhase !== 'ready'\)[\s\S]*runPostStartupMarketplaceReconcile\(\)[\s\S]*initCloudSaveSync/.test(
      app,
    ),
    'reconcile runs after first render gate, before the next cloud save',
  );
  assert(
    !/await startGame\(\);[\s\S]{0,80}runPostStartupMarketplaceReconcile/.test(app),
    'startGame / first paint is not blocked on marketplace reconcile',
  );
  assert(
    app.includes('retryPostStartupMarketplaceReconcileIfNeeded'),
    'offline failure retries on later foreground',
  );
  assert(
    app.includes('reconcileVehicleMarketplaceOnForeground'),
    'foreground reconcile runs for offline seller/buyer marketplace mutations',
  );
  assert(
    service.includes('getMyVehicleListings'),
    'startup reconcile uses the lightweight my-listings/state payload',
  );
  assert(
    !service.includes('getVehicleMarketplaceListings'),
    'startup reconcile does not fetch public marketplace inventory',
  );
  assert(service.includes('withMarketplacePurchaseTimeout'), 'startup reconcile has a timeout');
  assert(
    cloud.includes('waiting for marketplace startup reconcile'),
    'cloud save waits until marketplace reconcile becomes the source',
  );
  assert(startup.includes('MARKETPLACE_STARTUP_RECONCILE_START'), 'startup reconcile is timed separately');
  assert(
    !gameStore.includes('await getMyVehicleListings'),
    'gameStore boot never awaits marketplace',
  );
  assert(cold.includes('FIRST_MAIN_SCREEN_RENDER'), 'cold-start suite still guards first paint');

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
  console.log('vehicle-marketplace-startup-reconcile-test: PASSED\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
