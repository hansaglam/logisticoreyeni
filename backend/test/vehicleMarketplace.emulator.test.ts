import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

import {
  SERVER_DEFAULT_CASH,
  SERVER_DEFAULT_STARTER_INSTANCE_ID,
  buildDefaultServerState,
  buildServerStateFromMarketplaceState,
} from '../src/serverState';
import {
  calculateMarketplaceRecommendedPrice,
  cancelVehicleListingTransaction,
  createVehicleListingTransaction,
  ensureVehicleMarketplaceStateTransaction,
  prepareMarketplaceAccountDeletion,
  purchaseVehicleListingTransaction,
} from '../src/vehicleMarketplace';
import { reconcileAuthoritativeFleetTransaction } from '../src/authoritativeFleetReconciliation';
import {
  listingDtoToClientWire,
  serializeMarketplaceListingsForClient,
} from '../src/vehicleMarketplaceSerialization';
import type {
  MarketplacePlayerState,
  MarketplaceVehicleRecord,
} from '../src/vehicleMarketplaceTypes';
import { reconcileFleetWithVehicleMarketplace } from '../../src/domain/vehicleMarketplaceReconciliation';
import type { Truck } from '../../src/types/game';

const PROJECT_ID = 'logisticore-marketplace-emulator';
const NOW_MS = 1_800_000_000_000;
delete process.env.FIRESTORE_EMULATOR_HOST;
process.env.GCLOUD_PROJECT = PROJECT_ID;
let rulesEnvironment: RulesTestEnvironment;
let rulesTesting: typeof import('@firebase/rules-unit-testing');
const adminApp = initializeApp({ projectId: PROJECT_ID }, 'marketplace-tests');
const adminFirestore = getFirestore(adminApp);
adminFirestore.settings({ host: '127.0.0.1:8080', ssl: false });

function vehicle(
  truckId: string,
  overrides: Partial<MarketplaceVehicleRecord> = {},
): MarketplaceVehicleRecord {
  return {
    truckId,
    templateId: 'truck-ford-cargo',
    customName: `Truck ${truckId}`,
    currentCityId: 'izmir',
    condition: 90,
    totalMileageKm: 10_000,
    currentFuelL: 100,
    fuelTankCapacityL: 300,
    purchasePrice: 52_000,
    ownershipType: 'owned',
    status: 'idle',
    assignedDriverId: null,
    attachedTrailerId: null,
    activeJobIds: [],
    marketplaceListingId: null,
    upgrades: { engine: 0, fuelEfficiency: 0, cargo: 0, durability: 0 },
    ...overrides,
  };
}

async function seedState(
  uid: string,
  overrides: Partial<MarketplacePlayerState> = {},
): Promise<MarketplacePlayerState> {
  const state: MarketplacePlayerState = {
    ownerUid: uid,
    canonicalCash: 100_000,
    fleetLimit: 10,
    stateVersion: 1,
    sourceSaveVersion: 7,
    ownedTruckSnapshots: [
      vehicle(`${uid}-truck-1`),
      vehicle(`${uid}-truck-2`),
    ],
    activeListingIds: [],
    soldTruckTombstones: [],
    ...overrides,
  };
  await adminFirestore.doc(`users/${uid}`).set(
    {
      uid,
      username: `seller_${uid.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 10) || 'user'}`,
      usernameNormalized: `seller_${uid.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 10) || 'user'}`.toLowerCase(),
      usernameSetupCompleted: true,
    },
    { merge: true },
  );
  await adminFirestore.doc(`users/${uid}/marketplaceState/current`).set(state);
  const serverState = buildServerStateFromMarketplaceState(
    uid,
    state,
    Timestamp.fromMillis(NOW_MS),
  );
  await adminFirestore.doc(`users/${uid}/serverState/current`).set(serverState);
  return state;
}

function createInput(
  truckId: string,
  askingPrice: number,
  suffix: string,
) {
  return {
    transactionId: `create-${suffix}`,
    idempotencyKey: `create-key-${suffix}`,
    truckId,
    askingPrice,
    clientSaveVersion: 7,
  };
}

