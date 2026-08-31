import { createHash } from 'node:crypto';

import { initializeApp } from 'firebase-admin/app';
import { FieldPath, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { deleteLinkedAccount } from './accountDeletion';
import { runGlobalEconomyEpoch } from './globalEconomyWorker';
import {
  getLeaderboardSnapshot,
  submitLeaderboardScoreTransaction,
} from './leaderboard';
import { seedLeaderboardSeason } from './leaderboardSeasonSeed';
import {
  migrateLegacyServerStateTransaction,
} from './serverState';
import { reconcileAuthoritativeFleetTransaction } from './authoritativeFleetReconciliation';
import { parseMarketplaceListRequest } from './vehicleMarketplaceListRequest';
import { getLeaderboardSeasonKey, isValidLeaderboardSeasonKey } from './leaderboardSeason';
import {
  checkUsernameAvailabilityTransaction,
  getUsernameProfileForUid,
  setUsernameTransaction,
} from './username';
import {
  suggestUsernameFromDisplayName,
  USERNAME_CHANGE_COOLDOWN_MS,
} from './usernameValidation';
import {
  cancelVehicleListingTransaction,
  cleanupVehicleMarketplaceEphemeralRecords,
  createVehicleListingTransaction,
  ensureVehicleMarketplaceStateTransaction,
  expireVehicleMarketplaceListings,
  purchaseVehicleListingTransaction,
} from './vehicleMarketplace';
import {
  VEHICLE_MARKETPLACE_API_VERSION,
  listingDtoToClientWire,
  serializeMarketplaceListingsForClient,
  serializeReconciliationVehicleForClient,
  timestampToMillis,
} from './vehicleMarketplaceSerialization';
import type {
  CancelVehicleListingInput,
  CreateVehicleListingInput,
  PurchaseVehicleListingInput,
} from './vehicleMarketplaceTypes';
import { revokeAppleAuthorizationCode } from './appleTokenRevocation';
import {
  APPLE_SIGNIN_SECRETS,
  readAppleSignInSecretValuesFromBinding,
} from './appleSignInSecrets';

initializeApp();

const VEHICLE_MARKETPLACE_FUNCTION_OPTIONS = {
  region: 'us-central1',
  timeoutSeconds: 60,
  memory: '256MiB',
  maxInstances: 20,
} as const;

const MAX_ID_LENGTH = 128;
const MAX_CLIENT_SAVE_VERSION = 1_000_000_000;
const RATE_LIMITS = {
  create: { windowMs: 60 * 60 * 1000, maxRequests: 10 },
  cancel: { windowMs: 60 * 60 * 1000, maxRequests: 30 },
  purchase: { windowMs: 60 * 60 * 1000, maxRequests: 20 },
  list: { windowMs: 60 * 1000, maxRequests: 120 },
  myListings: { windowMs: 60 * 1000, maxRequests: 60 },
  accountDeletion: { windowMs: 24 * 60 * 60 * 1000, maxRequests: 3 },
  leaderboardSubmit: { windowMs: 60 * 60 * 1000, maxRequests: 30 },
  leaderboardGet: { windowMs: 60 * 1000, maxRequests: 60 },
  setUsername: { windowMs: 60 * 60 * 1000, maxRequests: 10 },
  checkUsername: { windowMs: 60 * 1000, maxRequests: 60 },
  migrateServerState: { windowMs: 24 * 60 * 60 * 1000, maxRequests: 3 },
} as const;

function requestRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

function hasOnlyKeys(
  data: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(data).every((key) => allowed.has(key));
}

function isBoundedId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_ID_LENGTH &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function isOptionalSaveVersion(value: unknown): boolean {
  return (
    value === undefined ||
    (Number.isInteger(value) &&
      Number(value) >= 0 &&
      Number(value) <= MAX_CLIENT_SAVE_VERSION)
  );
}

async function consumeRateLimit(
  uid: string,
  action: keyof typeof RATE_LIMITS,
  idempotencyKey?: string,
): Promise<boolean> {
  const firestore = getFirestore();
  const config = RATE_LIMITS[action];
  const nowMs = Date.now();
  const ref = firestore.doc(`vehicleMarketplaceRateLimits/${uid}_${action}`);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.data() as {
      windowStartedAtMs?: number;
      requestCount?: number;
      recentKeys?: string[];
    } | undefined;
    const sameWindow =
      Number.isFinite(current?.windowStartedAtMs) &&
      nowMs - Number(current?.windowStartedAtMs) < config.windowMs;
    const recentKeys = sameWindow && Array.isArray(current?.recentKeys)
      ? current.recentKeys.filter((key): key is string => typeof key === 'string').slice(-19)
      : [];
    if (idempotencyKey && recentKeys.includes(idempotencyKey)) return true;
    const requestCount = sameWindow ? Number(current?.requestCount ?? 0) : 0;
    if (requestCount >= config.maxRequests) return false;
    const nextKeys = idempotencyKey ? [...recentKeys, idempotencyKey] : recentKeys;
    transaction.set(ref, {
      uid,
      action,
      windowStartedAtMs: sameWindow ? current?.windowStartedAtMs : nowMs,
      requestCount: requestCount + 1,
      recentKeys: nextKeys,
      updatedAt: Timestamp.fromMillis(nowMs),
      expiresAt: Timestamp.fromMillis(nowMs + config.windowMs * 2),
    });
    return true;
  });
}

