import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';

import {
  SERVER_DEFAULT_CASH,
  SERVER_DEFAULT_STARTER_INSTANCE_ID,
  migrateLegacyServerStateTransaction,
} from '../backend/src/serverState';
import { ensureVehicleMarketplaceStateTransaction } from '../backend/src/vehicleMarketplace';
import { submitLeaderboardScoreTransaction } from '../backend/src/leaderboard';
import { calculateLeaderboardScore } from '../backend/src/leaderboardScore';
import { extractCanonicalPlayerStateFromServerState } from '../backend/src/leaderboardScore';
import { buildDefaultServerState } from '../backend/src/serverState';

const emulatorAddress = process.env.FIRESTORE_EMULATOR_HOST;
if (!emulatorAddress) {
  console.log(
    '[security-malicious-save-trust-test] SKIP — FIRESTORE_EMULATOR_HOST missing (run via firebase emulators:exec)',
  );
  process.exit(0);
}

const [emulatorHost, emulatorPortRaw] = emulatorAddress.split(':');
const emulatorPort = Number(emulatorPortRaw);
assert.ok(emulatorHost && Number.isInteger(emulatorPort) && emulatorPort > 0);

const PROJECT_ID = 'logisticore-malicious-save-poc';
const UID = 'malicious-save-user';
const FORGED_CASH = 987_654_321;
const FORGED_TRUCK_ID = 'forged-truck-from-client-save';
const backendRequire = createRequire(resolve(process.cwd(), 'backend', 'package.json'));
const { initializeApp, deleteApp } = backendRequire('firebase-admin/app') as {
  initializeApp: (options: { projectId: string }, name: string) => unknown;
  deleteApp: (app: unknown) => Promise<void>;
};
const { getFirestore, Timestamp } = backendRequire('firebase-admin/firestore') as {
  getFirestore: (app: unknown) => any;
  Timestamp: {
    now: () => unknown;
    fromDate: (date: Date) => unknown;
  };
};

const adminApp = initializeApp({ projectId: PROJECT_ID }, 'malicious-save-poc');
const adminFirestore = getFirestore(adminApp);
adminFirestore.settings({ host: emulatorAddress, ssl: false });

function buildSave(cash: number, truckId = FORGED_TRUCK_ID) {
  return {
    ownerUid: UID,
    schemaVersion: 1,
    version: 3,
    saveVersion: 3,
    gameState: {
      version: 3,
      currentTime: 2_000,
      activeDeliveries: [],
      activeTransfers: [],
      activeWarehouseStockTransfers: [],
      financeLedger: [],
      player: {
        companyName: 'Forged Logistics',
        homeCityId: 'izmir',
        money: cash,
        level: 100,
        reputation: 100,
        completedContracts: 50_000,
        failedDeliveries: 0,
        lateDeliveries: 0,
        drivers: [],
        trailers: [],
        warehouses: [],
        trucks: [
          {
            id: truckId,
            catalogId: 'truck-ford-cargo',
            name: 'Client Forged Truck',
            currentCityId: 'izmir',
            condition: 100,
            totalMileageKm: 0,
            currentFuelL: 300,
            fuelTankCapacityL: 300,
            purchasePrice: 52_000,
            ownershipType: 'owned',
            status: 'idle',
            upgrades: { engine: 3, fuelEfficiency: 3, cargo: 3, durability: 3 },
          },
        ],
      },
    },
  };
}