async function createValidListing(
  sellerUid = 'seller',
  suffix = 'valid',
) {
  const state = await seedState(sellerUid);
  const recommended = calculateMarketplaceRecommendedPrice(
    state.ownedTruckSnapshots[0]!,
  );
  const result = await createVehicleListingTransaction(
    adminFirestore,
    { uid: sellerUid, displayName: 'Seller Co' },
    createInput(state.ownedTruckSnapshots[0]!.truckId, recommended, suffix),
    NOW_MS,
  );
  assert.equal(result.ok, true);
  return {
    state,
    recommended,
    listingId: result.data!.listingId,
  };
}

before(async () => {
  rulesTesting = await import('@firebase/rules-unit-testing');
  rulesEnvironment = await rulesTesting.initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync(
        resolve(__dirname, '..', '..', 'firestore.rules'),
        'utf8',
      ),
    },
  });
});

beforeEach(async () => {
  await rulesEnvironment.clearFirestore();
});

after(async () => {
  await rulesEnvironment?.cleanup();
  await deleteApp(adminApp);
});

test('valid listing locks vehicle, charges listing fee once and duplicate is idempotent', async () => {
  const { state, listingId, recommended } = await createValidListing();
  const firstState = (
    await adminFirestore.doc('users/seller/marketplaceState/current').get()
  ).data() as MarketplacePlayerState;
  assert.equal(firstState.canonicalCash, state.canonicalCash - 150);
  assert.equal(
    firstState.ownedTruckSnapshots[0]!.status,
    'marketplace_locked',
  );
  assert.equal(
    firstState.ownedTruckSnapshots[0]!.marketplaceListingId,
    listingId,
  );
  const duplicate = await createVehicleListingTransaction(
    adminFirestore,
    { uid: 'seller' },
    createInput(state.ownedTruckSnapshots[0]!.truckId, recommended, 'valid'),
    NOW_MS,
  );
  assert.equal(duplicate.ok, true);
  const afterReplay = (
    await adminFirestore.doc('users/seller/marketplaceState/current').get()
  ).data() as MarketplacePlayerState;
  assert.equal(afterReplay.canonicalCash, firstState.canonicalCash);
  assert.equal(
    (
      await adminFirestore
        .collection('users/seller/marketplaceLedger')
        .get()
    ).size,
    1,
  );
  const duplicateTransaction = await createVehicleListingTransaction(
    adminFirestore,
    { uid: 'seller' },
    {
      ...createInput(
        state.ownedTruckSnapshots[0]!.truckId,
        recommended,
        'different-key',
      ),
      transactionId: 'create-valid',
    },
    NOW_MS,
  );
  assert.equal(duplicateTransaction.reason, 'already-completed');
});

test('new user marketplace state bootstraps from server defaults, not cloud save', async () => {
  const uid = 'new-user';
  await adminFirestore.doc(`users/${uid}`).set({
    uid,
    username: 'new_user_seller',
    usernameNormalized: 'new_user_seller',
    usernameSetupCompleted: true,
  });
  await adminFirestore.doc(`users/${uid}/saves/current`).set({
    saveVersion: 3,
    deviceUpdatedAt: NOW_MS,
    gameState: {
      player: {
        money: 75_000,
        homeCityId: 'izmir',
        trucks: [
          {
            id: 'new-truck-1',
            catalogId: 'truck-ford-cargo',
            purchasePrice: 52_000,
            ownershipType: 'owned',
            status: 'idle',
          },
          {
            id: 'new-truck-2',
            catalogId: 'truck-ford-cargo',
            purchasePrice: 52_000,
            ownershipType: 'owned',
            status: 'idle',
          },
        ],
        drivers: [],
        trailers: [],
      },
      activeDeliveries: [],
      activeTransfers: [],
      activeWarehouseStockTransfers: [],
    },
  });
  const ensured = await ensureVehicleMarketplaceStateTransaction(
    adminFirestore,
    { uid },
    {
      transactionId: 'ensure-new-user',
      idempotencyKey: 'ensure-new-user',
      clientSaveVersion: 3,
    },
    NOW_MS,
  );
  assert.equal(ensured.ok, true);
  assert.equal(ensured.data?.created, true);
  const state = (
    await adminFirestore.doc(`users/${uid}/marketplaceState/current`).get()
  ).data() as MarketplacePlayerState;
  assert.equal(state.ownerUid, uid);
  assert.equal(state.canonicalCash, SERVER_DEFAULT_CASH);
  assert.equal(state.ownedTruckSnapshots.length, 1);
  assert.equal(state.ownedTruckSnapshots[0]?.truckId, SERVER_DEFAULT_STARTER_INSTANCE_ID);
  const serverState = (
    await adminFirestore.doc(`users/${uid}/serverState/current`).get()
  ).data();
  assert.equal(Number(serverState?.cash), SERVER_DEFAULT_CASH);
});