function rateLimitedResult(data: Record<string, unknown>) {
  return {
    ok: false,
    reason: 'rate-limited',
    transactionId: typeof data.transactionId === 'string' ? data.transactionId : '',
    idempotencyKey: typeof data.idempotencyKey === 'string' ? data.idempotencyKey : '',
  };
}

export const generateGlobalEconomy = onSchedule(
  {
    schedule: '0,30 * * * *',
    timeZone: 'UTC',
    retryCount: 3,
    maxInstances: 1,
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async () => {
    const startedAt = Date.now();
    try {
      const result = await runGlobalEconomyEpoch(getFirestore(), {
        nowMs: startedAt,
      });
      logger.info('[global-economy-worker]', {
        epoch: result.epoch,
        configVersion: result.configVersion,
        snapshotCreated: result.snapshotCreated,
        historyRecordsWritten: result.historyRecordsWritten,
        historyRecordsDeleted: result.historyRecordsDeleted,
        durationMs: Date.now() - startedAt,
        retryCount: result.retryCount,
      });
    } catch (error) {
      logger.error('[global-economy-worker]', {
        durationMs: Date.now() - startedAt,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : String(error),
      });
      throw error;
    }
  },
);

/** Haftalık sezon rollover — kayıtlı oyuncuları yeni sezona taşır. */
export const seedWeeklyLeaderboard = onSchedule(
  {
    schedule: '5 0 * * *',
    timeZone: 'UTC',
    retryCount: 2,
    maxInstances: 1,
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const startedAt = Date.now();
    const seasonKey = getLeaderboardSeasonKey(startedAt);
    try {
      const result = await seedLeaderboardSeason(getFirestore(), seasonKey, {
        nowMs: startedAt,
        maxDurationMs: 480_000,
      });
      logger.info('[leaderboard-season-seed]', {
        seasonKey: result.seasonKey,
        ran: result.ran,
        completed: result.completed,
        seeded: result.seeded,
        skipped: result.skipped,
        deleted: result.deleted,
        pagesProcessed: result.pagesProcessed,
        durationMs: result.durationMs,
      });
    } catch (error) {
      logger.error('[leaderboard-season-seed]', {
        seasonKey,
        durationMs: Date.now() - startedAt,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message }
            : String(error),
      });
      throw error;
    }
  },
);

function callableIdentity(request: {
  auth?: { uid: string; token: Record<string, unknown> };
}) {
  if (!request.auth?.uid) return null;
  const firebaseToken = request.auth.token.firebase;
  const signInProvider =
    firebaseToken &&
    typeof firebaseToken === 'object' &&
    'sign_in_provider' in firebaseToken
      ? String(
          (firebaseToken as { sign_in_provider?: unknown }).sign_in_provider ??
            '',
        )
      : '';
  if (signInProvider === 'anonymous') return null;
  return {
    uid: request.auth.uid,
    displayName:
      typeof request.auth.token.name === 'string'
        ? request.auth.token.name
        : null,
  };
}

function resolveSignInProvider(token: Record<string, unknown> | undefined): string {
  const firebaseToken = token?.firebase;
  if (
    firebaseToken &&
    typeof firebaseToken === 'object' &&
    'sign_in_provider' in firebaseToken
  ) {
    return String(
      (firebaseToken as { sign_in_provider?: unknown }).sign_in_provider ?? '',
    );
  }
  return '';
}

