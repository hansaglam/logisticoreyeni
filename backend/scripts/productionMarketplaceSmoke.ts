import { createHash, randomBytes } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  applicationDefault,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

import {
  calculateMarketplaceRecommendedPrice,
} from '../src/vehicleMarketplace';
import type {
  MarketplaceActionResult,
  MarketplacePlayerState,
  MarketplaceVehicleRecord,
} from '../src/vehicleMarketplaceTypes';

const CONFIRMED = process.argv.includes('--confirm-production');
const PROJECT_ID = 'logisticore-53ab4';
const REGION = 'us-central1';
const SOURCE_SAVE_VERSION = 7;

interface TestIdentity {
  uid: string;
  idToken: string;
}

function uidHash(uid: string): string {
  return createHash('sha256').update(uid).digest('hex').slice(0, 12);
}

function prepareFirebaseCliAdcIfNeeded(): void {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return;
  const cliAuth = require('firebase-tools/lib/auth') as {
    getGlobalDefaultAccount: () =>
      | { tokens?: { refresh_token?: string } }
      | undefined;
  };
  const cliApi = require('firebase-tools/lib/api') as {
    clientId: () => string;
    clientSecret: () => string;
  };
  const refreshToken =
    cliAuth.getGlobalDefaultAccount()?.tokens?.refresh_token;
  if (!refreshToken) return;
  const directory = mkdtempSync(resolve(tmpdir(), 'logisticore-smoke-adc-'));
  const credentialPath = resolve(directory, 'authorized-user.json');
  writeFileSync(
    credentialPath,
    JSON.stringify({
      type: 'authorized_user',
      client_id: cliApi.clientId(),
      client_secret: cliApi.clientSecret(),
      refresh_token: refreshToken,
    }),
    { encoding: 'utf8', mode: 0o600 },
  );
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialPath;
  process.once('exit', () => {
    rmSync(directory, { recursive: true, force: true });
  });
}

function readFirebaseApiKey(): string {
  const direct = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
  if (direct) return direct;
  const envPath = resolve(__dirname, '..', '..', '.env');
  const line = readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((value) => value.startsWith('EXPO_PUBLIC_FIREBASE_API_KEY='));
  const value = line?.slice(line.indexOf('=') + 1).trim();
  if (!value) throw new Error('FIREBASE_API_KEY_NOT_CONFIGURED');
  return value.replace(/^['"]|['"]$/g, '');
}

async function createTestIdentity(
  apiKey: string,
  label: string,
  suffix: string,
): Promise<TestIdentity> {
  void label;
  void suffix;
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        returnSecureToken: true,
      }),
    },
  );
  const body = (await response.json()) as {
    localId?: string;
    idToken?: string;
    error?: { message?: string };
  };
  if (!response.ok || !body.localId || !body.idToken) {
    throw new Error(
      `AUTH_TEST_ACCOUNT_CREATE_FAILED:${body.error?.message ?? response.status}`,
    );
  }
  return { uid: body.localId, idToken: body.idToken };
}

async function deleteTestIdentity(
  apiKey: string,
  identity: TestIdentity,
): Promise<void> {
  await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: identity.idToken }),
    },
  );
}

function truck(
  truckId: string,
  currentCityId = 'izmir',
): MarketplaceVehicleRecord {
  return {
    truckId,
    templateId: 'truck-ford-cargo',
    customName: `Smoke ${truckId.slice(-4)}`,
    currentCityId,
    condition: 92,
    totalMileageKm: 12_500,
    currentFuelL: 180,
    fuelTankCapacityL: 300,
    purchasePrice: 52_000,
    ownershipType: 'owned',
    status: 'idle',
    assignedDriverId: null,
    attachedTrailerId: null,
    activeJobIds: [],
    marketplaceListingId: null,
    upgrades: { engine: 0, fuelEfficiency: 0, cargo: 0, durability: 0 },
  };
}

function state(
  uid: string,
  canonicalCash: number,
  trucks: MarketplaceVehicleRecord[],
): MarketplacePlayerState {
  const now = Timestamp.now();
  return {
    ownerUid: uid,
    canonicalCash,
    fleetLimit: 20,
    ownedTruckSnapshots: trucks,
    activeListingIds: [],
    soldTruckTombstones: [],
    stateVersion: 1,
    sourceSaveVersion: SOURCE_SAVE_VERSION,
    migratedAt: now,
    updatedAt: now,
  };
}