test('stale default marketplace state reconciles from cloud save before listing create', async () => {
  const uid = 'stale-user';
  await adminFirestore.doc(`users/${uid}`).set({
    uid,
    username: 'stale_user',
    usernameNormalized: 'stale_user',
    usernameSetupCompleted: true,
  });
  const defaultState = buildDefaultServerState(uid, Timestamp.fromMillis(NOW_MS));
  await adminFirestore.doc(`users/${uid}/serverState/current`).set(defaultState);
  await adminFirestore.doc(`users/${uid}/marketplaceState/current`).set({
    ownerUid: uid,
    canonicalCash: SERVER_DEFAULT_CASH,
    fleetLimit: 10,
    stateVersion: 1,
    sourceSaveVersion: 1,
    ownedTruckSnapshots: [
      {
        truckId: 'truck-starter-1',
        templateId: 'truck-starter-1',
        currentCityId: 'izmir',
        condition: 88,
        totalMileageKm: 0,
        currentFuelL: 300,
        fuelTankCapacityL: 300,
        purchasePrice: 45_000,
        ownershipType: 'owned',
        status: 'idle',
        assignedDriverId: null,
        attachedTrailerId: null,
        activeJobIds: [],
        marketplaceListingId: null,
        upgrades: { engine: 0, fuelEfficiency: 0, cargo: 0, durability: 0 },
      },
    ],
    activeListingIds: [],
    soldTruckTombstones: [],
    migratedAt: Timestamp.fromMillis(NOW_MS),
    updatedAt: Timestamp.fromMillis(NOW_MS - 60_000),
  });
  await adminFirestore.doc(`users/${uid}/saves/current`).set({
    saveVersion: 6,
    deviceUpdatedAt: NOW_MS,
    ownerUid: uid,
    gameState: {
      player: {
        money: 120_000,
        homeCityId: 'izmir',
        trucks: [
          {
            id: 'truck-starter-1',
            catalogId: 'truck-starter-1',
            purchasePrice: 45_000,
            ownershipType: 'owned',
            status: 'idle',
          },
          {
            id: 'legacy-truck-2',
            catalogId: 'truck-ford-cargo',
            purchasePrice: 52_000,
            ownershipType: 'owned',
            status: 'idle',
          },
        ],
        drivers: [],
        trailers: [],
      },
      activeDeliveries: [],
      activeTransfers: [],
      activeWarehouseStockTransfers: [],
    },
  });

  const reconciled = await reconcileAuthoritativeFleetTransaction(
    adminFirestore,
    uid,
    NOW_MS,
    { requestedVehicleId: 'legacy-truck-2' },
  );
  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.reconciled, true);

  const recommended = calculateMarketplaceRecommendedPrice(
    reconciled.state.ownedTruckSnapshots.find(
      (truck) => truck.truckId === 'legacy-truck-2',
    )!,
  );
  const created = await createVehicleListingTransaction(
    adminFirestore,
    { uid, displayName: 'Stale User' },
    createInput('legacy-truck-2', recommended, 'stale-reconcile'),
    NOW_MS,
  );
  assert.equal(created.ok, true);
});