function resolveLeaderboardIdentity(request: {
  auth?: { uid: string; token: Record<string, unknown> };
}):
  | { ok: true; identity: { uid: string; displayName: string | null } }
  | { ok: false; reason: 'auth-required' | 'anonymous-not-supported' } {
  if (!request.auth?.uid) {
    return { ok: false, reason: 'auth-required' };
  }
  const signInProvider = resolveSignInProvider(request.auth.token);
  if (signInProvider === 'anonymous') {
    return { ok: false, reason: 'anonymous-not-supported' };
  }
  return {
    ok: true,
    identity: {
      uid: request.auth.uid,
      displayName:
        typeof request.auth.token.name === 'string'
          ? request.auth.token.name
          : null,
    },
  };
}

/** Username callables: linked hesap zorunlu (misafir oluşturamaz). */
function resolveUsernameIdentity(request: {
  auth?: { uid: string; token: Record<string, unknown> };
}):
  | {
      ok: true;
      identity: {
        uid: string;
        displayName: string | null;
        signInProvider: string;
      };
    }
  | { ok: false; reason: 'auth-required' | 'anonymous-not-supported' } {
  if (!request.auth?.uid) {
    return { ok: false, reason: 'auth-required' };
  }
  const signInProvider = resolveSignInProvider(request.auth.token);
  if (signInProvider === 'anonymous' || !signInProvider) {
    return { ok: false, reason: 'anonymous-not-supported' };
  }
  return {
    ok: true,
    identity: {
      uid: request.auth.uid,
      displayName:
        typeof request.auth.token.name === 'string'
          ? request.auth.token.name
          : null,
      signInProvider,
    },
  };
}

function uidHash(uid?: string | null): string | null {
  return uid
    ? createHash('sha256').update(uid).digest('hex').slice(0, 12)
    : null;
}

function unauthenticatedResult(data: Record<string, unknown>) {
  return {
    ok: false,
    reason: 'auth-required',
    transactionId:
      typeof data.transactionId === 'string' ? data.transactionId : '',
    idempotencyKey:
      typeof data.idempotencyKey === 'string' ? data.idempotencyKey : '',
  };
}

function invalidRequestResult(data: Record<string, unknown>) {
  return {
    ok: false,
    reason: 'invalid-request',
    transactionId:
      typeof data.transactionId === 'string' ? data.transactionId : '',
    idempotencyKey:
      typeof data.idempotencyKey === 'string' ? data.idempotencyKey : '',
  };
}

function hasActionEnvelope(
  data: unknown,
): data is { transactionId: string; idempotencyKey: string } {
  return Boolean(
    data &&
      typeof data === 'object' &&
      isBoundedId((data as Record<string, unknown>).transactionId) &&
      isBoundedId((data as Record<string, unknown>).idempotencyKey),
  );
}

export const createVehicleListing = onCall(VEHICLE_MARKETPLACE_FUNCTION_OPTIONS, async (request) => {
  const startedAt = Date.now();
  const identity = callableIdentity(request);
  if (!identity) return unauthenticatedResult(request.data ?? {});
  const record = requestRecord(request.data);
  if (
    !hasActionEnvelope(request.data) ||
    !hasOnlyKeys(record, [
      'transactionId',
      'idempotencyKey',
      'truckId',
      'askingPrice',
      'clientSaveVersion',
    ]) ||
    !isBoundedId(record.truckId) ||
    !Number.isFinite(record.askingPrice) ||
    Number(record.askingPrice) <= 0 ||
    !isOptionalSaveVersion(record.clientSaveVersion)
  ) {
    return invalidRequestResult(request.data ?? {});
  }
  if (!(await consumeRateLimit(identity.uid, 'create', record.idempotencyKey as string))) {
    return rateLimitedResult(record);
  }
  const data = request.data as CreateVehicleListingInput;
  const result = await createVehicleListingTransaction(
    getFirestore(),
    identity,
    data,
  );
  logger.info('[vehicle-marketplace-create]', {
    transactionId: data.transactionId,
    listingId: result.data?.listingId ?? null,
    sellerUidHash: uidHash(identity.uid),
    buyerUidHash: null,
    durationMs: Date.now() - startedAt,
    result: result.ok ? 'success' : result.reason,
    retryCount: result.retryCount ?? 0,
  });
  return result;
});