async function callable<T>(
  functionName: string,
  identity: TestIdentity,
  data: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${functionName}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${identity.idToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ data }),
    },
  );
  const body = (await response.json()) as {
    result?: T;
    error?: { message?: string; status?: string };
  };
  if (!response.ok || body.result == null) {
    throw new Error(
      `CALLABLE_FAILED:${functionName}:${body.error?.status ?? response.status}:${body.error?.message ?? ''}`,
    );
  }
  return body.result;
}

async function firestoreRest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
    init,
  );
}

async function main(): Promise<void> {
  if (!CONFIRMED) throw new Error('PRODUCTION_CONFIRMATION_REQUIRED');
  const startedAt = Date.now();
  prepareFirebaseCliAdcIfNeeded();
  const apiKey = readFirebaseApiKey();
  const app =
    getApps()[0] ??
    initializeApp({
      projectId: PROJECT_ID,
      credential: applicationDefault(),
    });
  const firestore = getFirestore(app);
  const suffix = `${Date.now()}-${randomBytes(3).toString('hex')}`;
  const identities: TestIdentity[] = [];
  const listingIds: string[] = [];
  const transactionIds: string[] = [];
  try {
    const [seller, buyer, concurrentBuyer] = await Promise.all([
      createTestIdentity(apiKey, 'seller', suffix),
      createTestIdentity(apiKey, 'buyer', suffix),
      createTestIdentity(apiKey, 'buyer-concurrent', suffix),
    ]);
    identities.push(seller, buyer, concurrentBuyer);
    const sellerTrucks = [
      truck(`smoke-${suffix}-seller-1`),
      truck(`smoke-${suffix}-seller-2`),
      truck(`smoke-${suffix}-seller-3`),
    ];
    await Promise.all([
      firestore.doc(`users/${seller.uid}`).set({ smokeTest: true }),
      firestore.doc(`users/${buyer.uid}`).set({ smokeTest: true }),
      firestore.doc(`users/${concurrentBuyer.uid}`).set({ smokeTest: true }),
      firestore
        .doc(`users/${seller.uid}/marketplaceState/current`)
        .create(state(seller.uid, 100_000, sellerTrucks)),
      firestore
        .doc(`users/${buyer.uid}/marketplaceState/current`)
        .create(state(buyer.uid, 200_000, [truck(`smoke-${suffix}-buyer`)])),
      firestore
        .doc(`users/${concurrentBuyer.uid}/marketplaceState/current`)
        .create(
          state(concurrentBuyer.uid, 200_000, [
            truck(`smoke-${suffix}-buyer-concurrent`),
          ]),
        ),
    ]);

    const ownStateRead = await firestoreRest(
      `users/${buyer.uid}/marketplaceState/current`,
      {
        headers: { authorization: `Bearer ${buyer.idToken}` },
      },
    );
    const foreignStateRead = await firestoreRest(
      `users/${seller.uid}/marketplaceState/current`,
      {
        headers: { authorization: `Bearer ${buyer.idToken}` },
      },
    );
    assert(ownStateRead.ok, 'OWNER_MARKETPLACE_STATE_READ_FAILED');
    assert(foreignStateRead.status === 403, 'FOREIGN_STATE_READ_NOT_DENIED');

    const firstPrice = calculateMarketplaceRecommendedPrice(sellerTrucks[0]!);
    const firstCreate = await callable<
      MarketplaceActionResult<{ listingId: string; recommendedPrice: number }>
    >('createVehicleListing', seller, {
      transactionId: `smoke-create-1-${suffix}`,
      idempotencyKey: `smoke-create-key-1-${suffix}`,
      truckId: sellerTrucks[0]!.truckId,
      askingPrice: firstPrice,
      clientSaveVersion: SOURCE_SAVE_VERSION,
    });
    assert(firstCreate.ok && firstCreate.data, 'FIRST_LISTING_CREATE_FAILED');
    listingIds.push(firstCreate.data.listingId);

    const publicRead = await firestoreRest(
      `vehicleMarketplaceListings/${firstCreate.data.listingId}`,
    );
    assert(publicRead.ok, 'PUBLIC_ACTIVE_LISTING_READ_FAILED');
    const buyerListings = await callable<{
      ok: boolean;
      listings: Array<{ id: string }>;
    }>('getVehicleMarketplaceListings', buyer, { limit: 25 });
    assert(
      buyerListings.ok &&
        buyerListings.listings.some(
          (listing) => listing.id === firstCreate.data!.listingId,
        ),
      'BUYER_LISTING_VISIBILITY_FAILED',
    );

    const directWrite = await firestoreRest(
      `vehicleMarketplaceListings/${firstCreate.data.listingId}?updateMask.fieldPaths=askingPrice`,
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${seller.idToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          fields: { askingPrice: { integerValue: '1' } },
        }),
      },
    );
    assert(directWrite.status === 403, 'DIRECT_LISTING_WRITE_NOT_DENIED');
    const directTransactionWrite = await firestoreRest(
      `vehicleMarketplaceTransactions/smoke-direct-${suffix}`,
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${buyer.idToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          fields: { buyerUid: { stringValue: buyer.uid } },
        }),
      },
    );
    assert(
      directTransactionWrite.status === 403,
      'DIRECT_TRANSACTION_WRITE_NOT_DENIED',
    );

    const firstPurchaseId = `smoke-purchase-1-${suffix}`;
    const firstPurchase = await callable<
      MarketplaceActionResult<{
        listingId: string;
        grossPrice: number;
        marketplaceFee: number;
        sellerNet: number;
      }>
    >('purchaseVehicleListing', buyer, {
      transactionId: firstPurchaseId,
      idempotencyKey: `smoke-purchase-key-1-${suffix}`,
      listingId: firstCreate.data.listingId,
      listingVersion: 1,
      quotedPrice: firstPrice,
      clientSaveVersion: SOURCE_SAVE_VERSION,
    });
    transactionIds.push(firstPurchaseId);
    assert(firstPurchase.ok && firstPurchase.data, 'FIRST_PURCHASE_FAILED');
    const [sellerAfter, buyerAfter, soldListing] = await Promise.all([
      firestore.doc(`users/${seller.uid}/marketplaceState/current`).get(),
      firestore.doc(`users/${buyer.uid}/marketplaceState/current`).get(),
      firestore
        .doc(`vehicleMarketplaceListings/${firstCreate.data.listingId}`)
        .get(),
    ]);
    const sellerState = sellerAfter.data() as MarketplacePlayerState;
    const buyerState = buyerAfter.data() as MarketplacePlayerState;
    assert(soldListing.data()?.status === 'sold', 'LISTING_NOT_SOLD');
    assert(
      sellerState.soldTruckTombstones.includes(sellerTrucks[0]!.truckId),
      'SELLER_TOMBSTONE_MISSING',
    );
    assert(
      !sellerState.ownedTruckSnapshots.some(
        (item) => item.truckId === sellerTrucks[0]!.truckId,
      ) &&
        buyerState.ownedTruckSnapshots.some(
          (item) => item.truckId === sellerTrucks[0]!.truckId,
        ),
      'OWNERSHIP_TRANSFER_FAILED',
    );
    const expectedFee = Math.round(firstPrice * 0.06 * 100) / 100;
    assert(
      firstPurchase.data.marketplaceFee === expectedFee &&
        sellerState.canonicalCash ===
          100_000 - 150 + firstPrice - expectedFee &&
        buyerState.canonicalCash === 200_000 - firstPrice,
      'CASH_OR_FEE_MISMATCH',
    );
    const restoredOldTruckWouldSurvive =
      !sellerState.soldTruckTombstones.includes(sellerTrucks[0]!.truckId);
    assert(
      restoredOldTruckWouldSurvive === false,
      'OLD_SAVE_COULD_RESURRECT_TRUCK',
    );

    const secondPrice = calculateMarketplaceRecommendedPrice(sellerTrucks[1]!);
    const secondCreate = await callable<
      MarketplaceActionResult<{ listingId: string; recommendedPrice: number }>
    >('createVehicleListing', seller, {
      transactionId: `smoke-create-2-${suffix}`,
      idempotencyKey: `smoke-create-key-2-${suffix}`,
      truckId: sellerTrucks[1]!.truckId,
      askingPrice: secondPrice,
      clientSaveVersion: SOURCE_SAVE_VERSION,
    });
    assert(secondCreate.ok && secondCreate.data, 'SECOND_LISTING_CREATE_FAILED');
    listingIds.push(secondCreate.data.listingId);
    const concurrentInputs = [buyer, concurrentBuyer].map(
      (identity, index) =>
        callable<MarketplaceActionResult>(
          'purchaseVehicleListing',
          identity,
          {
            transactionId: `smoke-concurrent-${index}-${suffix}`,
            idempotencyKey: `smoke-concurrent-key-${index}-${suffix}`,
            listingId: secondCreate.data!.listingId,
            listingVersion: 1,
            quotedPrice: secondPrice,
            clientSaveVersion: SOURCE_SAVE_VERSION,
          },
        ),
    );
    const concurrentResults = await Promise.all(concurrentInputs);
    for (const result of concurrentResults) {
      if (result.ok) transactionIds.push(result.transactionId);
    }
    assert(
      concurrentResults.filter((result) => result.ok).length === 1,
      'CONCURRENT_PURCHASE_WINNER_COUNT_INVALID',
    );
    assert(
      concurrentResults.some(
        (result) =>
          !result.ok &&
          (result.reason === 'listing-not-active' ||
            result.reason === 'stale-listing-version'),
      ),
      'CONCURRENT_LOSER_REASON_INVALID',
    );
    const ownershipStates = await Promise.all(
      [buyer, concurrentBuyer].map((identity) =>
        firestore.doc(`users/${identity.uid}/marketplaceState/current`).get(),
      ),
    );
    assert(
      ownershipStates.filter((snapshot) =>
        (snapshot.data() as MarketplacePlayerState).ownedTruckSnapshots.some(
          (item) => item.truckId === sellerTrucks[1]!.truckId,
        ),
      ).length === 1,
      'DUPLICATE_CONCURRENT_OWNERSHIP',
    );

    console.info('[vehicle-marketplace-production-smoke]', {
      result: 'complete',
      sellerUidHash: uidHash(seller.uid),
      buyerUidHashes: [uidHash(buyer.uid), uidHash(concurrentBuyer.uid)],
      firstSale: 'success',
      directWritesDenied: true,
      ownerReadIsolationVerified: true,
      concurrentWinners: 1,
      restoreResurrectionBlocked: true,
      durationMs: Date.now() - startedAt,
    });
  } finally {
    for (const listingId of listingIds) {
      await firestore
        .doc(`vehicleMarketplaceListings/${listingId}`)
        .delete()
        .catch(() => undefined);
    }
    for (const transactionId of transactionIds) {
      await firestore
        .doc(`vehicleMarketplaceTransactions/${transactionId}`)
        .delete()
        .catch(() => undefined);
    }
    for (const identity of identities) {
      for (const subcollection of [
        'marketplaceState',
        'marketplaceHistory',
        'marketplaceLedger',
      ]) {
        const documents = await firestore
          .collection(`users/${identity.uid}/${subcollection}`)
          .get();
        const batch = firestore.batch();
        for (const document of documents.docs) batch.delete(document.ref);
        await batch.commit().catch(() => undefined);
      }
      for (const collectionName of [
        'vehicleMarketplaceIdempotency',
        'vehicleMarketplaceActionReceipts',
      ]) {
        const documents = await firestore
          .collection(collectionName)
          .where('uid', '==', identity.uid)
          .get();
        const batch = firestore.batch();
        for (const document of documents.docs) batch.delete(document.ref);
        await batch.commit().catch(() => undefined);
      }
      await firestore.doc(`users/${identity.uid}`).delete().catch(() => undefined);
      await deleteTestIdentity(apiKey, identity).catch(() => undefined);
    }
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

void main().catch((error) => {
  console.error('[vehicle-marketplace-production-smoke]', {
    result: 'failed',
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