test('missing cloud save still bootstraps safe server-owned marketplace state', async () => {
  const uid = 'no-save';
  await adminFirestore.doc(`users/${uid}`).set({
    uid,
    username: 'no_save_user',
    usernameNormalized: 'no_save_user',
    usernameSetupCompleted: true,
  });
  const ensured = await ensureVehicleMarketplaceStateTransaction(
    adminFirestore,
    { uid },
    {
      transactionId: 'ensure-no-save',
      idempotencyKey: 'ensure-no-save',
      clientSaveVersion: 1,
    },
    NOW_MS,
  );
  assert.equal(ensured.ok, true);
  assert.equal(ensured.data?.created, true);
  const state = (
    await adminFirestore.doc(`users/${uid}/marketplaceState/current`).get()
  ).data() as MarketplacePlayerState;
  assert.equal(state.canonicalCash, SERVER_DEFAULT_CASH);
});

test('malicious cloud save cannot change canonical marketplace cash or fleet', async () => {
  const uid = 'malicious-marketplace';
  await seedState(uid, {
    canonicalCash: 100_000,
    ownedTruckSnapshots: [vehicle('trusted-truck-1'), vehicle('trusted-truck-2')],
  });
  await adminFirestore.doc(`users/${uid}/saves/current`).set({
    saveVersion: 99,
    deviceUpdatedAt: NOW_MS,
    gameState: {
      player: {
        money: 987_654_321,
        homeCityId: 'izmir',
        trucks: [
          {
            id: 'forged-truck',
            catalogId: 'truck-ford-cargo',
            purchasePrice: 52_000,
            ownershipType: 'owned',
            status: 'idle',
          },
        ],
        drivers: [],
        trailers: [],
      },
      activeDeliveries: [],
      activeTransfers: [],
      activeWarehouseStockTransfers: [],
    },
  });

  const reconciled = await reconcileAuthoritativeFleetTransaction(
    adminFirestore,
    uid,
    NOW_MS,
    { force: true },
  );
  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.state.canonicalCash, 100_000);
  assert.deepEqual(
    reconciled.state.ownedTruckSnapshots.map((truck) => truck.truckId).sort(),
    ['trusted-truck-1', 'trusted-truck-2'],
  );

  const ensured = await ensureVehicleMarketplaceStateTransaction(
    adminFirestore,
    { uid },
    {
      transactionId: 'ensure-malicious',
      idempotencyKey: 'ensure-malicious',
      clientSaveVersion: 99,
    },
    NOW_MS,
  );
  assert.equal(ensured.ok, true);
  const state = (
    await adminFirestore.doc(`users/${uid}/marketplaceState/current`).get()
  ).data() as MarketplacePlayerState;
  assert.equal(state.canonicalCash, 100_000);
  assert.equal(state.ownedTruckSnapshots.length, 2);
});

test('listing rejects busy, attached, leased, duplicate, unsupported and protected trucks', async () => {
  const cases: Array<
    [string, Partial<MarketplaceVehicleRecord>, string]
  > = [
    ['busy', { status: 'on_route' }, 'truck-busy'],
    ['driver', { assignedDriverId: 'driver-1' }, 'driver-attached'],
    ['trailer', { attachedTrailerId: 'trailer-1' }, 'trailer-attached'],
    ['job', { activeJobIds: ['delivery-1'] }, 'active-job'],
    ['leased', { ownershipType: 'leased' }, 'leased-truck'],
    ['listed', { marketplaceListingId: 'existing' }, 'already-listed'],
    ['unsupported', { templateId: 'unknown' }, 'unsupported-truck'],
  ];
  for (const [suffix, override, expected] of cases) {
    const uid = `seller-${suffix}`;
    const truck = vehicle(`${uid}-truck`, override);
    await seedState(uid, {
      ownedTruckSnapshots: [truck, vehicle(`${uid}-backup`)],
    });
    const recommended = Math.max(
      1,
      calculateMarketplaceRecommendedPrice(truck),
    );
    const result = await createVehicleListingTransaction(
      adminFirestore,
      { uid },
      createInput(truck.truckId, recommended, suffix),
      NOW_MS,
    );
    assert.equal(result.reason, expected, suffix);
  }
  const only = vehicle('only-truck');
  await seedState('starter', { ownedTruckSnapshots: [only] });
  const protectedResult = await createVehicleListingTransaction(
    adminFirestore,
    { uid: 'starter' },
    createInput(
      only.truckId,
      calculateMarketplaceRecommendedPrice(only),
      'protected',
    ),
    NOW_MS,
  );
  assert.equal(protectedResult.reason, 'starter-protection');
});