export const cancelVehicleListing = onCall(VEHICLE_MARKETPLACE_FUNCTION_OPTIONS, async (request) => {
  const startedAt = Date.now();
  const identity = callableIdentity(request);
  if (!identity) return unauthenticatedResult(request.data ?? {});
  const record = requestRecord(request.data);
  if (
    !hasActionEnvelope(request.data) ||
    !hasOnlyKeys(record, [
      'transactionId',
      'idempotencyKey',
      'listingId',
      'listingVersion',
    ]) ||
    !isBoundedId(record.listingId) ||
    !Number.isInteger(record.listingVersion) ||
    Number(record.listingVersion) < 1
  ) {
    return invalidRequestResult(request.data ?? {});
  }
  if (!(await consumeRateLimit(identity.uid, 'cancel', record.idempotencyKey as string))) {
    return rateLimitedResult(record);
  }
  const data = request.data as CancelVehicleListingInput;
  const result = await cancelVehicleListingTransaction(
    getFirestore(),
    identity,
    data,
  );
  logger.info('[vehicle-marketplace-cancel]', {
    transactionId: data.transactionId,
    listingId: data.listingId,
    sellerUidHash: uidHash(identity.uid),
    buyerUidHash: null,
    durationMs: Date.now() - startedAt,
    result: result.ok ? 'success' : result.reason,
    retryCount: result.retryCount ?? 0,
  });
  return result;
});

export const purchaseVehicleListing = onCall(VEHICLE_MARKETPLACE_FUNCTION_OPTIONS, async (request) => {
  const startedAt = Date.now();
  const identity = callableIdentity(request);
  if (!identity) return unauthenticatedResult(request.data ?? {});
  const record = requestRecord(request.data);
  if (
    !hasActionEnvelope(request.data) ||
    !hasOnlyKeys(record, [
      'transactionId',
      'idempotencyKey',
      'listingId',
      'listingVersion',
      'quotedPrice',
      'clientSaveVersion',
    ]) ||
    !isBoundedId(record.listingId) ||
    !Number.isInteger(record.listingVersion) ||
    Number(record.listingVersion) < 1 ||
    !Number.isFinite(record.quotedPrice) ||
    Number(record.quotedPrice) <= 0 ||
    !isOptionalSaveVersion(record.clientSaveVersion)
  ) {
    return invalidRequestResult(request.data ?? {});
  }
  if (!(await consumeRateLimit(identity.uid, 'purchase', record.idempotencyKey as string))) {
    return rateLimitedResult(record);
  }
  const data = request.data as PurchaseVehicleListingInput;
  const firestore = getFirestore();
  const sellerUid = (
    await firestore.doc(`vehicleMarketplaceListings/${data.listingId}`).get()
  ).data()?.sellerUid as string | undefined;
  const result = await purchaseVehicleListingTransaction(
    firestore,
    identity,
    data,
  );
  logger.info('[MARKETPLACE_PURCHASE] transaction committed', {
    transactionId: data.transactionId,
    listingId: data.listingId,
    sellerUidHash: uidHash(sellerUid),
    buyerUidHash: uidHash(identity.uid),
    price: data.quotedPrice,
    serverMoneyBefore: result.data?.buyerCashBefore ?? null,
    serverMoneyAfter: result.data?.buyerCashAfter ?? null,
    durationMs: Date.now() - startedAt,
    result: result.ok ? 'success' : result.reason,
    retryCount: result.retryCount ?? 0,
  });
  logger.info('[vehicle-marketplace-purchase]', {
    transactionId: data.transactionId,
    listingId: data.listingId,
    sellerUidHash: uidHash(sellerUid),
    buyerUidHash: uidHash(identity.uid),
    durationMs: Date.now() - startedAt,
    result: result.ok ? 'success' : result.reason,
    retryCount: result.retryCount ?? 0,
  });
  return result;
});