async function main() {
  const rulesEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: emulatorHost,
      port: emulatorPort,
      rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
    },
  });

  try {
    await rulesEnvironment.clearFirestore();
    await adminFirestore.doc(`users/${UID}`).set({
      uid: UID,
      username: 'security_poc_user',
      usernameNormalized: 'security_poc_user',
      usernameSetupCompleted: true,
      usernameChangeCount: 0,
    });

    const client = rulesEnvironment.authenticatedContext(UID).firestore();
    const saveRef = client.doc(`users/${UID}/saves/current`);
    const serverStateRef = client.doc(`users/${UID}/serverState/current`);

    await saveRef.set(buildSave(25_000));
    await saveRef.set(buildSave(FORGED_CASH));
    const maliciousWriteAllowed = true;

    await assertFails(
      serverStateRef.set({
        cash: FORGED_CASH,
        initialized: true,
      }),
    );

    const marketplaceBootstrap = await ensureVehicleMarketplaceStateTransaction(
      adminFirestore,
      { uid: UID, displayName: 'Security PoC' },
      {
        transactionId: 'poc-marketplace-bootstrap',
        idempotencyKey: 'poc-marketplace-bootstrap',
        clientSaveVersion: 3,
      },
    );
    assert.equal(marketplaceBootstrap.ok, true);

    const marketplaceStateSnap = await adminFirestore
      .doc(`users/${UID}/marketplaceState/current`)
      .get();
    const marketplaceState = marketplaceStateSnap.data() ?? {};
    const canonicalCash = Number(marketplaceState.canonicalCash);
    const ownedTruckSnapshots = Array.isArray(marketplaceState.ownedTruckSnapshots)
      ? marketplaceState.ownedTruckSnapshots
      : [];
    const fakeTruckCanonical = ownedTruckSnapshots.some(
      (truck: { truckId?: unknown }) => truck.truckId === FORGED_TRUCK_ID,
    );
    assert.notEqual(canonicalCash, FORGED_CASH);
    assert.equal(canonicalCash, SERVER_DEFAULT_CASH);
    assert.equal(fakeTruckCanonical, false);
    assert.ok(
      ownedTruckSnapshots.some(
        (truck: { truckId?: unknown }) =>
          truck.truckId === SERVER_DEFAULT_STARTER_INSTANCE_ID,
      ),
    );

    const serverStateSnap = await adminFirestore
      .doc(`users/${UID}/serverState/current`)
      .get();
    assert.equal(serverStateSnap.exists, true);
    assert.equal(Number(serverStateSnap.data()?.cash), SERVER_DEFAULT_CASH);

    const leaderboard = await submitLeaderboardScoreTransaction(
      adminFirestore,
      { uid: UID, displayName: 'Security PoC' },
      {
        transactionId: 'poc-leaderboard-submit',
        idempotencyKey: 'poc-leaderboard-submit',
        clientSaveVersion: 3,
      },
    );
    assert.equal(leaderboard.ok, true);
    if (!leaderboard.ok) throw new Error(leaderboard.reason);

    const defaultState = buildDefaultServerState(UID, Timestamp.now());
    const extractedDefault = extractCanonicalPlayerStateFromServerState(defaultState);
    assert.equal(extractedDefault.ok, true);
    const expectedScore = calculateLeaderboardScore(
      extractedDefault.player,
      extractedDefault.gameState,
    ).totalScore;
    assert.equal(leaderboard.score, expectedScore);
    assert.ok(leaderboard.score < 1_000_000);

    await saveRef.set(buildSave(FORGED_CASH * 2, 'second-forged-truck'));
    const leaderboardAfterForgedSave = await submitLeaderboardScoreTransaction(
      adminFirestore,
      { uid: UID, displayName: 'Security PoC' },
      {
        transactionId: 'poc-leaderboard-resubmit',
        idempotencyKey: 'poc-leaderboard-resubmit',
        clientSaveVersion: 99,
      },
    );
    assert.equal(leaderboardAfterForgedSave.ok, true);
    if (!leaderboardAfterForgedSave.ok) throw new Error(leaderboardAfterForgedSave.reason);
    assert.equal(leaderboardAfterForgedSave.score, expectedScore);

    const migrationDryRun = await migrateLegacyServerStateTransaction(
      adminFirestore,
      UID,
      true,
    );
    assert.equal(migrationDryRun.ok, true);
    if (!migrationDryRun.ok) throw new Error(migrationDryRun.reason);
    assert.ok(migrationDryRun.report?.flags.includes('preserved-marketplace-canonical'));
    assert.equal(migrationDryRun.report?.cashAfter, SERVER_DEFAULT_CASH);

    const result = {
      status: 'MITIGATED',
      maliciousClientSaveWriteAllowed: maliciousWriteAllowed,
      serverStateDirectClientWriteDenied: true,
      rulesBlockedMaliciousGameplayFields: false,
      marketplaceBootstrapAccepted: marketplaceBootstrap.ok,
      maliciousCashBecameCanonical: canonicalCash === FORGED_CASH,
      fakeTruckBecameCanonical: fakeTruckCanonical,
      leaderboardAcceptedClientSave: leaderboard.ok,
      forgedLeaderboardScoreIgnored: leaderboard.score < 1_000_000,
      leaderboardScore: leaderboard.score,
      canonicalMarketplaceCash: canonicalCash,
      scope:
        'Cloud save remains client-writable backup only; marketplace and leaderboard use serverState.',
    };
    console.log('[security-malicious-save-trust-test]');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await rulesEnvironment.cleanup();
    await deleteApp(adminApp);
  }
}

void main().catch((error) => {
  console.error('[security-malicious-save-trust-test] FAILED', error);
  process.exitCode = 1;
});