test('invalid price and cloud save conflict are rejected', async () => {
  const state = await seedState('seller');
  const recommended = calculateMarketplaceRecommendedPrice(
    state.ownedTruckSnapshots[0]!,
  );
  const invalid = await createVehicleListingTransaction(
    adminFirestore,
    { uid: 'seller' },
    createInput(
      state.ownedTruckSnapshots[0]!.truckId,
      recommended * 10,
      'bad-price',
    ),
    NOW_MS,
  );
  assert.equal(invalid.reason, 'invalid-price');
  const conflictInput = createInput(
    state.ownedTruckSnapshots[0]!.truckId,
    recommended,
    'conflict',
  );
  conflictInput.clientSaveVersion = 6;
  const conflict = await createVehicleListingTransaction(
    adminFirestore,
    { uid: 'seller' },
    conflictInput,
    NOW_MS,
  );
  assert.equal(conflict.reason, 'save-conflict');
});

test('cancel unlocks vehicle; stale cancel and cancellation after sale are rejected', async () => {
  const { listingId } = await createValidListing();
  const stale = await cancelVehicleListingTransaction(
    adminFirestore,
    { uid: 'seller' },
    {
      transactionId: 'cancel-stale',
      idempotencyKey: 'cancel-stale-key',
      listingId,
      listingVersion: 99,
    },
    NOW_MS + 1,
  );
  assert.equal(stale.reason, 'stale-listing-version');
  const cancelled = await cancelVehicleListingTransaction(
    adminFirestore,
    { uid: 'seller' },
    {
      transactionId: 'cancel-valid',
      idempotencyKey: 'cancel-valid-key',
      listingId,
      listingVersion: 1,
    },
    NOW_MS + 2,
  );
  assert.equal(cancelled.ok, true);
  const state = (
    await adminFirestore.doc('users/seller/marketplaceState/current').get()
  ).data() as MarketplacePlayerState;
  assert.equal(state.ownedTruckSnapshots[0]!.status, 'idle');

  await rulesEnvironment.clearFirestore();
  const soldListing = await createValidListing('seller', 'sold');
  await seedState('buyer');
  const purchase = await purchaseVehicleListingTransaction(
    adminFirestore,
    { uid: 'buyer' },
    {
      transactionId: 'purchase-sold',
      idempotencyKey: 'purchase-sold-key',
      listingId: soldListing.listingId,
      listingVersion: 1,
      quotedPrice: soldListing.recommended,
      clientSaveVersion: 7,
    },
    NOW_MS + 3,
  );
  assert.equal(purchase.ok, true);
  const afterSaleCancel = await cancelVehicleListingTransaction(
    adminFirestore,
    { uid: 'seller' },
    {
      transactionId: 'cancel-after-sale',
      idempotencyKey: 'cancel-after-sale-key',
      listingId: soldListing.listingId,
      listingVersion: 2,
    },
    NOW_MS + 4,
  );
  assert.equal(afterSaleCancel.reason, 'listing-not-active');
});