export const getVehicleMarketplaceListings = onCall(VEHICLE_MARKETPLACE_FUNCTION_OPTIONS, async (request) => {
  const identity = callableIdentity(request);
  if (!identity) return unauthenticatedResult(request.data ?? {});
  const parsedRequest = parseMarketplaceListRequest(request.data);
  if (!parsedRequest) {
    logger.warn('[vehicle-marketplace-list-invalid-request]', {
      uidHash: uidHash(identity.uid),
      keys: Object.keys(requestRecord(request.data)),
      cursorType: typeof requestRecord(request.data).cursor,
    });
    return invalidRequestResult(requestRecord(request.data));
  }
  const { limit, cursor } = parsedRequest;
  if (!(await consumeRateLimit(identity.uid, 'list'))) return rateLimitedResult(requestRecord(request.data));
  try {
    let query = getFirestore()
      .collection('vehicleMarketplaceListings')
      .where('status', '==', 'active')
      .orderBy('createdAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');
    if (cursor) {
      query = query.startAfter(Timestamp.fromMillis(cursor.createdAt), cursor.id);
    }
    const snapshot = await query.limit(limit + 1).get();
    const visibleDocs = snapshot.docs.slice(0, limit);
    const lastDocument = visibleDocs.at(-1);
    const serialized = serializeMarketplaceListingsForClient(visibleDocs);
    if (serialized.rejectedCount > 0) {
      logger.warn('[vehicle-marketplace-list-serialize]', {
        rejectedCount: serialized.rejectedCount,
        samples: serialized.rejected.slice(0, 3),
      });
    }
    return {
      ok: true,
      apiVersion: VEHICLE_MARKETPLACE_API_VERSION,
      listings: serialized.listings.map((listing) => listingDtoToClientWire(listing)),
      rejectedCount: serialized.rejectedCount,
      hasMore: snapshot.docs.length > limit,
      nextCursor: lastDocument
        ? {
            createdAt:
              serialized.listings.at(-1)?.createdAtMs ??
              timestampToMillis(lastDocument.data().createdAt) ??
              0,
            id: lastDocument.id,
          }
        : null,
    };
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : error instanceof Error
          ? error.message
          : String(error);
    logger.error('[MARKETPLACE_LOAD_ERROR]', {
      uidHash: uidHash(identity.uid),
      code,
      message: error instanceof Error ? error.message : String(error),
      pathOrFunction: 'vehicleMarketplaceListings',
    });
    return {
      ok: false,
      reason: code.includes('permission-denied') ? 'permission-denied' : 'service-unavailable',
      transactionId: '',
      idempotencyKey: '',
    };
  }
});

export const getMyVehicleListings = onCall(VEHICLE_MARKETPLACE_FUNCTION_OPTIONS, async (request) => {
  const startedAt = Date.now();
  const identity = callableIdentity(request);
  if (!identity) return unauthenticatedResult(request.data ?? {});
  const record = requestRecord(request.data);
  if (!hasOnlyKeys(record, [])) return invalidRequestResult(record);
  if (!(await consumeRateLimit(identity.uid, 'myListings'))) return rateLimitedResult(record);
  const firestore = getFirestore();
  const initializationId = `marketplace-read-${identity.uid}`;
  const initialization = await ensureVehicleMarketplaceStateTransaction(
    firestore,
    identity,
    {
      transactionId: initializationId,
      idempotencyKey: initializationId,
    },
  );
  if (!initialization.ok) return initialization;
  const [listings, state] = await Promise.all([
    firestore
      .collection('vehicleMarketplaceListings')
      .where('sellerUid', '==', identity.uid)
      .limit(50)
      .get(),
    firestore.doc(`users/${identity.uid}/marketplaceState/current`).get(),
  ]);
  const serialized = serializeMarketplaceListingsForClient(listings.docs);
  if (serialized.rejectedCount > 0) {
    logger.warn('[vehicle-marketplace-my-listings-serialize]', {
      uidHash: uidHash(identity.uid),
      rejectedCount: serialized.rejectedCount,
      samples: serialized.rejected.slice(0, 3),
    });
  }
  const ownedSnapshots = Array.isArray(state.data()?.ownedTruckSnapshots)
    ? (state.data()?.ownedTruckSnapshots as Record<string, unknown>[])
    : [];
  const serializedVehicles = ownedSnapshots.map((vehicle) =>
    serializeReconciliationVehicleForClient(vehicle),
  );
  const vehicles = serializedVehicles.filter(
    (vehicle): vehicle is Record<string, unknown> => vehicle != null,
  );
  const droppedOwnedCount = ownedSnapshots.length - vehicles.length;
  if (droppedOwnedCount > 0) {
    logger.error('[vehicle-marketplace-reconciliation-incomplete]', {
      uidHash: uidHash(identity.uid),
      ownedCount: ownedSnapshots.length,
      serializedCount: vehicles.length,
      droppedOwnedCount,
    });
  }
  const result = {
    ok: true,
    apiVersion: VEHICLE_MARKETPLACE_API_VERSION,
    listings: serialized.listings.map((listing) => listingDtoToClientWire(listing)),
    rejectedCount: serialized.rejectedCount,
    reconciliation: state.exists
      ? {
          marketplaceStateVersion: state.data()?.stateVersion ?? 0,
          cash: state.data()?.canonicalCash ?? 0,
          fleetLimit: state.data()?.fleetLimit ?? 0,
          soldTruckIds: state.data()?.soldTruckTombstones ?? [],
          vehicles,
          incomplete: droppedOwnedCount > 0,
          droppedOwnedCount,
        }
      : null,
  };
  logger.info('[vehicle-marketplace-reconciliation]', {
    transactionId: null,
    listingId: null,
    sellerUidHash: uidHash(identity.uid),
    buyerUidHash: null,
    durationMs: Date.now() - startedAt,
    result: result.reconciliation ? 'success' : 'state-missing',
    retryCount: 0,
  });
  return result;
});

