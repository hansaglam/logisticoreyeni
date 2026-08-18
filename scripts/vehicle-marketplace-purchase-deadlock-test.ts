/**
 * Vehicle marketplace purchase deadlock / timeout / idempotency regression.
 * Run: npx tsx scripts/vehicle-marketplace-purchase-deadlock-test.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import './test-globals';

import { STARTER_TRUCK } from '../src/data/trucks';
import { resolveStaleCloudMarketplaceOverwrite } from '../src/domain/vehicleMarketplaceCloudMerge';
import {
  createMarketplacePurchaseEnvelope,
  getMarketplacePurchaseAlertCopy,
  isMarketplacePurchaseSuccess,
  resolveMarketplacePurchaseAttempt,
  resolveMarketplacePurchaseClientOutcome,
  shouldReusePurchaseEnvelope,
  withMarketplacePurchaseTimeout,
} from '../src/domain/vehicleMarketplacePurchaseFlow';
import { reconcileFleetWithVehicleMarketplace } from '../src/domain/vehicleMarketplaceReconciliation';
import {
  __resetMarketplaceOperationLockForTests,
  isVehicleMarketplaceOperationActive,
  withVehicleMarketplaceOperationLock,
} from '../src/services/marketplaceOperationLock';
import {
  abandonHungCloudSaveInFlight,
  joinCloudSaveInFlight,
} from '../src/storage/cloudSaveInFlight';
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

console.log('\n=== Vehicle Marketplace Purchase Deadlock ===\n');

console.log('Idempotency envelope');
{
  const first = createMarketplacePurchaseEnvelope({
    listingId: 'listing-1',
    buyerUid: 'buyer-uid',
    requestId: 'req-aaa',
  });
  const second = createMarketplacePurchaseEnvelope({
    listingId: 'listing-1',
    buyerUid: 'buyer-uid',
    requestId: 'req-aaa',
  });
  assert(first.idempotencyKey === second.idempotencyKey, 'same request reuses the same key');
  assert(first.transactionId === first.idempotencyKey, 'transaction id matches idempotency key');
  assert(first.idempotencyKey.startsWith('purchase:'), 'purchase key prefix');
  assert(first.idempotencyKey.length <= 128, 'bounded id length');
}

console.log('\nSuccess vs timeout classification');
{
  assert(isMarketplacePurchaseSuccess({ ok: true }), 'ok result is success');
  assert(
    isMarketplacePurchaseSuccess({ ok: false, reason: 'already-completed' }),
    'already-completed is treated as success, not a second charge',
  );
  assert(
    !isMarketplacePurchaseSuccess({ ok: false, reason: 'insufficient-funds' }),
    'insufficient funds is not success',
  );
  assert(shouldReusePurchaseEnvelope('timeout'), 'timeout retries with same key');
  assert(shouldReusePurchaseEnvelope('network-error'), 'network retries with same key');
  assert(!shouldReusePurchaseEnvelope('listing-sold'), 'sold listing does not reuse buy key');
}

console.log('\nError copy');
{
  assert(
    getMarketplacePurchaseAlertCopy('insufficient-funds').message === 'Yeterli nakdin yok.',
    'insufficient funds copy',
  );
  assert(
    getMarketplacePurchaseAlertCopy('listing-sold').message.includes('başka bir oyuncu'),
    'sold listing copy',
  );
  assert(
    getMarketplacePurchaseAlertCopy('listing-not-found').message === 'İlan artık mevcut değil.',
    'missing listing copy',
  );
  assert(
    getMarketplacePurchaseAlertCopy('fleet-limit').message === 'Filonda boş yer yok.',
    'fleet full copy',
  );
  assert(
    getMarketplacePurchaseAlertCopy('timeout').title === 'Satın alma tamamlanamadı',
    'timeout title',
  );
  assert(
    getMarketplacePurchaseAlertCopy('timeout').message.includes('Sunucudan yanıt alınamadı'),
    'timeout asks the player to check then retry',
  );
}

function vehicleSnapshot(truckId: string, templateId: string) {
  return {
    truckId,
    templateId,
    currentCityId: 'izmir' as const,
    condition: 88,
    totalMileageKm: 1000,
    currentFuelL: 80,
    fuelTankCapacityL: 300,
    status: 'idle' as const,
  };
}

async function runAsyncChecks(): Promise<void> {
  console.log('\nTimeout wrapper');
  const started = Date.now();
  let timedOut = false;
  try {
    await withMarketplacePurchaseTimeout(new Promise(() => undefined), 40);
  } catch (error) {
    timedOut = (error as { marketplaceReason?: string }).marketplaceReason === 'timeout';
  }
  assert(timedOut, 'unsettled promise times out');
  assert(Date.now() - started < 500, 'timeout does not spin forever');

  const value = await withMarketplacePurchaseTimeout(Promise.resolve('ok'), 200);
  assert(value === 'ok', 'fast success is not timed out');

  console.log('\nPoisoned syncInFlight recovery');
  {
    const hung = new Promise<boolean>(() => undefined);
    const joined = await joinCloudSaveInFlight(hung, 25);
    assert(joined.timedOut, 'joiner times out instead of waiting forever');
    assert(joined.value === false, 'timed-out join returns false');
    const recovered = abandonHungCloudSaveInFlight(hung, hung);
    assert(recovered === null, 'hung mutex is cleared so a later sync can start');
    const replacement = Promise.resolve(true);
    assert(
      abandonHungCloudSaveInFlight(replacement, hung) === replacement,
      'a newer in-flight sync is not cleared by the abandoned hung promise',
    );
    const next = await joinCloudSaveInFlight(replacement, 50);
    assert(next.timedOut === false && next.value === true, 'future cloud save works after poisoned join');
  }

  console.log('\nLock release after exception');
  {
    __resetMarketplaceOperationLockForTests();
    let caught = false;
    try {
      await withVehicleMarketplaceOperationLock(async () => {
        assert(isVehicleMarketplaceOperationActive(), 'lock is held during the mutation');
        throw new Error('typed backend error');
      });
    } catch {
      caught = true;
    }
    assert(caught, 'unexpected exception still surfaces');
    assert(!isVehicleMarketplaceOperationActive(), 'lock is released after exception');

    await withVehicleMarketplaceOperationLock(async () => 'ok');
    assert(!isVehicleMarketplaceOperationActive(), 'lock is released after success');

    try {
      await withVehicleMarketplaceOperationLock(async () => {
        await withMarketplacePurchaseTimeout(new Promise(() => undefined), 20);
      });
    } catch {
      // timeout
    }
    assert(!isVehicleMarketplaceOperationActive(), 'lock is released after timeout');
    __resetMarketplaceOperationLockForTests();
  }

  console.log('\nCommitted purchase + failed refresh');
  {
    const outcome = resolveMarketplacePurchaseClientOutcome(
      { ok: true, reason: undefined },
      { refreshFailed: true },
    );
    assert(outcome.kind === 'success', 'committed purchase stays SUCCESS if refresh fails');
    assert(outcome.kind === 'success' && outcome.reconcileAsync, 'local reconcile stays asynchronous');
    const replayed = resolveMarketplacePurchaseClientOutcome(
      { ok: false, reason: 'already-completed' },
      { refreshFailed: true },
    );
    assert(replayed.kind === 'success', 'receipt already-completed is still SUCCESS after refresh failure');
  }

  console.log('\nTimeout + replay keeps the same idempotency key');
  {
    const first = resolveMarketplacePurchaseAttempt({
      existing: null,
      listingId: 'listing-9',
      buyerUid: 'buyer-9',
      requestId: 'req-1',
    });
    const timeoutOutcome = resolveMarketplacePurchaseClientOutcome({
      ok: false,
      reason: 'timeout',
    });
    assert(timeoutOutcome.kind === 'retryable-failure' && timeoutOutcome.reuseEnvelope, 'timeout keeps the envelope');
    const networkOutcome = resolveMarketplacePurchaseClientOutcome({
      ok: false,
      reason: 'network-error',
    });
    assert(networkOutcome.reuseEnvelope, 'temporary network failure keeps the envelope');
    const retry = resolveMarketplacePurchaseAttempt({
      existing: first,
      listingId: 'listing-9',
      buyerUid: 'buyer-9',
      requestId: 'req-2',
    });
    assert(retry.idempotencyKey === first.idempotencyKey, 'retry reuses the same key');
    assert(retry.transactionId === first.transactionId, 'retry reuses the same transaction id');
    const terminal = resolveMarketplacePurchaseClientOutcome({
      ok: false,
      reason: 'listing-sold',
    });
    assert(terminal.kind === 'terminal-failure' && !terminal.reuseEnvelope, 'terminal outcome drops the key');
    const nextPurchase = resolveMarketplacePurchaseAttempt({
      existing: null,
      listingId: 'listing-9',
      buyerUid: 'buyer-9',
      requestId: 'req-3',
    });
    assert(nextPurchase.idempotencyKey !== first.idempotencyKey, 'a genuinely new purchase gets a new key');
  }

  console.log('\nApp restart after commit');
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
    const first = reconcileFleetWithVehicleMarketplace(local, authoritative);
    assert(first.authoritativeCash === 80_000, 'restart applies authoritative post-purchase cash');
    const ids = first.trucks.map((truck) => truck.id);
    assert(ids.includes(STARTER_TRUCK.id), 'starter remains');
    assert(ids.includes(purchasedId), 'purchased vehicle appears after restart hydrate');
    assert(ids.filter((id) => id === purchasedId).length === 1, 'purchased vehicle appears exactly once');
    const second = reconcileFleetWithVehicleMarketplace(first.trucks, authoritative);
    assert(
      second.trucks.filter((truck) => truck.id === purchasedId).length === 1,
      'replaying restart reconcile does not duplicate the vehicle',
    );
    const restartAttempt = resolveMarketplacePurchaseAttempt({
      existing: null,
      listingId: 'listing-committed',
      buyerUid: 'buyer-9',
      requestId: 'after-restart',
    });
    assert(
      restartAttempt.idempotencyKey.includes('after-restart'),
      'in-memory key is lost on process death; a new attempt is a new key',
    );
  }

  console.log('\nCloud-save stale overwrite attempt');
  {
    const overwrite = resolveStaleCloudMarketplaceOverwrite({
      existingCash: 80_000,
      cloudCash: 100_000,
      existingVehicleIds: ['truck-starter-1', 'purchased-market-truck'],
      cloudVehicleIds: ['truck-starter-1'],
      soldTruckIds: [],
    });
    assert(overwrite.cash === 80_000, 'stale local money cannot restore the pre-purchase balance');
    assert(
      overwrite.preservedVehicleIds.includes('purchased-market-truck'),
      'stale local fleet cannot remove the newly purchased vehicle',
    );
    assert(overwrite.rejectedStaleCashRestore, 'stale cash restore is rejected');
    assert(overwrite.rejectedStaleVehicleRemoval, 'stale vehicle removal is rejected');

    const earnings = resolveStaleCloudMarketplaceOverwrite({
      existingCash: 80_000,
      cloudCash: 95_000,
      existingVehicleIds: ['truck-starter-1', 'purchased-market-truck'],
      cloudVehicleIds: ['truck-starter-1', 'purchased-market-truck'],
      soldTruckIds: [],
    });
    assert(earnings.cash === 95_000, 'matching fleets still accept newer cloud cash');
  }
}

void runAsyncChecks()
  .then(() => {
    console.log('\nWiring');
    const screen = read('src/screens/VehicleMarketplaceScreen.tsx');
    const prep = read('src/domain/vehicleMarketplacePurchasePrep.ts');
    const service = read('src/services/vehicleMarketplaceService.ts');
    const sheets = read('src/components/marketplace/VehicleMarketplaceSheets.tsx');
    const cloud = read('src/storage/cloudSaveSync.ts');
    const money = read('src/services/testMoneySyncService.ts');
    const backend = read('backend/src/vehicleMarketplace.ts');
    const fleet = read('backend/src/authoritativeFleetReconciliation.ts');
    const callable = read('backend/src/index.ts');
    const lock = read('src/services/marketplaceOperationLock.ts');

    const prepAwaitCount = (screen.match(/await prepareMarketplacePurchaseFunds\(\)/g) ?? []).length;
    assert(prepAwaitCount === 1, 'confirm does not re-await purchase prep');
    assert(
      screen.includes('refreshAll({ skipStaleCloudReconcile: true })'),
      'post-purchase refresh does not upload stale local save first',
    );
    assert(screen.includes('void refreshAll({ skipStaleCloudReconcile: true }).then('), 'success does not wait on full refresh');
    assert(screen.includes('withMarketplacePurchaseTimeout'), 'confirm wraps purchase in a timeout');
    assert(screen.includes('reconciling receipt'), 'timeout path reconciles the same receipt');
    assert(screen.includes('finally'), 'buying flag always clears');
    assert(screen.includes('endVehicleMarketplaceOperation()'), 'confirm releases the marketplace lock');
    assert(screen.includes('setIsBuyingVehicle(false)'), 'spinner recovery wired');
    assert(screen.includes('setIsPreparingPurchase(false)'), 'cash-prep spinner has a terminal path');
    assert(prep.includes('withMarketplacePurchaseTimeout(getMyVehicleListings())'), 'cash prep times out');
    assert(sheets.includes('Satın alınıyor'), 'buying copy exists');
    assert(sheets.includes('Nakit kontrol ediliyor'), 'prep copy exists');
    assert(sheets.includes('Tekrar Dene') || screen.includes('Tekrar Dene'), 'retry button exists');
    assert(!prep.includes('syncLocalSaveToCloud'), 'cash prep no longer awaits force cloud sync');
    assert(!prep.includes('ensureAuthoritativeFleetReady'), 'cash prep no longer awaits fleet migrate');
    assert(service.includes('[MARKETPLACE_PURCHASE] request sent'), 'purchase request is logged');
    assert(service.includes('finally {\n    endVehicleMarketplaceOperation();'), 'callable releases lock in finally');
    assert(lock.includes('finally {\n    endVehicleMarketplaceOperation();'), 'lock helper always ends in finally');
    assert(cloud.includes('marketplace purchase in flight'), 'cloud save skipped during purchase');
    assert(cloud.includes('abandonHungCloudSaveInFlight'), 'timed-out join abandons a hung syncInFlight');
    assert(money.includes('marketplace purchase in flight'), 'test money sync deferred during purchase');
    assert(backend.includes("failure(input, 'listing-sold')"), 'sold listing is a typed error');
    assert(backend.includes('listing.buyerUid === identity.uid'), 'same-buyer restart reconciles the committed sale');
    assert(fleet.includes('resolveStaleCloudMarketplaceOverwrite'), 'cloud fleet merge preserves marketplace mutations');
    assert(callable.includes('serverMoneyBefore'), 'server logs authoritative cash before');
    assert(callable.includes('serverMoneyAfter'), 'server logs authoritative cash after');

    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      process.exit(1);
    }
    console.log('vehicle-marketplace-purchase-deadlock-test: PASSED\n');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