test('purchase transfers ownership and cash with exact fee and ledger entries', async () => {
  const { listingId, recommended } = await createValidListing();
  const buyerBefore = await seedState('buyer');
  const sellerAfterListing = (
    await adminFirestore.doc('users/seller/marketplaceState/current').get()
  ).data() as MarketplacePlayerState;
  const result = await purchaseVehicleListingTransaction(
    adminFirestore,
    { uid: 'buyer' },
    {
      transactionId: 'purchase-1',
      idempotencyKey: 'purchase-key-1',
      listingId,
      listingVersion: 1,
      quotedPrice: recommended,
      clientSaveVersion: 7,
    },
    NOW_MS + 1,
  );
  assert.equal(result.ok, true);
  const fee = Math.round(recommended * 0.06 * 100) / 100;
  assert.equal(result.data!.marketplaceFee, fee);
  assert.equal(result.data!.sellerNet, recommended - fee);
  const buyer = (
    await adminFirestore.doc('users/buyer/marketplaceState/current').get()
  ).data() as MarketplacePlayerState;
  const seller = (
    await adminFirestore.doc('users/seller/marketplaceState/current').get()
  ).data() as MarketplacePlayerState;
  assert.equal(
    buyer.canonicalCash,
    buyerBefore.canonicalCash - recommended,
  );
  assert.equal(
    seller.canonicalCash,
    sellerAfterListing.canonicalCash + recommended - fee,
  );
  assert.equal(
    buyer.ownedTruckSnapshots.some(
      (item) => item.truckId === 'seller-truck-1',
    ),
    true,
  );
  assert.equal(
    seller.ownedTruckSnapshots.some(
      (item) => item.truckId === 'seller-truck-1',
    ),
    false,
  );
  assert.equal(
    (
      await adminFirestore.doc(
        'vehicleMarketplaceTransactions/purchase-1',
      ).get()
    ).exists,
    true,
  );
});

test('purchase rejects insufficient cash, fleet limit, self purchase and stale version', async () => {
  const { listingId, recommended } = await createValidListing();
  await seedState('poor', { canonicalCash: recommended - 1 });
  const base = {
    listingId,
    listingVersion: 1,
    quotedPrice: recommended,
    clientSaveVersion: 7,
  };
  const poor = await purchaseVehicleListingTransaction(
    adminFirestore,
    { uid: 'poor' },
    { ...base, transactionId: 'poor', idempotencyKey: 'poor-key' },
    NOW_MS + 1,
  );
  assert.equal(poor.reason, 'insufficient-funds');
  await seedState('full', { fleetLimit: 2 });
  const full = await purchaseVehicleListingTransaction(
    adminFirestore,
    { uid: 'full' },
    { ...base, transactionId: 'full', idempotencyKey: 'full-key' },
    NOW_MS + 2,
  );
  assert.equal(full.reason, 'fleet-limit');
  const self = await purchaseVehicleListingTransaction(
    adminFirestore,
    { uid: 'seller' },
    { ...base, transactionId: 'self', idempotencyKey: 'self-key' },
    NOW_MS + 3,
  );
  assert.equal(self.reason, 'self-purchase');
  await seedState('stale');
  const stale = await purchaseVehicleListingTransaction(
    adminFirestore,
    { uid: 'stale' },
    {
      ...base,
      listingVersion: 9,
      transactionId: 'stale',
      idempotencyKey: 'stale-key',
    },
    NOW_MS + 4,
  );
  assert.equal(stale.reason, 'stale-listing-version');
});