export const revokeAppleSignInTokens = onCall(
  {
    ...VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
    secrets: [...APPLE_SIGNIN_SECRETS],
  },
  async (request) => {
    const identity = callableIdentity(request);
    if (!identity) return unauthenticatedResult(request.data ?? {});
    const record = requestRecord(request.data);
    if (!hasOnlyKeys(record, ['authorizationCode'])) return invalidRequestResult(record);
    if (
      typeof record.authorizationCode !== 'string' ||
      record.authorizationCode.trim().length === 0 ||
      record.authorizationCode.length > 4096
    ) {
      return invalidRequestResult(record);
    }
    if (!(await consumeRateLimit(identity.uid, 'accountDeletion'))) {
      return rateLimitedResult(record);
    }
    const result = await revokeAppleAuthorizationCode(
      record.authorizationCode,
      readAppleSignInSecretValuesFromBinding(),
    );
    if (result.ok) {
      logger.info('[apple-revoke]', { uidHash: uidHash(identity.uid), revoked: true });
      return { ok: true };
    }
    logger.warn('[apple-revoke]', {
      uidHash: uidHash(identity.uid),
      reason: result.reason,
    });
    return { ok: false, reason: result.reason };
  },
);

export const prepareVehicleMarketplaceAccountDeletion = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const identity = callableIdentity(request);
    if (!identity) return unauthenticatedResult(request.data ?? {});
    const record = requestRecord(request.data);
    if (!hasOnlyKeys(record, ['authorizationCode'])) return invalidRequestResult(record);
    const authorizationCode =
      typeof record.authorizationCode === 'string' ? record.authorizationCode.trim() : undefined;
    if (
      record.authorizationCode !== undefined &&
      (!authorizationCode || authorizationCode.length > 4096)
    ) {
      return invalidRequestResult(record);
    }
    if (!(await consumeRateLimit(identity.uid, 'accountDeletion'))) {
      return rateLimitedResult(record);
    }
    const firestore = getFirestore();
    const deletionResult = await deleteLinkedAccount(firestore, {
      uid: identity.uid,
      authorizationCode,
    });
    if (!deletionResult.ok) {
      logger.warn('[account-deletion-failed]', {
        uidHash: uidHash(identity.uid),
        stage: deletionResult.stage,
        reason: deletionResult.reason,
        code: deletionResult.code,
      });
      return {
        ok: false,
        stage: deletionResult.stage,
        reason: deletionResult.reason,
        code: deletionResult.code,
      };
    }
    logger.info('[account-deletion-cleanup]', {
      uidHash: uidHash(identity.uid),
      ...deletionResult,
    });
    return deletionResult;
  },
);

export const setUsername = onCall(VEHICLE_MARKETPLACE_FUNCTION_OPTIONS, async (request) => {
  const startedAt = Date.now();
  const auth = resolveUsernameIdentity(request);
  const record = requestRecord(request.data);
  if (!auth.ok) {
    return { ok: false, reason: auth.reason };
  }
  if (
    !hasOnlyKeys(record, ['username']) ||
    typeof record.username !== 'string' ||
    record.username.length > 40
  ) {
    return { ok: false, reason: 'invalid-request' };
  }
  if (!(await consumeRateLimit(auth.identity.uid, 'setUsername'))) {
    return { ok: false, reason: 'rate-limited' };
  }
  const result = await setUsernameTransaction(
    getFirestore(),
    auth.identity,
    record.username,
  );
  logger.info('[username-set]', {
    uidHash: uidHash(auth.identity.uid),
    ok: result.ok,
    reason: result.ok ? 'success' : result.reason,
    durationMs: Date.now() - startedAt,
  });
  return result;
});

