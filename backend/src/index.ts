import { createHash } from 'node:crypto';

import { initializeApp } from 'firebase-admin/app';
import { FieldPath, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { runGlobalEconomyEpoch } from './globalEconomyWorker';
import {
  deleteLeaderboardEntriesForUid,
  getLeaderboardSnapshot,
  submitLeaderboardScoreTransaction,
} from './leaderboard';
import { isValidLeaderboardSeasonKey } from './leaderboardSeason';
import {
  checkUsernameAvailabilityTransaction,
  getUsernameProfileForUid,
  releaseUsernameForUid,
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
  prepareMarketplaceAccountDeletion,
  purchaseVehicleListingTransaction,
} from './vehicleMarketplace';
import type {
  CancelVehicleListingInput,
  CreateVehicleListingInput,
  PurchaseVehicleListingInput,
} from './vehicleMarketplaceTypes';

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
  const record = requestRecord(request.data);
  const cursor = requestRecord(record.cursor);
  if (
    !hasOnlyKeys(record, ['limit', 'cursor']) ||
    (record.limit !== undefined &&
      (!Number.isInteger(record.limit) || Number(record.limit) < 1 || Number(record.limit) > 50)) ||
    (record.cursor !== undefined &&
      (!hasOnlyKeys(cursor, ['createdAt', 'id']) ||
        !Number.isFinite(cursor.createdAt) ||
        Number(cursor.createdAt) <= 0 ||
        !isBoundedId(cursor.id)))
  ) {
    return invalidRequestResult(record);
  }
  if (!(await consumeRateLimit(identity.uid, 'list'))) return rateLimitedResult(record);
  const limit = record.limit === undefined ? 20 : Number(record.limit);
  const cursorCreatedAt = Number(cursor.createdAt);
  const cursorId = cursor.id;
  let query = getFirestore()
    .collection('vehicleMarketplaceListings')
    .where('status', '==', 'active')
    .orderBy('createdAt', 'desc')
    .orderBy(FieldPath.documentId(), 'desc');
  if (
    Number.isFinite(cursorCreatedAt) &&
    cursorCreatedAt > 0 &&
    typeof cursorId === 'string' &&
    cursorId.length > 0
  ) {
    query = query.startAfter(Timestamp.fromMillis(cursorCreatedAt), cursorId);
  }
  const snapshot = await query.limit(limit + 1).get();
  const visibleDocs = snapshot.docs.slice(0, limit);
  const lastDocument = visibleDocs.at(-1);
  return {
    ok: true,
    listings: visibleDocs.map((document) => document.data()),
    hasMore: snapshot.docs.length > limit,
    nextCursor: lastDocument
      ? {
          createdAt:
            (lastDocument.data().createdAt as Timestamp | undefined)?.toMillis?.() ?? 0,
          id: lastDocument.id,
        }
      : null,
  };
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
  const result = {
    ok: true,
    listings: listings.docs.map((document) => document.data()),
    reconciliation: state.exists
      ? {
          marketplaceStateVersion: state.data()?.stateVersion ?? 0,
          cash: state.data()?.canonicalCash ?? 0,
          fleetLimit: state.data()?.fleetLimit ?? 0,
          soldTruckIds: state.data()?.soldTruckTombstones ?? [],
          vehicles: state.data()?.ownedTruckSnapshots ?? [],
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

export const prepareVehicleMarketplaceAccountDeletion = onCall(
  VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  async (request) => {
    const identity = callableIdentity(request);
    if (!identity) return unauthenticatedResult(request.data ?? {});
    const record = requestRecord(request.data);
    if (!hasOnlyKeys(record, [])) return invalidRequestResult(record);
    if (!(await consumeRateLimit(identity.uid, 'accountDeletion'))) {
      return rateLimitedResult(record);
    }
    const firestore = getFirestore();
    const marketplace = await prepareMarketplaceAccountDeletion(
      firestore,
      identity.uid,
    );
    const usernameCleanup = await releaseUsernameForUid(firestore, identity.uid);
    // Admin SDK recursive delete profile, saves/meta, alarms, notification
    // tokens ve bounded restore receipt alt koleksiyonlarını kapsar.
    await firestore.recursiveDelete(firestore.doc(`users/${identity.uid}`));
    const leaderboardEntriesDeleted = await deleteLeaderboardEntriesForUid(
      firestore,
      identity.uid,
    );
    logger.info('[account-deletion-cleanup]', {
      uidHash: uidHash(identity.uid),
      leaderboardEntriesDeleted,
      usernameReleased: usernameCleanup.usernameReleased,
      ...marketplace,
    });
    return {
      ok: true,
      ...marketplace,
      leaderboardEntriesDeleted,
      usernameReleased: usernameCleanup.usernameReleased,
    };
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