test('concurrent double purchase has exactly one winner and duplicate request is idempotent', async () => {
  const { listingId, recommended } = await createValidListing();
  const buyerABefore = await seedState('buyer-a');
  const buyerBBefore = await seedState('buyer-b');
  const sellerBefore = (
    await adminFirestore.doc('users/seller/marketplaceState/current').get()
  ).data() as MarketplacePlayerState;
  const buy = (uid: string) =>
    purchaseVehicleListingTransaction(
      adminFirestore,
      { uid },
      {
        transactionId: `purchase-${uid}`,
        idempotencyKey: `purchase-key-${uid}`,
        listingId,
        listingVersion: 1,
        quotedPrice: recommended,
        clientSaveVersion: 7,
      },
      NOW_MS + 1,
    );
  const results = await Promise.all([buy('buyer-a'), buy('buyer-b')]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(
    results.filter(
      (result) =>
        result.reason === 'listing-not-active' || result.reason === 'listing-sold',
    ).length,
    1,
  );
  const winner = results.find((result) => result.ok)!;
  const loser = results.find((result) => !result.ok)!;
  const winnerUid = winner.transactionId.replace('purchase-', '');
  const loserUid = loser.transactionId.replace('purchase-', '');
  const winnerBefore =
    winnerUid === 'buyer-a' ? buyerABefore : buyerBBefore;
  const loserBefore = winnerUid === 'buyer-a' ? buyerBBefore : buyerABefore;
  const replay = await buy(winnerUid);
  assert.deepEqual(
    { ...replay, retryCount: undefined },
    { ...winner, retryCount: undefined },
  );

  const listing = (
    await adminFirestore.doc(`vehicleMarketplaceListings/${listingId}`).get()
  ).data()!;
  assert.equal(listing.status, 'sold');
  assert.equal(listing.buyerUid, winnerUid);
  assert.equal(listing.transactionId, `purchase-${winnerUid}`);

  const buyerAfter = (
    await adminFirestore.doc(`users/${winnerUid}/marketplaceState/current`).get()
  ).data() as MarketplacePlayerState;
  const buyerLoserAfter = (
    await adminFirestore.doc(`users/${loserUid}/marketplaceState/current`).get()
  ).data() as MarketplacePlayerState;
  const sellerAfter = (
    await adminFirestore.doc('users/seller/marketplaceState/current').get()
  ).data() as MarketplacePlayerState;

  const fee = Math.round(recommended * 0.06 * 100) / 100;
  assert.equal(buyerAfter.canonicalCash, winnerBefore.canonicalCash - recommended);
  assert.equal(buyerLoserAfter.canonicalCash, loserBefore.canonicalCash);
  assert.equal(
    sellerAfter.canonicalCash,
    sellerBefore.canonicalCash + recommended - fee,
  );
  assert.equal(
    buyerAfter.ownedTruckSnapshots.some((item) => item.truckId === 'seller-truck-1'),
    true,
  );
  assert.equal(
    buyerLoserAfter.ownedTruckSnapshots.some((item) => item.truckId === 'seller-truck-1'),
    false,
  );
  assert.equal(
    sellerAfter.ownedTruckSnapshots.some((item) => item.truckId === 'seller-truck-1'),
    false,
  );

  const marketplaceTransactions = await adminFirestore
    .collection('vehicleMarketplaceTransactions')
    .get();
  assert.equal(marketplaceTransactions.size, 1);
  assert.equal(marketplaceTransactions.docs[0]!.id, `purchase-${winnerUid}`);

  const winnerIdempotency = await adminFirestore
    .collection('vehicleMarketplaceIdempotency')
    .where('uid', '==', winnerUid)
    .get();
  assert.equal(winnerIdempotency.size, 1);
  const loserIdempotency = await adminFirestore
    .collection('vehicleMarketplaceIdempotency')
    .where('uid', '==', loserUid)
    .get();
  assert.equal(loserIdempotency.size, 0);

  const listingLock = (
    await adminFirestore.doc(`vehicleMarketplaceListingLocks/${listingId}`).get()
  ).data()!;
  assert.equal(listingLock.buyerUid, winnerUid);
  assert.equal(listingLock.transactionId, `purchase-${winnerUid}`);
});

test('cloud restore cannot resurrect sold truck', () => {
  const localTruck = {
    id: 'sold-truck',
    catalogId: 'truck-ford-cargo',
    name: 'Old Save Truck',
    capacity: 26,
    fuelConsumptionPerKm: 0.31,
    speed: 70,
    reliability: 78,
    maintenanceCost: 0.14,
    comfort: 55,
    condition: 90,
    purchasePrice: 52_000,
    currentCityId: 'izmir',
    status: 'idle',
  } satisfies Truck;
  const incomplete = reconcileFleetWithVehicleMarketplace([localTruck], {
    marketplaceStateVersion: 9,
    soldTruckIds: ['sold-truck'],
    vehicles: [],
  });
  assert.equal(incomplete.isComplete, false);
  assert.equal(incomplete.trucks.length, 1);

  const result = reconcileFleetWithVehicleMarketplace([localTruck], {
    marketplaceStateVersion: 9,
    cash: 55_000,
    soldTruckIds: ['sold-truck'],
    vehicles: [],
  });
  assert.equal(result.isComplete, true);
  assert.equal(result.trucks.length, 0);
  assert.deepEqual(result.cache.soldTruckIds, ['sold-truck']);
  assert.equal(result.authoritativeCash, 55_000);
});

test('account deletion cancels active listing and anonymizes history', async () => {
  const { listingId } = await createValidListing();
  const result = await prepareMarketplaceAccountDeletion(
    adminFirestore,
    'seller',
    NOW_MS + 1,
  );
  assert.equal(result.cancelledListings, 1);
  const listing = (
    await adminFirestore
      .doc(`vehicleMarketplaceListings/${listingId}`)
      .get()
  ).data()!;
  assert.equal(listing.status, 'cancelled');
  assert.equal(listing.sellerDisplayName, 'Silinmiş Oyuncu');
});

test('account deletion succeeds with no marketplace activity', async () => {
  const result = await prepareMarketplaceAccountDeletion(
    adminFirestore,
    'no-marketplace-user',
    NOW_MS + 2,
  );
  assert.equal(result.cancelledListings, 0);
  assert.equal(result.anonymizedListings, 0);
});

test('account deletion succeeds with marketplace state but no listings', async () => {
  await seedState('state-only-user');
  const result = await prepareMarketplaceAccountDeletion(
    adminFirestore,
    'state-only-user',
    NOW_MS + 3,
  );
  assert.equal(result.cancelledListings, 0);
  assert.equal(result.anonymizedListings, 0);
  const stateSnap = await adminFirestore
    .doc('users/state-only-user/marketplaceState/current')
    .get();
  assert.equal(stateSnap.exists, false);
});

test('account deletion is idempotent when marketplace state already cleaned', async () => {
  await prepareMarketplaceAccountDeletion(adminFirestore, 'already-clean', NOW_MS + 4);
  const second = await prepareMarketplaceAccountDeletion(
    adminFirestore,
    'already-clean',
    NOW_MS + 5,
  );
  assert.equal(second.cancelledListings, 0);
  assert.equal(second.anonymizedListings, 0);
});

test('Firestore allows public active reads but denies all direct marketplace writes', async () => {
  const { assertFails, assertSucceeds } = rulesTesting;
  const { listingId } = await createValidListing();
  const publicDb = rulesEnvironment.unauthenticatedContext().firestore();
  const ownerDb = rulesEnvironment.authenticatedContext('seller').firestore();
  await assertSucceeds(
    publicDb.doc(`vehicleMarketplaceListings/${listingId}`).get(),
  );
  await assertSucceeds(
    ownerDb.doc('users/seller/marketplaceState/current').get(),
  );
  await assertFails(
    ownerDb
      .doc(`vehicleMarketplaceListings/${listingId}`)
      .update({ askingPrice: 1 }),
  );
  await assertFails(
    ownerDb
      .doc('vehicleMarketplaceTransactions/fake')
      .set({ sellerUid: 'seller' }),
  );
  await assertFails(
    ownerDb
      .doc('users/seller/marketplaceState/current')
      .update({ cash: 999_999 }),
  );

  await adminFirestore
    .doc(`vehicleMarketplaceListings/${listingId}`)
    .update({ status: 'cancelled' });
  await assertFails(
    publicDb.doc(`vehicleMarketplaceListings/${listingId}`).get(),
  );
});

test('marketplace listing serializer emits primitive client wire values', async () => {
  const { listingId } = await createValidListing('seller-serialize', 'serialize');
  const snap = await adminFirestore.doc(`vehicleMarketplaceListings/${listingId}`).get();
  assert.equal(snap.exists, true);
  const serialized = serializeMarketplaceListingsForClient([snap]);
  assert.equal(serialized.rejectedCount, 0);
  assert.equal(serialized.listings.length, 1);
  const wire = listingDtoToClientWire(serialized.listings[0]!);
  assert.equal(typeof wire.createdAt, 'number');
  assert.equal(typeof wire.updatedAt, 'number');
  assert.equal(typeof wire.expiresAt, 'number');
  assert.equal(typeof (wire.truckSnapshot as Record<string, unknown>).condition, 'number');
  assert.notEqual(typeof wire.createdAt, 'object');
});