export const checkUsernameAvailability = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveUsernameIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason };
    }
    if (
      !hasOnlyKeys(record, ['username']) ||
      typeof record.username !== 'string' ||
      record.username.length > 40
    ) {
      return { ok: false, reason: 'invalid-request' };
    }
    if (!(await consumeRateLimit(auth.identity.uid, 'checkUsername'))) {
      return { ok: false, reason: 'rate-limited' };
    }
    return checkUsernameAvailabilityTransaction(
      getFirestore(),
      auth.identity,
      record.username,
    );
  },
);

export const getUsernameProfile = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const auth = resolveUsernameIdentity(request);
    if (!auth.ok) {
      return { ok: false, reason: auth.reason };
    }
    const record = requestRecord(request.data);
    if (!hasOnlyKeys(record, [])) {
      return { ok: false, reason: 'invalid-request' };
    }
    const profile = await getUsernameProfileForUid(getFirestore(), auth.identity.uid);
    return {
      ok: true,
      username: profile.username,
      usernameSetupCompleted: profile.usernameSetupCompleted,
      usernameChangeCount: profile.usernameChangeCount,
      usernameUpdatedAtMs: profile.usernameUpdatedAtMs,
      suggestedUsername: suggestUsernameFromDisplayName(auth.identity.displayName),
      nextChangeAvailableAtMs:
        profile.usernameUpdatedAtMs != null && profile.usernameSetupCompleted
          ? profile.usernameUpdatedAtMs + USERNAME_CHANGE_COOLDOWN_MS
          : null,
    };
  },
);

export const submitLeaderboardScore = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const startedAt = Date.now();
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return {
        ok: false,
        reason: auth.reason,
        transactionId: typeof record.transactionId === 'string' ? record.transactionId : '',
        idempotencyKey:
          typeof record.idempotencyKey === 'string' ? record.idempotencyKey : '',
      };
    }
    if (
      !hasActionEnvelope(request.data) ||
      !hasOnlyKeys(record, ['transactionId', 'idempotencyKey', 'clientSaveVersion']) ||
      !isOptionalSaveVersion(record.clientSaveVersion)
    ) {
      return invalidRequestResult(record);
    }
    // Client may not spoof UID — only request.auth.uid is used.
    if ('uid' in record || 'score' in record || 'companyScore' in record) {
      return invalidRequestResult(record);
    }
    if (
      !(await consumeRateLimit(
        auth.identity.uid,
        'leaderboardSubmit',
        record.idempotencyKey as string,
      ))
    ) {
      return rateLimitedResult(record);
    }
    const result = await submitLeaderboardScoreTransaction(
      getFirestore(),
      auth.identity,
      {
        transactionId: record.transactionId as string,
        idempotencyKey: record.idempotencyKey as string,
        clientSaveVersion:
          record.clientSaveVersion === undefined
            ? undefined
            : Number(record.clientSaveVersion),
      },
    );
    logger.info('[leaderboard-submit]', {
      uidHash: uidHash(auth.identity.uid),
      seasonKey: result.ok ? result.seasonKey : null,
      updated: result.ok ? result.updated : false,
      reason: result.ok ? result.reason ?? 'success' : result.reason,
      durationMs: Date.now() - startedAt,
      retryCount: result.retryCount ?? 0,
    });
    return result;
  },
);

