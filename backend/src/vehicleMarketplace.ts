import { createHash } from 'node:crypto';

import {
  FieldPath,
  FieldValue,
  Timestamp,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';

import { calculateCanonicalTruckResaleValue } from '../../src/domain/truckResaleValuation';
import {
  CANONICAL_TRUCK_MARKET_CATALOG,
  FLEET_MANAGEMENT_BALANCE,
  VEHICLE_MARKETPLACE_BALANCE,
} from './generated/canonicalInputs';
import type {
  CancelVehicleListingInput,
  CreateVehicleListingInput,
  EnsureVehicleMarketplaceStateInput,
  MarketplaceActionIdentity,
  MarketplaceActionResult,
  MarketplaceFailureReason,
  MarketplaceListingDocument,
  MarketplacePlayerState,
  MarketplaceTruckSnapshot,
  MarketplaceVehicleRecord,
  PurchaseVehicleListingInput,
} from './vehicleMarketplaceTypes';
import {
  ensureServerStateInTransaction,
  mirrorServerStateFromMarketplace,
  serverStateRef,
} from './serverState';
import type { ServerStateDocument } from './serverStateTypes';
import {
  buildMarketplaceStateFromServerState,
  validateMarketplaceState,
} from './vehicleMarketplaceState';
import {
  DEFAULT_OUTER_TRANSACTION_ATTEMPTS,
  runFirestoreTransactionWithRetry,
} from './firestoreTransactionUtils';
import {
  reconcileAuthoritativeFleetInTransaction,
} from './authoritativeFleetReconciliation';

const ACTIVE_JOB_STATUSES = new Set([
  'on_route',
  'transferring',
  'out_of_fuel',
]);

function failure<T extends Record<string, unknown>>(
  input: { transactionId: string; idempotencyKey: string },
  reason: MarketplaceFailureReason,
): MarketplaceActionResult<T> {
  return {
    ok: false,
    reason,
    transactionId: input.transactionId,
    idempotencyKey: input.idempotencyKey,
  };
}

function actionKey(uid: string, key: string): string {
  return createHash('sha256').update(`${uid}:${key}`).digest('hex');
}

function stateRef(firestore: Firestore, uid: string) {
  return firestore.doc(`users/${uid}/marketplaceState/current`);
}

function idempotencyRef(firestore: Firestore, uid: string, key: string) {
  return firestore.doc(
    `vehicleMarketplaceIdempotency/${actionKey(uid, key)}`,
  );
}

function actionReceiptRef(
  firestore: Firestore,
  uid: string,
  transactionId: string,
) {
  return firestore.doc(
    `vehicleMarketplaceActionReceipts/${actionKey(uid, transactionId)}`,
  );
}

/** Exactly-one-winner claim for concurrent purchase contention. */
function listingPurchaseLockRef(firestore: Firestore, listingId: string) {
  return firestore.doc(`vehicleMarketplaceListingLocks/${listingId}`);
}

type PurchaseActionData = {
  listingId: string;
  grossPrice: number;
  marketplaceFee: number;
  sellerNet: number;
  buyerCashBefore: number;
  buyerCashAfter: number;
};

function buildPurchaseSuccessResult(
  input: PurchaseVehicleListingInput,
  listing: MarketplaceListingDocument,
  cash?: { buyerCashBefore: number; buyerCashAfter: number },
): MarketplaceActionResult<PurchaseActionData> {
  const marketplaceFee = normalizeMoney(
    listing.askingPrice * listing.marketplaceFeeRate,
  );
  const sellerNet = normalizeMoney(listing.askingPrice - marketplaceFee);
  return {
    ok: true,
    transactionId: input.transactionId,
    idempotencyKey: input.idempotencyKey,
    data: {
      listingId: listing.id,
      grossPrice: listing.askingPrice,
      marketplaceFee,
      sellerNet,
      buyerCashBefore: cash?.buyerCashBefore ?? 0,
      buyerCashAfter: cash?.buyerCashAfter ?? 0,
    },
  };
}

interface PurchaseWriteContext {
  listing: MarketplaceListingDocument;
  buyer: MarketplacePlayerState;
  seller: MarketplacePlayerState;
  sellerVehicle: MarketplaceVehicleRecord;
  buyerServer: ServerStateDocument | null;
  sellerServer: ServerStateDocument | null;
  listingLockExists: boolean;
}

async function readPurchaseTransactionContext(
  transaction: Transaction,
  firestore: Firestore,
  identity: MarketplaceActionIdentity,
  input: PurchaseVehicleListingInput,
  nowMs: number,
): Promise<
  | { kind: 'return'; result: MarketplaceActionResult<PurchaseActionData> }
  | { kind: 'continue'; ctx: PurchaseWriteContext }
> {
  const replay = await readIdempotent<PurchaseActionData>(
    transaction,
    firestore,
    identity.uid,
    input,
  );
  if (replay) {
    return { kind: 'return', result: replay };
  }
  if (await hasTransactionReceipt(transaction, firestore, identity.uid, input)) {
    return { kind: 'return', result: failure(input, 'already-completed') };
  }

  const listingRef = firestore.doc(
    `vehicleMarketplaceListings/${input.listingId}`,
  );
  const saleTransactionRef = firestore.doc(
    `vehicleMarketplaceTransactions/${input.transactionId}`,
  );
  const listingLockRef = listingPurchaseLockRef(firestore, input.listingId);

  const listingLockSnapshot = await transaction.get(listingLockRef);
  const listingSnapshot = await transaction.get(listingRef);
  const saleTransactionSnapshot = await transaction.get(saleTransactionRef);

  if (saleTransactionSnapshot.exists) {
    return { kind: 'return', result: failure(input, 'already-completed') };
  }
  if (!listingSnapshot.exists) {
    return { kind: 'return', result: failure(input, 'listing-not-found') };
  }

  const listing = listingSnapshot.data() as MarketplaceListingDocument;
  if (listingLockSnapshot.exists) {
    const lock = listingLockSnapshot.data() as {
      buyerUid?: string;
      transactionId?: string;
    };
    if (
      lock.buyerUid !== identity.uid ||
      lock.transactionId !== input.transactionId
    ) {
      return { kind: 'return', result: failure(input, 'listing-not-active') };
    }
    if (
      listing.status === 'sold' &&
      listing.buyerUid === identity.uid &&
      listing.transactionId === input.transactionId
    ) {
      return {
        kind: 'return',
        result: buildPurchaseSuccessResult(input, listing),
      };
    }
  }

  if (listing.sellerUid === identity.uid) {
    return { kind: 'return', result: failure(input, 'self-purchase') };
  }
  if (listing.status === 'sold') {
    if (listing.buyerUid === identity.uid) {
      return {
        kind: 'return',
        result: buildPurchaseSuccessResult(input, listing),
      };
    }
    return { kind: 'return', result: failure(input, 'listing-sold') };
  }
  if (listing.status !== 'active') {
    return { kind: 'return', result: failure(input, 'listing-not-active') };
  }
  if (listing.expiresAt.toMillis() <= nowMs) {
    return { kind: 'return', result: failure(input, 'listing-not-active') };
  }
  if (listing.version !== input.listingVersion) {
    return { kind: 'return', result: failure(input, 'stale-listing-version') };
  }
  if (listing.askingPrice !== input.quotedPrice) {
    return { kind: 'return', result: failure(input, 'invalid-price') };
  }

  const sellerRef = stateRef(firestore, listing.sellerUid);
  const buyerRef = stateRef(firestore, identity.uid);
  const buyerSnapshot = await transaction.get(buyerRef);
  const sellerSnapshot = await transaction.get(sellerRef);
  const buyerServerSnapshot = await transaction.get(
    serverStateRef(firestore, identity.uid),
  );
  const sellerServerSnapshot = await transaction.get(
    serverStateRef(firestore, listing.sellerUid),
  );

  if (!buyerSnapshot.exists || !sellerSnapshot.exists) {
    return { kind: 'return', result: failure(input, 'save-conflict') };
  }

  const buyer = buyerSnapshot.data() as MarketplacePlayerState;
  const seller = sellerSnapshot.data() as MarketplacePlayerState;
  if (
    input.clientSaveVersion != null &&
    input.clientSaveVersion < buyer.sourceSaveVersion
  ) {
    return { kind: 'return', result: failure(input, 'save-conflict') };
  }
  if (buyer.syncConflict || seller.syncConflict) {
    return { kind: 'return', result: failure(input, 'save-conflict') };
  }
  if (buyer.canonicalCash < listing.askingPrice) {
    return { kind: 'return', result: failure(input, 'insufficient-funds') };
  }
  if (buyer.ownedTruckSnapshots.length >= buyer.fleetLimit) {
    return { kind: 'return', result: failure(input, 'fleet-limit') };
  }

  const sellerVehicle = seller.ownedTruckSnapshots.find(
    (item) => item.truckId === listing.truckSnapshot.truckId,
  );
  if (
    !sellerVehicle ||
    sellerVehicle.status !== 'marketplace_locked' ||
    sellerVehicle.marketplaceListingId !== listing.id
  ) {
    return { kind: 'return', result: failure(input, 'not-owner') };
  }

  return {
    kind: 'continue',
    ctx: {
      listing,
      buyer,
      seller,
      sellerVehicle,
      buyerServer: buyerServerSnapshot.exists
        ? (buyerServerSnapshot.data() as ServerStateDocument)
        : null,
      sellerServer: sellerServerSnapshot.exists
        ? (sellerServerSnapshot.data() as ServerStateDocument)
        : null,
      listingLockExists: listingLockSnapshot.exists,
    },
  };
}

function writePurchaseTransactionOutcome(
  transaction: Transaction,
  firestore: Firestore,
  identity: MarketplaceActionIdentity,
  input: PurchaseVehicleListingInput,
  ctx: PurchaseWriteContext,
  nowMs: number,
): MarketplaceActionResult<PurchaseActionData> {
  const { listing, buyer, seller, sellerVehicle } = ctx;
  const listingRef = firestore.doc(
    `vehicleMarketplaceListings/${input.listingId}`,
  );
  const saleTransactionRef = firestore.doc(
    `vehicleMarketplaceTransactions/${input.transactionId}`,
  );
  const buyerRef = stateRef(firestore, identity.uid);
  const sellerRef = stateRef(firestore, listing.sellerUid);
  const listingLockRef = listingPurchaseLockRef(firestore, listing.id);
  const now = Timestamp.fromMillis(nowMs);
  const marketplaceFee = normalizeMoney(
    listing.askingPrice * listing.marketplaceFeeRate,
  );
  const sellerNet = normalizeMoney(listing.askingPrice - marketplaceFee);
  const buyerVehicle: MarketplaceVehicleRecord = {
    ...sellerVehicle,
    ...listing.truckSnapshot,
    ownershipType: 'owned',
    status: 'idle',
    assignedDriverId: null,
    attachedTrailerId: null,
    activeJobIds: [],
    marketplaceListingId: null,
    acquiredAt: nowMs,
  };
  const transactionData = {
    id: input.transactionId,
    listingId: listing.id,
    sellerUid: listing.sellerUid,
    buyerUid: identity.uid,
    vehicleType: 'truck',
    truckSnapshot: listing.truckSnapshot,
    grossPrice: listing.askingPrice,
    marketplaceFee,
    sellerNet,
    createdAt: now,
    version: 1,
  };
  const buyerCashBefore = normalizeMoney(buyer.canonicalCash);
  const buyerCashAfter = normalizeMoney(buyer.canonicalCash - listing.askingPrice);
  const result = buildPurchaseSuccessResult(input, listing, {
    buyerCashBefore,
    buyerCashAfter,
  });

  if (!ctx.listingLockExists) {
    transaction.create(listingLockRef, {
      listingId: listing.id,
      buyerUid: identity.uid,
      transactionId: input.transactionId,
      createdAt: now,
    });
  }
  transaction.update(buyerRef, {
    canonicalCash: normalizeMoney(buyer.canonicalCash - listing.askingPrice),
    ownedTruckSnapshots: [...buyer.ownedTruckSnapshots, buyerVehicle],
    stateVersion: buyer.stateVersion + 1,
    updatedAt: now,
  });
  transaction.update(sellerRef, {
    canonicalCash: normalizeMoney(seller.canonicalCash + sellerNet),
    ownedTruckSnapshots: seller.ownedTruckSnapshots.filter(
      (item) => item.truckId !== sellerVehicle.truckId,
    ),
    activeListingIds: FieldValue.arrayRemove(listing.id),
    soldTruckTombstones: FieldValue.arrayUnion(sellerVehicle.truckId),
    stateVersion: seller.stateVersion + 1,
    updatedAt: now,
  });
  syncServerStateMirror(
    transaction,
    firestore,
    identity.uid,
    {
      ...buyer,
      canonicalCash: normalizeMoney(buyer.canonicalCash - listing.askingPrice),
      ownedTruckSnapshots: [...buyer.ownedTruckSnapshots, buyerVehicle],
      stateVersion: buyer.stateVersion + 1,
      updatedAt: now,
    },
    ctx.buyerServer,
    now,
  );
  syncServerStateMirror(
    transaction,
    firestore,
    listing.sellerUid,
    {
      ...seller,
      canonicalCash: normalizeMoney(seller.canonicalCash + sellerNet),
      ownedTruckSnapshots: seller.ownedTruckSnapshots.filter(
        (item) => item.truckId !== sellerVehicle.truckId,
      ),
      activeListingIds: seller.activeListingIds.filter((id) => id !== listing.id),
      soldTruckTombstones: [...seller.soldTruckTombstones, sellerVehicle.truckId],
      stateVersion: seller.stateVersion + 1,
      updatedAt: now,
    },
    ctx.sellerServer,
    now,
  );
  transaction.update(listingRef, {
    status: 'sold',
    soldAt: now,
    updatedAt: now,
    buyerUid: identity.uid,
    transactionId: input.transactionId,
    version: listing.version + 1,
  });
  transaction.create(saleTransactionRef, transactionData);
  for (const uid of [identity.uid, listing.sellerUid]) {
    transaction.create(
      firestore.doc(`users/${uid}/marketplaceHistory/${input.transactionId}`),
      transactionData,
    );
  }
  transaction.create(
    firestore.doc(`users/${identity.uid}/marketplaceLedger/${input.transactionId}`),
    {
      type: 'expense',
      category: 'vehicle_purchase',
      amount: listing.askingPrice,
      transactionId: input.transactionId,
      referenceId: listing.id,
      createdAt: now,
    },
  );
  transaction.create(
    firestore.doc(
      `users/${listing.sellerUid}/marketplaceLedger/${input.transactionId}`,
    ),
    {
      type: 'income',
      category: 'vehicle_sale',
      amount: sellerNet,
      grossAmount: listing.askingPrice,
      marketplaceFee,
      transactionId: input.transactionId,
      referenceId: listing.id,
      createdAt: now,
    },
  );
  saveIdempotent(transaction, firestore, identity.uid, input, result, now);
  return result;
}

function normalizeMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

async function bootstrapMarketplaceStateInTransaction(
  transaction: Transaction,
  firestore: Firestore,
  uid: string,
  nowMs: number,
  options?: { requestedVehicleId?: string },
): Promise<
  | {
      ok: true;
      state: MarketplacePlayerState;
      wasCreated: boolean;
      statePersisted: boolean;
      serverState: ServerStateDocument;
    }
  | { ok: false; reason: MarketplaceFailureReason }
> {
  const playerRef = stateRef(firestore, uid);
  const stateSnapshot = await transaction.get(playerRef);
  const existing = stateSnapshot.exists
    ? (stateSnapshot.data() as MarketplacePlayerState)
    : null;

  if (existing) {
    const stateReason = validateMarketplaceState(uid, existing);
    if (stateReason) return { ok: false, reason: stateReason };
  }

  const now = Timestamp.fromMillis(nowMs);
  const reconciled = await reconcileAuthoritativeFleetInTransaction(
    transaction,
    firestore,
    uid,
    nowMs,
    {
      existing,
      requestedVehicleId: options?.requestedVehicleId,
      write: false,
    },
  );
  if (reconciled.ok) {
    const shouldPersist = reconciled.reconciled || !existing;
    if (shouldPersist) {
      if (existing) {
        transaction.set(playerRef, reconciled.state, { merge: true });
      } else {
        transaction.create(playerRef, reconciled.state);
      }
      syncServerStateMirror(
        transaction,
        firestore,
        uid,
        reconciled.state,
        reconciled.serverState,
        now,
      );
    }
    return {
      ok: true,
      state: reconciled.state,
      wasCreated: !existing && shouldPersist,
      statePersisted: shouldPersist,
      serverState: reconciled.serverState,
    };
  }

  const serverRef = serverStateRef(firestore, uid);
  const serverSnapshot = await transaction.get(serverRef);

  if (existing) {
    if (serverSnapshot.exists) {
      return {
        ok: true,
        state: existing,
        wasCreated: false,
        statePersisted: false,
        serverState: serverSnapshot.data() as ServerStateDocument,
      };
    }
    const ensured = await ensureServerStateInTransaction(
      transaction,
      firestore,
      uid,
      nowMs,
    );
    if (!ensured.ok) return { ok: false, reason: 'marketplace-state-missing' };
    return {
      ok: true,
      state: existing,
      wasCreated: false,
      statePersisted: false,
      serverState: ensured.state,
    };
  }

  const ensured = await ensureServerStateInTransaction(
    transaction,
    firestore,
    uid,
    nowMs,
  );
  if (!ensured.ok) return { ok: false, reason: 'marketplace-state-missing' };
  const built = buildMarketplaceStateFromServerState(
    uid,
    ensured.state,
    now,
  );
  if (!built.ok) return { ok: false, reason: built.reason };
  return {
    ok: true,
    state: built.state,
    wasCreated: true,
    statePersisted: false,
    serverState: ensured.state,
  };
}

function syncServerStateMirror(
  transaction: Transaction,
  firestore: Firestore,
  uid: string,
  marketplaceState: MarketplacePlayerState,
  existing: ServerStateDocument | null,
  now: Timestamp,
) {
  const patch = mirrorServerStateFromMarketplace(
    marketplaceState,
    existing,
    now,
  );
  transaction.set(serverStateRef(firestore, uid), patch, { merge: true });
}

function findCatalogTruck(templateId: string) {
  return CANONICAL_TRUCK_MARKET_CATALOG.find(
    (item) => item.templateId === templateId,
  );
}

function upgradeInvestment(vehicle: MarketplaceVehicleRecord): number {
  const multipliers = {
    engine: 0.08,
    fuelEfficiency: 0.07,
    cargo: 0.09,
    durability: 0.06,
  } as const;
  let total = 0;
  for (const key of Object.keys(multipliers) as Array<
    keyof typeof multipliers
  >) {
    const level = Math.min(3, Math.max(0, Number(vehicle.upgrades?.[key]) || 0));
    for (let tier = 0; tier < level; tier += 1) {
      total += vehicle.purchasePrice * multipliers[key] * (1 + tier * 0.75);
    }
  }
  return Math.round(total);
}

export function calculateMarketplaceRecommendedPrice(
  vehicle: MarketplaceVehicleRecord,
): number {
  return calculateCanonicalTruckResaleValue(
    {
      basePrice: vehicle.purchasePrice,
      condition: vehicle.condition,
      mileageKm: vehicle.totalMileageKm,
      upgradeValue: upgradeInvestment(vehicle),
      isLeased: vehicle.ownershipType === 'leased',
    },
    FLEET_MANAGEMENT_BALANCE,
  );
}

function transferableSnapshot(
  vehicle: MarketplaceVehicleRecord,
): MarketplaceTruckSnapshot {
  return {
    truckId: vehicle.truckId,
    templateId: vehicle.templateId,
    ...(vehicle.customName ? { customName: vehicle.customName } : {}),
    currentCityId: vehicle.currentCityId,
    condition: vehicle.condition,
    totalMileageKm: vehicle.totalMileageKm,
    currentFuelL: Math.min(
      vehicle.fuelTankCapacityL,
      Math.max(0, vehicle.currentFuelL),
    ),
    fuelTankCapacityL: vehicle.fuelTankCapacityL,
    ...(vehicle.upgrades ? { upgrades: vehicle.upgrades } : {}),
    ...(vehicle.acquiredAt != null ? { acquiredAt: vehicle.acquiredAt } : {}),
    ...(vehicle.visualCustomization
      ? { visualCustomization: vehicle.visualCustomization }
      : {}),
  };
}

function listingEligibility(
  state: MarketplacePlayerState,
  vehicle: MarketplaceVehicleRecord | undefined,
  input: CreateVehicleListingInput,
): MarketplaceFailureReason | null {
  if (state.syncConflict) return 'save-conflict';
  if (
    input.clientSaveVersion != null &&
    input.clientSaveVersion < state.sourceSaveVersion
  ) {
    return 'save-conflict';
  }
  if (!vehicle) return 'truck-not-found';
  if (!findCatalogTruck(vehicle.templateId)) return 'unsupported-truck';
  if (vehicle.ownershipType === 'leased') return 'leased-truck';
  if (vehicle.marketplaceListingId || vehicle.status === 'marketplace_locked') {
    return 'already-listed';
  }
  if (vehicle.assignedDriverId) return 'driver-attached';
  if (vehicle.attachedTrailerId) return 'trailer-attached';
  if ((vehicle.activeJobIds?.length ?? 0) > 0) return 'active-job';
  if (ACTIVE_JOB_STATUSES.has(vehicle.status)) return 'truck-busy';
  if (
    state.ownedTruckSnapshots.filter(
      (item) => item.ownershipType === 'owned',
    ).length <= 1
  ) {
    return 'starter-protection';
  }
  const recommendedPrice = calculateMarketplaceRecommendedPrice(vehicle);
  const minimum = Math.ceil(
    recommendedPrice *
      VEHICLE_MARKETPLACE_BALANCE.vehicleMarketplaceMinPriceRatio,
  );
  const maximum = Math.floor(
    recommendedPrice *
      VEHICLE_MARKETPLACE_BALANCE.vehicleMarketplaceMaxPriceRatio,
  );
  if (
    !Number.isFinite(input.askingPrice) ||
    input.askingPrice < minimum ||
    input.askingPrice > maximum
  ) {
    return 'invalid-price';
  }
  return null;
}

async function readIdempotent<T extends Record<string, unknown>>(
  transaction: Transaction,
  firestore: Firestore,
  uid: string,
  input: { idempotencyKey: string },
): Promise<MarketplaceActionResult<T> | null> {
  const snapshot = await transaction.get(
    idempotencyRef(firestore, uid, input.idempotencyKey),
  );
  return snapshot.exists
    ? (snapshot.data()?.result as MarketplaceActionResult<T>)
    : null;
}

async function hasTransactionReceipt(
  transaction: Transaction,
  firestore: Firestore,
  uid: string,
  input: { transactionId: string },
): Promise<boolean> {
  return (
    await transaction.get(
      actionReceiptRef(firestore, uid, input.transactionId),
    )
  ).exists;
}

function saveIdempotent<T extends Record<string, unknown>>(
  transaction: Transaction,
  firestore: Firestore,
  uid: string,
  input: { idempotencyKey: string },
  result: MarketplaceActionResult<T>,
  now: Timestamp,
): void {
  const expiresAt = Timestamp.fromMillis(
    now.toMillis() +
      VEHICLE_MARKETPLACE_BALANCE.vehicleMarketplaceIdempotencyRetentionDays *
        24 *
        60 *
        60 *
        1000,
  );
  transaction.create(idempotencyRef(firestore, uid, input.idempotencyKey), {
    uid,
    createdAt: now,
    expiresAt,
    result,
  });
  transaction.create(
    actionReceiptRef(firestore, uid, result.transactionId),
    {
      uid,
      transactionId: result.transactionId,
      createdAt: now,
      expiresAt,
    },
  );
}

export async function createVehicleListingTransaction(
  firestore: Firestore,
  identity: MarketplaceActionIdentity,
  input: CreateVehicleListingInput,
  nowMs = Date.now(),
): Promise<MarketplaceActionResult<{ listingId: string; recommendedPrice: number }>> {
  const listingId = actionKey(identity.uid, input.transactionId).slice(0, 32);
  const listingRef = firestore.doc(`vehicleMarketplaceListings/${listingId}`);
  let transactionAttempts = 0;
  const result: MarketplaceActionResult<{
    listingId: string;
    recommendedPrice: number;
  }> = await firestore.runTransaction(async (transaction) => {
    transactionAttempts += 1;
    const replay = await readIdempotent<{
      listingId: string;
      recommendedPrice: number;
    }>(transaction, firestore, identity.uid, input);
    if (replay) return replay;
    if (await hasTransactionReceipt(transaction, firestore, identity.uid, input)) {
      return failure(input, 'already-completed');
    }
    const playerRef = stateRef(firestore, identity.uid);
    const userProfileSnap = await transaction.get(
      firestore.doc(`users/${identity.uid}`),
    );
    const bootstrap = await bootstrapMarketplaceStateInTransaction(
      transaction,
      firestore,
      identity.uid,
      nowMs,
      { requestedVehicleId: input.truckId },
    );
    if (!bootstrap.ok) return failure(input, bootstrap.reason);
    let state = bootstrap.state;
    const stateWasCreated = bootstrap.wasCreated;
    const statePersisted = bootstrap.statePersisted;
    let serverState = bootstrap.serverState;
    const usernameRaw = userProfileSnap.data()?.username;
    const sellerUsername =
      typeof usernameRaw === 'string' ? usernameRaw.trim().slice(0, 20) : '';
    if (!sellerUsername || userProfileSnap.data()?.usernameSetupCompleted !== true) {
      return failure(input, 'username-required');
    }
    const availableVehicleIds = state.ownedTruckSnapshots.map((item) => item.truckId);
    let vehicle = state.ownedTruckSnapshots.find(
      (item) => item.truckId === input.truckId,
    );
    let match = Boolean(vehicle);
    console.info('[MARKETPLACE_CREATE]', {
      uidHash: createHash('sha256').update(identity.uid).digest('hex').slice(0, 12),
      requestedVehicleId: input.truckId,
      authoritativeVehicleIds: availableVehicleIds,
      vehicleFound: match,
      ownerMatch: state.ownerUid === identity.uid,
      rental: vehicle?.ownershipType === 'leased',
      alreadyListed: Boolean(vehicle?.marketplaceListingId),
      wasCreated: stateWasCreated,
      sourceSaveVersion: state.sourceSaveVersion,
      clientSaveVersion: input.clientSaveVersion ?? null,
      serverOwnedTruckIds: serverState.ownedTruckIds,
    });
    if (!vehicle) {
      return failure(input, 'truck-not-found');
    }
    const reason = listingEligibility(state, vehicle, input);
    if (reason || !vehicle) return failure(input, reason ?? 'truck-not-found');
    const listingFee =
      VEHICLE_MARKETPLACE_BALANCE.vehicleMarketplaceListingFee;
    if (state.canonicalCash < listingFee) {
      return failure(input, 'insufficient-funds');
    }

    const now = Timestamp.fromMillis(nowMs);
    const recommendedPrice = calculateMarketplaceRecommendedPrice(vehicle);
    const lockedVehicle: MarketplaceVehicleRecord = {
      ...vehicle,
      status: 'marketplace_locked',
      marketplaceListingId: listingId,
    };
    const listing: MarketplaceListingDocument = {
      id: listingId,
      sellerUid: identity.uid,
      sellerDisplayName: sellerUsername,
      vehicleType: 'truck',
      truckSnapshot: transferableSnapshot(vehicle),
      askingPrice: Math.round(input.askingPrice),
      recommendedPrice,
      marketplaceFeeRate:
        VEHICLE_MARKETPLACE_BALANCE.vehicleMarketplaceSaleFeeRate,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      expiresAt: Timestamp.fromMillis(
        nowMs +
          VEHICLE_MARKETPLACE_BALANCE.vehicleMarketplaceListingDurationHours *
            60 *
            60 *
            1000,
      ),
      version: 1,
    };
    const result: MarketplaceActionResult<{
      listingId: string;
      recommendedPrice: number;
    }> = {
      ok: true,
      transactionId: input.transactionId,
      idempotencyKey: input.idempotencyKey,
      data: { listingId, recommendedPrice },
    };
    transaction.create(listingRef, listing);
    const updatedPlayerState = {
      canonicalCash: normalizeMoney(state.canonicalCash - listingFee),
      ownedTruckSnapshots: state.ownedTruckSnapshots.map((item) =>
        item.truckId === vehicle.truckId ? lockedVehicle : item,
      ),
      activeListingIds: stateWasCreated && !statePersisted
        ? [listingId]
        : [...state.activeListingIds, listingId],
      stateVersion: state.stateVersion + 1,
      updatedAt: now,
    };
    const nextMarketplaceState: MarketplacePlayerState = {
      ...state,
      ...updatedPlayerState,
      activeListingIds: stateWasCreated && !statePersisted
        ? [listingId]
        : [...state.activeListingIds, listingId],
    };
    if (stateWasCreated && !statePersisted) {
      transaction.create(playerRef, {
        ...state,
        ...updatedPlayerState,
      });
    } else {
      transaction.update(playerRef, updatedPlayerState);
    }
    syncServerStateMirror(
      transaction,
      firestore,
      identity.uid,
      nextMarketplaceState,
      serverState,
      now,
    );
    transaction.create(
      firestore.doc(`users/${identity.uid}/marketplaceLedger/${input.transactionId}`),
      {
        type: 'expense',
        category: 'vehicle_marketplace_listing_fee',
        amount: listingFee,
        transactionId: input.transactionId,
        referenceId: listingId,
        createdAt: now,
      },
    );
    saveIdempotent(transaction, firestore, identity.uid, input, result, now);
    return result;
  });
  return { ...result, retryCount: Math.max(0, transactionAttempts - 1) };
}

export async function ensureVehicleMarketplaceStateTransaction(
  firestore: Firestore,
  identity: MarketplaceActionIdentity,
  input: EnsureVehicleMarketplaceStateInput,
  nowMs = Date.now(),
): Promise<MarketplaceActionResult<{
  created: boolean;
  marketplaceStateVersion: number;
  sourceSaveVersion: number;
  hasMarketplaceState: true;
}>> {
  return firestore.runTransaction(async (transaction) => {
    const playerRef = stateRef(firestore, identity.uid);
    const bootstrap = await bootstrapMarketplaceStateInTransaction(
      transaction,
      firestore,
      identity.uid,
      nowMs,
    );
    if (!bootstrap.ok) return failure(input, bootstrap.reason);
    const state = bootstrap.state;
    if (
      input.clientSaveVersion != null &&
      input.clientSaveVersion < state.sourceSaveVersion
    ) {
      return failure(input, 'save-conflict');
    }
    if (bootstrap.wasCreated && !bootstrap.statePersisted) {
      transaction.create(playerRef, state);
      syncServerStateMirror(
        transaction,
        firestore,
        identity.uid,
        state,
        bootstrap.serverState,
        Timestamp.fromMillis(nowMs),
      );
    }
    return {
      ok: true,
      transactionId: input.transactionId,
      idempotencyKey: input.idempotencyKey,
      data: {
        created: bootstrap.wasCreated,
        marketplaceStateVersion: state.stateVersion,
        sourceSaveVersion: state.sourceSaveVersion,
        hasMarketplaceState: true,
      },
    };
  });
}

export async function cancelVehicleListingTransaction(
  firestore: Firestore,
  identity: MarketplaceActionIdentity,
  input: CancelVehicleListingInput,
  nowMs = Date.now(),
): Promise<MarketplaceActionResult<{ listingId: string }>> {
  let transactionAttempts = 0;
  const result: MarketplaceActionResult<{
    listingId: string;
  }> = await firestore.runTransaction(async (transaction) => {
    transactionAttempts += 1;
    const replay = await readIdempotent<{ listingId: string }>(
      transaction,
      firestore,
      identity.uid,
      input,
    );
    if (replay) return replay;
    if (await hasTransactionReceipt(transaction, firestore, identity.uid, input)) {
      return failure(input, 'already-completed');
    }
    const listingRef = firestore.doc(
      `vehicleMarketplaceListings/${input.listingId}`,
    );
    const playerRef = stateRef(firestore, identity.uid);
    const [listingSnapshot, stateSnapshot, serverSnapshot] = await Promise.all([
      transaction.get(listingRef),
      transaction.get(playerRef),
      transaction.get(serverStateRef(firestore, identity.uid)),
    ]);
    if (!listingSnapshot.exists) return failure(input, 'listing-not-found');
    const listing = listingSnapshot.data() as MarketplaceListingDocument;
    if (listing.sellerUid !== identity.uid) return failure(input, 'not-owner');
    if (listing.status !== 'active') return failure(input, 'listing-not-active');
    if (listing.version !== input.listingVersion) {
      return failure(input, 'stale-listing-version');
    }
    if (!stateSnapshot.exists) return failure(input, 'truck-not-found');
    const state = stateSnapshot.data() as MarketplacePlayerState;
    const vehicle = state.ownedTruckSnapshots.find(
      (item) => item.truckId === listing.truckSnapshot.truckId,
    );
    if (
      !vehicle ||
      vehicle.marketplaceListingId !== listing.id ||
      vehicle.status !== 'marketplace_locked'
    ) {
      return failure(input, 'save-conflict');
    }
    const now = Timestamp.fromMillis(nowMs);
    const result: MarketplaceActionResult<{ listingId: string }> = {
      ok: true,
      transactionId: input.transactionId,
      idempotencyKey: input.idempotencyKey,
      data: { listingId: listing.id },
    };
    transaction.update(listingRef, {
      status: 'cancelled',
      version: listing.version + 1,
      updatedAt: now,
    });
    transaction.update(playerRef, {
      ownedTruckSnapshots: state.ownedTruckSnapshots.map((item) =>
        item.truckId === vehicle.truckId
          ? { ...item, status: 'idle', marketplaceListingId: null }
          : item,
      ),
      activeListingIds: FieldValue.arrayRemove(listing.id),
      stateVersion: state.stateVersion + 1,
      updatedAt: now,
    });
    syncServerStateMirror(
      transaction,
      firestore,
      identity.uid,
      {
        ...state,
        ownedTruckSnapshots: state.ownedTruckSnapshots.map((item) =>
          item.truckId === vehicle.truckId
            ? { ...item, status: 'idle', marketplaceListingId: null }
            : item,
        ),
        activeListingIds: state.activeListingIds.filter((id) => id !== listing.id),
        stateVersion: state.stateVersion + 1,
        updatedAt: now,
      },
      serverSnapshot.exists
        ? (serverSnapshot.data() as ServerStateDocument)
        : null,
      now,
    );
    saveIdempotent(transaction, firestore, identity.uid, input, result, now);
    return result;
  });
  return { ...result, retryCount: Math.max(0, transactionAttempts - 1) };
}

export async function purchaseVehicleListingTransaction(
  firestore: Firestore,
  identity: MarketplaceActionIdentity,
  input: PurchaseVehicleListingInput,
  nowMs = Date.now(),
): Promise<MarketplaceActionResult<PurchaseActionData>> {
  const { result, outerRetryCount } = await runFirestoreTransactionWithRetry(
    firestore,
    async (transaction): Promise<MarketplaceActionResult<PurchaseActionData>> => {
      const readPhase = await readPurchaseTransactionContext(
        transaction,
        firestore,
        identity,
        input,
        nowMs,
      );
      if (readPhase.kind === 'return') {
        return readPhase.result;
      }
      return writePurchaseTransactionOutcome(
        transaction,
        firestore,
        identity,
        input,
        readPhase.ctx,
        nowMs,
      );
    },
    { maxAttempts: DEFAULT_OUTER_TRANSACTION_ATTEMPTS },
  );
  return { ...result, retryCount: outerRetryCount };
}

export async function expireVehicleMarketplaceListings(
  firestore: Firestore,
  nowMs = Date.now(),
): Promise<number> {
  const now = Timestamp.fromMillis(nowMs);
  const expired = await firestore
    .collection('vehicleMarketplaceListings')
    .where('status', '==', 'active')
    .where('expiresAt', '<=', now)
    .limit(100)
    .get();
  let count = 0;
  for (const listingSnapshot of expired.docs) {
    await firestore.runTransaction(async (transaction) => {
      const fresh = await transaction.get(listingSnapshot.ref);
      if (!fresh.exists) return;
      const listing = fresh.data() as MarketplaceListingDocument;
      if (listing.status !== 'active' || listing.expiresAt.toMillis() > nowMs) {
        return;
      }
      const sellerRef = stateRef(firestore, listing.sellerUid);
      const sellerSnapshot = await transaction.get(sellerRef);
      if (sellerSnapshot.exists) {
        const seller = sellerSnapshot.data() as MarketplacePlayerState;
        transaction.update(sellerRef, {
          ownedTruckSnapshots: seller.ownedTruckSnapshots.map((vehicle) =>
            vehicle.marketplaceListingId === listing.id
              ? { ...vehicle, status: 'idle', marketplaceListingId: null }
              : vehicle,
          ),
          activeListingIds: FieldValue.arrayRemove(listing.id),
          stateVersion: seller.stateVersion + 1,
          updatedAt: now,
        });
      }
      transaction.update(fresh.ref, {
        status: 'expired',
        version: listing.version + 1,
        updatedAt: now,
      });
      count += 1;
    });
  }
  return count;
}

/**
 * Firestore TTL gecikse veya production'da henüz etkin değilse ephemeral
 * idempotency koleksiyonlarının sınırsız büyümesini engelleyen bounded fallback.
 */
export async function cleanupVehicleMarketplaceEphemeralRecords(
  firestore: Firestore,
  nowMs = Date.now(),
): Promise<{ idempotencyDeleted: number; receiptsDeleted: number; rateLimitsDeleted: number }> {
  const expiresBefore = Timestamp.fromMillis(nowMs);
  const collections = [
    'vehicleMarketplaceIdempotency',
    'vehicleMarketplaceActionReceipts',
    'vehicleMarketplaceRateLimits',
  ] as const;
  const counts = {
    idempotencyDeleted: 0,
    receiptsDeleted: 0,
    rateLimitsDeleted: 0,
  };
  for (const collectionName of collections) {
    const expired = await firestore
      .collection(collectionName)
      .where('expiresAt', '<=', expiresBefore)
      .limit(250)
      .get();
    if (expired.empty) continue;
    const batch = firestore.batch();
    for (const document of expired.docs) batch.delete(document.ref);
    await batch.commit();
    if (collectionName === 'vehicleMarketplaceIdempotency') {
      counts.idempotencyDeleted += expired.size;
    } else if (collectionName === 'vehicleMarketplaceActionReceipts') {
      counts.receiptsDeleted += expired.size;
    } else {
      counts.rateLimitsDeleted += expired.size;
    }
  }
  return counts;
}

/** Hesap silme öncesi aktif ilanları iptal eder, geçmişteki adı anonimleştirir. */
export async function prepareMarketplaceAccountDeletion(
  firestore: Firestore,
  uid: string,
  nowMs = Date.now(),
): Promise<{ cancelledListings: number; anonymizedListings: number }> {
  const now = Timestamp.fromMillis(nowMs);
  const anonymizedUid = `deleted:${createHash('sha256')
    .update(uid)
    .digest('hex')
    .slice(0, 20)}`;
  let cancelledListings = 0;
  let anonymizedListings = 0;
  let listingCursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (true) {
    let query = firestore
      .collection('vehicleMarketplaceListings')
      .where('sellerUid', '==', uid)
      .orderBy(FieldPath.documentId())
      .limit(200);
    if (listingCursor) query = query.startAfter(listingCursor);
    const listings = await query.get();
    if (listings.empty) break;
    for (const snapshot of listings.docs) {
    await firestore.runTransaction(async (transaction) => {
      const fresh = await transaction.get(snapshot.ref);
      if (!fresh.exists) return;
      const listing = fresh.data() as MarketplaceListingDocument;
      const update: Record<string, unknown> = {
        sellerUid: anonymizedUid,
        sellerDisplayName: 'Silinmiş Oyuncu',
        updatedAt: now,
        version: listing.version + 1,
      };
      if (listing.status === 'active' || listing.status === 'reserved') {
        update.status = 'cancelled';
        cancelledListings += 1;
      }
      transaction.update(fresh.ref, update);
      anonymizedListings += 1;
    });
    }
    listingCursor = listings.docs.at(-1);
    if (listings.size < 200) break;
  }
  while (true) {
    const purchasedListings = await firestore
      .collection('vehicleMarketplaceListings')
      .where('buyerUid', '==', uid)
      .limit(200)
      .get();
    if (purchasedListings.empty) break;
    const batch = firestore.batch();
    for (const document of purchasedListings.docs) {
      batch.update(document.ref, {
        buyerUid: anonymizedUid,
        updatedAt: now,
      });
    }
    await batch.commit();
    if (purchasedListings.size < 200) break;
  }
  for (const identityField of ['sellerUid', 'buyerUid'] as const) {
    while (true) {
      const transactions = await firestore
        .collection('vehicleMarketplaceTransactions')
        .where(identityField, '==', uid)
        .limit(200)
        .get();
      if (transactions.empty) break;
      const batch = firestore.batch();
      for (const document of transactions.docs) {
        batch.update(document.ref, {
          [identityField]: anonymizedUid,
          updatedAt: now,
        });
      }
      await batch.commit();
      if (transactions.size < 200) break;
    }
  }
  const personalCollections = [
    `users/${uid}/marketplaceHistory`,
    `users/${uid}/marketplaceLedger`,
  ];
  for (const collectionPath of personalCollections) {
    while (true) {
      const documents = await firestore.collection(collectionPath).limit(400).get();
      if (documents.empty) break;
      const batch = firestore.batch();
      for (const document of documents.docs) {
        batch.delete(document.ref);
      }
      await batch.commit();
      if (documents.size < 400) break;
    }
  }
  for (const collectionName of [
    'vehicleMarketplaceIdempotency',
    'vehicleMarketplaceActionReceipts',
    'vehicleMarketplaceRateLimits',
  ]) {
    while (true) {
      const documents = await firestore
        .collection(collectionName)
        .where('uid', '==', uid)
        .limit(400)
        .get();
      if (documents.empty) break;
      const batch = firestore.batch();
      for (const document of documents.docs) batch.delete(document.ref);
      await batch.commit();
      if (documents.size < 400) break;
    }
  }
  await stateRef(firestore, uid).delete();
  return { cancelledListings, anonymizedListings };
}