export const getLeaderboard = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const startedAt = Date.now();
    const auth = resolveLeaderboardIdentity(request);
    const record = requestRecord(request.data);
    if (!auth.ok) {
      return {
        ok: false,
        reason: auth.reason,
        seasonKey: '',
      };
    }
    const cursor = requestRecord(record.cursor);
    if (
      !hasOnlyKeys(record, ['seasonKey', 'limit', 'cursor']) ||
      (record.seasonKey !== undefined &&
        !isValidLeaderboardSeasonKey(record.seasonKey)) ||
      (record.limit !== undefined &&
        (!Number.isInteger(record.limit) ||
          Number(record.limit) < 1 ||
          Number(record.limit) > 100)) ||
      (record.cursor !== undefined &&
        (!hasOnlyKeys(cursor, ['companyScore', 'uid']) ||
          !Number.isFinite(cursor.companyScore) ||
          !isBoundedId(cursor.uid)))
    ) {
      return {
        ok: false,
        reason: 'invalid-request',
        seasonKey:
          typeof record.seasonKey === 'string' ? record.seasonKey : '',
      };
    }
    if (!(await consumeRateLimit(auth.identity.uid, 'leaderboardGet'))) {
      return {
        ok: false,
        reason: 'rate-limited',
        seasonKey:
          typeof record.seasonKey === 'string' ? record.seasonKey : '',
      };
    }
    const result = await getLeaderboardSnapshot(
      getFirestore(),
      auth.identity,
      {
        seasonKey:
          typeof record.seasonKey === 'string' ? record.seasonKey : undefined,
        limit: record.limit === undefined ? undefined : Number(record.limit),
        cursor:
          record.cursor === undefined
            ? undefined
            : {
                companyScore: Number(cursor.companyScore),
                uid: String(cursor.uid),
              },
      },
    );
    logger.info('[leaderboard-get]', {
      uidHash: uidHash(auth.identity.uid),
      seasonKey: result.seasonKey,
      ok: result.ok,
      entryCount: result.ok ? result.entries.length : 0,
      durationMs: Date.now() - startedAt,
    });
    return result;
  },
);

export const migrateLegacyServerState = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const identity = callableIdentity(request);
    if (!identity) return unauthenticatedResult(request.data ?? {});
    const record = requestRecord(request.data);
    if (
      !hasOnlyKeys(record, ['dryRun']) ||
      (record.dryRun !== undefined && typeof record.dryRun !== 'boolean')
    ) {
      return invalidRequestResult(record);
    }
    if (!(await consumeRateLimit(identity.uid, 'migrateServerState'))) {
      return rateLimitedResult(record);
    }
    const dryRun = record.dryRun === true;
    const result = await migrateLegacyServerStateTransaction(
      getFirestore(),
      identity.uid,
      dryRun,
    );
    logger.info('[server-state-migration]', {
      uidHash: uidHash(identity.uid),
      dryRun,
      ok: result.ok,
      reason: result.ok ? 'success' : result.reason,
      flags: result.report?.flags ?? [],
    });
    return result;
  },
);

export const reconcileAuthoritativeFleet = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const identity = callableIdentity(request);
    if (!identity) return unauthenticatedResult(request.data ?? {});
    const record = requestRecord(request.data);
    if (
      !hasOnlyKeys(record, ['force', 'requestedVehicleId']) ||
      (record.force !== undefined && typeof record.force !== 'boolean') ||
      (record.requestedVehicleId !== undefined &&
        !isBoundedId(record.requestedVehicleId))
    ) {
      return invalidRequestResult(record);
    }
    if (!(await consumeRateLimit(identity.uid, 'migrateServerState'))) {
      return rateLimitedResult(record);
    }
    const result = await reconcileAuthoritativeFleetTransaction(
      getFirestore(),
      identity.uid,
      Date.now(),
      {
        force: record.force === true,
        requestedVehicleId:
          typeof record.requestedVehicleId === 'string'
            ? record.requestedVehicleId
            : undefined,
      },
    );
    logger.info('[reconcile-authoritative-fleet]', {
      uidHash: uidHash(identity.uid),
      ok: result.ok,
      reconciled: result.ok ? result.reconciled : false,
      truckCount: result.ok ? result.state.ownedTruckSnapshots.length : 0,
      reason: result.ok ? null : result.reason,
    });
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason,
        transactionId: '',
        idempotencyKey: '',
      };
    }
    return {
      ok: true,
      reconciled: result.reconciled,
      marketplaceStateVersion: result.state.stateVersion,
      sourceSaveVersion: result.state.sourceSaveVersion,
      ownedTruckIds: result.state.ownedTruckSnapshots.map((truck) => truck.truckId),
    };
  },
);

export const expireVehicleMarketplace = onSchedule(
  {
    schedule: '15 * * * *',
    timeZone: 'UTC',
    retryCount: 2,
    maxInstances: 1,
    timeoutSeconds: 120,
    memory: '256MiB',
  },
  async () => {
    const firestore = getFirestore();
    const [expiredListings, cleanup] = await Promise.all([
      expireVehicleMarketplaceListings(firestore),
      cleanupVehicleMarketplaceEphemeralRecords(firestore),
    ]);
    logger.info('[vehicle-marketplace-expiry]', {
      expiredListings,
      ...cleanup,
    });
  },
);
